import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReplyStyle, DEFAULTS, normalizeStyle } from './reply-style.js';

function store(t) {
  const dir = mkdtempSync(join(tmpdir(), 'reply-style-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'zalo', 'reply-style.json');
  return { file, rs: createReplyStyle({ file }) };
}

test('chưa có tệp hoặc tệp hỏng → mặc định', (t) => {
  const { file, rs } = store(t);
  assert.deepEqual(rs.view(), DEFAULTS);
  rs.save({ tone: 'formal' });
  writeFileSync(file, '{hỏng');
  assert.deepEqual(rs.view(), DEFAULTS);
});

test('lưu gộp vào bản cũ, ghi đúng khoá plugin đọc', (t) => {
  const { file, rs } = store(t);
  rs.save({ owner_name: 'sếp', colors: ['green', 'red'] });
  const { before, after } = rs.save({ length: 'short' });
  assert.equal(before.length, 'medium');
  assert.equal(after.owner_name, 'sếp');
  assert.deepEqual(after.colors, ['red', 'green'], 'thứ tự màu cố định như plugin');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), after);
});

test('giá trị sai bị từ chối 400 và không ghi gì', (t) => {
  const { rs } = store(t);
  for (const values of [{ length: 'dài' }, { colors: ['blue'] }, { owner_name: 'x'.repeat(31) }, { mau: 1 }, null, []]) {
    assert.throws(() => rs.save(values), (e) => e.statusCode === 400, JSON.stringify(values));
  }
  assert.deepEqual(rs.view(), DEFAULTS);
});

test('đọc: tên để trống về mặc định, ký tự điều khiển bị bỏ, lời dặn thêm được để trống', () => {
  const s = normalizeStyle({ self_name: '  ', owner_name: 'sế\u0000p', extra: '' });
  assert.equal(s.self_name, 'em');
  assert.equal(s.owner_name, 'sếp');
  assert.equal(s.extra, '');
});
