import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPermissionsStore, FEATURE_KEYS, normalize, parseSettings } from './permissions.js';

const G = '2054797107487294899';
const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
const settings = (over = {}, features = {}) => ({ active: true, replyOnlyTagged: true, ...over, features: { ...allOn(), ...features } });

function setup(t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-perm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'zalo', 'permissions.json');
  return { file, store: createPermissionsStore({ file, ...opts }), disk: () => JSON.parse(readFileSync(file, 'utf8')) };
}

test('chưa có tệp: mọi tính năng bật, cờ tag theo cài đặt chung, không tạo tệp', (t) => {
  const s = setup(t, { globalReplyOnlyTagged: false });
  const v = s.store.get();
  assert.equal(v.exists, false);
  assert.deepEqual(v.defaults, { active: true, replyOnlyTagged: false, features: allOn() });
  assert.deepEqual(v.groups, {});
  assert.equal(existsSync(s.file), false);
});

test('lưu nhóm chỉ ghi khoá khác mặc định; trùng mặc định thì xoá mục của nhóm', (t) => {
  const s = setup(t);
  const { state, changed } = s.store.setGroup(G, settings({ replyOnlyTagged: false }, { web: false }), 'Tổ Hoá');
  assert.deepEqual(changed, ['replyOnlyTagged', 'web']);
  assert.deepEqual(s.disk(), { version: 1, defaults: {}, groups: { [G]: { name: 'Tổ Hoá', replyOnlyTagged: false, features: { web: false } } } });
  assert.equal(state.groups[G].custom, true);
  assert.equal(state.groups[G].features.kb, true);
  // Nhóm chưa chỉnh "kb" nên đi theo mặc định khi mặc định đổi.
  s.store.setDefaults(settings({}, { kb: false }));
  assert.equal(s.store.get().groups[G].features.kb, false);
  // Đưa về đúng mặc định → mục của nhóm biến mất.
  const back = s.store.setGroup(G, settings({}, { kb: false }));
  assert.deepEqual(back.changed, []);
  assert.deepEqual(s.disk().groups, {});
});

test('ghi nguyên tử, giữ .bak bản trước, quyền 600', (t) => {
  const s = setup(t);
  s.store.setDefaults(settings({}, { video: false }));
  s.store.setDefaults(settings({}, { voice: false }));
  assert.equal(s.disk().defaults.features.voice, false);
  assert.equal(JSON.parse(readFileSync(`${s.file}.bak`, 'utf8')).defaults.features.video, false);
  assert.equal(existsSync(`${s.file}.tmp`), false);
  if (process.platform !== 'win32') {
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.equal(statSync(`${s.file}.bak`).mode & 0o777, 0o600);
  }
});

test('tệp hỏng: báo corrupt, hiện mặc định, không đổi tên tệp; lưu lại thì .bak giữ bản hỏng', (t) => {
  const s = setup(t);
  s.store.setDefaults(settings());
  writeFileSync(s.file, '{hỏng');
  const v = s.store.get();
  assert.equal(v.corrupt, true);
  assert.deepEqual(v.defaults.features, allOn());
  assert.equal(readFileSync(s.file, 'utf8'), '{hỏng');
  s.store.setGroup(G, settings({ active: false }));
  assert.equal(readFileSync(`${s.file}.bak`, 'utf8'), '{hỏng');
  assert.equal(s.store.get().corrupt, false);
});

test('normalize bỏ khoá lạ, sai kiểu, ID nhóm không phải số; sai phiên bản thì ném', () => {
  const n = normalize({ version: 1, defaults: { active: 'no', features: { web: false, lạ: false, kb: 1 } },
    groups: { abc: { active: false }, [G]: { name: ' Tổ Hoá ', active: false, features: [] }, '1': 'rác' } });
  assert.deepEqual(n, { version: 1, defaults: { features: { web: false } }, groups: { [G]: { name: 'Tổ Hoá', active: false }, 1: {} } });
  assert.throws(() => normalize({ version: 2 }));
  assert.throws(() => normalize([]));
});

test('parseSettings đòi đủ hai công tắc và đủ 9 nút boolean', () => {
  assert.deepEqual(parseSettings(settings({}, { web: false })).features.web, false);
  for (const bad of [null, [], { ...settings(), active: 'true' }, { ...settings(), replyOnlyTagged: undefined },
    { ...settings(), features: { ...allOn(), web: 'off' } }, { ...settings(), features: { ...allOn(), lạ: true } },
    { active: true, replyOnlyTagged: true, features: { web: true } }]) {
    assert.throws(() => parseSettings(bad), (e) => e.name === 'InvalidPermissions' && e.status === 400, JSON.stringify(bad));
  }
});

test('danh sách nút khớp FEATURES của plugin Python', () => {
  const py = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hermes-plugin', 'zalo_tools', 'group_permissions.py'), 'utf8');
  const tuple = /^FEATURES = \(([^)]*)\)/m.exec(py)[1];
  assert.deepEqual([...tuple.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]), FEATURE_KEYS);
});

test('mặc định trong tệp chưa ghi cờ tag: nhóm luôn ghi hẳn replyOnlyTagged, dù bằng cờ chung', (t) => {
  const s = setup(t, { globalReplyOnlyTagged: true });
  const { changed } = s.store.setGroup(G, settings({ active: false }));
  assert.deepEqual(changed, ['active']);
  assert.deepEqual(s.disk().groups[G], { active: false, replyOnlyTagged: true });
  // Không có khác biệt thật nào: vẫn giữ cờ tag để bot không rơi về cờ chung khác.
  assert.deepEqual(s.store.setGroup(G, settings()).changed, []);
  assert.deepEqual(s.disk().groups[G], { replyOnlyTagged: true });
  // Mặc định đã ghi cờ tag rõ ràng → quay lại kiểu chỉ ghi phần khác biệt.
  s.store.setDefaults(settings());
  s.store.setGroup(G, settings());
  assert.deepEqual(s.disk().groups, {});
});

test('quá 500 nhóm riêng thì từ chối nhóm mới bằng InvalidPermissions', (t) => {
  const s = setup(t);
  for (let i = 1; i <= 500; i++) s.store.setGroup(String(i), settings({ active: false }));
  assert.throws(() => s.store.setGroup(G, settings({ active: false })), (e) => e.name === 'InvalidPermissions' && /—/.test(e.message));
  assert.equal(s.store.setGroup('7', settings({ active: true })).state.groups['7'].custom, true);
});
