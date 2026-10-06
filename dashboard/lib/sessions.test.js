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

test('phiên còn sống qua khởi động lại (đọc lại từ tệp)', (t) => {
  const clock = { t: 0 }; const { s, file } = mk(t, clock);
  const a = s.create('anh');
  const again = createSessionStore(file, { now: () => clock.t, ttlMs: 1000, idleMs: 300 });
  assert.equal(again.get(a).username, 'anh');
});
