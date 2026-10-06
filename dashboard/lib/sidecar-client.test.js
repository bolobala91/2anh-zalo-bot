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
