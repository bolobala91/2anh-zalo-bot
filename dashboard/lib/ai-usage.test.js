import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAiUsage, readUsageTotals, vnDate } from './ai-usage.js';

function hermesDb(t, { legacy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-usage-'));
  const path = join(dir, 'state.db');
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); }); // đóng trước khi xoá (Windows khoá tệp đang mở)
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, api_call_count INTEGER DEFAULT 0, input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0)`);
  if (!legacy) {
    db.exec(`CREATE TABLE session_model_usage (session_id TEXT, model TEXT, api_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0)`);
  }
  const table = legacy ? 'sessions' : 'session_model_usage';
  const put = (id, calls, input, output, cached) => {
    db.prepare(`DELETE FROM ${table} WHERE ${legacy ? 'id' : 'session_id'} = ?`).run(id);
    db.prepare(legacy
      ? 'INSERT INTO sessions (id, api_call_count, input_tokens, output_tokens, cache_read_tokens) VALUES (?, ?, ?, ?, ?)'
      : "INSERT INTO session_model_usage (session_id, model, api_call_count, input_tokens, output_tokens, cache_read_tokens) VALUES (?, 'hermes', ?, ?, ?, ?)")
      .run(id, calls, input, output, cached);
  };
  return { dir, path, put };
}

const at = (iso) => Date.parse(iso);

test('readUsageTotals: cộng mọi phiên; bản Hermes cũ không có session_model_usage thì đọc bảng sessions; không có tệp → UsageUnavailable', (t) => {
  const h = hermesDb(t);
  h.put('a', 3, 1000, 50, 400); h.put('b', 2, 500, 20, 0);
  assert.deepEqual(readUsageTotals(h.path), { calls: 5, input: 1500, output: 70, cached: 400, source: 'session_model_usage' });
  const old = hermesDb(t, { legacy: true });
  old.put('a', 7, 70, 7, 0);
  assert.deepEqual(readUsageTotals(old.path), { calls: 7, input: 70, output: 7, cached: 0, source: 'sessions' });
  assert.throws(() => readUsageTotals(join(h.dir, 'khong-co.db')), { name: 'UsageUnavailable' });
});

test('theo ngày giờ Việt Nam: mẫu đầu chỉ lấy mốc; phần tăng cộng vào đúng ngày; phiên dài nhiều ngày không dồn vào một ngày', (t) => {
  const h = hermesDb(t);
  const file = join(h.dir, 'ai-usage.json');
  let clock = at('2026-10-06T16:30:00Z'); // 23:30 ngày 06/10 giờ VN
  const u = createAiUsage({ dbPath: h.path, file, now: () => clock });
  h.put('long', 100, 10_000, 500, 0);
  u.sample();
  assert.deepEqual(u.report().days, [], 'mẫu đầu: chưa biết phần nào thuộc hôm nay');
  h.put('long', 104, 10_400, 540, 100);
  clock = at('2026-10-06T16:50:00Z'); u.sample(); // vẫn 06/10
  h.put('long', 110, 11_000, 600, 100);
  clock = at('2026-10-06T17:10:00Z'); u.sample(); // 00:10 ngày 07/10
  assert.deepEqual(u.report().days, [
    { date: '2026-10-06', calls: 4, input: 400, output: 40, cached: 100 },
    { date: '2026-10-07', calls: 6, input: 600, output: 60, cached: 0 },
  ]);
  assert.equal(u.report().since, at('2026-10-06T16:30:00Z'));
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  // Khởi động lại dashboard: đọc lại tệp, tiếp tục cộng.
  const again = createAiUsage({ dbPath: h.path, file, now: () => clock });
  h.put('long', 111, 11_100, 610, 100); again.sample();
  assert.equal(again.report().days.at(-1).calls, 7);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).last.calls, 111);
});

test('tổng giảm (Hermes dọn phiên) không ra số âm; giữ 30 ngày; lỗi đọc không ném và báo loại lỗi', (t) => {
  const h = hermesDb(t);
  let clock = at('2026-09-01T03:00:00Z');
  const u = createAiUsage({ dbPath: h.path, file: join(h.dir, 'u.json'), now: () => clock });
  h.put('a', 10, 100, 10, 0); h.put('b', 10, 100, 10, 0);
  u.sample();
  rmSync(join(h.dir, 'u.json'));
  h.put('b', 0, 0, 0, 0); // phiên b bị dọn
  clock += 60_000; u.sample();
  assert.deepEqual(u.report().days[0], { date: '2026-09-01', calls: 0, input: 0, output: 0, cached: 0 });
  h.put('a', 12, 120, 12, 0);
  clock += 60_000; u.sample();
  assert.equal(u.report().days[0].calls, 2, 'mốc mới sau khi tổng giảm');
  clock = at('2026-10-05T03:00:00Z'); u.sample();
  assert.deepEqual(u.report().days.map((d) => d.date), ['2026-10-05'], 'ngày quá 30 ngày bị bỏ');
  let fail = true;
  const broken = createAiUsage({ dbPath: h.path, file: join(h.dir, 'x.json'), now: () => 7_000, readTotals: () => { if (fail) throw new Error('database is locked'); return { calls: 0, input: 0, output: 0, cached: 0 }; } });
  assert.equal(broken.report().errorAt, null);
  broken.sample();
  assert.equal(broken.report().error, 'unreadable');
  assert.equal(broken.report().errorAt, 7_000, 'giữ lúc đọc lỗi để trang ghi "lúc HH:MM"');
  fail = false; broken.sample();
  assert.equal(broken.report().errorAt, null, 'đọc lại được thì xoá');
  const missing = createAiUsage({ dbPath: join(h.dir, 'khong-co.db'), file: join(h.dir, 'y.json') });
  missing.sample();
  assert.equal(missing.report().error, 'missing');
  assert.equal(vnDate(at('2026-10-06T17:00:00Z')), '2026-10-07');
});

const tot = (calls, source) => ({ calls, input: calls * 10, output: calls, cached: 0, source });

test('lỗi đọc thoáng qua không đổi mốc: 6599 → lỗi → 6610 chỉ cộng 11', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-usage-'));
  try {
    let step = 0;
    const seq = [() => tot(6599), () => { throw new Error('database is locked'); }, () => tot(6610)];
    const u = createAiUsage({ dbPath: 'x', file: join(dir, 'u.json'), now: () => at('2026-10-07T03:00:00Z') + step * 60_000, readTotals: () => seq[step]() });
    u.sample(); step = 1; u.sample();
    assert.equal(u.report().error, 'unreadable');
    step = 2; u.sample();
    assert.equal(u.report().days[0].calls, 11);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('đổi nguồn (session_model_usage ↔ sessions) lấy mốc mới, không cộng phần chênh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-usage-'));
  try {
    let step = 0;
    const seq = [tot(6599, 'session_model_usage'), tot(5613, 'sessions'), tot(5620, 'sessions')];
    const u = createAiUsage({ dbPath: 'x', file: join(dir, 'u.json'), now: () => at('2026-10-07T03:00:00Z') + step * 60_000, readTotals: () => seq[step] });
    u.sample(); step = 1; u.sample();
    assert.deepEqual(u.report().days, [], "đổi nguồn: không thêm gì");
    step = 2; u.sample();
    assert.equal(u.report().days[0].calls, 7);
    assert.equal(JSON.parse(readFileSync(join(dir, 'u.json'), 'utf8')).source, 'sessions');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('thiếu bảng session_model_usage thì dùng bảng sessions; lỗi khác thì ném', (t) => {
  const old = hermesDb(t, { legacy: true });
  old.put('a', 3, 30, 3, 0);
  const u = createAiUsage({ dbPath: old.path, file: join(old.dir, 'u.json') });
  u.sample();
  assert.equal(u.report().error, null);
  assert.equal(JSON.parse(readFileSync(join(old.dir, 'u.json'), 'utf8')).source, 'sessions');
});

test('dashboard tắt hơn 2 giờ: ngày nhận phần tăng được đánh dấu includesGap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-usage-'));
  try {
    let clock = at('2026-10-01T03:00:00Z'); let calls = 10;
    const u = createAiUsage({ dbPath: 'x', file: join(dir, 'u.json'), now: () => clock, readTotals: () => tot(calls) });
    u.sample();
    clock += 5 * 60_000; calls = 12; u.sample();
    assert.equal(u.report().days[0].includesGap, undefined);
    clock = at('2026-10-06T03:00:00Z'); calls = 500; u.sample();
    const days = u.report().days;
    assert.equal(days.at(-1).date, '2026-10-06');
    assert.equal(days.at(-1).includesGap, true);
    assert.equal(days[0].includesGap, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
