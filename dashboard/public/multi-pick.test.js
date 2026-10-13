import test from 'node:test';
import assert from 'node:assert/strict';

const OPTS = [{ uid: '1', name: 'Nguyễn Văn An' }, { uid: '2', name: 'Trần Thị Bình', note: 'đang ở "Lớp 12A"' }, { uid: '3', name: 'Lê An' }];

test('chọn nhiều: lọc theo tên không dấu (cả ghi chú); "Chọn tất cả" chỉ chọn/bỏ các mục đang lọc', async () => {
  const { filterOptions, toggleAll } = await import('./views/multi-pick.js');
  assert.deepEqual(filterOptions(OPTS, 'lê an').map((o) => o.uid), ['3']);
  assert.deepEqual(filterOptions(OPTS, 'nguyen').map((o) => o.uid), ['1']);
  assert.deepEqual(filterOptions(OPTS, 'lop 12').map((o) => o.uid), ['2']);
  assert.equal(filterOptions(OPTS, '  ').length, 3);
  const ANS = [OPTS[0], OPTS[2]];
  const some = toggleAll(new Set(['2']), ANS);
  assert.deepEqual([...some].sort(), ['1', '2', '3'], 'chọn thêm mục đang lọc, giữ mục đã chọn khác');
  const off = toggleAll(some, ANS);
  assert.deepEqual([...off], ['2'], 'đã chọn hết mục đang lọc → bỏ chọn đúng các mục đó');
  assert.deepEqual([...toggleAll(new Set(), [])], []);
});
