import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidecarDown, SidecarTimeout } from '../lib/sidecar-client.js';
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

test('bot tắt (không kết nối được) → 503 tiếng Việt; gửi lại cùng tin được ngay', async (t) => {
  let down = true;
  const sidecar = fakeSidecar();
  const ok = sidecar.send;
  sidecar.send = async (m) => { if (down) throw new SidecarDown(); return ok(m); };
  const { send, sends } = await ready(t, { sidecar });
  const res = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(res.status, 503);
  assert.match(res.json.error, /Kết nối Zalo đang tắt/);
  assert.doesNotMatch(res.json.error, /sidecar|bridge/i);
  down = false;
  assert.equal((await send('100', { text: 'chào', threadType: 0 })).status, 200); // lỗi rõ ràng không chặn gửi lại
  assert.equal(sends().length, 1);
});

test('bot báo Zalo chưa đăng nhập → 503 kèm bước quét QR, không lộ chữ gốc', async (t) => {
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw Object.assign(new Error('Zalo chưa đăng nhập'), { statusCode: 502 }); } }) });
  const res = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(res.status, 503);
  assert.equal(res.json.error, 'Zalo của bot đang đăng xuất — vào Tài khoản Zalo để quét QR.');
});

test('lỗi 502 khác từ bot không lộ nội dung gốc; 401/403 từ bot → 502', async (t) => {
  const orig = console.error; console.error = () => {};
  t.after(() => { console.error = orig; });
  let fail = { message: 'zca: lỗi nội bộ abc', statusCode: 502 };
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw Object.assign(new Error(fail.message), { statusCode: fail.statusCode }); } }) });
  const res = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.json.error, /lỗi nội bộ abc/);
  for (const statusCode of [401, 403]) {
    fail = { message: 'unauthorized', statusCode };
    const r = await send('100', { text: `chào ${statusCode}`, threadType: 0 });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /khoá kết nối/);
  }
});

test('gửi quá hạn chờ → 504 "chưa rõ đã gửi"; gửi lại đúng tin đó trong 30 s → 409, không gọi bot lần hai', async (t) => {
  let clock = 1_000_000;
  const sidecar = fakeSidecar();
  sidecar.send = async (m) => { sidecar.calls.push(['send', m]); throw new SidecarTimeout(); };
  const { send, sends } = await ready(t, { sidecar, now: () => clock });
  const res = await send('100', { text: 'Dạ em chào chị', threadType: 0 });
  assert.equal(res.status, 504);
  assert.equal(res.json.error, 'Chưa rõ tin đã gửi được chưa — xem khung tin (tự cập nhật) trước khi gửi lại.');
  clock += 29_999;
  const again = await send('100', { text: '  Dạ em chào chị ', threadType: 0 });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'Tin này vừa được gửi — kiểm tra khung tin trước khi gửi lại.');
  assert.equal(sends().length, 1);
  clock += 1;
  assert.equal((await send('100', { text: 'Dạ em chào chị', threadType: 0 })).status, 504); // hết 30 s thì cho thử lại
  assert.equal(sends().length, 2);
});

test('gửi trùng sau khi đã gửi được: 409 trong 30 s; khác nội dung / hội thoại / người gửi thì vẫn gửi', async (t) => {
  let clock = 1_000_000;
  const { deps, call, send, sends } = await ready(t, { now: () => clock });
  assert.equal((await send('100', { text: 'chào', threadType: 0 })).status, 200);
  clock += 10_000;
  assert.equal((await send('100', { text: 'chào', threadType: 0 })).status, 409);
  assert.equal((await send('100', { text: 'chào nhé', threadType: 0 })).status, 200);
  assert.equal((await send('200', { text: 'chào', threadType: 1 })).status, 200);
  const admin = await loginAs(t, deps, call);
  assert.equal((await send('100', { text: 'chào', threadType: 0 }, admin)).status, 200);
  assert.equal(sends().length, 4);
  clock += 20_000;
  assert.equal((await send('100', { text: 'chào', threadType: 0 })).status, 200);
});

test('gửi tay thành công thì danh sách hội thoại cập nhật ngay, không chờ hết đệm 10 s', async (t) => {
  const { deps, call, cookie, send } = await ready(t);
  const ids = async () => (await call('/api/chats', { cookie })).json.conversations.map((c) => c.threadId);
  assert.deepEqual(await ids(), ['200', '100']);
  seedHistory(deps, { messages: [chatMsg({ threadId: '300', threadType: 0, ts: 9_000_000 })] });
  assert.deepEqual(await ids(), ['200', '100']); // còn trong đệm
  assert.equal((await send('100', { text: 'chào', threadType: 0 })).status, 200);
  assert.deepEqual(await ids(), ['300', '200', '100']);
});

test('chưa đăng nhập → 401; Origin lạ → 403', async (t) => {
  const { call } = await ready(t);
  assert.equal((await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 } })).status, 401);
  const res = await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('trả lời có trích dẫn: tra tin gốc ở máy chủ (UID không qua trình duyệt); tin không có msgId Zalo → 400', async (t) => {
  const deps = makeDeps(t);
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '200', threadType: 1, msgId: '7001', senderUid: '5550001', senderName: 'Lan', text: 'Mai họp mấy giờ?' }),
    chatMsg({ threadId: '200', threadType: 1, msgId: '7002', senderUid: '0', text: 'Dạ 8h ạ', isSelf: true }),
  ] });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const list = await call('/api/chats/200/messages?type=1', { cookie });
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.json).includes('5550001'), 'danh sách tin không lộ UID');
  const [lan, bot] = list.json.messages;
  const send = (body) => call('/api/chats/200/send', { method: 'POST', cookie, body: { threadType: 1, ...body } });
  assert.equal((await send({ text: 'Dạ 8h sáng ạ', replyTo: lan.id })).status, 200);
  assert.equal((await send({ text: 'Bổ sung: phòng 201', replyTo: bot.id })).status, 200);
  const sends = deps.sidecar.calls.filter((c) => c[0] === 'send').map((c) => c[1]);
  assert.deepEqual(sends[0].quote, { msgId: '7001', cliMsgId: '', uidFrom: '5550001', content: 'Mai họp mấy giờ?', ts: sends[0].quote.ts, isSelf: false });
  assert.equal(sends[1].quote.isSelf, true);
  assert.equal((await send({ text: 'x', replyTo: 999999 })).status, 400);
  assert.equal((await call('/api/chats/100/send', { method: 'POST', cookie, body: { text: 'x', threadType: 1, replyTo: lan.id } })).status, 404, 'tin của hội thoại khác không trích được');
});

test('nhắc tên (@): vị trí phải đúng "@…" trong nội dung; nhắc theo tin thì máy chủ tự tra UID; chỉ trong nhóm', async (t) => {
  const deps = makeDeps(t);
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '200', threadType: 1, msgId: '7001', senderUid: '5550001', senderName: 'Lan', text: 'Ai trực?' }),
    chatMsg({ threadId: '100', threadType: 0, text: 'chào' }),
  ] });
  deps.sidecar.groupMembers = async () => ({ total: 2, members: [{ id: '5550001', displayName: 'Lan' }, { id: '5550002', displayName: 'Minh Anh' }] });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const mem = await call('/api/chats/200/members', { cookie });
  assert.deepEqual(mem.json.members, [{ uid: '5550001', name: 'Lan' }, { uid: '5550002', name: 'Minh Anh' }]);
  assert.equal((await call('/api/chats/999/members', { cookie })).status, 404);
  const lan = (await call('/api/chats/200/messages?type=1', { cookie })).json.messages[0];
  const text = '@Lan và @Minh Anh trực nhé';
  const ok = await call('/api/chats/200/send', { method: 'POST', cookie, body: { text, threadType: 1, mentions: [{ msg: lan.id, pos: 0, len: 4 }, { uid: '5550002', pos: 8, len: 9 }] } });
  assert.equal(ok.status, 200);
  const sent = deps.sidecar.calls.filter((c) => c[0] === 'send').map((c) => c[1]).pop();
  assert.deepEqual(sent.mentions, [{ uid: '5550001', pos: 0, len: 4 }, { uid: '5550002', pos: 8, len: 9 }]);
  for (const mentions of [[{ uid: '5550002', pos: 1, len: 4 }], [{ uid: 'abc', pos: 0, len: 4 }], [{ uid: '5550002', pos: 20, len: 50 }]]) {
    assert.equal((await call('/api/chats/200/send', { method: 'POST', cookie, body: { text: `${text} ${mentions[0].pos}`, threadType: 1, mentions } })).status, 400, JSON.stringify(mentions));
  }
  assert.equal((await call('/api/chats/100/send', { method: 'POST', cookie, body: { text: '@Lan', threadType: 0, mentions: [{ uid: '5550001', pos: 0, len: 4 }] } })).status, 400, 'tin riêng không gắn tag');
});
