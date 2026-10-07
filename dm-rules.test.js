import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DM_FEATURE_KEYS, createDmRules, dmVerdict, normalizeDm, permissionsFileFromEnv } from './dm-rules.js';

const A = '1111111111111111111';
const B = '2222222222222222222';

test('normalizeDm: giữ khoá biết, đúng kiểu; bỏ who lạ, UID không phải số, nút groupCron', () => {
  assert.equal(normalizeDm(undefined), null);
  assert.equal(normalizeDm([]), null);
  assert.deepEqual(normalizeDm({
    who: 'list', features: { web: false, groupCron: false, kb: 'no' },
    people: { [A]: { name: '  Cô Lan ', features: { voice: false, nope: true } }, 'abc': { name: 'x' }, [B]: 'rác' },
  }), {
    who: 'list', features: { web: false },
    people: { [A]: { name: 'Cô Lan', features: { voice: false } }, [B]: { features: {} } },
  });
  assert.equal(normalizeDm({ who: 'all' }).who, undefined);
  assert.deepEqual(DM_FEATURE_KEYS, ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video']);
});

test('dmVerdict: who quyết ai vào; tính năng gộp mặc định ← dm ← người', () => {
  const dm = normalizeDm({ who: 'list', features: { web: false }, people: { [A]: { features: { web: true, video: false } } } });
  assert.deepEqual(dmVerdict(dm, A), { allowed: true, features: { web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: false } });
  assert.equal(dmVerdict(dm, B).allowed, false);
  assert.equal(dmVerdict(dm, B).features.web, false);
  assert.equal(dmVerdict({ ...dm, who: 'everyone' }, B).allowed, true);
  assert.equal(dmVerdict({ ...dm, who: 'owners' }, A).allowed, false, 'chỉ chủ nhân: người trong danh sách cũng không vào');
  assert.equal(dmVerdict(normalizeDm({ features: { kb: false } }), B).allowed, null, 'chưa chọn who → theo ZALO_DM_POLICY');
  assert.equal(dmVerdict(null, B).allowed, null);
  assert.ok(Object.values(dmVerdict(null, B).features).every(Boolean));
});

test('dmVerdict: tên thuộc tính có sẵn của object (constructor, __proto__, toString) không phải người trong danh sách', () => {
  const dm = normalizeDm({ who: 'list', features: { web: false }, people: {} });
  for (const uid of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const v = dmVerdict(dm, uid);
    assert.equal(v.allowed, false, uid);
    assert.equal(v.features.web, false, uid);
  }
});

test('permissionsFileFromEnv: ZALO_PERMISSIONS_FILE thắng HERMES_HOME; thiếu cả hai → null', () => {
  assert.equal(permissionsFileFromEnv({ ZALO_PERMISSIONS_FILE: '/x/p.json', HERMES_HOME: '/h' }), '/x/p.json');
  assert.equal(permissionsFileFromEnv({ HERMES_HOME: '/h' }), join('/h', 'zalo', 'permissions.json'));
  assert.equal(permissionsFileFromEnv({}), null);
});

test('createDmRules: đọc lại khi tệp đổi; không có tệp, tệp hỏng, phiên bản lạ → null', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-rules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'permissions.json');
  const warnings = [];
  const rules = createDmRules({ file, warn: (m) => warnings.push(m) });
  assert.equal(rules(), null);
  let stamp = 1_700_000_000;
  const write = (text) => { writeFileSync(file, text); stamp += 10; utimesSync(file, stamp, stamp); };
  write(JSON.stringify({ version: 1, defaults: {}, groups: {} }));
  assert.equal(rules(), null, 'tệp chưa có mục dm');
  write(`\uFEFF${JSON.stringify({ version: 1, dm: { who: 'everyone' } })}`);
  assert.equal(rules().who, 'everyone', 'bỏ BOM như plugin');
  write('{hỏng');
  assert.equal(rules(), null);
  assert.equal(warnings.length, 1);
  write(JSON.stringify({ version: 2, dm: { who: 'everyone' } }));
  assert.equal(rules(), null);
  assert.equal(createDmRules({ file: null })(), null);
});
