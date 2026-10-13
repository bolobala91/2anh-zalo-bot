import test from 'node:test';
import assert from 'node:assert/strict';
import { docFolderOf, docsInFilter, liveFilter, newDocFolder } from './views/kb.js';
import { NO_FOLDER } from './views/folder-ui.js';

const folders = [{ id: 'lop', name: 'Lớp học', color: 'green' }, { id: 'nq', name: 'Nội quy', color: 'red' }];
const own = [
  { path: 'u/a.md', folder: 'lop' }, { path: 'u/b.md', folder: 'lop' }, { path: 'u/c.md', folder: 'nq' },
  { path: 'u/d.md', folder: null }, { path: 'u/e.md', folder: 'damat' },
];
const paths = (list) => list.map((d) => d.path);

test('tài liệu theo thư mục: Tất cả, từng thư mục, Chưa xếp (gồm id lạ); đếm khớp', () => {
  assert.equal(docsInFilter(own, folders, 'all').length, 5);
  assert.deepEqual(paths(docsInFilter(own, folders, 'lop')), ['u/a.md', 'u/b.md']);
  assert.deepEqual(paths(docsInFilter(own, folders, 'nq')), ['u/c.md']);
  assert.deepEqual(paths(docsInFilter(own, folders, NO_FOLDER)), ['u/d.md', 'u/e.md']);
  const of = docFolderOf(folders);
  assert.equal(of(own[0]).name, 'Lớp học');
  assert.equal(of(own[4]), null, 'thư mục đã mất → Chưa xếp');
  assert.deepEqual(docsInFilter([], folders, 'lop'), []);
});

test('bộ lọc thư mục đã bị xoá quay về Tất cả; tài liệu mới vào thư mục đang lọc', () => {
  assert.equal(liveFilter('lop', folders), 'lop');
  assert.equal(liveFilter('damat', folders), 'all');
  assert.equal(liveFilter(NO_FOLDER, []), NO_FOLDER);
  assert.equal(docsInFilter(own, folders, 'damat').length, 5);
  assert.equal(newDocFolder('lop', folders), 'lop');
  assert.equal(newDocFolder('all', folders), null);
  assert.equal(newDocFolder(NO_FOLDER, folders), null);
  assert.equal(newDocFolder('damat', folders), null);
  assert.equal(newDocFolder('lop', undefined), null);
});
