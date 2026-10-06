import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore } from './sessions.js';

function mk(t, clock) { const d = mkdtempSync(join(tmpdir(), 'zd-sess-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 's.json'); return { file, s: createSessionStore(file, { now: () => clock.t, ttlMs: 1000, idleMs: 300 }) }; }

test('tạo và đọc phiên; tệp chỉ lưu băm', (t) => {
  const clock = { t: 0 }; const { s, file } = mk(t, clock);
  const token = s.create('anh');
  assert.equal(s.get(token).username, 'anh');
  assert.ok(!readFileSync(file, 'utf8').includes(token));
});

test('hết hạn khi không hoạt động và hết hạn tuyệt đối', (t) => {
  const clock = { t: 0 }; const { s } = mk(t, clock);
  const a = s.create('anh');
  clock.t = 200; assert.ok(s.get(a));          // còn hoạt động, gia hạn idle
  clock.t = 450; assert.ok(s.get(a));
  clock.t = 800; assert.equal(s.get(a), null); // quá idle 300 kể từ lần cuối (450)
  const b = s.create('anh');                    // tạo lúc 800
  for (const x of [900, 1100, 1300, 1500, 1700, 1790]) { clock.t = x; assert.ok(s.get(b)); } // luôn hoạt động
  clock.t = 1850; assert.equal(s.get(b), null); // idle chỉ 60 nhưng quá ttl 1000 tính từ lúc tạo (800)
});

test('đăng xuất mọi nơi', (t) => {
  const clock = { t: 0 }; const { s } = mk(t, clock);
  const a = s.create('anh'); const b = s.create('anh'); const c = s.create('khach');
  s.destroyAll('anh');
  assert.equal(s.get(a), null); assert.equal(s.get(b), null); assert.ok(s.get(c));
});

test('reset-admin (tiến trình khác) gỡ phiên thì dashboard đang chạy cũng mất phiên, không làm sống lại', (t) => {
  const clock = { t: 0 }; const { s: server, file } = mk(t, clock);
  const opts = { now: () => clock.t, ttlMs: 1000, idleMs: 300 };
  const a = server.create('anh'); const b = server.create('anh'); const k = server.create('khach');
  assert.ok(server.get(a));
  const cli = createSessionStore(file, opts); // như dashboard:reset-admin
  cli.destroyAll('anh');
  assert.equal(server.get(a), null);
  assert.equal(server.get(b), null);
  assert.ok(server.get(k));
  // Server ghi tiếp (tạo phiên mới, flush) không được hồi sinh phiên đã gỡ.
  const c = server.create('khach');
  clock.t = 100; server.get(c);
  const fresh = createSessionStore(file, opts);
  assert.equal(fresh.get(a), null);
  assert.equal(fresh.get(b), null);
  assert.ok(fresh.get(c));
  assert.ok(fresh.get(k));
});

test('phiên do tiến trình khác tạo được thấy ngay', (t) => {
  const clock = { t: 0 }; const { s: server, file } = mk(t, clock);
  server.get('chua-co');
  const other = createSessionStore(file, { now: () => clock.t, ttlMs: 1000, idleMs: 300 });
  const tok = other.create('anh');
  assert.equal(server.get(tok).username, 'anh');
});

test('phiên còn sống qua khởi động lại (đọc lại từ tệp)', (t) => {
  const clock = { t: 0 }; const { s, file } = mk(t, clock);
  const a = s.create('anh');
  const again = createSessionStore(file, { now: () => clock.t, ttlMs: 1000, idleMs: 300 });
  assert.equal(again.get(a).username, 'anh');
});
