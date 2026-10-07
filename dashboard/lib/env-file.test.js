import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvKey, writeEnvKey } from './env-file.js';

const K = 'ZALO_ALLOWED_USERS';
function tmp(t) { const d = mkdtempSync(join(tmpdir(), 'zd-env-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }

test('chỉ đọc/ghi khoá được phép — khoá khác ném lỗi, không bao giờ trả giá trị', (t) => {
  const f = join(tmp(t), '.env');
  writeFileSync(f, 'OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=1234567890123456\n');
  assert.equal(readEnvKey(f, K), '1234567890123456');
  assert.throws(() => readEnvKey(f, 'OPENAI_API_KEY'), /không nằm trong danh sách/);
  assert.throws(() => writeEnvKey(f, 'OPENAI_API_KEY', '1'), /không nằm trong danh sách/);
});

test('đọc như Hermes: export, dấu nháy, khoảng trắng, dòng sau cùng thắng; dòng chú thích bỏ qua', (t) => {
  const d = tmp(t);
  const cases = [
    ['export ZALO_ALLOWED_USERS="1234567890123456,2234567890123456"\n', '1234567890123456,2234567890123456'],
    ['ZALO_ALLOWED_USERS = 1234567890123456\n', '1234567890123456'],
    ['ZALO_ALLOWED_USERS=1\nZALO_ALLOWED_USERS=2\n', '2'],
    ['# ZALO_ALLOWED_USERS=999\nZALO_ALLOWED_USERS_OLD=5\n', null],
    ['﻿ZALO_ALLOWED_USERS=3\r\n', '3'],
  ];
  for (const [text, want] of cases) {
    const f = join(d, 'a.env'); writeFileSync(f, text);
    assert.equal(readEnvKey(f, K), want, JSON.stringify(text));
  }
  assert.equal(readEnvKey(join(d, 'khong-co.env'), K), null);
});

test('ghi: chỉ đổi dòng của khoá, giữ nguyên mọi dòng khác, CRLF, export; có .env.bak', (t) => {
  const d = tmp(t); const f = join(d, '.env');
  const before = '# Hermes\r\nOPENAI_API_KEY=sk-bimat\r\nexport ZALO_ALLOWED_USERS="1234567890123456"\r\nZALO_DM_POLICY=owner-only\r\n';
  writeFileSync(f, before);
  writeEnvKey(f, K, '1234567890123456,2234567890123456');
  assert.equal(readFileSync(f, 'utf8'),
    '# Hermes\r\nOPENAI_API_KEY=sk-bimat\r\nexport ZALO_ALLOWED_USERS=1234567890123456,2234567890123456\r\nZALO_DM_POLICY=owner-only\r\n');
  assert.equal(readFileSync(`${f}.bak`, 'utf8'), before);
  assert.equal(readEnvKey(f, K), '1234567890123456,2234567890123456');
  if (process.platform !== 'win32') {
    assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.equal(statSync(`${f}.bak`).mode & 0o777, 0o600);
  }
});

test('ghi: chưa có khoá thì thêm cuối tệp; chưa có tệp thì tạo; giá trị lạ (xuống dòng, chữ) bị từ chối', (t) => {
  const d = tmp(t);
  const f = join(d, '.env');
  writeFileSync(f, 'A=1');
  writeEnvKey(f, K, '1234567890123456');
  assert.equal(readFileSync(f, 'utf8'), 'A=1\nZALO_ALLOWED_USERS=1234567890123456\n');
  const g = join(d, 'moi', '.env');
  writeEnvKey(g, K, '1234567890123456');
  assert.equal(readFileSync(g, 'utf8'), 'ZALO_ALLOWED_USERS=1234567890123456\n');
  assert.equal(existsSync(`${g}.bak`), false);
  for (const v of ['1\nOPENAI_API_KEY=x', '1 2', 'abc', '"1"']) assert.throws(() => writeEnvKey(f, K, v), /chữ số và dấu phẩy/, v);
  assert.equal(readEnvKey(f, K), '1234567890123456');
});

test('ghi: giữ BOM, thiếu xuống dòng cuối, khoá trùng (đổi hết), khoá chỉ nằm trong chú thích, giá trị rỗng', (t) => {
  const d = tmp(t); const f = join(d, '.env');
  writeFileSync(f, '\uFEFFA=1\r\nZALO_ALLOWED_USERS=1\r\nB=2');
  writeEnvKey(f, K, '5');
  assert.equal(readFileSync(f, 'utf8'), '\uFEFFA=1\r\nZALO_ALLOWED_USERS=5\r\nB=2');
  writeFileSync(f, 'ZALO_ALLOWED_USERS=1\nX=1\nZALO_ALLOWED_USERS=2');
  writeEnvKey(f, K, '7,8');
  assert.equal(readFileSync(f, 'utf8'), 'ZALO_ALLOWED_USERS=7,8\nX=1\nZALO_ALLOWED_USERS=7,8');
  writeFileSync(f, '# ZALO_ALLOWED_USERS=999\nZALO_ALLOWED_USERS_OLD=5\nA=1');
  writeEnvKey(f, K, '9');
  assert.equal(readFileSync(f, 'utf8'), '# ZALO_ALLOWED_USERS=999\nZALO_ALLOWED_USERS_OLD=5\nA=1\nZALO_ALLOWED_USERS=9\n');
  writeFileSync(f, 'A=1\nZALO_ALLOWED_USERS=\n');
  assert.equal(readEnvKey(f, K), '');
  writeEnvKey(f, K, '4');
  assert.equal(readFileSync(f, 'utf8'), 'A=1\nZALO_ALLOWED_USERS=4\n');
});

test('ghi giữ quyền tệp cũ (POSIX); .bak vẫn 600', { skip: process.platform === 'win32' }, (t) => {
  const f = join(tmp(t), '.env');
  writeFileSync(f, 'ZALO_ALLOWED_USERS=1\n', { mode: 0o640 });
  chmodSync(f, 0o640);
  writeEnvKey(f, K, '2');
  assert.equal(statSync(f).mode & 0o777, 0o640);
  assert.equal(statSync(`${f}.bak`).mode & 0o777, 0o600);
});
