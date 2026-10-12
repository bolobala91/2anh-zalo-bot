import test from 'node:test';
import assert from 'node:assert/strict';
import { baseOfGroup, folderBadge, mergeGroups, staysListed } from './views/permissions.js';

const features = { web: true, files: true };
const defaults = { active: true, replyOnlyTagged: true, features, studio: {}, studioQuota: null };
const folder = { id: 'lop', name: 'Lớp học', groups: ['200', '300'], active: false, replyOnlyTagged: true,
  features: { web: false, files: true }, studio: {}, studioQuota: 2 };

test('nhóm trong thư mục lấy nền thư mục, có nhãn thư mục; danh sách "chỉ chủ nhân" cũ không áp cho nhóm đã vào thư mục', () => {
  const perms = { defaults, folders: [folder], legacyOwnerOnly: ['300', '400'],
    groups: { 300: { name: 'Lớp 12B', ...folder, active: true, studioQuota: 2 } } };
  const list = mergeGroups([{ id: '200', name: 'Lớp 12A', members: 30 }, { id: '300', name: 'Lớp 12B', members: 31 }, { id: '400', name: 'Khác', members: 5 }], perms);
  const [a, b, c] = list;
  assert.deepEqual(a.folder, { id: 'lop', name: 'Lớp học' });
  assert.equal(a.active, false, 'theo thư mục đang tắt');
  assert.equal(a.features.web, false);
  assert.equal(a.custom, false);
  assert.equal(a.ownerOnly, false);
  assert.equal(b.active, true, 'mục riêng thắng thư mục');
  assert.equal(b.custom, true);
  assert.equal(b.ownerOnly, false, 'nhóm thuộc thư mục: phân quyền đã chọn thắng danh sách cũ');
  assert.equal(c.folder, null);
  assert.equal(c.ownerOnly, true);
  assert.equal(baseOfGroup(perms, '200'), folder);
  assert.equal(baseOfGroup(perms, '400'), defaults);
  assert.ok(staysListed('f:lop', perms, []));
  assert.ok(staysListed('200', perms, []), 'nhóm chỉ có trong thư mục vẫn còn trong danh sách');
});

test('nhãn thư mục: đang tắt hay số nhóm', () => {
  assert.deepEqual(folderBadge(folder), { kind: 'danger', text: 'Đang tắt · 2 nhóm' });
  assert.deepEqual(folderBadge({ ...folder, active: true }), { kind: 'idle', text: '2 nhóm' });
});
