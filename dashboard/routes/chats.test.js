import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SidecarDown } from '../lib/sidecar-client.js';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

function seedChats(deps) {
  seedHistory(deps, { messages: [
    chatMsg({ msgId: 'd1', threadId: '100', threadType: 0, senderUid: '100', senderName: 'Lan', text: 'Chào bot', ts: 1000 }),
    chatMsg({ msgId: 'd2', threadId: '100', threadType: 0, senderUid: '999', senderName: 'Uyển Nhi', text: 'Chào Lan', ts: 1001, isSelf: true }),
    chatMsg({ msgId: 'g1', threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', text: 'Họp tổ chiều nay', ts: 2000 }),
    chatMsg({ msgId: 'x1', threadId: '987654', threadType: 1, senderUid: '301', senderName: 'Hà', text: '<img src=x onerror=alert(1)>', ts: 1500 }),
  ] });
}

async function ready(t, { seed = true, ...overrides } = {}) {
  const deps = makeDeps(t, overrides);
  if (seed) seedChats(deps);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  return { deps, call, cookie };
}

test('phiên chat cần đăng nhập', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  for (const p of ['/api/chats', '/api/chats/100/messages?type=0', '/api/chats/search?q=chao']) {
    assert.equal((await call(p)).status, 401, p);
  }
});

test('danh sách hội thoại: mới nhất trước, tên nhóm từ bot, tên người từ tin nhắn, nhóm lạ có tên dự phòng', async (t) => {
  const { call, cookie } = await ready(t);
  const res = await call('/api/chats', { cookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.conversations.map((c) => [c.threadId, c.threadType, c.name]), [
    ['200', 1, 'Tổ Hoá'], ['987654', 1, 'Nhóm …7654'], ['100', 0, 'Lan'],
  ]);
  const dm = res.json.conversations[2];
  assert.equal(dm.lastText, 'Chào Lan');
  assert.equal(dm.lastIsSelf, true);
  assert.equal('peerName' in dm, false);
});

test('tin nhắn trả nguyên văn (giao diện tự thoát HTML), cũ trước mới sau', async (t) => {
  const { call, cookie } = await ready(t);
  const x = await call('/api/chats/987654/messages?type=1', { cookie });
  assert.equal(x.status, 200);
  assert.equal(x.json.messages[0].text, '<img src=x onerror=alert(1)>');
  const dm = await call('/api/chats/100/messages?type=0', { cookie });
  assert.deepEqual(dm.json.messages.map((m) => [m.text, m.isSelf]), [['Chào bot', false], ['Chào Lan', true]]);
  assert.equal(dm.json.nextBefore, null);
});

test('tham số sai bị từ chối 400 (kể cả chuỗi đường dẫn)', async (t) => {
  const { call, cookie } = await ready(t);
  for (const p of [
    '/api/chats/abc/messages?type=0',
    '/api/chats/..%2F..%2Fetc/messages?type=0',
    '/api/chats/100/messages?type=2',
    '/api/chats/100/messages',
    '/api/chats/100/messages?type=0&before=..%2F',
    '/api/chats/search?q=a',
    `/api/chats/search?q=${'a'.repeat(101)}`,
    '/api/chats/search?q=chao&before=x',
  ]) {
    const res = await call(p, { cookie });
    assert.equal(res.status, 400, p);
    assert.match(res.json.error, /—/, p); // có bước tiếp theo
  }
});

test('tìm toàn văn không phân biệt hoa thường, kèm tên hội thoại', async (t) => {
  const { call, cookie } = await ready(t);
  const g = await call(`/api/chats/search?q=${encodeURIComponent('HỌP TỔ')}`, { cookie });
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.results.map((r) => [r.threadId, r.threadName]), [['200', 'Tổ Hoá']]);
  const d = await call(`/api/chats/search?q=${encodeURIComponent('chào lan')}`, { cookie });
  assert.deepEqual(d.json.results.map((r) => [r.threadId, r.threadName, r.isSelf]), [['100', 'Lan', true]]);
});

test('chưa có lịch sử: danh sách rỗng có cờ unavailable, xem tin trả 503 có bước tiếp theo, không tạo tệp', async (t) => {
  const { deps, call, cookie } = await ready(t, { seed: false });
  const list = await call('/api/chats', { cookie });
  assert.deepEqual([list.status, list.json.conversations, list.json.unavailable], [200, [], true]);
  const msgs = await call('/api/chats/100/messages?type=0', { cookie });
  assert.equal(msgs.status, 503);
  assert.match(msgs.json.error, /báo người cài đặt/);
  assert.equal((await call('/api/chats/search?q=chao', { cookie })).status, 503);
  assert.equal(existsSync(join(deps.dir, 'zalo.sqlite')), false);
});

test('kết nối Zalo tắt vẫn xem được hội thoại, nhóm dùng tên dự phòng', async (t) => {
  const { call, cookie } = await ready(t, { sidecar: fakeSidecar({ groups: async () => { throw new SidecarDown(); } }) });
  const res = await call('/api/chats', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.conversations[0].name, 'Nhóm …200');
});
