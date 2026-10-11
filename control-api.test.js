import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createControlRouter } from './control-api.js';

async function serve(t, overrides = {}) {
  const calls = [];
  const deps = {
    token: 'secret-token-123456',
    health: () => ({ status: 'healthy', zalo: { status: 'logged-in', needsRelogin: false } }),
    qr: { start: async () => { calls.push('qr-start'); }, state: () => ({ status: 'qr-pending', image: 'data:image/png;base64,AAA', user: null }) },
    logout: async () => { calls.push('logout'); },
    send: async (m) => { calls.push(['send', m]); return { msgId: '1' }; },
    loginCode: async (m) => { calls.push(['code', m]); },
    groups: async () => [{ id: '123', name: 'Tổ Hoá', members: 12 }],
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/control', createControlRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/control`;
  const call = (path, { method = 'GET', body, token = deps.token } = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, calls };
}

test('thiếu hoặc sai token thì 401', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('/health', { token: null })).status, 401);
  assert.equal((await call('/health', { token: 'sai' })).status, 401);
  assert.equal((await call('/health')).status, 200);
});

test('gửi tin tay chuyển đúng người gửi xuống', async (t) => {
  const { call, calls } = await serve(t);
  const res = await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1), ['send', { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' }]);
});

test('gửi tệp chỉ nhận tệp nằm trong outbox của dashboard', async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'zd-outbox-'));
  const outboxDir = join(root, 'outbox');
  mkdirSync(join(outboxDir, 'x'), { recursive: true });
  const inside = join(outboxDir, 'x', 'a.png');
  const outside = join(root, 'secret.txt');
  writeFileSync(inside, 'a'); writeFileSync(outside, 'b');
  const sent = [];
  const { call } = await serve(t, { outboxDir, sendFile: async (m) => { sent.push(m); return { msgId: '2' }; } });
  const post = (path) => call('/send-file', { method: 'POST', body: { threadId: '9', threadType: 1, path, actor: 'khach' } });
  assert.equal((await post(inside)).status, 200);
  assert.equal(sent[0].path, realpathSync(inside));
  for (const p of [outside, join(outboxDir, '..', 'secret.txt'), outboxDir, join(outboxDir, 'khong-co.png')]) {
    assert.equal((await post(p)).status, 400, p);
  }
  assert.equal(sent.length, 1);
});

test('gửi tin tay từ chối khi thiếu chữ hoặc quá 2000 ký tự', async (t) => {
  const { call } = await serve(t);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: '  ', actor: 'a' } })).status, 400);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'x'.repeat(2001), actor: 'a' } })).status, 400);
});

test('mã đăng nhập chỉ nhận đúng 6 chữ số và UID hợp lệ', async (t) => {
  const { call, calls } = await serve(t);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: 'abc123', actor: 'a' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '0987', code: '123456', actor: 'a' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: '123456', actor: 'khach' } })).status, 200);
  assert.deepEqual(calls.at(-1), ['code', { zaloUid: '1234567890123456', code: '123456', actor: 'khach' }]);
});

test('QR: bị Zalo đá (needsRelogin) thì /qr không bao giờ báo logged-in', async (t) => {
  const { call } = await serve(t, {
    health: () => ({ zalo: { status: 'logged-in', needsRelogin: true } }),
    qr: { start: async () => {}, state: () => ({ status: 'logged-in', image: null, user: { user_id: '1' } }) },
  });
  const state = await (await call('/qr')).json();
  assert.equal(state.status, 'idle');
  assert.equal(state.user, null);
});

test('QR: bắt đầu không chặn, đọc trạng thái', async (t) => {
  const { call, calls } = await serve(t);
  assert.equal((await call('/qr/start', { method: 'POST' })).status, 200);
  assert.ok(calls.includes('qr-start'));
  const state = await (await call('/qr')).json();
  assert.equal(state.status, 'qr-pending');
  assert.match(state.image, /^data:image\/png;base64,/);
});

test('lỗi bên trong trả 502 kèm thông điệp, không làm sập', async (t) => {
  const { call } = await serve(t, { groups: async () => { throw new Error('Zalo chưa đăng nhập'); } });
  const res = await call('/groups');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Zalo chưa đăng nhập/);
});

test('mã đăng nhập đòi người thao tác', async (t) => {
  const { call } = await serve(t);
  const base = { zaloUid: '1234567890123456', code: '123456' };
  assert.equal((await call('/login-code', { method: 'POST', body: base })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { ...base, actor: 'x'.repeat(65) } })).status, 400);
});

test('threadType và actor được kiểm chặt', async (t) => {
  const { call } = await serve(t);
  for (const threadType of ['', null, false, [1], '1', 2]) {
    const res = await call('/send', { method: 'POST', body: { threadId: '9', threadType, text: 'a', actor: 'a' } });
    assert.equal(res.status, 400, JSON.stringify(threadType));
  }
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 0, text: 'a', actor: 'x'.repeat(65) } })).status, 400);
});

test('lỗi bên trong luôn 502 dù có statusCode, và POST thiếu token vẫn 401', async (t) => {
  const { call } = await serve(t, { logout: async () => { throw Object.assign(new Error('boom'), { statusCode: 404 }); } });
  assert.equal((await call('/logout', { method: 'POST' })).status, 502);
  assert.equal((await call('/logout', { method: 'POST', token: null })).status, 401);
  assert.equal((await call('/send', { method: 'POST', token: null, body: {} })).status, 401);
});

// --- Liên hệ và Lịch hẹn (spec §18.4) ---
function fakeDirectory() {
  const calls = [];
  return {
    calls,
    friends: async (o) => { calls.push(['friends', o]); return [{ uid: '1111111111111111111', name: 'Lan', zaloName: 'lan' }]; },
    friendRequests: async () => [{ uid: '2222222222222222222', name: 'Minh', message: '', at: 1 }],
    answerFriendRequest: async (m) => { calls.push(['answer', m]); return {}; },
    reminders: async (m) => { calls.push(['reminders', m]); return []; },
    removeReminder: async (m) => { calls.push(['remove', m]); return {}; },
  };
}

test('liên hệ: bạn bè, lời mời, trả lời lời mời chuyển đúng người làm; không có directory thì 404', async (t) => {
  const directory = fakeDirectory();
  const { call } = await serve(t, { directory });
  assert.equal((await (await call('/friends?fresh=1')).json()).friends[0].name, 'Lan');
  assert.deepEqual(directory.calls.at(-1), ['friends', { fresh: true }]);
  assert.equal((await (await call('/friend-requests')).json()).requests.length, 1);
  const res = await call('/friend-requests/answer', { method: 'POST', body: { uid: '2222222222222222222', accept: true, actor: 'anh' } });
  assert.equal(res.status, 200);
  assert.deepEqual(directory.calls.at(-1), ['answer', { uid: '2222222222222222222', accept: true, actor: 'anh' }]);
  assert.equal((await call('/friend-requests/answer', { method: 'POST', body: { uid: '2222222222222222222', accept: true } })).status, 400, 'thiếu actor');
  const bare = await serve(t);
  assert.equal((await bare.call('/friends')).status, 404);
});

test('lời nhắc: threadType từ chuỗi truy vấn thành số; xoá đòi actor; lỗi kiểm tra thành 400', async (t) => {
  const directory = fakeDirectory();
  directory.reminders = async (m) => {
    directory.calls.push(['reminders', m]);
    if (m.threadType !== 0 && m.threadType !== 1) throw Object.assign(new Error('threadType phải là 0 hoặc 1'), { validation: true });
    return [];
  };
  const { call } = await serve(t, { directory });
  assert.equal((await call('/reminders?threadId=55&threadType=1')).status, 200);
  assert.deepEqual(directory.calls.at(-1), ['reminders', { threadId: '55', threadType: 1 }]);
  assert.equal((await call('/reminders?threadId=55&threadType=x')).status, 400);
  assert.equal((await call('/reminders/remove', { method: 'POST', body: { reminderId: '7', threadId: '55', threadType: 1 } })).status, 400);
  assert.equal((await call('/reminders/remove', { method: 'POST', body: { reminderId: '7', threadId: '55', threadType: 1, actor: 'anh' } })).status, 200);
  assert.deepEqual(directory.calls.at(-1), ['remove', { reminderId: '7', threadId: '55', threadType: 1, actor: 'anh' }]);
});

test('kiểm trích dẫn và tag trước khi gửi qua Zalo', async () => {
  const { checkQuote, checkMentions } = await import('./control-api.js');
  const bad = (m) => Object.assign(new Error(m), { validation: true });
  assert.equal(checkQuote(null, bad), null);
  assert.deepEqual(checkQuote({ msgId: '7001', cliMsgId: '', uidFrom: '5550001', content: 'x', ts: 1 }, bad), { msgId: '7001', cliMsgId: '', uidFrom: '5550001', content: 'x', ts: 1, isSelf: false });
  assert.equal(checkQuote({ msgId: '7001', uidFrom: '', content: 'x', ts: 1, isSelf: true }, bad).isSelf, true);
  assert.throws(() => checkQuote({ msgId: 'abc', uidFrom: '1', ts: 1 }, bad), /Trích dẫn/);
  assert.deepEqual(checkMentions([{ uid: '1', pos: 0, len: 4 }], '@Lan ơi', 1, bad), [{ uid: '1', pos: 0, len: 4 }]);
  assert.throws(() => checkMentions([{ uid: '1', pos: 0, len: 4 }], '@Lan ơi', 0, bad), /tag/);
  assert.throws(() => checkMentions([{ uid: '1', pos: 1, len: 3 }], '@Lan ơi', 1, bad), /tag/);
});
