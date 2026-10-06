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
  await assert.rejects(net.setToken('123456:SECRETtoken'), (e) => e.statusCode === 400 && !e.message.includes('SECRETtoken'));
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
  bot.push({ update_id: 10, message: { text: `/start ${code}`, chat: { id: 555 } } });
  assert.equal(await linker.pollOnce(), 1);
  assert.equal(linker.isLinked('khach'), true);
  bot.push({ update_id: 11, message: { text: `/start ${code}`, chat: { id: 999 } } });
  assert.equal(await linker.pollOnce(), 0);
  await linker.sendTo('khach', 'thử');
  assert.equal(String(bot.sent.at(-1).chat_id), '555'); // chatId lưu dạng chuỗi (Telegram nhận cả hai)
});

test('mã nối hết hạn sau 10 phút', async (t) => {
  const bot = fakeBot(); const clock = { t: 0 }; const { linker } = mk(t, bot, clock);
  await linker.setToken('1:tok');
  const code = new URL(linker.linkUrl('anh')).searchParams.get('start');
  clock.t = 10 * 60_000 + 1;
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 1 } } });
  assert.equal(await linker.pollOnce(), 0);
});
