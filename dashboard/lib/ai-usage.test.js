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
  assert.deepEqual(readUsageTotals(h.path), { calls: 5, input: 1500, output: 70, cached: 400 });
  const old = hermesDb(t, { legacy: true });
  old.put('a', 7, 70, 7, 0);
  assert.deepEqual(readUsageTotals(old.path), { calls: 7, input: 70, output: 7, cached: 0 });
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
  const broken = createAiUsage({ dbPath: h.path, file: join(h.dir, 'x.json'), readTotals: () => { throw new Error('database is locked'); } });
  broken.sample();
  assert.equal(broken.report().error, 'unreadable');
  const missing = createAiUsage({ dbPath: join(h.dir, 'khong-co.db'), file: join(h.dir, 'y.json') });
  missing.sample();
  assert.equal(missing.report().error, 'missing');
  assert.equal(vnDate(at('2026-10-06T17:00:00Z')), '2026-10-07');
});
