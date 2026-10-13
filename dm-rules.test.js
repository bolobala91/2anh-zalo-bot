import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DM_FEATURE_KEYS, STUDIO_KEYS, createDmRules, dmVerdict, folderPeople, normalizeDm, permissionsFileFromEnv } from './dm-rules.js';

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
  assert.deepEqual(DM_FEATURE_KEYS, ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video', 'history']);
});

test('dmVerdict: who quyết ai vào; tính năng gộp mặc định ← dm ← người', () => {
  const dm = normalizeDm({ who: 'list', features: { web: false }, people: { [A]: { features: { web: true, video: false } } } });
  assert.deepEqual(dmVerdict(dm, A), { allowed: true, features: { web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: false, history: true } });
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

test('xưởng (spec §17): normalizeDm giữ 6 nút xưởng để dashboard không làm rơi; dmVerdict vẫn đúng 8 nút', () => {
  const dm = normalizeDm({ who: 'everyone', features: { studioSlides: true, studioVideo: 'yes' },
    people: { [A]: { features: { studioDocs: true, web: false } } } });
  assert.deepEqual(dm.features, { studioSlides: true });
  assert.deepEqual(dm.people[A].features, { web: false, studioDocs: true });
  assert.deepEqual(Object.keys(dmVerdict(dm, A).features), DM_FEATURE_KEYS);
  assert.deepEqual(STUDIO_KEYS, ['studioSlides', 'studioDocs', 'studioExams', 'studioVideo', 'studioImage', 'studioAIVideo']);
});

test('thư mục chứa người: vào thư mục = được nhắn riêng, nút = mặc định nhóm ← thư mục; chỉnh riêng của người thắng', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-folder-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'permissions.json');
  const P = '1111111111111111111'; const Q = '2222222222222222222';
  writeFileSync(file, JSON.stringify({ version: 1, defaults: { features: { kb: false } },
    folders: { bch: { people: [{ uid: P, name: 'Lan' }, Q, 'bad'], features: { web: false } }, x2: { people: [P], features: { web: true } } },
    dm: { who: 'list', features: { voice: false }, people: { [Q]: { features: { web: true } } } } }));
  assert.deepEqual(Object.keys(folderPeople(JSON.parse(readFileSync(file, 'utf8')))).sort(), [P, Q]);
  const dm = createDmRules({ file })();
  const p = dmVerdict(dm, P);
  assert.equal(p.allowed, true);
  assert.equal(p.features.web, false, 'thư mục đầu giữ người');
  assert.equal(p.features.kb, false);
  assert.equal(p.features.voice, true, 'không theo tính năng chung nhắn riêng');
  assert.equal(dmVerdict(dm, Q).features.web, true);
  assert.equal(dmVerdict(dm, '3333333333333333333').allowed, false);
  // Không có mục dm nhưng có người trong thư mục: tệp vẫn được đọc, quyết định "ai được nhắn" vẫn theo ZALO_DM_POLICY.
  writeFileSync(file, JSON.stringify({ version: 1, folders: { bch: { people: [P], features: { web: false } } } }));
  const only = createDmRules({ file })();
  assert.equal(dmVerdict(only, P).allowed, null);
  assert.equal(dmVerdict(only, P).features.web, false);
});
