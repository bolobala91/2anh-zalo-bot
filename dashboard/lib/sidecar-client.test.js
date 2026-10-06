import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSidecarClient } from './sidecar-client.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('health trả object health và gửi Bearer token', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ ok: true, health: { status: 'healthy' } }) }; };
  const c = createSidecarClient({ token: 'tok', fetchImpl });
  assert.deepEqual(await c.health(), { status: 'healthy' });
  assert.equal(seen.opts.headers.Authorization, 'Bearer tok');
  assert.match(seen.url, /\/control\/health$/);
});

test('mạng hỏng thì SidecarDown', async () => {
  const c = createSidecarClient({ token: 'tok', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(c.health(), (e) => e.name === 'SidecarDown');
});

test('quá thời gian chờ thì SidecarDown', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const c = createSidecarClient({ token: 'tok', fetchImpl, timeoutMs: 20 });
  await assert.rejects(c.health(), (e) => e.name === 'SidecarDown');
});

test('HTTP 502 giữ thông báo và statusCode', async () => {
  const c = createSidecarClient({ token: 'tok', fetchImpl: reply(502, { ok: false, error: 'Zalo chưa đăng nhập' }) });
  await assert.rejects(c.health(), (e) => /Zalo chưa đăng nhập/.test(e.message) && e.statusCode === 502);
});

const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
const flush = () => new Promise((r) => setImmediate(r));

test('gửi tin có hạn riêng 20 s, quá hạn là SidecarTimeout (chưa rõ đã gửi); lệnh khác vẫn hạn 4 s và báo SidecarDown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = createSidecarClient({ token: 'tok', fetchImpl: hang });
  const errs = {};
  const sendP = c.send({ threadId: '1', threadType: 0, text: 'x', actor: 'a' }).catch((e) => { errs.send = e; });
  const others = ['health', 'groups', 'qrStart', 'logout'].map((k) => c[k]().catch((e) => { errs[k] = e; }));
  t.mock.timers.tick(3999); await flush();
  assert.deepEqual(Object.keys(errs), []);
  t.mock.timers.tick(1); await Promise.all(others);
  for (const k of ['health', 'groups', 'qrStart', 'logout']) assert.equal(errs[k]?.name, 'SidecarDown', k);
  assert.equal(errs.send, undefined);
  t.mock.timers.tick(15_999); await flush();
  assert.equal(errs.send, undefined);
  t.mock.timers.tick(1); await sendP;
  assert.equal(errs.send?.name, 'SidecarTimeout');
});

test('gửi tin khi không kết nối được (từ chối kết nối) vẫn là SidecarDown, không phải quá hạn', async () => {
  const c = createSidecarClient({ token: 'tok', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(c.send({ threadId: '1', threadType: 0, text: 'x', actor: 'a' }), (e) => e.name === 'SidecarDown');
});
