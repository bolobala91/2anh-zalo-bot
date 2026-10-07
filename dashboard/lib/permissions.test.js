import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPermissionsStore, FEATURE_KEYS, InvalidPermissions, makeDmEnv, makeGlobalReplyOnlyTagged, normalize, parseDm, parseSettings } from './permissions.js';

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
  assert.deepEqual(s.disk(), { version: 1, defaults: { replyOnlyTagged: true }, groups: { [G]: { name: 'Tổ Hoá', replyOnlyTagged: false, features: { web: false } } } });
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

test('lần lưu nhóm đầu tiên ghi cờ tag thật vào defaults một lần, không ghi vào nhóm', (t) => {
  const s = setup(t, { globalReplyOnlyTagged: false });
  // Bot đang trả lời mọi tin (cờ chung false); chỉ tắt "web" ở nhóm G → nhóm G không được thành chỉ-khi-tag.
  const { changed, state } = s.store.setGroup(G, settings({ replyOnlyTagged: false }, { web: false }));
  assert.deepEqual(changed, ['web']);
  assert.deepEqual(s.disk(), { version: 1, defaults: { replyOnlyTagged: false }, groups: { [G]: { features: { web: false } } } });
  assert.equal(state.groups[G].replyOnlyTagged, false);
  // Từ đó cờ tag so khác biệt như mọi khoá khác: đổi mặc định thì nhóm không chỉnh khoá này đi theo.
  s.store.setDefaults(settings({ replyOnlyTagged: true }));
  assert.equal(s.store.get().groups[G].replyOnlyTagged, true);
  assert.deepEqual(s.disk().groups[G], { features: { web: false } });
});

test('cờ chung lấy qua hàm: đọc lại mỗi lần, chỉ hạt giống một lần', (t) => {
  let flag = true;
  const s = setup(t, { globalReplyOnlyTagged: () => flag });
  assert.equal(s.store.get().defaults.replyOnlyTagged, true);
  flag = false;
  assert.equal(s.store.get().defaults.replyOnlyTagged, false);
  s.store.setGroup(G, settings({ replyOnlyTagged: false, active: false }));
  flag = true;
  // Đã có trong tệp → tệp thắng, không đổi theo cờ chung nữa.
  assert.equal(s.store.get().defaults.replyOnlyTagged, false);
  assert.deepEqual(s.disk().groups[G], { active: false });
});

test('tệp cũ ghi cờ tag vào từng nhóm: bằng hạt giống thì dọn, khác thì giữ — hành vi không đổi', (t) => {
  const s = setup(t, { globalReplyOnlyTagged: false });
  mkdirSync(dirname(s.file), { recursive: true });
  const H = '2054797107487294811';
  const K = '2054797107487294822';
  writeFileSync(s.file, JSON.stringify({ version: 1, defaults: {}, groups: {
    [G]: { name: 'A', replyOnlyTagged: false, features: { web: false } },
    [H]: { name: 'B', replyOnlyTagged: true },
    [K]: { name: 'C', replyOnlyTagged: false },
  } }));
  const before = s.store.get();
  s.store.setGroup('1', settings({ replyOnlyTagged: false, active: false }));
  const after = s.store.get();
  for (const id of [G, H, K]) {
    assert.equal(after.groups[id]?.replyOnlyTagged ?? after.defaults.replyOnlyTagged, before.groups[id].replyOnlyTagged, id);
  }
  assert.deepEqual(s.disk().groups[G], { name: 'A', features: { web: false } });
  assert.deepEqual(s.disk().groups[H], { name: 'B', replyOnlyTagged: true });
  assert.equal(s.disk().groups[K], undefined);
  assert.equal(after.groups[H].replyOnlyTagged, true);
});

test('tệp có BOM (sửa bằng Notepad) không bị coi là hỏng', (t) => {
  const s = setup(t);
  mkdirSync(dirname(s.file), { recursive: true });
  writeFileSync(s.file, `﻿${JSON.stringify({ version: 1, defaults: { features: { web: false } }, groups: {} })}`);
  const v = s.store.get();
  assert.equal(v.corrupt, false);
  assert.equal(v.defaults.features.web, false);
});

test('cờ tag chung đọc từ .env và config.yaml của Hermes như adapter, đọc lại khi tệp đổi', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-flag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  const read = (inherited) => makeGlobalReplyOnlyTagged({ envFile, configFile, inherited })();
  // Không có gì → mặc định bật.
  assert.equal(read(undefined), true);
  // config.yaml do bộ cài ghi.
  writeFileSync(configFile, 'platforms:\n  zalo:\n    extra:\n      reply_only_tagged: false\n');
  assert.equal(read(undefined), false);
  // Biến môi trường dịch vụ khác rỗng đè config.yaml; .env của Hermes đè biến môi trường.
  assert.equal(read('yes'), true);
  writeFileSync(envFile, '﻿# ghi chú\nZALO_GROUP_REPLY_ONLY_TAGGED="off"\n');
  assert.equal(read('yes'), false);
  writeFileSync(envFile, 'ZALO_GROUP_REPLY_ONLY_TAGGED=On\n');
  assert.equal(read(undefined), true);
  // Rỗng trong .env → rơi về config.yaml (giống _env_enablement bỏ giá trị rỗng).
  writeFileSync(envFile, 'ZALO_GROUP_REPLY_ONLY_TAGGED=\n');
  assert.equal(read('true'), false);
  // Một bộ đọc dùng lâu dài thấy thay đổi của tệp.
  const live = makeGlobalReplyOnlyTagged({ envFile, configFile });
  assert.equal(live(), false);
  writeFileSync(envFile, 'ZALO_GROUP_REPLY_ONLY_TAGGED=true\nKHAC=1\n');
  const later = new Date(Date.now() + 5000);
  utimesSync(envFile, later, later);
  assert.equal(live(), true);
});

test('quá 500 nhóm riêng thì từ chối nhóm mới bằng InvalidPermissions', (t) => {
  const s = setup(t);
  for (let i = 1; i <= 500; i++) s.store.setGroup(String(i), settings({ active: false }));
  assert.throws(() => s.store.setGroup(G, settings({ active: false })), (e) => e.name === 'InvalidPermissions' && /—/.test(e.message));
  assert.equal(s.store.setGroup('7', settings({ active: true }, { web: false })).state.groups['7'].custom, true);
});

// --- Nhắn riêng (spec §16) ---
const P1 = '1234567890123456';
const P2 = '2234567890123456789';
const dm8 = (over = {}) => ({ web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: true, ...over });

test('nhắn riêng: chưa có mục dm → theo ZALO_DM_POLICY, mọi nút bật; báo Hermes có đang chặn người ngoài không', (t) => {
  const s = setup(t, { dmEnv: () => ({ legacyWho: 'everyone', gatewayOpen: false }) });
  assert.deepEqual(s.store.get().dm, { who: 'everyone', explicit: false, gatewayOpen: false, features: dm8(), people: [] });
});

test('nhắn riêng: lưu ghi who + 8 nút chung, người chỉ ghi nút khác; lưu nhóm sau đó không làm mất mục dm', (t) => {
  const s = setup(t);
  const state = s.store.setDm(parseDm({
    who: 'list', features: dm8({ web: false }),
    people: [{ uid: P1, name: '  Cô   Lan ', features: dm8({ web: true, voice: false }) }, { uid: P2, features: null }, { uid: P1, name: 'trùng', features: null }],
  }));
  assert.deepEqual(s.disk().dm, {
    who: 'list', features: dm8({ web: false }),
    people: { [P1]: { name: 'Cô Lan', features: { web: true, voice: false } }, [P2]: {} },
  });
  assert.deepEqual(state.dm.people, [
    { uid: P1, name: 'Cô Lan', custom: true, features: dm8({ voice: false }) },
    { uid: P2, name: '', custom: false, features: dm8({ web: false }) },
  ]);
  assert.equal(state.dm.explicit, true);
  s.store.setGroup(G, settings({}, { web: false }), 'Tổ Hoá');
  s.store.setDefaults(settings({}, { kb: false }));
  assert.equal(s.disk().dm.who, 'list', 'lưu nhóm/mặc định giữ nguyên mục dm');
  assert.equal(s.disk().version, 1, 'không đổi phiên bản tệp — bản v1.21+ vẫn đọc được');
});

test('parseDm: từ chối who lạ, thiếu nút, nút groupCron, UID là số điện thoại, quá 200 người', () => {
  const ok = { who: 'everyone', features: dm8(), people: [] };
  assert.deepEqual(parseDm(ok), ok);
  const bad = [
    [{ ...ok, who: 'all' }, /Chưa chọn ai/],
    [{ ...ok, features: { ...dm8(), groupCron: true } }, /tính năng/],
    [{ ...ok, features: { web: true } }, /tính năng/],
    [{ ...ok, people: 'x' }, /Danh sách người/],
    [{ ...ok, people: [{ uid: '0912345678' }] }, /không phải UID Zalo — .*\/sethome/],
    [{ ...ok, people: [{ uid: P1, features: { web: false } }] }, /Tính năng riêng/],
    [{ ...ok, people: Array.from({ length: 201 }, (_, i) => ({ uid: String(1234567890123456n + BigInt(i)) })) }, /tối đa 200/],
    [null, /Chưa chọn ai/],
  ];
  for (const [body, re] of bad) assert.throws(() => parseDm(body), (e) => e instanceof InvalidPermissions && re.test(e.message), JSON.stringify(body)?.slice(0, 60));
});

test('makeDmEnv: config.yaml thắng .env; "open" → mọi người; cờ mở cổng của Hermes; đọc lại khi tệp đổi', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-dmenv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  const read = makeDmEnv({ envFile, configFile, inherited: { ZALO_ALLOW_ALL_USERS: 'true' } });
  assert.deepEqual(read(), { legacyWho: 'owners', gatewayOpen: true }, 'không có tệp: mặc định owner-only, cờ từ môi trường dịch vụ');
  let stamp = 1_700_000_000;
  const put = (path, text) => { writeFileSync(path, text); stamp += 10; utimesSync(path, stamp, stamp); };
  put(envFile, 'ZALO_DM_POLICY=open\nZALO_ALLOW_ALL_USERS=false\n');
  assert.deepEqual(read(), { legacyWho: 'everyone', gatewayOpen: false });
  put(configFile, 'platforms:\n  zalo:\n    extra:\n      dm_policy: owner-only\n');
  assert.equal(read().legacyWho, 'owners', 'extra.dm_policy trong config.yaml thắng .env như adapter');
  put(envFile, 'GATEWAY_ALLOW_ALL_USERS=1\n');
  assert.equal(read().gatewayOpen, true);
});
