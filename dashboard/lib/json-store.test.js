import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
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
