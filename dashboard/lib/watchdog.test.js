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
const ok = { zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false }, bridge: { attachedClients: 1 } };
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
  const healthRef = { h: { zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false }, bridge: { attachedClients: 0 } } }; const clock = { t: 0 };
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

test('notify lỗi lúc tới ngưỡng: tick sau thử gửi lại', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 }; let fail = true; const attempts = [];
  const { make, sent } = mk(t, healthRef, clock, { notify: async (x) => { attempts.push(x); if (fail) throw new Error('telegram down'); sent.push(x); } });
  const wd = make();
  await wd.tick(); clock.t = 121_000; await wd.tick();
  assert.equal(attempts.length, 1); assert.equal(wd.incidents().zalo.alertedAt, 0);
  fail = false; clock.t = 151_000; await wd.tick();
  assert.equal(attempts.length, 2); assert.equal(sent.length, 1);
});

test('notify ném đồng bộ cũng được xử lý như bị từ chối', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 };
  const { make } = mk(t, healthRef, clock, { notify: () => { throw new Error('sync'); } });
  const wd = make(); await wd.tick(); clock.t = 121_000; await wd.tick();
  assert.equal(wd.incidents().zalo.alertedAt, 0);
});

test('notify lỗi rồi hồi phục: không gửi thông báo hồi phục', async (t) => {
  const healthRef = { h: kicked }; const clock = { t: 0 }; const attempts = [];
  const { make } = mk(t, healthRef, clock, { notify: async (x) => { attempts.push(x); throw new Error('down'); } });
  const wd = make(); await wd.tick(); clock.t = 121_000; await wd.tick();
  healthRef.h = ok; clock.t = 200_000; await wd.tick();
  assert.equal(attempts.length, 1);
});

const deaf = (listener) => ({ zalo: { status: 'logged-in', listener, needsRelogin: false }, bridge: { attachedClients: 1 } });

test('listener đứt (vẫn đăng nhập): chỉ báo sau 10 phút, lời báo nói rõ cần làm gì', async (t) => {
  const healthRef = { h: deaf('reconnecting') }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 121_000; await wd.tick(); clock.t = 599_000; await wd.tick();
  assert.equal(sent.length, 0);
  healthRef.h = deaf('closed'); clock.t = 601_000; await wd.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Uyển Nhi đang không nhận được tin nhắn/);
  assert.match(sent[0], /khởi động lại/);
  assert.match(sent[0], /quét lại mã QR/);
  assert.match(sent[0], /https:\/\/d\.vn\/#\/zalo/);
  assert.doesNotMatch(sent[0], /sidecar|bridge|toolset|listener/i);
  healthRef.h = ok; clock.t = 700_000; await wd.tick();
  assert.match(sent.at(-1), /đã hoạt động lại/);
});

test('listener nối lại trước 10 phút: không báo gì', async (t) => {
  const healthRef = { h: deaf('reconnecting') }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 300_000; await wd.tick();
  healthRef.h = ok; clock.t = 310_000; await wd.tick();
  assert.equal(sent.length, 0);
  assert.equal(wd.incidents().zalo, undefined);
});

test('listener null (chưa ai báo) không tính là sự cố', async (t) => {
  const healthRef = { h: deaf(null) }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 700_000; await wd.tick();
  assert.equal(sent.length, 0);
});

test('listener đứt rồi bị đá phiên: báo ngay lời "quét QR" (ngưỡng 2 phút tính từ lúc đứt)', async (t) => {
  const healthRef = { h: deaf('reconnecting') }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  await wd.tick(); clock.t = 601_000; await wd.tick();
  assert.equal(sent.length, 1);
  healthRef.h = kicked; clock.t = 631_000; await wd.tick();
  assert.equal(sent.length, 2);
  assert.match(sent[1], /mất kết nối Zalo — cần quét mã QR/);
});

test('Zalo đang có sự cố: không báo thêm "Trợ lý", giữ nguyên trạng thái trợ lý cũ', async (t) => {
  const down = { zalo: { status: 'logged-in', listener: 'reconnecting', needsRelogin: true }, bridge: { attachedClients: 0 } };
  const healthRef = { h: down }; const clock = { t: 0 };
  const { make, sent } = mk(t, healthRef, clock); const wd = make();
  for (const x of [0, 121_000, 301_000, 400_000]) { clock.t = x; await wd.tick(); }
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0], /Trợ lý/);
  assert.equal(wd.incidents().assistant, undefined);

  // Trợ lý đã có sự cố từ trước: Zalo hỏng thì giữ nguyên, không xoá cũng không báo hồi phục.
  const healthRef2 = { h: { zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false }, bridge: { attachedClients: 0 } } };
  const clock2 = { t: 0 };
  const two = mk(t, healthRef2, clock2); const wd2 = two.make();
  await wd2.tick(); const since = wd2.incidents().assistant.since;
  healthRef2.h = down; clock2.t = 60_000; await wd2.tick();
  assert.equal(wd2.incidents().assistant.since, since);
  assert.equal(two.sent.length, 0);
});
