import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatchdog } from './watchdog.js';
import { SidecarDown } from './sidecar-client.js';

function mk(t, healthRef, clock, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zd-wd-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const sent = []; const restarts = [];
  const make = () => createWatchdog({
    sidecar: { health: async () => { const h = healthRef.h; if (h instanceof Error) throw h; return h; } },
    notify: async (text) => { sent.push(text); }, restartSidecar: async () => { restarts.push(clock.t); },
    stateFile: join(d, 'wd.json'), publicUrl: 'https://d.vn', now: () => clock.t, botName: () => 'Uyển Nhi', ...extra,
  });
  return { make, sent, restarts };
}
const ok = { zalo: { status: 'logged-in', needsRelogin: false }, bridge: { attachedClients: 1 } };
const kicked = { zalo: { status: 'logged-in', needsRelogin: true }, bridge: { attachedClients: 1 } };

test('Zalo mất phiên: báo sau 2 phút, một lần, kèm link QR; hồi phục thì báo', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 60_000; await wd.tick();
  assert.equal(sent.length, 0);
  clock.t = 121_000; await wd.tick(); clock.t = 150_000; await wd.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Uyển Nhi.*mất kết nối Zalo/s);
  assert.match(sent[0], /https:\/\/d\.vn\/#\/zalo/);
  healthRef.h = ok; clock.t = 200_000; await wd.tick();
  assert.match(sent.at(-1), /đã hoạt động lại/);
});

test('nhắc lại sau 6 giờ nếu chưa hết', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 121_000; await wd.tick();
  clock.t = 121_000 + 6 * 3600_000 + 1; await wd.tick();
  assert.equal(sent.length, 2);
});

test('khởi động lại không báo trùng', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock);
  const a = make(); await a.tick(); clock.t = 121_000; await a.tick();
  const b = make(); clock.t = 130_000; await b.tick();
  assert.equal(sent.length, 1);
});

test('sidecar tắt: tự khởi động lại đúng một lần, vẫn hỏng thì báo', async (t) => {
  const healthRef = { h: new SidecarDown() }; const clock = { t: 0 };
  const { make, sent, restarts } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 121_000; await wd.tick();
  assert.equal(restarts.length, 1); assert.equal(sent.length, 0);
  clock.t = 160_000; await wd.tick();
  assert.equal(sent.length, 0);
  clock.t = 242_000; await wd.tick();
  assert.equal(restarts.length, 1); assert.equal(sent.length, 1);
  assert.match(sent[0], /kết nối Zalo không chạy/);
});

test('trợ lý không nối: báo sau 5 phút', async (t) => {
  const healthRef = { h: { zalo: { status: 'logged-in', needsRelogin: false }, bridge: { attachedClients: 0 } } }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 299_000; await wd.tick(); assert.equal(sent.length, 0);
  clock.t = 301_000; await wd.tick(); assert.equal(sent.length, 1);
  assert.match(sent[0], /Trợ lý/);
});

test('sidecar tắt: giữ nguyên sự cố zalo cũ, lời báo không dùng từ kỹ thuật', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick();
  healthRef.h = new SidecarDown(); clock.t = 10_000; await wd.tick();
  assert.ok(wd.incidents().zalo);
  clock.t = 121_000; await wd.tick(); clock.t = 250_000; await wd.tick(); clock.t = 400_000; await wd.tick();
  assert.ok(sent.length >= 1);
  for (const s of sent) assert.doesNotMatch(s, /sidecar|bridge|toolset/i);
});
