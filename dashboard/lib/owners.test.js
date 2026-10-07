import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnersStore, parseOwners } from './owners.js';

const A = '1234567890123456'; const B = '2234567890123456';

function setup(t, hermesEnv = `X=1\nZALO_ALLOWED_USERS=${A}\n`) {
  const d = mkdtempSync(join(tmpdir(), 'zd-owners-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const files = { envFile: join(d, 'hermes.env'), sidecarEnvFile: join(d, 'sidecar.env'), pendingFile: join(d, 'pending-restart.json') };
  writeFileSync(files.envFile, hermesEnv);
  return { files, s: createOwnersStore({ ...files, now: () => 42 }) };
}

test('parseOwners: bỏ khoảng trắng và trùng; không cho rỗng (không khoá mất chủ nhân cuối), UID sai, quá 20', () => {
  assert.deepEqual(parseOwners([` ${A} `, B, A]), [A, B]);
  assert.throws(() => parseOwners([]), /ít nhất một chủ nhân/);
  assert.throws(() => parseOwners(['0912345678']), /không phải UID Zalo/);
  assert.throws(() => parseOwners([Number(A)]), /không phải UID Zalo/);
  assert.throws(() => parseOwners('1234567890123456'), /không hợp lệ/);
  assert.throws(() => parseOwners(Array.from({ length: 21 }, (_, i) => `${1000000000000000 + i}`)), /Tối đa 20/);
  for (const fn of [() => parseOwners([]), () => parseOwners(['x'])]) assert.throws(fn, (e) => e.statusCode === 400);
});

test('đọc danh sách từ .env Hermes; lưu khác thì ghi .env và đánh dấu chờ khởi động lại; trùng thì không ghi', (t) => {
  const { files, s } = setup(t);
  assert.deepEqual(s.list(), [A]);
  assert.equal(s.pending(), null);
  assert.equal(s.set([A], 'anh'), false);
  assert.equal(s.pending(), null);
  assert.equal(s.set([A, B], 'anh'), true);
  assert.equal(readFileSync(files.envFile, 'utf8'), `X=1\nZALO_ALLOWED_USERS=${A},${B}\n`);
  assert.deepEqual(s.pending(), { since: 42, by: 'anh' });
  s.clearPending();
  assert.equal(s.pending(), null);
});

test('.env của thư mục bot đặt khoá khác → shadowed; trùng hoặc không đặt → không', (t) => {
  const { files, s } = setup(t);
  assert.equal(s.shadowed(), false);
  writeFileSync(files.sidecarEnvFile, `ZALO_ALLOWED_USERS=${A}\n`);
  assert.equal(s.shadowed(), false);
  writeFileSync(files.sidecarEnvFile, `ZALO_ALLOWED_USERS=${B}\n`);
  assert.equal(s.shadowed(), true);
});

test('markPending: đặt cờ chờ khi chưa có, không đè cờ đang có', (t) => {
  const { s } = setup(t);
  s.markPending('ghi-de');
  assert.deepEqual(s.pending(), { since: 42, by: 'ghi-de' });
  s.clearPending();
  s.set([A, B], 'anh');
  s.markPending('ghi-de');
  assert.equal(s.pending().by, 'anh');
});

test('.env Hermes chưa có khoá → danh sách rỗng; tệp chờ hỏng → coi như không chờ', (t) => {
  const { files, s } = setup(t, 'X=1\n');
  assert.deepEqual(s.list(), []);
  writeFileSync(files.pendingFile, '{hỏng');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(s.pending(), null); } finally { console.warn = warn; }
});

test('.env bot đặt khoá rỗng → không coi là shadowed', (t) => {
  const { files, s } = setup(t);
  writeFileSync(files.sidecarEnvFile, 'ZALO_ALLOWED_USERS=\n');
  assert.equal(s.shadowed(), false);
});
