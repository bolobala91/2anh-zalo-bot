import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramApi, createTelegramLinker } from './telegram.js';
import { fakeBot } from '../test-helpers.js';

function mk(t, bot, clock = { t: 0 }, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zd-tg-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'telegram.json');
  const linker = createTelegramLinker({ file, now: () => clock.t, apiFactory: (token) => createTelegramApi({ token, fetchImpl: bot.fetchImpl }), ...extra });
  return { linker, file };
}

test('lưu token sau khi kiểm getMe, che token khi đọc', async (t) => {
  const bot = fakeBot(); const { linker, file } = mk(t, bot);
  const r = await linker.setToken('123456:ABCDEFxyz');
  assert.equal(r.botUsername, 'canhbao_bot');
  assert.equal(linker.settings().tokenMasked, '123456:•••••xyz');
  assert.ok(readFileSync(file, 'utf8').includes('123456:ABCDEFxyz'));
});

test('từ chối token trùng bot Telegram của trợ lý', async (t) => {
  const bot = fakeBot(); const { linker } = mk(t, bot, { t: 0 }, { hermesTelegramToken: '123456:ABCDEFxyz' });
  await assert.rejects(linker.setToken('123456:ABCDEFxyz'), (e) => /bot riêng/.test(e.message) && e.statusCode === 400);
});

test('token sai dạng hoặc Telegram từ chối -> lỗi 400 tiếng Việt, không lộ token', async (t) => {
  const bot = fakeBot({ failGetMe: true }); const { linker } = mk(t, bot);
  await assert.rejects(linker.setToken('abc'), (e) => e.statusCode === 400);
  await assert.rejects(linker.setToken('123456:SECRETtoken'), (e) => e.statusCode === 400 && /@BotFather/.test(e.message) && !e.message.includes('SECRETtoken'));
  const net = mk(t, { fetchImpl: async (url) => { throw new Error(`fetch failed ${url}`); } }).linker;
  await assert.rejects(net.setToken('123456:SECRETtoken'), (e) => e.statusCode === 502 && !e.message.includes('SECRETtoken'));
});

test('lỗi mạng của API không chứa token trong message', async () => {
  const api = createTelegramApi({ token: '1:SECRET', fetchImpl: async (url) => { throw new Error(`boom ${url}`); } });
  await assert.rejects(api.getMe(), (e) => !e.message.includes('SECRET'));
});

test('mã nối chỉ lưu dạng băm sha256', async (t) => {
  const bot = fakeBot(); const { linker, file } = mk(t, bot);
  await linker.setToken('1:tok');
  const code = new URL(linker.linkUrl('khach')).searchParams.get('start');
  assert.ok(!readFileSync(file, 'utf8').includes(code));
});

test('nối người dùng bằng /start <mã> dùng một lần', async (t) => {
  const bot = fakeBot(); const clock = { t: 0 }; const { linker } = mk(t, bot, clock);
  await linker.setToken('1:tok');
  const url = linker.linkUrl('khach');
  const code = new URL(url).searchParams.get('start');
  assert.match(url, /^https:\/\/t\.me\/canhbao_bot\?start=/);
  bot.push({ update_id: 10, message: { text: `/start ${code}`, chat: { id: 555, type: 'private' } } });
  assert.equal(await linker.pollOnce(), 1);
  assert.equal(linker.isLinked('khach'), true);
  bot.push({ update_id: 11, message: { text: `/start ${code}`, chat: { id: 999, type: 'private' } } });
  assert.equal(await linker.pollOnce(), 0);
  await linker.sendTo('khach', 'thử');
  assert.equal(String(bot.sent.at(-1).chat_id), '555'); // chatId lưu dạng chuỗi (Telegram nhận cả hai)
});

test('broadcast bỏ qua người dùng đã bị khoá hoặc xoá', async (t) => {
  const bot = fakeBot(); const active = new Set(['anh']);
  const { linker } = mk(t, bot, { t: 0 }, { isActive: (u) => active.has(u) });
  await linker.setToken('1:tok');
  let id = 20;
  for (const [user, chat] of [['anh', 1], ['khach', 2], ['da-xoa', 3]]) {
    const code = new URL(linker.linkUrl(user)).searchParams.get('start');
    bot.push({ update_id: id++, message: { text: `/start ${code}`, chat: { id: chat, type: 'private' } } });
  }
  await linker.pollOnce();
  bot.sent.length = 0;
  assert.equal(await linker.broadcast('⚠️ thử'), 1, 'trả về số tin gửi được');
  assert.deepEqual(bot.sent.map((m) => String(m.chat_id)), ['1']);
});

test('broadcast trả 0 khi chưa cài bot Telegram', async (t) => {
  const { linker } = mk(t, fakeBot(), { t: 0 });
  assert.equal(await linker.broadcast('⚠️ thử'), 0);
});

test('mã nối hết hạn sau 10 phút', async (t) => {
  const bot = fakeBot(); const clock = { t: 0 }; const { linker } = mk(t, bot, clock);
  await linker.setToken('1:tok');
  const code = new URL(linker.linkUrl('anh')).searchParams.get('start');
  clock.t = 10 * 60_000 + 1;
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 1, type: 'private' } } });
  assert.equal(await linker.pollOnce(), 0);
});

const linkCode = (linker, u) => new URL(linker.linkUrl(u)).searchParams.get('start');

test('pollOnce không ghi đè linkUrl chạy đồng thời trong lúc gửi tin xác nhận', async (t) => {
  const bot = fakeBot(); const d = mkdtempSync(join(tmpdir(), 'zd-tg-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'telegram.json'); let linker;
  const api = (token) => { const a = createTelegramApi({ token, fetchImpl: bot.fetchImpl }); return { ...a, sendMessage: async (c, x) => { linker.linkUrl('other'); return a.sendMessage(c, x); } }; };
  linker = createTelegramLinker({ file, apiFactory: api });
  await linker.setToken('1:tok');
  const code = linkCode(linker, 'khach');
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 5, type: 'private' } } });
  assert.equal(await linker.pollOnce(), 1);
  assert.equal(Object.values(JSON.parse(readFileSync(file, 'utf8')).pending).filter((p) => p.username === 'other').length, 1);
});

test('đổi token trong lúc getUpdates đang chờ -> bỏ kết quả cũ', async (t) => {
  const bot = fakeBot(); let release; const gate = new Promise((r) => { release = r; });
  const { linker, file } = mk(t, bot);
  await linker.setToken('1:tok');
  const code = linkCode(linker, 'khach');
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 5, type: 'private' } } });
  const slow = createTelegramLinker({ file, apiFactory: (token) => { const a = createTelegramApi({ token, fetchImpl: bot.fetchImpl }); return { ...a, getUpdates: async (o) => { const r = await a.getUpdates(o); await gate; return r; } }; } });
  const p = slow.pollOnce();
  await new Promise((r) => setTimeout(r, 10));
  await linker.setToken('2:other');
  release();
  assert.equal(await p, 0);
  const s = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(s.offset, 0); assert.deepEqual(s.links, {});
});

test('setToken: lỗi mạng -> 502, ok:false -> 400', async (t) => {
  const net = mk(t, { fetchImpl: async () => { throw new Error('x'); } }).linker;
  await assert.rejects(net.setToken('1:abc'), (e) => e.statusCode === 502 && /Không kết nối được Telegram/.test(e.message));
  const bad = mk(t, fakeBot({ failGetMe: true })).linker;
  await assert.rejects(bad.setToken('1:abc'), (e) => e.statusCode === 400);
});

test('/start@Bot <mã> trong chat riêng nối được; chat nhóm thì không', async (t) => {
  const bot = fakeBot(); const { linker } = mk(t, bot);
  await linker.setToken('1:tok');
  const code = linkCode(linker, 'khach');
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: -9, type: 'group' } } });
  assert.equal(await linker.pollOnce(), 0);
  assert.equal(linker.isLinked('khach'), false);
  bot.push({ update_id: 2, message: { text: `/start@canhbao_bot ${code}`, chat: { id: 5, type: 'private' } } });
  assert.equal(await linker.pollOnce(), 1);
  assert.equal(linker.isLinked('khach'), true);
});

test('mỗi người dùng chỉ giữ một mã chờ', async (t) => {
  const bot = fakeBot(); const { linker, file } = mk(t, bot);
  await linker.setToken('1:tok');
  linker.linkUrl('khach'); linker.linkUrl('khach');
  assert.equal(Object.keys(JSON.parse(readFileSync(file, 'utf8')).pending).length, 1);
});
