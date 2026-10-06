import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupToken } from './setup-token.js';

function mk(t, clock) {
  const d = mkdtempSync(join(tmpdir(), 'zd-setup-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'setup.json');
  return { file, s: createSetupToken(file, { now: () => clock.t }) };
}

test('issue trả chuỗi đủ dài; consume đúng một lần', (t) => {
  const { s } = mk(t, { t: 0 });
  const token = s.issue();
  assert.ok(token.length >= 32);
  assert.equal(s.consume(token), true);
  assert.equal(s.consume(token), false);
});

test('hết 24 giờ thì không dùng được', (t) => {
  const clock = { t: 0 }; const { s } = mk(t, clock);
  const token = s.issue();
  clock.t = 24 * 3600_000 + 1;
  assert.equal(s.consume(token), false);
});

test('chuỗi sai bị từ chối và không huỷ token đúng', (t) => {
  const { s } = mk(t, { t: 0 });
  const token = s.issue();
  assert.equal(s.consume('sai-token'), false);
  assert.equal(s.consume(token), true);
});

test('chưa cấp token thì consume false', (t) => {
  const { s } = mk(t, { t: 0 });
  assert.equal(s.consume('bat-ky'), false);
});

test('tệp không chứa token thô', (t) => {
  const { s, file } = mk(t, { t: 0 });
  const token = s.issue();
  assert.ok(!readFileSync(file, 'utf8').includes(token));
});
