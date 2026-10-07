import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './json-store.js';

function tmp(t) { const d = mkdtempSync(join(tmpdir(), 'zd-json-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }

test('không có tệp thì trả bản sao của giá trị dự phòng', (t) => {
  const fb = { users: [] };
  const v = readJson(join(tmp(t), 'x.json'), fb);
  v.users.push(1);
  assert.deepEqual(fb, { users: [] });
});

test('ghi rồi đọc lại; tạo thư mục còn thiếu', (t) => {
  const p = join(tmp(t), 'a', 'b.json');
  writeJsonAtomic(p, { n: 1 });
  assert.deepEqual(readJson(p, {}), { n: 1 });
});

test('tệp hỏng được cất sang .corrupt-* và trả dự phòng', (t) => {
  const d = tmp(t); const p = join(d, 'u.json');
  writeFileSync(p, '{hỏng');
  assert.deepEqual(readJson(p, { ok: 1 }), { ok: 1 });
  assert.ok(readdirSync(d).some((f) => f.startsWith('u.json.corrupt-')));
});

test('quyền tệp 600 trên hệ điều hành có quyền POSIX', { skip: process.platform === 'win32' }, (t) => {
  const p = join(tmp(t), 'k.json');
  writeJsonAtomic(p, {});
  assert.equal(statSync(p).mode & 0o777, 0o600);
});

test('Windows: đổi tên lỗi EPERM/EBUSY tạm thời thì thử lại, quá 3 lần thì ném', (t) => {
  const p = join(tmp(t), 'p.json');
  let calls = 0;
  const flaky = (codes) => (from, to) => {
    calls += 1;
    if (codes.length) { const e = new Error('bận'); e.code = codes.shift(); throw e; }
    renameSync(from, to);
  };
  const started = Date.now();
  writeJsonAtomic(p, { n: 1 }, { rename: flaky(['EPERM', 'EBUSY']), platform: 'win32' });
  assert.equal(calls, 3);
  assert.ok(Date.now() - started >= 90, 'chờ ~50 ms giữa các lần thử');
  assert.deepEqual(readJson(p, {}), { n: 1 });
  calls = 0;
  assert.throws(() => writeJsonAtomic(p, { n: 2 }, { rename: flaky(['EACCES', 'EACCES', 'EACCES', 'EACCES']), platform: 'win32' }), { code: 'EACCES' });
  assert.equal(calls, 4);
  // Không phải Windows, hoặc lỗi khác: không thử lại.
  calls = 0;
  assert.throws(() => writeJsonAtomic(p, { n: 3 }, { rename: flaky(['EPERM']), platform: 'linux' }), { code: 'EPERM' });
  assert.throws(() => writeJsonAtomic(p, { n: 3 }, { rename: flaky(['ENOENT']), platform: 'win32' }), { code: 'ENOENT' });
  assert.equal(calls, 2);
});
