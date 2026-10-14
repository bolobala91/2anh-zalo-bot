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
    ['200', 1, 'Tổ Hoá'], ['987654', 1, 'Nhóm chưa rõ tên'], ['100', 0, 'Lan'],
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
  for (const p of ['/api/chats/100/search?type=0&q=chao', '/api/chats/100/media?type=0&kind=link', '/api/chats/100/messages?type=0&around=5:1']) {
    const res = await call(p, { cookie });
    assert.equal(res.status, 503, p);
    assert.match(res.json.error, /báo người cài đặt/, p);
  }
  assert.equal(existsSync(join(deps.dir, 'zalo.sqlite')), false);
});

const PHOTO = 'https://photo-stal-27.zdn.vn/gr/jpg/4465fc927e4faf11f65e/2aOboR44d1PKLnuojjTWw89o8pKvNcouPXM6dnTE.jpg';
const FILE = 'https://file-stal-18.dlfl.vn/gr/4e7412403493e5cdbc82/2aOboR448crP59vGXdg7cy4myByEAcqBLYc8diiW';
const VIDEO = 'https://video-stal-46.dlmd.me/gr/1f78a5bfe81c36426f0d/2aOboR3605P4uCnJwRiSwTYeOw2uLdFtv234Ay24';

function seedGroup(deps) {
  const gm = (n, over) => chatMsg({ msgId: `gm${n}`, threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', ts: 5000 + n, ...over });
  const filler = Array.from({ length: 60 }, (_, i) => gm(100 + i, { text: `tin thường ${i}` }));
  seedHistory(deps, { messages: [
    gm(1, { text: `Ảnh lớp\n${PHOTO}`, msgType: 'chat.photo' }),
    gm(2, { text: `KH.docx\n${FILE}`, msgType: 'share.file' }),
    gm(3, { text: VIDEO, msgType: 'chat.video.msg' }),
    gm(4, { text: 'Nộp ở https://forms.gle/abc nhé', msgType: 'webchat' }),
    gm(5, { text: 'Họp tổ chiều nay ở phòng Hoá', msgType: 'webchat' }),
    ...filler,
    chatMsg({ msgId: 'o1', threadId: '201', threadType: 1, senderUid: '300', text: 'Họp tổ nhóm khác', ts: 9000 }),
  ] });
}

async function readyGroup(t, role = 'owner') {
  const deps = makeDeps(t);
  seedGroup(deps);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: `k-${role}`, role });
  return { call, cookie };
}

test('tìm trong hội thoại, bảng media, trang quanh tin: cần đăng nhập, cả hai vai trò dùng được', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  for (const p of ['/api/chats/200/search?type=1&q=hop', '/api/chats/200/media?type=1&kind=photo', '/api/chats/200/messages?type=1&around=5001:1']) {
    assert.equal((await call(p)).status, 401, p);
  }
  for (const role of ['admin', 'owner']) {
    const { call: c, cookie } = await readyGroup(t, role);
    assert.equal((await c('/api/chats/200/search?type=1&q=hop', { cookie })).status, 200, role);
    assert.equal((await c('/api/chats/200/media?type=1&kind=file', { cookie })).status, 200, role);
  }
});

test('tìm trong một hội thoại: không dấu, chỉ hội thoại đó, có tên người gửi, không senderUid', async (t) => {
  const { call, cookie } = await readyGroup(t);
  const res = await call(`/api/chats/200/search?type=1&q=${encodeURIComponent('HOP TO')}`, { cookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.results.map((r) => [r.text, r.senderName]), [['Họp tổ chiều nay ở phòng Hoá', 'Minh']]);
  assert.equal('senderUid' in res.json.results[0], false);
  assert.equal(res.json.nextBefore, null);
  const page = await call('/api/chats/200/search?type=1&q=thuong', { cookie });
  assert.equal(page.json.results.length, 30);
  const more = await call(`/api/chats/200/search?type=1&q=thuong&before=${encodeURIComponent(page.json.nextBefore)}`, { cookie });
  assert.equal(more.json.results.length, 30);
});

test('bảng Ảnh/Video · Tệp · Link trả đúng dạng, không senderUid', async (t) => {
  const { call, cookie } = await readyGroup(t);
  const photo = await call('/api/chats/200/media?type=1&kind=photo', { cookie });
  assert.deepEqual(photo.json.items.map((x) => [x.url, x.video, x.caption]), [[VIDEO, true, ''], [PHOTO, false, 'Ảnh lớp']]);
  const file = await call('/api/chats/200/media?type=1&kind=file', { cookie });
  assert.deepEqual(file.json.items.map((x) => [x.name, x.url, x.ext, x.senderName]), [['KH.docx', FILE, 'docx', 'Minh']]);
  const link = await call('/api/chats/200/media?type=1&kind=link', { cookie });
  assert.deepEqual(link.json.items.map((x) => [x.url, x.host]), [['https://forms.gle/abc', 'forms.gle']]);
  for (const x of [...photo.json.items, ...file.json.items, ...link.json.items]) {
    assert.equal('senderUid' in x, false);
    assert.equal(typeof x.ts, 'number');
  }
});

test('trang quanh một tin rồi cuộn xuống tải tin mới hơn tới hết', async (t) => {
  const { call, cookie } = await readyGroup(t);
  const hit = (await call('/api/chats/200/search?type=1&q=forms', { cookie })).json.results[0];
  const around = await call(`/api/chats/200/messages?type=1&around=${encodeURIComponent(`${hit.ts}:${hit.id}`)}`, { cookie });
  assert.equal(around.status, 200);
  const ids = around.json.messages.map((m) => m.id);
  assert.ok(ids.includes(hit.id));
  assert.equal(around.json.nextBefore, null); // chỉ có 3 tin cũ hơn
  assert.equal(ids.indexOf(hit.id), 3);
  assert.equal(around.json.messages.length, 4 + 25);
  let after = around.json.nextAfter; let total = around.json.messages.length;
  while (after) {
    const p = await call(`/api/chats/200/messages?type=1&after=${encodeURIComponent(after)}`, { cookie });
    total += p.json.messages.length; after = p.json.nextAfter;
  }
  assert.equal(total, 65);
});

test('tham số sai của các đường mới bị từ chối 400 có bước tiếp theo', async (t) => {
  const { call, cookie } = await readyGroup(t);
  for (const p of [
    '/api/chats/200/search?type=1&q=a',
    `/api/chats/200/search?type=1&q=${'a'.repeat(101)}`,
    '/api/chats/200/search?type=1&q=hop&before=x',
    '/api/chats/200/search?q=hop',
    '/api/chats/abc/search?type=1&q=hop',
    '/api/chats/200/media?type=1',
    '/api/chats/200/media?type=1&kind=video',
    '/api/chats/200/media?type=1&kind=photo&before=..%2F',
    '/api/chats/200/media?type=1&kind=photo&kind=file',
    '/api/chats/200/messages?type=1&around=x',
    '/api/chats/200/messages?type=1&after=1:',
    '/api/chats/200/messages?type=1&around=5:1&before=5:1',
    '/api/chats/200/messages?type=1&around=5:1&after=5:1',
  ]) {
    const res = await call(p, { cookie });
    assert.equal(res.status, 400, p);
    assert.match(res.json.error, /—/, p);
  }
});

test('kết nối Zalo tắt vẫn xem được hội thoại, nhóm dùng tên dự phòng', async (t) => {
  const { call, cookie } = await ready(t, { sidecar: fakeSidecar({ groups: async () => { throw new SidecarDown(); } }) });
  const res = await call('/api/chats', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.conversations[0].name, 'Nhóm chưa rõ tên');
});

test('Phiên chat kiểu Zalo: ảnh đại diện gắn vào hội thoại và tin (không lộ UID), sidecar lỗi thì vẫn trả tin', async (t) => {
  const sidecar = fakeSidecar({
    groupAvatars: async (ids) => { sidecar.calls.push(['gava', ids]); return { 200: 'https://s1-ava.zadn.vn/g.jpg' }; },
    avatars: async (uids) => { sidecar.calls.push(['ava', uids]); return { 100: 'https://s1-ava.zadn.vn/lan.jpg', 300: 'https://s1-ava.zadn.vn/minh.jpg' }; },
  });
  const { call, cookie } = await ready(t, { sidecar });
  const list = (await call('/api/chats', { cookie })).json.conversations;
  assert.equal(list.find((c) => c.threadId === '200').avatar, 'https://s1-ava.zadn.vn/g.jpg');
  assert.equal(list.find((c) => c.threadId === '100').avatar, 'https://s1-ava.zadn.vn/lan.jpg');
  assert.equal('avatar' in list.find((c) => c.threadId === '987654'), false);
  const msgs = (await call('/api/chats/200/messages?type=1', { cookie })).json.messages;
  assert.equal(msgs[0].avatar, 'https://s1-ava.zadn.vn/minh.jpg');
  assert.equal(JSON.stringify(msgs).includes('"300"'), false, 'UID người gửi không ra trình duyệt');
  sidecar.avatars = async () => { throw new Error('sidecar chậm'); };
  sidecar.groupAvatars = async () => { throw new Error('sidecar chậm'); };
  assert.equal((await call('/api/chats/200/messages?type=1', { cookie })).json.messages[0].text, 'Họp tổ chiều nay');
  assert.equal((await call('/api/chats', { cookie })).status, 200);
});

test('Phiên chat kiểu Zalo: thông tin hội thoại và bảng tin (tin ghim có vị trí trong lịch sử để nhảy tới)', async (t) => {
  const sidecar = fakeSidecar({
    chatInfo: async (m) => { sidecar.calls.push(['info', m]); return { name: 'Tổ Hoá', avatar: '', members: 12, desc: '' }; },
    board: async (g) => { sidecar.calls.push(['board', g]); return {
      pins: [{ id: 'p1', text: 'Họp tổ', sender: 'Minh', msgId: 'g1', cliMsgId: '', at: 5 }, { id: 'p2', text: 'Cũ', sender: '', msgId: '123', cliMsgId: '', at: 1 }],
      notes: [{ id: 'n1', text: 'Nội quy', at: 2 }], polls: [] }; },
  });
  const { call, cookie } = await ready(t, { sidecar });
  const info = await call('/api/chats/200/info?type=1', { cookie });
  assert.equal(info.json.info.members, 12);
  assert.deepEqual(sidecar.calls.at(-1), ['info', { threadId: '200', threadType: 1 }]);
  assert.equal((await call('/api/chats/abc/info?type=1', { cookie })).status, 400);
  const b = (await call('/api/chats/200/board', { cookie })).json.board;
  assert.equal(b.pins[0].ref.ts, 2000, 'tin ghim có trong lịch sử → nhảy tới được');
  assert.equal(b.pins[1].ref, null);
  assert.equal('msgId' in b.pins[0], false);
  assert.equal(b.notes[0].text, 'Nội quy');
});
