import test from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

const JOB = { id: 'aa11bb22cc33', name: 'Nhắc nộp bài', kind: 'group', target: '200', paused: false };

function fakeSchedules(over = {}) {
  const calls = [];
  return { calls, list: () => [JOB], cron: async (action, id) => { calls.push([action, id]); return JOB; }, ...over };
}

test('Lịch hẹn: Chủ bot xem việc + tên nhóm; tạm dừng ghi Nhật ký; thao tác lạ 400; lỗi đọc vẫn 200 kèm câu lỗi', async (t) => {
  const deps = makeDeps(t, { schedules: fakeSchedules() });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/schedules')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/schedules', { cookie: owner });
  assert.equal(r.json.jobs[0].targetName, 'Tổ Hoá');
  assert.equal((await call('/api/schedules/cron/aa11bb22cc33/pause', { method: 'POST', cookie: owner })).status, 200);
  assert.deepEqual(deps.schedules.calls, [['pause', 'aa11bb22cc33']]);
  assert.equal(deps.activity.list()[0].action, 'cron_pause');
  assert.equal((await call('/api/schedules/cron/aa11bb22cc33/run', { method: 'POST', cookie: owner })).status, 400);

  const broken = makeDeps(t, { schedules: fakeSchedules({ list: () => { throw new Error('jobs.json hỏng'); } }) });
  const app2 = await startApp(t, broken);
  const admin = await loginAs(t, broken, app2.call);
  const r2 = await app2.call('/api/schedules', { cookie: admin });
  assert.equal(r2.status, 200);
  assert.match(r2.json.cronError, /Chưa đọc được/);
});

test('Lịch hẹn: lỗi lệnh Hermes ghi Nhật ký thất bại và trả câu của lib; lời nhắc Zalo chuyển xuống kết nối Zalo kèm người làm', async (t) => {
  const deps = makeDeps(t, { schedules: fakeSchedules({ cron: async () => { throw Object.assign(new Error('Trợ lý chưa làm được việc này — thử lại.'), { statusCode: 502 }); } }) });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/schedules/cron/aa11bb22cc33/remove', { method: 'POST', cookie: admin });
  assert.equal(r.status, 502);
  assert.equal(deps.activity.list()[0].ok, false);
  const rem = (await call('/api/schedules/reminders?threadId=200&threadType=1', { cookie: admin })).json.reminders[0];
  assert.equal(rem.title, 'Họp tổ');
  assert.equal(rem.mine, true);
  assert.equal('creatorUid' in rem, false);
  assert.equal((await call('/api/schedules/reminders?threadId=abc&threadType=1', { cookie: admin })).status, 400);
  await call('/api/schedules/reminders/remove', { method: 'POST', cookie: admin, body: { reminderId: '77', threadId: '200', threadType: 1 } });
  assert.deepEqual(deps.sidecar.calls.at(-1), ['remove-reminder', { reminderId: '77', threadId: '200', threadType: 1, actor: 'anh' }]);
});

test('Lịch hẹn: nhiều việc một lần — kiểm mã trước, chạy lần lượt, báo mục lỗi, một dòng Nhật ký', async (t) => {
  const B = 'bb22cc33dd44';
  const deps = makeDeps(t, { schedules: fakeSchedules({ cron: async (action, id) => {
    deps.schedules.calls.push([action, id]);
    if (id === B) throw Object.assign(new Error('Không tìm thấy việc hẹn giờ này — tải lại trang.'), { statusCode: 404 });
    return JOB;
  } }) });
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/schedules/cron/bulk', { method: 'POST', body: { action: 'pause', ids: [JOB.id] } })).status, 401);
  for (const body of [{ action: 'run', ids: [JOB.id] }, { action: 'pause', ids: [] }, { action: 'pause', ids: [JOB.id, '../x'] },
    { action: 'pause', ids: Array(101).fill(JOB.id) }, { action: 'pause', ids: 'aa' }]) {
    assert.equal((await call('/api/schedules/cron/bulk', { method: 'POST', cookie: owner, body })).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.deepEqual(deps.schedules.calls, [], 'từ chối trước khi chạy lệnh nào');
  const r = await call('/api/schedules/cron/bulk', { method: 'POST', cookie: owner, body: { action: 'remove', ids: [JOB.id, B, JOB.id] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.done, [{ id: JOB.id, name: JOB.name }]);
  assert.deepEqual(r.json.failed.map((f) => f.id), [B]);
  assert.deepEqual(deps.schedules.calls, [['remove', JOB.id], ['remove', B]]);
  assert.deepEqual(deps.activity.list().filter((e) => e.action.startsWith('cron_')).map((e) => [e.action, e.detail]), [['cron_remove', '1/2 việc']]);
});

test('Lời nhắc Zalo: xoá nhiều trong một hội thoại — kiểm mã trước, gửi kèm người làm, một dòng Nhật ký', async (t) => {
  const deps = makeDeps(t, { schedules: fakeSchedules() });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const url = '/api/schedules/reminders/bulk-remove';
  for (const body of [{ threadId: 'x', threadType: 1, reminderIds: ['1'] }, { threadId: '200', threadType: 2, reminderIds: ['1'] },
    { threadId: '200', threadType: 1, reminderIds: [] }, { threadId: '200', threadType: 1, reminderIds: ['1', 'a b'] }]) {
    assert.equal((await call(url, { method: 'POST', cookie: admin, body })).status, 400);
  }
  assert.equal(deps.sidecar.calls.filter((c) => c[0] === 'remove-reminder').length, 0);
  const r = await call(url, { method: 'POST', cookie: admin, body: { threadId: '200', threadType: 1, reminderIds: ['77', '78'] } });
  assert.deepEqual([r.status, r.json.done.length, r.json.failed.length], [200, 2, 0]);
  assert.deepEqual(deps.sidecar.calls.filter((c) => c[0] === 'remove-reminder').map((c) => c[1].reminderId), ['77', '78']);
  assert.equal(deps.sidecar.calls.at(-1)[1].actor, 'anh');
  assert.deepEqual(deps.activity.list().filter((e) => e.action === 'reminder_remove').map((e) => e.detail), ['2/2 lời nhắc']);
});
