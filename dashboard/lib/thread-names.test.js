import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadNames, fallbackName } from './thread-names.js';
import { SidecarDown } from './sidecar-client.js';

test('tên nhóm được đệm, hết hạn thì lấy lại', async () => {
  let clock = 0; let calls = 0;
  const names = createThreadNames({ loadGroups: async () => { calls += 1; return [{ id: '200', name: 'Tổ Hoá' }]; }, ttlMs: 1000, now: () => clock });
  assert.equal((await names.load()).get('200'), 'Tổ Hoá');
  await names.load();
  assert.equal(calls, 1);
  clock = 1000;
  await names.load();
  assert.equal(calls, 2);
});

test('bot không trả lời: không ném lỗi, giữ tên cũ, không thử lại dồn dập', async () => {
  let clock = 0; let fail = false; let calls = 0;
  const names = createThreadNames({
    loadGroups: async () => { calls += 1; if (fail) throw new SidecarDown(); return [{ id: '200', name: 'Tổ Hoá' }]; },
    ttlMs: 1000, retryMs: 500, now: () => clock,
  });
  await names.load();
  fail = true; clock = 1000;
  assert.equal((await names.load()).get('200'), 'Tổ Hoá');
  assert.equal(calls, 2);
  clock = 1200; await names.load();
  assert.equal(calls, 2); // chưa đủ retryMs
  clock = 1500; await names.load();
  assert.equal(calls, 3);
});

test('loadGroups ném lỗi đồng bộ vẫn không kẹt, lần sau thử lại được', async () => {
  let clock = 0; let calls = 0;
  const names = createThreadNames({ loadGroups: () => { calls += 1; throw new SidecarDown(); }, retryMs: 10, now: () => clock });
  assert.equal((await names.load()).size, 0);
  clock = 10;
  await names.load();
  assert.equal(calls, 2);
});

test('cached() trả ngay và làm mới ngầm', async () => {
  const names = createThreadNames({ loadGroups: async () => [{ id: '200', name: 'Tổ Hoá' }] });
  assert.equal(names.cached().size, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(names.cached().get('200'), 'Tổ Hoá');
});

test('tên dự phòng', () => {
  assert.equal(fallbackName('987654', 1), 'Nhóm …7654');
  assert.equal(fallbackName('123456789', 0), 'Người dùng …6789');
});
