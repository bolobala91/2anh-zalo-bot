import test from 'node:test';
import assert from 'node:assert/strict';
import { createZaloDirectory, normalizeFriend, normalizeReminder, normalizeRequests } from './zalo-directory.js';

const A = '1111111111111111111';
const B = '2222222222222222222';

function fakeApi(over = {}) {
  const calls = [];
  return {
    calls,
    getAllFriends: async (count, page) => { calls.push(['friends', count, page]); return [{ userId: A, displayName: ' Cô  Lan ', zaloName: 'lan' }, { userId: 'abc' }]; },
    getFriendRecommendations: async () => ({ recommItems: [
      { dataInfo: { userId: B, displayName: 'Minh', recommType: 2, recommTime: 5, recommInfo: { message: 'Chào bot' } } },
      { dataInfo: { userId: A, displayName: 'Gợi ý', recommType: 1 } },
    ] }),
    acceptFriendRequest: async (uid) => { calls.push(['accept', uid]); return ''; },
    rejectFriendRequest: async (uid) => { calls.push(['reject', uid]); return ''; },
    getListReminder: async (opts, threadId, type) => { calls.push(['list', opts, threadId, type]); return [
      { id: '77', creatorId: 'bot', params: { title: 'Họp tổ' }, startTime: 100, repeat: 1, createTime: 50 },
      { reminderId: '../x', params: { title: 'lạ' } },
    ]; },
    removeReminder: async (id, threadId, type) => { calls.push(['remove', id, threadId, type]); return ''; },
    getOwnId: () => 'bot',
    ...over,
  };
}

test('chuẩn hoá: bạn bè, lời mời (chỉ loại 2), lời nhắc (id nhóm/riêng, của bot hay không)', () => {
  assert.deepEqual(normalizeFriend({ userId: A, displayName: '', zaloName: 'lan' }), { uid: A, name: 'lan', zaloName: 'lan' });
  assert.equal(normalizeFriend({ userId: '0123' }), null);
  assert.deepEqual(normalizeRequests({ recommItems: [{ dataInfo: { userId: B, zaloName: 'M', recommType: 2 } }] }),
    [{ uid: B, name: 'M', message: '', at: null }]);
  assert.deepEqual(normalizeRequests(null), []);
  assert.deepEqual(normalizeReminder({ reminderId: 'r1', creatorUid: 'u', params: { title: 'X' }, startTime: 9 }, 'bot'),
    { id: 'r1', title: 'X', startAt: 9, repeat: 0, creatorUid: 'u', mine: false, createdAt: null });
  assert.equal(normalizeReminder({ id: 'a b' }, 'bot'), null);
});

test('danh sách bạn đệm 10 phút; fresh thì đọc lại; đồng ý kết bạn xoá đệm', async () => {
  const api = fakeApi();
  let clock = 0;
  const dir = createZaloDirectory({ getApi: () => api, now: () => clock });
  assert.deepEqual(await dir.friends(), [{ uid: A, name: 'Cô Lan', zaloName: 'lan' }]);
  clock = 60_000; await dir.friends();
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 1);
  await dir.friends({ fresh: true });
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 2);
  await dir.answerFriendRequest({ uid: B, accept: true, actor: 'anh' });
  await dir.friends();
  assert.equal(api.calls.filter((c) => c[0] === 'friends').length, 3);
});

test('đồng ý/từ chối: kiểm UID, xin lượt, ghi audit đúng hành động và người làm', async () => {
  const api = fakeApi();
  const audits = []; let acquired = 0;
  const dir = createZaloDirectory({
    getApi: () => api, acquire: async () => { acquired += 1; },
    audit: async (meta, fn) => { audits.push(meta); return fn(); },
  });
  await dir.answerFriendRequest({ uid: B, accept: false, actor: 'khach' });
  assert.deepEqual(api.calls.at(-1), ['reject', B]);
  assert.deepEqual(audits, [{ action: 'dashboard_friend_reject', actor: 'khach', threadId: B, threadType: 0 }]);
  assert.equal(acquired, 1);
  await assert.rejects(dir.answerFriendRequest({ uid: '123', accept: true, actor: 'a' }), (e) => e.validation === true);
  await assert.rejects(dir.answerFriendRequest({ uid: B, accept: 'yes', actor: 'a' }), (e) => e.validation === true);
});

test('lời nhắc: liệt kê theo hội thoại, bỏ mã lạ; xoá kiểm mã + hội thoại; Zalo chưa đăng nhập thì báo lỗi', async () => {
  const api = fakeApi();
  const audits = [];
  const dir = createZaloDirectory({ getApi: () => api, audit: async (meta, fn) => { audits.push(meta.action); return fn(); } });
  const list = await dir.reminders({ threadId: '555', threadType: 1 });
  assert.deepEqual(list, [{ id: '77', title: 'Họp tổ', startAt: 100, repeat: 1, creatorUid: 'bot', mine: true, createdAt: 50 }]);
  assert.deepEqual(api.calls.at(-1), ['list', { page: 1, count: 50 }, '555', 1]);
  await dir.removeReminder({ reminderId: '77', threadId: '555', threadType: 1, actor: 'anh' });
  assert.deepEqual(api.calls.at(-1), ['remove', '77', '555', 1]);
  assert.deepEqual(audits, ['dashboard_reminder_remove']);
  await assert.rejects(dir.removeReminder({ reminderId: '../x', threadId: '555', threadType: 1, actor: 'a' }), (e) => e.validation);
  await assert.rejects(dir.reminders({ threadId: 'abc', threadType: 1 }), (e) => e.validation);
  await assert.rejects(dir.reminders({ threadId: '1', threadType: 2 }), (e) => e.validation);
  await assert.rejects(createZaloDirectory({ getApi: () => null }).friends(), /Zalo chưa đăng nhập/);
});

const G = '5555555555555555555';

test('thông tin hội thoại: nhóm lấy ảnh + số thành viên, nhắn riêng lấy ảnh người; đệm 10 phút', async () => {
  let t = 0;
  const api = fakeApi({
    getGroupInfo: async (id) => { api.calls.push(['group', id]); return { gridInfoMap: { [G]: { name: 'Lớp 12A', fullAvt: 'https://s1-ava.zadn.vn/g.jpg', avt: 'x', totalMember: 42, desc: ' Mô  tả ' } } }; },
    getUserInfo: async (ids) => { api.calls.push(['user', ids]); return { changed_profiles: { [`${A}_0`]: { userId: A, displayName: 'Lan', avatar: 'https://s1-ava.zadn.vn/a.jpg' } } }; },
  });
  const dir = createZaloDirectory({ getApi: () => api, now: () => t });
  assert.deepEqual(await dir.chatInfo({ threadId: G, threadType: 1 }), { name: 'Lớp 12A', avatar: 'https://s1-ava.zadn.vn/g.jpg', members: 42, desc: 'Mô tả' });
  await dir.chatInfo({ threadId: G, threadType: 1 });
  assert.equal(api.calls.filter((c) => c[0] === 'group').length, 1, 'lần hai lấy từ đệm');
  t = 11 * 60_000;
  await dir.chatInfo({ threadId: G, threadType: 1 });
  assert.equal(api.calls.filter((c) => c[0] === 'group').length, 2, 'hết 10 phút thì đọc lại');
  assert.deepEqual(await dir.chatInfo({ threadId: A, threadType: 0 }), { name: 'Lan', avatar: 'https://s1-ava.zadn.vn/a.jpg', members: 0, desc: '' });
  await assert.rejects(dir.chatInfo({ threadId: 'x', threadType: 1 }), /threadId/);
});

test('ảnh đại diện theo lô: chỉ UID hợp lệ, chỉ link https, đệm từng người; Zalo lỗi thì trả phần đã có', async () => {
  const seen = [];
  const api = fakeApi({
    getUserInfo: async (ids) => { seen.push(ids); return { changed_profiles: {
      [`${A}_0`]: { userId: A, avatar: 'https://s1-ava.zadn.vn/a.jpg' },
      [`${B}_0`]: { userId: B, avatar: 'javascript:alert(1)' },
    } }; },
  });
  const dir = createZaloDirectory({ getApi: () => api, now: () => 0 });
  assert.deepEqual(await dir.avatars([A, B, 'abc', A]), { [A]: 'https://s1-ava.zadn.vn/a.jpg' });
  assert.deepEqual(seen, [[A, B]], 'bỏ UID lạ và trùng');
  assert.deepEqual(await dir.avatars([A]), { [A]: 'https://s1-ava.zadn.vn/a.jpg' });
  assert.equal(seen.length, 1, 'đã đệm thì không hỏi lại (kể cả người không có ảnh)');
  const broken = createZaloDirectory({ getApi: () => fakeApi({ getUserInfo: async () => { throw new Error('mạng'); } }), now: () => 0 });
  assert.deepEqual(await broken.avatars([A]), {});
});

test('bảng tin nhóm: tin ghim, ghi chú, bình chọn chuẩn hoá; đệm 1 phút; nhắn riêng thì rỗng', async () => {
  let t = 0;
  const api = fakeApi({
    getListBoard: async (opts, gid) => { api.calls.push(['board', opts, gid]); return { count: 4, items: [
      { boardType: 2, data: { id: 'p1', creatorId: A, createTime: 10, params: { title: 'Nhớ nộp bài', senderName: 'Cô Lan', client_msg_id: '777', global_msg_id: '888', msg_type: 'chat' } } },
      { boardType: 1, data: { id: 'n1', creatorId: B, createTime: 20, params: { title: 'Nội quy nhóm' } } },
      { boardType: 3, data: { poll_id: 9, creator: A, question: 'Đi đâu?', closed: false, num_vote: 3, created_time: 30,
        options: [{ content: 'Biển', votes: 2 }, { content: 'Núi', votes: 1 }] } },
      { boardType: 7, data: {} },
    ] }; },
  });
  const dir = createZaloDirectory({ getApi: () => api, now: () => t });
  const b = await dir.board({ groupId: G });
  assert.deepEqual(b.pins, [{ id: 'p1', text: 'Nhớ nộp bài', sender: 'Cô Lan', msgId: '888', cliMsgId: '777', at: 10 }]);
  assert.deepEqual(b.notes, [{ id: 'n1', text: 'Nội quy nhóm', at: 20 }]);
  assert.deepEqual(b.polls, [{ id: '9', question: 'Đi đâu?', closed: false, votes: 3, at: 30, options: [{ text: 'Biển', votes: 2 }, { text: 'Núi', votes: 1 }] }]);
  await dir.board({ groupId: G });
  assert.equal(api.calls.filter((c) => c[0] === 'board').length, 1);
  t = 61_000;
  await dir.board({ groupId: G });
  assert.equal(api.calls.filter((c) => c[0] === 'board').length, 2);
  await assert.rejects(dir.board({ groupId: '1 OR 1' }), /groupId/);
});

test('ảnh nhóm theo lô cho danh sách hội thoại: một lần gọi cho nhiều nhóm, đệm', async () => {
  const seen = [];
  const api = fakeApi({ getGroupInfo: async (ids) => { seen.push(ids); return { gridInfoMap: { [G]: { avt: 'https://s1-ava.zadn.vn/g.jpg' }, 66: { avt: '' } } }; } });
  const dir = createZaloDirectory({ getApi: () => api, now: () => 0 });
  assert.deepEqual(await dir.groupAvatars([G, '66', 'x']), { [G]: 'https://s1-ava.zadn.vn/g.jpg' });
  assert.deepEqual(seen, [[G, '66']]);
  await dir.groupAvatars([G, '66']);
  assert.equal(seen.length, 1);
});
