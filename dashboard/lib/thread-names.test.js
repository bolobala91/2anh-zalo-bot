import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('bot trả tên nhóm chính là ID (Zalo không cho tên) → coi như chưa có tên, dùng tên dự phòng', async () => {
  const names = createThreadNames({ loadGroups: async () => [{ id: '200', name: 'Tổ Hoá' }, { id: '987654', name: '987654' }, { id: '555', name: ' 555 ' }] });
  const map = await names.load();
  assert.deepEqual([...map], [['200', 'Tổ Hoá']]);
  assert.equal(map.get('987654') || fallbackName('987654', 1), 'Nhóm chưa rõ tên');
});

test('tên dự phòng không lộ ID', () => {
  assert.equal(fallbackName('987654', 1), 'Nhóm chưa rõ tên');
  assert.equal(fallbackName('123456789', 0), 'Người chưa rõ tên');
});

test('tên đã biết được lưu xuống đĩa: khởi động lại vẫn có tên ngay, nhóm đã rời vẫn giữ tên', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-names-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'group-names.json');
  await createThreadNames({ loadGroups: async () => [{ id: '200', name: 'Tổ Hoá' }, { id: '300', name: 'CLB' }], file }).load();
  const restarted = createThreadNames({ loadGroups: async () => { throw Object.assign(new Error('tắt'), { name: 'SidecarDown' }); }, file });
  const map = await restarted.load();
  assert.equal(map.get('200'), 'Tổ Hoá', 'kết nối Zalo chưa lên vẫn có tên đã lưu');
  const later = createThreadNames({ loadGroups: async () => [{ id: '200', name: 'Tổ Hoá học' }], file });
  const merged = await later.load();
  assert.equal(merged.get('200'), 'Tổ Hoá học', 'tên mới thắng');
  assert.equal(merged.get('300'), 'CLB', 'nhóm bot đã rời vẫn giữ tên cũ');
});
