import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeSendName } from './chats.js';
import { attachProblem } from '../public/views/chats.js';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

async function ready(t, { sendFile, outbox = true } = {}) {
  const seen = [];
  const sidecar = fakeSidecar({
    sendFile: sendFile || (async (m) => { seen.push({ ...m, bytes: readFileSync(m.path, 'utf8') }); return { msgId: '1' }; }),
  });
  const deps = makeDeps(t, { sidecar });
  if (outbox) deps.outboxDir = join(deps.dir, 'outbox');
  seedHistory(deps, { messages: [chatMsg({ threadId: '200', threadType: 1, text: 'Chào cả nhóm' })] });
  const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const upload = (name, body = 'noi dung', { threadId = '200', type = 1 } = {}) => fetch(`${base}/api/chats/${threadId}/send-file?type=${type}`, {
    method: 'POST', body,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'zalo-dashboard', Cookie: cookie, 'X-File-Name': encodeURIComponent(name) },
  });
  return { deps, seen, upload };
}

test('gửi ảnh/tệp: đặt tạm vào outbox đúng tên, gửi dưới tên người bấm, gửi xong thì xoá', async (t) => {
  const { deps, seen, upload } = await ready(t);
  const res = await upload('Bài tập Hoá.PDF');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, name: 'Bài tập Hoá.pdf' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].threadId, '200');
  assert.equal(seen[0].threadType, 1);
  assert.equal(seen[0].actor, 'khach');
  assert.equal(seen[0].bytes, 'noi dung');
  assert.ok(seen[0].path.startsWith(deps.outboxDir));
  assert.ok(seen[0].path.endsWith('Bài tập Hoá.pdf'));
  assert.deepEqual(readdirSync(deps.outboxDir), []);
});

test('loại tệp lạ, tệp rỗng, hội thoại lạ → không gọi bot', async (t) => {
  const { seen, upload } = await ready(t);
  assert.equal((await upload('virus.exe')).status, 400);
  assert.equal((await upload('khong-duoi')).status, 400);
  assert.equal((await upload('anh.png', '')).status, 400);
  assert.equal((await upload('anh.png', 'x', { threadId: '555' })).status, 404);
  assert.equal((await upload('anh.png', 'x', { type: 0 })).status, 404);
  assert.equal((await upload('anh.png', 'x', { type: 7 })).status, 400);
  assert.equal(seen.length, 0);
});

test('bot gửi lỗi → báo lỗi nhưng vẫn dọn tệp tạm', async (t) => {
  const { deps, upload } = await ready(t, { sendFile: async () => { throw Object.assign(new Error('Zalo từ chối'), { statusCode: 502 }); } });
  const res = await upload('anh.jpg');
  assert.ok(res.status >= 400);
  assert.ok(!existsSync(deps.outboxDir) || readdirSync(deps.outboxDir).length === 0);
});

test('máy chưa cấu hình outbox → 503', async (t) => {
  const { upload } = await ready(t, { outbox: false });
  assert.equal((await upload('anh.png')).status, 503);
});

test('safeSendName: bỏ thư mục và ký tự cấm, đuôi chữ thường, chặn loại lạ', () => {
  assert.equal(safeSendName('C:\\Users\\a\\Ảnh 1.JPG'), 'Ảnh 1.jpg');
  assert.equal(safeSendName('../../etc/passwd.txt'), 'passwd.txt');
  assert.equal(safeSendName('a<b>:c?.png'), 'abc.png');
  assert.equal(safeSendName('...png'), 'tep.png');
  assert.equal(safeSendName('setup.exe'), '');
  assert.equal(safeSendName(''), '');
});

test('attachProblem (trình duyệt): đúng loại và cỡ thì rỗng, sai thì có câu lỗi', () => {
  assert.equal(attachProblem('a.png', 100), '');
  assert.match(attachProblem('x.exe', 1), /không gửi được/);
  assert.match(attachProblem('b.pdf', 26 * 1048576), /25 MB/);
  assert.match(attachProblem('c.png', 0), /rỗng/);
});
