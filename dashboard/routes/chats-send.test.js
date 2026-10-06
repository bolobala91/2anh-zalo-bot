import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidecarDown } from '../lib/sidecar-client.js';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

async function ready(t, overrides = {}) {
  const deps = makeDeps(t, overrides);
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '100', threadType: 0, text: 'Chào bot' }),
    chatMsg({ threadId: '200', threadType: 1, text: 'Chào cả nhóm' }),
  ] });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const send = (threadId, body, c = cookie) => call(`/api/chats/${threadId}/send`, { method: 'POST', cookie: c, body });
  const sends = () => deps.sidecar.calls.filter((c) => c[0] === 'send').map((c) => c[1]);
  return { deps, call, cookie, send, sends };
}

test('Chủ bot nhắn tay: gửi qua bot với tên người gửi, nội dung đã cắt khoảng trắng', async (t) => {
  const { send, sends } = await ready(t);
  const res = await send('100', { text: '  Dạ em chào chị  ', threadType: 0 });
  assert.equal(res.status, 200);
  assert.deepEqual(sends(), [{ threadId: '100', threadType: 0, text: 'Dạ em chào chị', actor: 'khach' }]);
});

test('nội dung rỗng, quá 2000 ký tự, loại hội thoại sai → 400, không gọi bot', async (t) => {
  const { send, sends } = await ready(t);
  for (const body of [{ text: '   ', threadType: 0 }, { text: 'x'.repeat(2001), threadType: 0 }, { text: 'chào' }, { text: 'chào', threadType: 2 }, { text: 42, threadType: 0 }]) {
    const res = await send('100', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.json.error, /—/);
  }
  assert.equal((await send('abc', { text: 'chào', threadType: 0 })).status, 400);
  assert.equal((await send('100', { text: 'x'.repeat(2000), threadType: 0 })).status, 200); // đúng 2000 vẫn được
  assert.equal(sends().length, 1);
});

test('hội thoại không có trong lịch sử (hoặc sai loại) → 404, không gọi bot', async (t) => {
  const { send, sends } = await ready(t);
  assert.equal((await send('555', { text: 'chào', threadType: 0 })).status, 404);
  assert.equal((await send('100', { text: 'chào', threadType: 1 })).status, 404);
  assert.equal(sends().length, 0);
});

test('quá 10 tin/phút/người dùng → 429; người khác vẫn gửi được; hết phút thì gửi lại được', async (t) => {
  let clock = 1_000_000;
  const { deps, call, send, sends } = await ready(t, { now: () => clock });
  for (let i = 0; i < 10; i += 1) assert.equal((await send('100', { text: `tin ${i}`, threadType: 0 })).status, 200);
  const blocked = await send('100', { text: 'tin 11', threadType: 0 });
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /đợi/);
  const admin = await loginAs(t, deps, call);
  assert.equal((await send('100', { text: 'của anh', threadType: 0 }, admin)).status, 200);
  clock += 60_001;
  assert.equal((await send('100', { text: 'tin 12', threadType: 0 })).status, 200);
  assert.equal(sends().length, 12);
});

test('bot tắt → 503 tiếng Việt; bot báo Zalo chưa đăng nhập (502) → câu chung, không lộ chữ gốc', async (t) => {
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw new SidecarDown(); } }) });
  const down = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(down.status, 503);
  assert.doesNotMatch(down.json.error, /sidecar|bridge/i);
});

test('lỗi 502 từ bot không lộ nội dung gốc', async (t) => {
  const orig = console.error; console.error = () => {};
  t.after(() => { console.error = orig; });
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw Object.assign(new Error('Zalo chưa đăng nhập'), { statusCode: 502 }); } }) });
  const res = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.json.error, /Zalo chưa đăng nhập/);
});

test('chưa đăng nhập → 401; Origin lạ → 403', async (t) => {
  const { call } = await ready(t);
  assert.equal((await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 } })).status, 401);
  const res = await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});
