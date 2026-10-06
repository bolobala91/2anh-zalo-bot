import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDeps, startApp, loginAs, fakeBot } from '../test-helpers.js';

async function setup(t, role = 'admin') {
  const bot = fakeBot();
  const deps = makeDeps(t, { bot });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: role === 'admin' ? 'anh' : 'khach', role });
  return { deps, call, cookie, bot };
}

test('link: cần đăng nhập; chưa cài bot -> 409', async (t) => {
  const { call, cookie } = await setup(t);
  assert.equal((await call('/api/telegram/link', { method: 'POST' })).status, 401);
  const r = await call('/api/telegram/link', { method: 'POST', cookie });
  assert.equal(r.status, 409);
});

test('admin cài token, link trả url, status báo đã nối sau khi nối', async (t) => {
  const { deps, call, cookie, bot } = await setup(t);
  const put = await call('/api/admin/telegram', { method: 'PUT', cookie, body: { token: '123456:ABCDEFxyz' } });
  assert.equal(put.status, 200);
  assert.equal(put.json.tokenMasked, '123456:•••••xyz');
  assert.ok(!JSON.stringify(put.json).includes('ABCDEF'));
  const get = await call('/api/admin/telegram', { cookie });
  assert.ok(!JSON.stringify(get.json).includes('ABCDEF'));
  assert.equal(get.json.token, undefined);
  const link = await call('/api/telegram/link', { method: 'POST', cookie });
  assert.match(link.json.url, /^https:\/\/t\.me\/canhbao_bot\?start=/);
  assert.equal((await call('/api/telegram/test', { method: 'POST', cookie })).status, 409);
  const code = new URL(link.json.url).searchParams.get('start');
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 7 } } });
  await deps.linker.pollOnce();
  assert.equal((await call('/api/telegram/test', { method: 'POST', cookie })).status, 200);
  const st = await call('/api/status', { cookie });
  assert.equal(st.json.telegramLinked, true);
});

test('token bị Telegram từ chối -> 400 tiếng Việt; owner PUT -> 403', async (t) => {
  const { deps, call, cookie } = await setup(t);
  const bad = await call('/api/admin/telegram', { method: 'PUT', cookie, body: { token: 'rác' } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /BotFather/);
  const ck = await loginAs(t, deps, call, { username: 'chu', role: 'owner' });
  assert.equal((await call('/api/admin/telegram', { method: 'PUT', cookie: ck, body: { token: '1:abc' } })).status, 403);
  assert.equal((await call('/api/admin/telegram', { cookie: ck })).status, 403);
});

test('lỗi 5xx không lộ chi tiết', async (t) => {
  const { deps, call, cookie } = await setup(t);
  deps.linker.linkUrl = () => { throw new Error('boom 123:SECRET'); };
  const r = await call('/api/telegram/link', { method: 'POST', cookie });
  assert.equal(r.status, 502);
  assert.ok(!r.json.error.includes('SECRET'));
});
