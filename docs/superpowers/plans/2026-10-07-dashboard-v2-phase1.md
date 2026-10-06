# Dashboard v2 — Giai đoạn 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dịch vụ dashboard riêng (127.0.0.1:3880) có đăng nhập + vai trò, màn Tổng quan, màn Tài khoản Zalo (quét QR qua HTTP), quản lý người dùng tối thiểu, canh gác + cảnh báo Telegram; sidecar thêm `/control/*` và giãn nhịp nối lại; bộ cài cài dịch vụ.

**Architecture:** Thư mục mới `dashboard/` là một tiến trình Express độc lập. Logic nằm trong `dashboard/lib/*` (mỗi tệp một việc, nhận phụ thuộc qua tham số để test được), route trong `dashboard/routes/*`, giao diện tĩnh Preact + htm nhúng sẵn ở `dashboard/public/`. Dashboard nói chuyện với sidecar qua `http://127.0.0.1:3872/control/*` có `Authorization: Bearer <ZALO_BRIDGE_TOKEN>`; dữ liệu riêng lưu ở `<HERMES_HOME>/zalo/dashboard/`.

**Tech Stack:** Node ≥ 22 ESM, Express 5.2.1 (đã có), `node:crypto` (scrypt, randomBytes, randomInt, timingSafeEqual), `node:test`, Preact 10 + htm 3 (tệp ESM chép vào `vendor/`, không bundler).

**Spec:** `docs/superpowers/specs/2026-10-07-zalo-dashboard-v2-design.md`

## Global Constraints

- Node ≥ 22, `"type": "module"`; test bằng `node --test` (tự tìm `**/*.test.js`), `import test from 'node:test'`, `import assert from 'node:assert/strict'`.
- Không thêm dependency npm chạy lúc runtime ngoài những gì đã có (express, ws, yaml, zca-js). Preact/htm là tệp tĩnh chép vào `dashboard/public/vendor/`.
- Dashboard **chỉ** nghe `127.0.0.1`, cổng `ZALO_DASHBOARD_PORT` (mặc định `3880`).
- `ZALO_DASHBOARD_URL` mặc định `http://localhost:3880`; dùng để kiểm `Origin` và dựng link Telegram.
- Dữ liệu dashboard ở `<HERMES_HOME>/zalo/dashboard/`, mọi tệp ghi quyền `0o600`, ghi nguyên tử (tệp tạm + rename).
- Cookie phiên tên `zd_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`, thêm `Secure` khi `req.secure`.
- Phiên: hết hạn tuyệt đối 7 ngày, hết hạn khi không hoạt động 12 giờ.
- Mã đăng nhập: 6 chữ số, sống 5 phút, sai tối đa 5 lần. Khoá đăng nhập: 5 lần sai / 15 phút → khoá 15 phút theo tên **và** theo IP.
- Tin X-Forwarded-* chỉ khi `req.socket.remoteAddress` là loopback (`trust proxy = 'loopback'`).
- Không bao giờ trả về giao diện: khoá API, token Telegram (chỉ dạng che), số điện thoại/cookie/IMEI Zalo, mật khẩu băm.
- Giao diện: tiếng Việt thường, không thuật ngữ "sidecar", "bridge", "toolset"; mọi lỗi kèm bước tiếp theo.
- Canh gác: 30 giây/lần; Zalo mất phiên báo sau 2 phút; sidecar không trả lời 2 phút → tự khởi động lại một lần, vẫn hỏng thì báo; trợ lý không nối 5 phút → báo; hồi phục → báo; nhắc lại sau 6 giờ.
- Giãn nhịp nối lại listener: 5 s → 15 s → 30 s → 60 s → 120 s → 300 s; chỉ đặt lại khi kết nối giữ được > 2 phút; mã đóng `3000`/`3003` → `needsRelogin=true`.
- Commit theo quy ước repo, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Sidecar tắt hẳn khi dashboard đang mở** → `/api/status` phải trả `{ sidecar: 'down' }` trong ≤ 4 giây (không treo request), giao diện hiện dải đỏ có bước xử lý. (Task 6 test `status khi sidecar không trả lời`.)
2. **Đăng nhập bằng mã khi Zalo đang mất phiên** → `/api/auth/start` chỉ trả `methods: ['password']`, không gọi gửi mã (sẽ treo/lỗi). (Task 5 test `không đề nghị mã Zalo khi bot mất phiên`.)
3. **Tệp JSON dữ liệu hỏng (sửa tay, mất điện giữa chừng)** → không sập dashboard: `readJson` trả giá trị dự phòng và cất bản hỏng thành `.corrupt-<ts>`. (Task 3 test.)
4. **Người dùng bị khoá (`disabled`) còn phiên cũ** → mọi request với phiên đó trả 401 ngay. (Task 5 test.)
5. **Hai dashboard/khởi động lại liên tục trong một sự cố** → không gửi cảnh báo trùng vì trạng thái sự cố lưu `watchdog.json`. (Task 8 test `khởi động lại không báo trùng`.)

---

## File Structure

**Sidecar (sửa):**
- `runtime-health.js` — thêm `setNeedsRelogin(bool)`, trường `zalo.needsRelogin` trong snapshot.
- `bot-handler.js` — giãn nhịp nối lại theo độ ổn định, nhận diện mã đóng 3000/3003.
- `hermes-bridge.js` — `sendSystemNotice` nhận `actorUid`, `actorRole`, `action`.
- `qr-login.js` (mới) — luồng đăng nhập QR tách khỏi `server.js`: bắt đầu không chặn, đọc trạng thái QR.
- `control-api.js` (mới) — router `/control/*` có token.
- `server.js` — dùng `qr-login.js`, gắn `control-api.js`.

**Dashboard (mới):**
- `dashboard/lib/json-store.js` — đọc/ghi JSON nguyên tử, chịu tệp hỏng.
- `dashboard/lib/paths.js` — tìm `HERMES_HOME`, thư mục sidecar, đường dẫn dữ liệu.
- `dashboard/lib/config.js` — cổng, URL công khai, lệnh khởi động lại sidecar.
- `dashboard/lib/users.js` — người dùng + scrypt.
- `dashboard/lib/sessions.js` — phiên băm.
- `dashboard/lib/login-guard.js` — khoá chống dò + mã đăng nhập.
- `dashboard/lib/setup-token.js` — link thiết lập dùng một lần.
- `dashboard/lib/activity-log.js` — `activity.jsonl` xoay vòng.
- `dashboard/lib/sidecar-client.js` — gọi sidecar có timeout.
- `dashboard/lib/telegram.js` — Bot API + nối người dùng bằng mã `/start`.
- `dashboard/lib/watchdog.js` — sự cố + cảnh báo.
- `dashboard/lib/restart.js` — khởi động lại sidecar theo nền tảng.
- `dashboard/lib/http-guards.js` — header bảo mật, kiểm Origin, middleware phiên/vai trò.
- `dashboard/routes/auth.js`, `status.js`, `zalo.js`, `telegram.js`, `admin.js`.
- `dashboard/app.js` — `createDashboardApp(deps)` (dùng cho test và server).
- `dashboard/server.js` — điểm chạy: nạp env, dựng deps, chạy canh gác, `listen`.
- `dashboard/cli/setup-link.js`, `dashboard/cli/reset-admin.js`.
- `dashboard/public/` — `index.html`, `style.css`, `app.js`, `views/*.js`, `vendor/`.

**Bộ cài (sửa):** `scripts/hermes-install-lib.js`, `scripts/install-hermes.js`, `scripts/doctor.js`, `scripts/uninstall-hermes.js`, `scripts/dashboard-service.js` (mới), `package.json`, `README.vi.md`, `README.md`, `CHANGELOG.md`.

---

### Task 1: Sidecar — giãn nhịp nối lại và `needsRelogin`

**Files:**
- Modify: `runtime-health.js`
- Modify: `bot-handler.js:52-160`
- Test: `runtime-health.test.js`, `bot-handler.test.js`

**Interfaces:**
- Produces: `health.setNeedsRelogin(flag: boolean)`; `snapshot().zalo.needsRelogin: boolean`; `setupBotListener(api, profile, { health, restartDelaysMs, stableAfterMs = 120_000, flapWindowMs = 10_000, now = Date.now })`.
- `health.setZaloState('logged-in', …)` tự đặt `needsRelogin=false`.

- [ ] **Step 1: Test runtime-health**

Thêm vào `runtime-health.test.js` (dùng lại cách tạo store giả của tệp này):

```js
test('needsRelogin bật/tắt và tự xoá khi đăng nhập lại', () => {
  const health = createRuntimeHealth({ store: fakeStore() });
  assert.equal(health.snapshot().zalo.needsRelogin, false);
  health.setNeedsRelogin(true);
  assert.equal(health.snapshot().zalo.needsRelogin, true);
  assert.equal(health.snapshot().status, 'degraded');
  health.setZaloState('logged-in', { userId: '1', displayName: 'Bot' });
  assert.equal(health.snapshot().zalo.needsRelogin, false);
});
```

(Nếu tệp test chưa có `fakeStore`, dùng đúng hàm tạo store mà các test khác trong tệp đang dùng.)

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test runtime-health.test.js` → `setNeedsRelogin is not a function`.

- [ ] **Step 3: Cài đặt** trong `runtime-health.js`: thêm biến `let needsRelogin = false;`; hàm `setNeedsRelogin(flag) { needsRelogin = Boolean(flag); }`; trong `setZaloState`, khi `status === 'logged-in'` thì `needsRelogin = false`; snapshot `zalo: { status, userId, displayName, listener, needsRelogin }`; điều kiện `degraded` thêm `|| needsRelogin`; trả `setNeedsRelogin` trong object API.

- [ ] **Step 4: Test bot-handler** — thêm vào `bot-handler.test.js` (dùng `FakeListener`, `fakeHealth`, `waitFor` sẵn có; mở rộng `fakeHealth` ghi `needsRelogin` qua `setNeedsRelogin(flag) { this.needs = flag; }`):

```js
test('kết nối chập chờn không đặt lại nhịp chờ: 5 → 15 → 30', async () => {
  const listener = new FakeListener();
  const health = fakeHealth();
  const delays = [];
  let clock = 0;
  const stop = setupBotListener({ listener }, { user_id: 'bot' }, {
    health, restartDelaysMs: [5, 15, 30], stableAfterMs: 1000, flapWindowMs: 50, now: () => clock,
    onScheduleRestart: (ms) => delays.push(ms),
  });
  for (let i = 0; i < 3; i++) {
    listener.emit('connected');
    clock += 10;                       // rớt sau 10 ms: chập chờn
    listener.emit('disconnected', 1006, '');
    listener.emit('closed', 1006, '');
    await waitFor(() => listener.starts.length === i + 2);
  }
  assert.deepEqual(delays, [5, 15, 30]);
  stop();
});

test('kết nối giữ đủ lâu thì đặt lại nhịp chờ', async () => {
  const listener = new FakeListener();
  const delays = [];
  let clock = 0;
  const stop = setupBotListener({ listener }, { user_id: 'bot' }, {
    health: fakeHealth(), restartDelaysMs: [5, 15, 30], stableAfterMs: 100, flapWindowMs: 50, now: () => clock,
    onScheduleRestart: (ms) => delays.push(ms),
  });
  listener.emit('connected'); clock += 10; listener.emit('closed', 1006, '');
  await waitFor(() => listener.starts.length === 2);
  listener.emit('connected');
  await new Promise((r) => setTimeout(r, 130)); // giữ > stableAfterMs (đồng hồ thật cho bộ hẹn giờ)
  clock += 500; listener.emit('closed', 1006, '');
  await waitFor(() => listener.starts.length === 3);
  assert.deepEqual(delays, [5, 5]);
  stop();
});

test('bị Zalo đá (3003) thì báo needsRelogin và chờ nhịp dài nhất', async () => {
  const listener = new FakeListener();
  const health = fakeHealth();
  const delays = [];
  const stop = setupBotListener({ listener }, { user_id: 'bot' }, {
    health, restartDelaysMs: [5, 15, 30], onScheduleRestart: (ms) => delays.push(ms),
  });
  listener.emit('connected');
  listener.emit('disconnected', 3003, 'kick');
  listener.emit('closed', 3003, 'kick');
  assert.equal(health.needs, true);
  assert.deepEqual(delays, [30]);
  stop();
});
```

- [ ] **Step 5: Chạy, thấy FAIL.**

- [ ] **Step 6: Cài đặt** trong `bot-handler.js`:

```js
const KICK_CODES = new Set([3000, 3003]); // 3000: phiên khác mở; 3003: bị đá (zca-js CloseReason)

export function setupBotListener(api, profile = null, {
  health = null, restartDelaysMs = RESTART_DELAYS_MS,
  stableAfterMs = 120_000, flapWindowMs = 10_000, now = Date.now,
  onScheduleRestart = null,
} = {}) {
  // ... giữ nguyên phần đầu ...
  let connectedAt = 0;
  let stableTimer = null;
  let kicked = false;

  const onConnected = () => {
    connectedAt = now();
    health?.setListenerState('connected');
    console.log('[bot] 🔌 Zalo listener đã kết nối');
    clearTimeout(stableTimer);
    // Chỉ coi là đã ổn khi giữ được kết nối đủ lâu — nối được rồi rớt ngay
    // không được xoá nhịp chờ (sự cố 01/10/2026: 17.414 lần thử trong 24 giờ).
    stableTimer = setTimeout(() => {
      restartAttempt = 0;
      kicked = false;
      health?.setNeedsRelogin?.(false);
    }, stableAfterMs);
    stableTimer.unref?.();
  };

  const onDisconnected = (code, reason) => {
    clearTimeout(stableTimer);
    health?.setListenerState('reconnecting');
    if (KICK_CODES.has(Number(code))) {
      kicked = true;
      health?.setNeedsRelogin?.(true);
    }
    console.warn(`[bot] ⚠️ Zalo listener mất kết nối (mã ${code}${reason ? `: ${reason}` : ''})`);
  };

  function scheduleRestart() {
    if (stopped || restartTimer) return;
    const delay = kicked
      ? restartDelaysMs[restartDelaysMs.length - 1]
      : restartDelaysMs[Math.min(restartAttempt, restartDelaysMs.length - 1)];
    restartAttempt += 1;
    onScheduleRestart?.(delay);
    console.warn(`[bot] 🔁 thử mở lại Zalo listener sau ${Math.round(delay / 1000)}s (lần ${restartAttempt})`);
    restartTimer = setTimeout(() => { restartTimer = null; startListener(); }, delay);
  }
  // cleanup: thêm clearTimeout(stableTimer)
```

Bỏ dòng `restartAttempt = 0;` cũ trong `onConnected`. `flapWindowMs` và `connectedAt` chỉ dùng để ghi log `(rớt sau Nms)` — không cần logic thêm; giữ tham số để test truyền vào không lỗi. `onClosed` giữ nguyên (gọi `scheduleRestart()`).

- [ ] **Step 7: Chạy** `node --test bot-handler.test.js runtime-health.test.js` → PASS, kể cả test cũ.

- [ ] **Step 8: Commit** `fix(zalo): giãn nhịp nối lại theo độ ổn định, báo cần quét QR khi bị đá phiên`.

---

### Task 2: Sidecar — tách luồng QR, `sendSystemNotice` có người gửi, `control-api.js`

**Files:**
- Create: `qr-login.js`, `control-api.js`, `control-api.test.js`
- Modify: `server.js:68-259`, `hermes-bridge.js:712-746`

**Interfaces:**
- `qr-login.js`: `createQrLogin({ createZalo, onLoggedIn, health, broadcast })` → `{ start(): Promise<void> (không chờ quét — trả khi đã bắt đầu), waitForLogin(): Promise<user>, state(): { status, image: string|null, user } }`. `server.js` dùng cho cả `/api/qr/start` (chờ `waitForLogin()` như cũ) và `/control/qr/start`.
- `sendSystemNotice({ api, threadId, threadType, text, mentions = null, actorUid = 'system', actorRole = 'system', action = 'send_system_notice' })`.
- `control-api.js`: `createControlRouter({ token, health(), qr: { start, state }, logout(), send({ threadId, threadType, text, actor }), loginCode({ zaloUid, code }), groups() })` → `express.Router`.

- [ ] **Step 1: Test control-api** — `control-api.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createControlRouter } from './control-api.js';

function serve(t, overrides = {}) {
  const calls = [];
  const deps = {
    token: 'secret-token-123456',
    health: () => ({ status: 'healthy', zalo: { status: 'logged-in', needsRelogin: false } }),
    qr: { start: async () => { calls.push('qr-start'); }, state: () => ({ status: 'qr-pending', image: 'data:image/png;base64,AAA', user: null }) },
    logout: async () => { calls.push('logout'); },
    send: async (m) => { calls.push(['send', m]); return { msgId: '1' }; },
    loginCode: async (m) => { calls.push(['code', m]); },
    groups: async () => [{ id: '123', name: 'Tổ Hoá', members: 12 }],
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use('/control', createControlRouter(deps));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/control`;
  const call = (path, { method = 'GET', body, token = deps.token } = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { call, calls };
}

test('thiếu hoặc sai token thì 401', async (t) => {
  const { call } = serve(t);
  assert.equal((await call('/health', { token: null })).status, 401);
  assert.equal((await call('/health', { token: 'sai' })).status, 401);
  assert.equal((await call('/health')).status, 200);
});

test('gửi tin tay chuyển đúng người gửi xuống', async (t) => {
  const { call, calls } = serve(t);
  const res = await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1), ['send', { threadId: '9', threadType: 1, text: 'Chào', actor: 'khach' }]);
});

test('gửi tin tay từ chối khi thiếu chữ hoặc quá 2000 ký tự', async (t) => {
  const { call } = serve(t);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: '  ', actor: 'a' } })).status, 400);
  assert.equal((await call('/send', { method: 'POST', body: { threadId: '9', threadType: 1, text: 'x'.repeat(2001), actor: 'a' } })).status, 400);
});

test('mã đăng nhập chỉ nhận đúng 6 chữ số và UID hợp lệ', async (t) => {
  const { call, calls } = serve(t);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: 'abc123' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '0987', code: '123456' } })).status, 400);
  assert.equal((await call('/login-code', { method: 'POST', body: { zaloUid: '1234567890123456', code: '123456' } })).status, 200);
  assert.deepEqual(calls.at(-1), ['code', { zaloUid: '1234567890123456', code: '123456' }]);
});

test('QR: bắt đầu không chặn, đọc trạng thái', async (t) => {
  const { call, calls } = serve(t);
  assert.equal((await call('/qr/start', { method: 'POST' })).status, 200);
  assert.ok(calls.includes('qr-start'));
  const state = await (await call('/qr')).json();
  assert.equal(state.status, 'qr-pending');
  assert.match(state.image, /^data:image\/png;base64,/);
});

test('lỗi bên trong trả 502 kèm thông điệp, không làm sập', async (t) => {
  const { call } = serve(t, { groups: async () => { throw new Error('Zalo chưa đăng nhập'); } });
  const res = await call('/groups');
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /Zalo chưa đăng nhập/);
});
```

- [ ] **Step 2: Chạy, thấy FAIL** (không có module).

- [ ] **Step 3: Viết `control-api.js`:**

```js
/**
 * Route /control/* cho dashboard. Luôn đòi ZALO_BRIDGE_TOKEN — nghe 127.0.0.1
 * không phải là xác thực: mọi tiến trình trên máy đều gọi được.
 * Một token cho cả cầu nối Hermes lẫn dashboard: một bí mật, một chỗ thu hồi.
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';

const ZALO_UID = /^[1-9]\d{14,21}$/;
const MAX_TEXT = 2000;

function tokenOk(header, expected) {
  const supplied = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(String(expected || ''));
  return want.length > 0 && supplied.length === want.length && timingSafeEqual(supplied, want);
}

export function createControlRouter({ token, health, qr, logout, send, loginCode, groups }) {
  const router = express.Router();
  router.use((req, res, next) => (tokenOk(req.get('authorization'), token)
    ? next() : res.status(401).json({ ok: false, error: 'unauthorized' })));

  const wrap = (fn) => async (req, res) => {
    try { res.json({ ok: true, ...(await fn(req)) }); } catch (err) {
      const status = err.statusCode || 502;
      res.status(status).json({ ok: false, error: String(err?.message || err) });
    }
  };
  const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });

  router.get('/health', wrap(async () => ({ health: health() })));
  router.post('/qr/start', wrap(async () => { await qr.start(); return {}; }));
  router.get('/qr', wrap(async () => qr.state()));
  router.post('/logout', wrap(async () => { await logout(); return {}; }));
  router.post('/send', wrap(async (req) => {
    const { threadId, threadType, text, actor } = req.body || {};
    const body = String(text ?? '').trim();
    if (!/^\d+$/.test(String(threadId ?? ''))) throw bad('threadId không hợp lệ');
    if (![0, 1].includes(Number(threadType))) throw bad('threadType phải là 0 hoặc 1');
    if (!body || body.length > MAX_TEXT) throw bad(`Nội dung trống hoặc quá ${MAX_TEXT} ký tự`);
    if (!String(actor || '').trim()) throw bad('Thiếu người gửi');
    return { result: await send({ threadId: String(threadId), threadType: Number(threadType), text: body, actor: String(actor) }) };
  }));
  router.post('/login-code', wrap(async (req) => {
    const { zaloUid, code } = req.body || {};
    if (!ZALO_UID.test(String(zaloUid ?? ''))) throw bad('UID Zalo không hợp lệ');
    if (!/^\d{6}$/.test(String(code ?? ''))) throw bad('Mã phải gồm đúng 6 chữ số');
    await loginCode({ zaloUid: String(zaloUid), code: String(code) });
    return {};
  }));
  router.get('/groups', wrap(async () => ({ groups: await groups() })));
  return router;
}
```

- [ ] **Step 4: Chạy** `node --test control-api.test.js` → PASS.

- [ ] **Step 5: `sendSystemNotice` có người gửi** — trong `hermes-bridge.js`, đổi chữ ký thành `sendSystemNotice({ api, threadId, threadType, text, mentions = null, actorUid = 'system', actorRole = 'system', action = 'send_system_notice' })` và dùng ba biến này trong `beginAudit` thay cho chuỗi cứng. Thêm test vào `hermes-bridge.test.js` (dùng cách dựng store/api giả sẵn có trong tệp cho `sendSystemNotice`): gọi với `actorUid: 'khach', actorRole: 'dashboard', action: 'dashboard_send'` → `store.getAuditTrail(requestId)` (hoặc truy vấn `audit_log` mới nhất) có `actor_uid='khach'`, `actor_role='dashboard'`, `action='dashboard_send'`. Chạy `node --test hermes-bridge.test.js` → PASS.

- [ ] **Step 6: Tách QR ra `qr-login.js`:**

```js
/**
 * Luồng đăng nhập QR. Tách khỏi server.js để dashboard bắt đầu quét qua HTTP
 * mà không phải giữ request mở tới khi người dùng quét (trang cũ vẫn chờ như trước).
 */
import { LoginQRCallbackEventType } from 'zca-js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

export function toDataUrl(image) {
  if (!image) return null;
  return String(image).startsWith('data:') ? String(image) : `data:image/png;base64,${image}`;
}

export function createQrLogin({ createZalo, onLoggedIn, health, broadcast = () => {} }) {
  let status = 'idle';
  let image = null;
  let user = null;
  let pending = null; // Promise của lần đăng nhập đang chạy

  function run() {
    status = 'qr-pending';
    image = null;
    health?.setZaloState('qr-pending');
    let credentials = null;
    const zalo = createZalo();
    pending = zalo.loginQR({ userAgent: USER_AGENT, language: 'vi' }, async (evt) => {
      switch (evt.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          image = toDataUrl(evt.data.image); status = 'qr-pending';
          broadcast({ type: 'qr-generated', data: { image: evt.data.image } }); break;
        case LoginQRCallbackEventType.QRCodeScanned:
          status = 'scanned'; health?.setZaloState('scanned'); broadcast({ type: 'qr-scanned' }); break;
        case LoginQRCallbackEventType.QRCodeExpired:
          status = 'idle'; image = null; health?.setZaloState('idle'); broadcast({ type: 'qr-expired' }); break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          status = 'idle'; image = null; health?.setZaloState('idle'); broadcast({ type: 'qr-declined' }); break;
        case LoginQRCallbackEventType.GotLoginInfo:
          credentials = evt.data; break;
        default: break;
      }
    }).then(async (api) => {
      user = await onLoggedIn(api, credentials);
      status = 'logged-in'; image = null;
      return user;
    }).catch((err) => {
      status = 'idle'; image = null; health?.setZaloState('idle');
      broadcast({ type: 'error', data: { message: String(err?.message || err) } });
      throw err;
    }).finally(() => { pending = null; });
    pending.catch(() => {}); // lỗi đã được xử lý ở trên; tránh unhandled rejection khi không ai chờ
    return pending;
  }

  return {
    async start() { if (status !== 'logged-in' && !pending) run(); },
    waitForLogin() { return pending || run(); },
    state: () => ({ status, image, user }),
    markLoggedIn(u) { status = 'logged-in'; user = u; image = null; },
    markLoggedOut() { status = 'idle'; user = null; image = null; },
  };
}
```

Trong `server.js`:
- Bỏ khối `zalo.loginQR(...)` cũ trong `POST /api/qr/start`; tạo một lần:

```js
const qrLogin = createQrLogin({
  createZalo: () => (zalo = new Zalo(zaloOptions())),
  health: runtimeHealth,
  broadcast,
  onLoggedIn: async (loggedApi, credentials) => {
    api = loggedApi;
    loginInfo = await fetchProfile(api);
    status = 'logged-in';
    runtimeHealth.setZaloState('logged-in', { userId: loginInfo?.user_id, displayName: loginInfo?.display_name });
    await saveSession(credentials, loginInfo);
    broadcast({ type: 'login-success', data: loginInfo });
    await activateZaloRuntime();
    return loginInfo;
  },
});
```

- `POST /api/qr/start`: nếu `status === 'logged-in' && api` → `{ok:true,user}`; ngược lại `try { const user = await qrLogin.waitForLogin(); res.json({ ok: true, user }); } catch (err) { res.status(500).json({ ok: false, error: String(err?.message || err) }); }`.
- Sau `tryReconnect()` thành công gọi `qrLogin.markLoggedIn(loginInfo)`; trong `POST /api/logout` gọi `qrLogin.markLoggedOut()`.
- Giữ `qrBase64` để WebSocket gửi trạng thái cho client mới: thay `qrBase64` bằng `qrLogin.state().image` khi gửi `qr-generated` lúc kết nối (cắt tiền tố `data:image/png;base64,` nếu trang cũ cần base64 thuần — kiểm `public/index.html` đang dùng dạng nào và giữ đúng dạng đó).

- [ ] **Step 7: Gắn `/control` trong `server.js`** (đặt **trước** `app.use('/api', …)` kiểm header CSRF; sau `express.json()`):

```js
import { createControlRouter } from './control-api.js';
import { createGroupDirectory } from './group-directory.js';

const groupDirectory = createGroupDirectory({ getApi: () => api });
app.use('/control', createControlRouter({
  token: process.env.ZALO_BRIDGE_TOKEN,
  health: () => runtimeHealth.snapshot(),
  qr: { start: () => qrLogin.start(), state: () => qrLogin.state() },
  logout: () => logoutZalo(),            // tách thân POST /api/logout thành hàm dùng chung
  send: ({ threadId, threadType, text, actor }) => {
    if (!api) throw new Error('Zalo chưa đăng nhập');
    return sendSystemNotice({ api, threadId, threadType, text, actorUid: actor, actorRole: 'dashboard', action: 'dashboard_send' });
  },
  loginCode: ({ zaloUid, code }) => {
    if (!api) throw new Error('Zalo chưa đăng nhập');
    return sendSystemNotice({
      api, threadId: zaloUid, threadType: 0, actorUid: 'dashboard', actorRole: 'dashboard', action: 'dashboard_login_code',
      text: `Mã đăng nhập dashboard: ${code}\nMã có hiệu lực 5 phút. Đừng đưa mã này cho ai.`,
    });
  },
  groups: () => groupDirectory.list(),
}));
```

Tạo `group-directory.js` (+ `group-directory.test.js`):

```js
/** Danh sách nhóm có tên, đệm 10 phút — getAllGroups chỉ trả ID. */
export function createGroupDirectory({ getApi, now = Date.now, ttlMs = 10 * 60_000 }) {
  let cache = null;
  return {
    async list() {
      if (cache && now() - cache.at < ttlMs) return cache.groups;
      const api = getApi();
      if (!api) throw new Error('Zalo chưa đăng nhập');
      const ids = Object.keys((await api.getAllGroups())?.gridVerMap || {});
      const groups = [];
      for (let i = 0; i < ids.length; i += 50) {
        const info = (await api.getGroupInfo(ids.slice(i, i + 50)))?.gridInfoMap || {};
        for (const id of ids.slice(i, i + 50)) {
          groups.push({ id, name: String(info[id]?.name || id), members: Number(info[id]?.totalMember) || 0 });
        }
      }
      groups.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      cache = { at: now(), groups };
      return groups;
    },
  };
}
```

Test: api giả trả `{gridVerMap:{'2':1,'1':1}}` và `gridInfoMap` có tên → `list()` trả đã sắp xếp theo tên; gọi lần hai trong 10 phút không gọi lại api (đếm số lần gọi); `getApi()` trả null → reject `Zalo chưa đăng nhập`.

- [ ] **Step 8: Chạy toàn bộ** `npm run test:js` → PASS (test cũ của server/bridge không vỡ).

- [ ] **Step 9: Commit** `feat(zalo): route /control cho dashboard (sức khoẻ, QR, gửi tay, mã đăng nhập, nhóm)`.

---

### Task 3: Dashboard nền — json-store, paths, config, activity-log

**Files:**
- Create: `dashboard/lib/json-store.js`, `dashboard/lib/paths.js`, `dashboard/lib/config.js`, `dashboard/lib/activity-log.js`
- Test: `dashboard/lib/json-store.test.js`, `dashboard/lib/paths.test.js`, `dashboard/lib/activity-log.test.js`

**Interfaces:**
- `readJson(path, fallback)` → giá trị đã parse hoặc `structuredClone(fallback)`; tệp hỏng → đổi tên `<path>.corrupt-<ms>` rồi trả fallback.
- `writeJsonAtomic(path, value)` → tạo thư mục, ghi `<path>.tmp` mode `0o600`, `renameSync`.
- `resolveDashboardPaths({ env = process.env, sidecarRoot })` → `{ sidecarRoot, hermesHome, dataDir, usersFile, sessionsFile, setupFile, telegramFile, watchdogFile, activityFile, brandFile, permissionsFile, hermesEnvFile, sqliteFile }`; ném lỗi tiếng Việt khi thiếu `HERMES_HOME`.
- `loadDashboardConfig(env)` → `{ port: number, publicUrl: string (không có "/" cuối), restartCmd: string|null }`.
- `createActivityLog(path, { maxBytes = 5 * 1024 * 1024, now = Date.now })` → `{ append({ actor, action, detail = '', ok = true }), list({ before = Infinity, limit = 50 }) }` (list mới nhất trước, gộp cả tệp `.1` đã xoay).

- [ ] **Step 1: Test json-store**

```js
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
```

- [ ] **Step 2: FAIL → Step 3: cài đặt** `json-store.js`:

```js
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); } catch { /* tệp đã biến mất */ }
    console.warn(`[dashboard] ${path} hỏng, đã cất sang ${aside}: ${err.message}`);
    return structuredClone(fallback);
  }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Test paths/config** (`paths.test.js`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveDashboardPaths } from './paths.js';
import { loadDashboardConfig } from './config.js';

test('đường dẫn dựng từ HERMES_HOME và thư mục sidecar', () => {
  const p = resolveDashboardPaths({ env: { HERMES_HOME: '/h' }, sidecarRoot: '/s' });
  assert.equal(p.dataDir, join('/h', 'zalo', 'dashboard'));
  assert.equal(p.usersFile, join('/h', 'zalo', 'dashboard', 'users.json'));
  assert.equal(p.permissionsFile, join('/h', 'zalo', 'permissions.json'));
  assert.equal(p.hermesEnvFile, join('/h', '.env'));
  assert.equal(p.sqliteFile, join('/s', 'data', 'zalo.sqlite'));
});

test('thiếu HERMES_HOME thì báo lỗi dễ hiểu', () => {
  assert.throws(() => resolveDashboardPaths({ env: {}, sidecarRoot: '/s' }), /HERMES_HOME/);
});

test('cấu hình mặc định và ghi đè', () => {
  assert.deepEqual(loadDashboardConfig({}), { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null });
  const c = loadDashboardConfig({ ZALO_DASHBOARD_PORT: '4000', ZALO_DASHBOARD_URL: 'https://d.example.vn/', ZALO_SIDECAR_RESTART_CMD: 'systemctl restart zalo-bridge' });
  assert.deepEqual(c, { port: 4000, publicUrl: 'https://d.example.vn', restartCmd: 'systemctl restart zalo-bridge' });
});

test('cổng sai thì quay về mặc định', () => {
  assert.equal(loadDashboardConfig({ ZALO_DASHBOARD_PORT: 'abc' }).port, 3880);
});
```

- [ ] **Step 5: FAIL → cài đặt:**

`paths.js`:

```js
import { join, resolve } from 'node:path';

export function resolveDashboardPaths({ env = process.env, sidecarRoot }) {
  const home = String(env.HERMES_HOME || '').trim();
  if (!home) throw new Error('Không tìm thấy HERMES_HOME — chạy lại "npm run install:hermes" để bộ cài ghi vào .env của sidecar.');
  const hermesHome = resolve(home);
  const dataDir = join(hermesHome, 'zalo', 'dashboard');
  return {
    sidecarRoot: resolve(sidecarRoot),
    hermesHome,
    dataDir,
    usersFile: join(dataDir, 'users.json'),
    sessionsFile: join(dataDir, 'sessions.json'),
    setupFile: join(dataDir, 'setup.json'),
    telegramFile: join(dataDir, 'telegram.json'),
    watchdogFile: join(dataDir, 'watchdog.json'),
    activityFile: join(dataDir, 'activity.jsonl'),
    brandFile: join(dataDir, 'brand.json'),
    permissionsFile: join(hermesHome, 'zalo', 'permissions.json'),
    hermesEnvFile: join(hermesHome, '.env'),
    sqliteFile: join(resolve(sidecarRoot), 'data', 'zalo.sqlite'),
  };
}
```

(Test dùng `/h`, `/s`: vì `resolve` trên Windows thêm ổ đĩa, test so sánh bằng `join(resolve('/h'), …)` — sửa test cho khớp: thay `join('/h', …)` bằng `join(resolve('/h'), …)` và import `resolve`.)

`config.js`:

```js
export function loadDashboardConfig(env = process.env) {
  const port = Number.parseInt(env.ZALO_DASHBOARD_PORT, 10);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3880,
    publicUrl: String(env.ZALO_DASHBOARD_URL || 'http://localhost:3880').trim().replace(/\/+$/, ''),
    restartCmd: String(env.ZALO_SIDECAR_RESTART_CMD || '').trim() || null,
  };
}
```

- [ ] **Step 6: Test activity-log**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActivityLog } from './activity-log.js';

test('ghi và đọc mới nhất trước, phân trang theo before', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-act-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  let clock = 1000;
  const log = createActivityLog(join(d, 'a.jsonl'), { now: () => clock++ });
  log.append({ actor: 'anh', action: 'login', ok: true });
  log.append({ actor: 'khach', action: 'login', ok: false, detail: 'sai mật khẩu' });
  const all = log.list({});
  assert.deepEqual(all.map((e) => e.actor), ['khach', 'anh']);
  assert.deepEqual(log.list({ before: all[0].at }).map((e) => e.actor), ['anh']);
});

test('xoay vòng khi vượt dung lượng, vẫn đọc được bản cũ', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-act-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const p = join(d, 'a.jsonl');
  const log = createActivityLog(p, { maxBytes: 200 });
  for (let i = 0; i < 10; i++) log.append({ actor: 'a', action: `x${i}` });
  assert.ok(existsSync(`${p}.1`));
  assert.equal(log.list({ limit: 100 })[0].action, 'x9');
});
```

- [ ] **Step 7: FAIL → cài đặt** `activity-log.js`:

```js
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export function createActivityLog(path, { maxBytes = 5 * 1024 * 1024, now = Date.now } = {}) {
  function rotate() {
    try { if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`); } catch { /* chưa có tệp */ }
  }
  function readLines(p) {
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
  return {
    append({ actor, action, detail = '', ok = true }) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      rotate();
      const entry = { at: now(), actor: String(actor), action: String(action), detail: String(detail).slice(0, 500), ok: Boolean(ok) };
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      return entry;
    },
    list({ before = Infinity, limit = 50 } = {}) {
      return [...readLines(`${path}.1`), ...readLines(path)]
        .filter((e) => e.at < before)
        .sort((a, b) => b.at - a.at)
        .slice(0, Math.min(Math.max(limit, 1), 200));
    },
  };
}
```

- [ ] **Step 8: PASS** `node --test dashboard/lib/` → **Step 9: Commit** `feat(dashboard): nền lưu trữ JSON, đường dẫn, cấu hình, nhật ký hoạt động`.

---

### Task 4: Người dùng, phiên, khoá chống dò, mã đăng nhập, link thiết lập

**Files:**
- Create: `dashboard/lib/users.js`, `dashboard/lib/sessions.js`, `dashboard/lib/login-guard.js`, `dashboard/lib/setup-token.js`
- Test: `dashboard/lib/users.test.js`, `dashboard/lib/sessions.test.js`, `dashboard/lib/login-guard.test.js`, `dashboard/lib/setup-token.test.js`

**Interfaces:**
- `createUserStore(path)` → `{ list(): PublicUser[], get(username): User|null, create({ username, role, zaloUid = '', password = '' }): PublicUser, update(username, { role?, zaloUid?, disabled? }): PublicUser, setPassword(username, password), verifyPassword(username, password): boolean, hasAdmin(): boolean }`. `PublicUser = { username, role, zaloUid, disabled, hasPassword, createdAt }`. Tên: `/^[a-z0-9._-]{3,32}$/`; vai trò `'admin'|'owner'`; UID `''` hoặc `/^[1-9]\d{14,21}$/`; mật khẩu ≥ 8 ký tự. Lỗi kiểm tra ném `Error` có `statusCode = 400`.
- `hashPassword(pw)` → `'scrypt$<saltHex>$<hashHex>'`; `verifyHash(pw, stored)` (timingSafeEqual).
- `createSessionStore(path, { now = Date.now, ttlMs = 7 days, idleMs = 12 h })` → `{ create(username): token, get(token): { username } | null, destroy(token), destroyAll(username) }`. Lưu `sha256(token)`; `get` cập nhật `lastSeen` (ghi tệp tối đa 1 lần/phút).
- `createLoginGuard({ now = Date.now, maxFails = 5, windowMs = 15 min, lockMs = 15 min, codeTtlMs = 5 min, codeAttempts = 5 })` → `{ locked(keys: string[]): number /* ms còn khoá, 0 = không */, fail(keys), succeed(keys), issueCode(username): string, verifyCode(username, code): boolean }` (trong bộ nhớ — khởi động lại xoá mã và khoá là chấp nhận được).
- `createSetupToken(path, { now = Date.now, ttlMs = 24 h })` → `{ issue(): token, consume(token): boolean }` (lưu băm; dùng xong xoá).

- [ ] **Step 1: Test users**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserStore } from './users.js';

function store(t) { const d = mkdtempSync(join(tmpdir(), 'zd-users-')); t.after(() => rmSync(d, { recursive: true, force: true })); return { s: createUserStore(join(d, 'users.json')), file: join(d, 'users.json') }; }

test('tạo, đặt mật khẩu, kiểm mật khẩu; tệp không chứa mật khẩu thật', (t) => {
  const { s, file } = store(t);
  s.create({ username: 'anh', role: 'admin', zaloUid: '1234567890123456', password: 'matkhau-dai' });
  assert.equal(s.verifyPassword('anh', 'matkhau-dai'), true);
  assert.equal(s.verifyPassword('anh', 'sai'), false);
  assert.equal(s.verifyPassword('khongco', 'x'), false);
  assert.ok(!readFileSync(file, 'utf8').includes('matkhau-dai'));
  assert.equal(s.hasAdmin(), true);
});

test('bản công khai không lộ mật khẩu băm', (t) => {
  const { s } = store(t);
  const u = s.create({ username: 'khach', role: 'owner', password: 'abcdefgh' });
  assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'disabled', 'hasPassword', 'role', 'username', 'zaloUid']);
});

test('từ chối dữ liệu sai', (t) => {
  const { s } = store(t);
  assert.throws(() => s.create({ username: 'A', role: 'admin' }), /Tên đăng nhập/);
  assert.throws(() => s.create({ username: 'abc', role: 'boss' }), /Vai trò/);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', zaloUid: '0912345678' }), /UID/);
  assert.throws(() => s.create({ username: 'abc', role: 'owner', password: 'ngan' }), /8 ký tự/);
  s.create({ username: 'abc', role: 'owner' });
  assert.throws(() => s.create({ username: 'abc', role: 'owner' }), /đã tồn tại/);
});

test('khoá tài khoản thì không kiểm mật khẩu được', (t) => {
  const { s } = store(t);
  s.create({ username: 'khach', role: 'owner', password: 'abcdefgh' });
  s.update('khach', { disabled: true });
  assert.equal(s.verifyPassword('khach', 'abcdefgh'), false);
});
```

- [ ] **Step 2: FAIL → Step 3: cài đặt** `users.js`:

```js
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const NAME = /^[a-z0-9._-]{3,32}$/;
const ZALO_UID = /^[1-9]\d{14,21}$/;
const ROLES = new Set(['admin', 'owner']);
const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(String(password), salt, 64).toString('hex')}`;
}

export function verifyHash(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = scryptSync(String(password), Buffer.from(saltHex, 'hex'), want.length);
  return timingSafeEqual(got, want);
}

const toPublic = (u) => ({ username: u.username, role: u.role, zaloUid: u.zaloUid, disabled: Boolean(u.disabled), hasPassword: Boolean(u.passwordHash), createdAt: u.createdAt });

export function createUserStore(path) {
  const load = () => readJson(path, { users: [] });
  const save = (data) => writeJsonAtomic(path, data);
  const checkPassword = (pw) => { if (String(pw).length < 8) throw bad('Mật khẩu cần ít nhất 8 ký tự'); };
  const checkUid = (uid) => { if (uid && !ZALO_UID.test(uid)) throw bad('UID Zalo không hợp lệ (dãy 15–22 chữ số, không bắt đầu bằng 0)'); };

  return {
    list: () => load().users.map(toPublic),
    get: (username) => load().users.find((u) => u.username === username) || null,
    hasAdmin: () => load().users.some((u) => u.role === 'admin' && !u.disabled),
    create({ username, role, zaloUid = '', password = '' }) {
      const name = String(username || '').trim().toLowerCase();
      if (!NAME.test(name)) throw bad('Tên đăng nhập 3–32 ký tự: chữ thường, số, dấu . _ -');
      if (!ROLES.has(role)) throw bad('Vai trò phải là Quản trị hoặc Chủ bot');
      checkUid(String(zaloUid));
      if (password) checkPassword(password);
      const data = load();
      if (data.users.some((u) => u.username === name)) throw bad('Tên đăng nhập đã tồn tại');
      const user = { username: name, role, zaloUid: String(zaloUid), disabled: false, passwordHash: password ? hashPassword(password) : '', createdAt: Date.now() };
      data.users.push(user);
      save(data);
      return toPublic(user);
    },
    update(username, patch = {}) {
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) throw Object.assign(new Error('Không có người dùng này'), { statusCode: 404 });
      if (patch.role !== undefined) { if (!ROLES.has(patch.role)) throw bad('Vai trò phải là Quản trị hoặc Chủ bot'); user.role = patch.role; }
      if (patch.zaloUid !== undefined) { checkUid(String(patch.zaloUid)); user.zaloUid = String(patch.zaloUid); }
      if (patch.disabled !== undefined) user.disabled = Boolean(patch.disabled);
      save(data);
      return toPublic(user);
    },
    setPassword(username, password) {
      checkPassword(password);
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) throw Object.assign(new Error('Không có người dùng này'), { statusCode: 404 });
      user.passwordHash = hashPassword(password);
      save(data);
    },
    verifyPassword(username, password) {
      const user = load().users.find((u) => u.username === username);
      if (!user || user.disabled || !user.passwordHash) { hashPassword('dummy-timing'); return false; }
      return verifyHash(password, user.passwordHash);
    },
  };
}
```

- [ ] **Step 4: Test sessions**

```js
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
  clock.t = 800; assert.equal(s.get(a), null); // quá idle 300
  const b = s.create('anh'); clock.t = 900; s.get(b); clock.t = 1100; s.get(b); clock.t = 1300; s.get(b);
  clock.t = 1900; assert.equal(s.get(b), null); // quá ttl 1000 tính từ lúc tạo (800)
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
```

- [ ] **Step 5: FAIL → cài đặt** `sessions.js`:

```js
import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSessionStore(path, { now = Date.now, ttlMs = 7 * 24 * 3600_000, idleMs = 12 * 3600_000 } = {}) {
  let data = readJson(path, { sessions: {} });
  let lastFlush = 0;
  const flush = () => { writeJsonAtomic(path, data); lastFlush = now(); };
  const alive = (s, t) => s && t - s.createdAt < ttlMs && t - s.lastSeen < idleMs;
  return {
    create(username) {
      const token = randomBytes(32).toString('base64url');
      const t = now();
      for (const [k, s] of Object.entries(data.sessions)) if (!alive(s, t)) delete data.sessions[k];
      data.sessions[sha(token)] = { username, createdAt: t, lastSeen: t };
      flush();
      return token;
    },
    get(token) {
      if (!token) return null;
      const key = sha(token);
      const s = data.sessions[key];
      const t = now();
      if (!alive(s, t)) { if (s) { delete data.sessions[key]; flush(); } return null; }
      s.lastSeen = t;
      if (t - lastFlush > 60_000) flush();
      return { username: s.username };
    },
    destroy(token) { delete data.sessions[sha(token)]; flush(); },
    destroyAll(username) {
      for (const [k, s] of Object.entries(data.sessions)) if (s.username === username) delete data.sessions[k];
      flush();
    },
  };
}
```

Lưu ý test idle: `get` gia hạn `lastSeen` trong bộ nhớ ngay cả khi chưa ghi tệp — đúng ý.

- [ ] **Step 6: Test login-guard**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginGuard } from './login-guard.js';

test('sai 5 lần thì khoá 15 phút theo từng khoá', () => {
  const clock = { t: 0 };
  const g = createLoginGuard({ now: () => clock.t });
  for (let i = 0; i < 4; i++) g.fail(['u:anh', 'ip:1.2.3.4']);
  assert.equal(g.locked(['u:anh']), 0);
  g.fail(['u:anh', 'ip:1.2.3.4']);
  assert.ok(g.locked(['u:anh']) > 0);
  assert.ok(g.locked(['ip:1.2.3.4']) > 0);
  assert.equal(g.locked(['u:khach']), 0);
  clock.t = 15 * 60_000 + 1;
  assert.equal(g.locked(['u:anh']), 0);
});

test('thành công thì xoá đếm sai', () => {
  const g = createLoginGuard({});
  for (let i = 0; i < 4; i++) g.fail(['u:anh']);
  g.succeed(['u:anh']);
  g.fail(['u:anh']);
  assert.equal(g.locked(['u:anh']), 0);
});

test('mã 6 số: đúng một lần, hết hạn sau 5 phút, sai quá 5 lần thì huỷ', () => {
  const clock = { t: 0 };
  const g = createLoginGuard({ now: () => clock.t });
  const code = g.issueCode('anh');
  assert.match(code, /^\d{6}$/);
  assert.equal(g.verifyCode('anh', code), true);
  assert.equal(g.verifyCode('anh', code), false); // dùng một lần
  const c2 = g.issueCode('anh'); clock.t = 5 * 60_000 + 1;
  assert.equal(g.verifyCode('anh', c2), false);
  const c3 = g.issueCode('anh');
  for (let i = 0; i < 5; i++) g.verifyCode('anh', '000000' === c3 ? '111111' : '000000');
  assert.equal(g.verifyCode('anh', c3), false);
});
```

- [ ] **Step 7: FAIL → cài đặt** `login-guard.js`:

```js
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const sha = (v) => createHash('sha256').update(String(v)).digest();

export function createLoginGuard({ now = Date.now, maxFails = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000, codeTtlMs = 5 * 60_000, codeAttempts = 5 } = {}) {
  const fails = new Map();   // key → { times: number[], lockedUntil }
  const codes = new Map();   // username → { hash, expiresAt, attempts }
  const entry = (k) => fails.get(k) || { times: [], lockedUntil: 0 };
  return {
    locked(keys) {
      const t = now();
      return Math.max(0, ...keys.map((k) => entry(k).lockedUntil - t));
    },
    fail(keys) {
      const t = now();
      for (const k of keys) {
        const e = entry(k);
        e.times = [...e.times.filter((x) => t - x < windowMs), t];
        if (e.times.length >= maxFails) { e.lockedUntil = t + lockMs; e.times = []; }
        fails.set(k, e);
      }
    },
    succeed(keys) { for (const k of keys) fails.delete(k); },
    issueCode(username) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      codes.set(username, { hash: sha(code), expiresAt: now() + codeTtlMs, attempts: 0 });
      return code;
    },
    verifyCode(username, code) {
      const c = codes.get(username);
      if (!c) return false;
      if (now() > c.expiresAt || c.attempts >= codeAttempts) { codes.delete(username); return false; }
      c.attempts += 1;
      const ok = /^\d{6}$/.test(String(code)) && timingSafeEqual(sha(code), c.hash);
      if (ok) codes.delete(username);
      return ok;
    },
  };
}
```

- [ ] **Step 8: Test + cài đặt setup-token** (`setup-token.test.js`: `issue()` trả chuỗi ≥ 32 ký tự; `consume(token)` đúng → true lần đầu, false lần hai; hết 24 giờ → false; chuỗi sai → false; tệp không chứa token thô):

```js
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (t) => createHash('sha256').update(String(t)).digest('hex');

export function createSetupToken(path, { now = Date.now, ttlMs = 24 * 3600_000 } = {}) {
  return {
    issue() {
      const token = randomBytes(24).toString('base64url');
      writeJsonAtomic(path, { hash: sha(token), expiresAt: now() + ttlMs });
      return token;
    },
    consume(token) {
      const saved = readJson(path, null);
      if (!saved || now() > saved.expiresAt) return false;
      const a = Buffer.from(sha(token)); const b = Buffer.from(saved.hash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
      rmSync(path, { force: true });
      return true;
    },
  };
}
```

- [ ] **Step 9: PASS** `node --test dashboard/lib/` → **Commit** `feat(dashboard): người dùng, phiên, khoá chống dò, mã đăng nhập, link thiết lập`.

---

### Task 5: App Express, bảo vệ HTTP, route đăng nhập/phiên

**Files:**
- Create: `dashboard/lib/http-guards.js`, `dashboard/routes/auth.js`, `dashboard/app.js`
- Test: `dashboard/routes/auth.test.js`, `dashboard/test-helpers.js` (hàm dựng app + gọi có cookie — dùng chung cho mọi test route)

**Interfaces:**
- `dashboard/app.js`: `createDashboardApp(deps)` với `deps = { config, users, sessions, guard, setupToken, activity, sidecar, telegram?, linker?, watchdog?, restartAssistant?, publicDir }` → `express.Application`. Đặt `app.set('trust proxy', 'loopback')`.
- `http-guards.js`: `securityHeaders()`; `checkOrigin(publicUrl)` (từ chối POST/PUT/PATCH/DELETE có `Origin` khác `publicUrl` và khác `http://localhost:<port>`/`http://127.0.0.1:<port>` → 403; không có Origin → cho qua chỉ khi có header `X-Requested-With: zalo-dashboard`); `sessionMiddleware({ sessions, users })` đặt `req.user` (PublicUser) hoặc null, người dùng `disabled` → null; `requireAuth`; `requireRole('admin')`; `readCookie(req, name)`; `setSessionCookie(res, req, token)`; `clearSessionCookie(res)`.
- Route `/api/auth/*`, `/api/me` như spec §7.1.
- `test-helpers.js`: `makeDeps(t, overrides)` dựng deps thật trên thư mục tạm với `sidecar` giả; `startApp(t, deps)` → `{ base, call(path, { method, body, cookie }) → { status, json, cookie } }` (tự gửi `X-Requested-With: zalo-dashboard`).

- [ ] **Step 1: Viết `dashboard/test-helpers.js`:**

```js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardApp } from './app.js';
import { createUserStore } from './lib/users.js';
import { createSessionStore } from './lib/sessions.js';
import { createLoginGuard } from './lib/login-guard.js';
import { createSetupToken } from './lib/setup-token.js';
import { createActivityLog } from './lib/activity-log.js';

export function fakeSidecar(overrides = {}) {
  const calls = [];
  return {
    calls,
    health: async () => ({ status: 'healthy', zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false, displayName: 'Uyển Nhi' },
      bridge: { attachedClients: 1 }, traffic: { lastInboundAtMs: 1, lastOutboundAtMs: 2 }, lastError: null }),
    loginCode: async (m) => { calls.push(['code', m]); },
    qrStart: async () => { calls.push('qr-start'); },
    qr: async () => ({ status: 'qr-pending', image: 'data:image/png;base64,AAA', user: null }),
    logout: async () => { calls.push('logout'); },
    ...overrides,
  };
}

export function makeDeps(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    config: { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null },
    users: createUserStore(join(dir, 'users.json')),
    sessions: createSessionStore(join(dir, 'sessions.json')),
    guard: createLoginGuard({}),
    setupToken: createSetupToken(join(dir, 'setup.json')),
    activity: createActivityLog(join(dir, 'activity.jsonl')),
    sidecar: fakeSidecar(),
    publicDir: join(dir, 'public'),
    dir,
    ...overrides,
  };
}

export async function startApp(t, deps) {
  const app = createDashboardApp(deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zalo-dashboard', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    let json = null;
    try { json = await res.json(); } catch { /* không phải JSON */ }
    return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null, headers: res.headers };
  }
  return { base, call };
}

export async function loginAs(t, deps, call, { username = 'anh', role = 'admin', password = 'matkhau-dai', zaloUid = '1234567890123456' } = {}) {
  if (!deps.users.get(username)) deps.users.create({ username, role, password, zaloUid });
  const res = await call('/api/auth/verify', { method: 'POST', body: { username, password } });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.cookie;
}
```

- [ ] **Step 2: Test route auth** (`dashboard/routes/auth.test.js`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeps, startApp, fakeSidecar } from '../test-helpers.js';

test('thiết lập Quản trị đầu tiên bằng link dùng một lần', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const token = deps.setupToken.issue();
  const res = await call('/api/auth/setup', { method: 'POST', body: { token, username: 'anh', password: 'matkhau-dai', zaloUid: '1234567890123456' } });
  assert.equal(res.status, 200);
  assert.ok(res.cookie);
  assert.equal(deps.users.get('anh').role, 'admin');
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { token, username: 'x2', password: 'matkhau-dai' } })).status, 403);
});

test('đăng nhập bằng mật khẩu, /api/me, đăng xuất', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const login = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/i);
  const me = await call('/api/me', { cookie: login.cookie });
  assert.equal(me.json.user.username, 'anh');
  await call('/api/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
});

test('mã qua Zalo: start gửi mã tới UID, verify bằng mã', async (t) => {
  const sidecar = fakeSidecar();
  const deps = makeDeps(t, { sidecar });
  deps.users.create({ username: 'khach', role: 'owner', zaloUid: '1234567890123456' });
  const { call } = await startApp(t, deps);
  const start = await call('/api/auth/start', { method: 'POST', body: { username: 'khach' } });
  assert.deepEqual(start.json.methods, ['zalo']);
  const [, sent] = sidecar.calls.find((c) => c[0] === 'code');
  assert.equal(sent.zaloUid, '1234567890123456');
  const ok = await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', code: sent.code } });
  assert.equal(ok.status, 200);
});

test('không đề nghị mã Zalo khi bot mất phiên', async (t) => {
  const sidecar = fakeSidecar({ health: async () => ({ zalo: { status: 'idle', needsRelogin: true }, bridge: { attachedClients: 0 } }) });
  const deps = makeDeps(t, { sidecar });
  deps.users.create({ username: 'anh', role: 'admin', zaloUid: '1234567890123456', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const start = await call('/api/auth/start', { method: 'POST', body: { username: 'anh' } });
  assert.deepEqual(start.json.methods, ['password']);
  assert.equal(sidecar.calls.filter((c) => c[0] === 'code').length, 0);
});

test('không tiết lộ tên đăng nhập có tồn tại hay không', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const res = await call('/api/auth/start', { method: 'POST', body: { username: 'khongco' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.methods, ['password']);
});

test('sai 5 lần thì khoá', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  for (let i = 0; i < 5; i++) await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'sai-sai-sai' } });
  const res = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' } });
  assert.equal(res.status, 429);
});

test('tài khoản bị khoá thì phiên cũ hết hiệu lực ngay', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'khach', role: 'owner', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const login = await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'matkhau-dai' } });
  deps.users.update('khach', { disabled: true });
  assert.equal((await call('/api/me', { cookie: login.cookie })).status, 401);
});

test('yêu cầu ghi từ Origin lạ bị chặn', async (t) => {
  const deps = makeDeps(t);
  deps.users.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  const { call } = await startApp(t, deps);
  const res = await call('/api/auth/verify', { method: 'POST', body: { username: 'anh', password: 'matkhau-dai' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('header bảo mật có mặt', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  const res = await call('/api/me');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
```

- [ ] **Step 3: FAIL → Step 4: cài đặt** `http-guards.js`:

```js
export const SESSION_COOKIE = 'zd_session';

export function securityHeaders() {
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  };
}

export function checkOrigin({ publicUrl, port }) {
  const allowed = new Set([publicUrl, `http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin ? allowed.has(origin) : req.get('x-requested-with') === 'zalo-dashboard') return next();
    return res.status(403).json({ ok: false, error: 'Yêu cầu không hợp lệ — tải lại trang rồi thử lại.' });
  };
}

export function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(res, req, token) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: 7 * 24 * 3600_000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function sessionMiddleware({ sessions, users }) {
  return (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const session = token ? sessions.get(token) : null;
    const user = session ? users.get(session.username) : null;
    req.sessionToken = token;
    req.user = user && !user.disabled ? { username: user.username, role: user.role, zaloUid: user.zaloUid } : null;
    next();
  };
}

export const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ ok: false, error: 'Phiên đăng nhập đã hết — đăng nhập lại.' }));

export const requireRole = (role) => (req, res, next) => (req.user?.role === role ? next()
  : res.status(403).json({ ok: false, error: 'Tài khoản của bạn không có quyền làm việc này.' }));
```

`routes/auth.js`:

```js
import express from 'express';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../lib/http-guards.js';

export function authRoutes({ users, sessions, guard, setupToken, activity, sidecar }) {
  const r = express.Router();
  const keys = (req, username) => [`u:${String(username || '').toLowerCase()}`, `ip:${req.ip}`];
  const tooMany = (res, ms) => res.status(429).json({ ok: false, error: `Thử sai quá nhiều lần — đợi ${Math.ceil(ms / 60_000)} phút rồi thử lại.` });

  async function zaloReady() {
    try {
      const h = await sidecar.health();
      return h?.zalo?.status === 'logged-in' && !h?.zalo?.needsRelogin;
    } catch { return false; }
  }

  r.post('/auth/setup', (req, res) => {
    const { token, username, password, zaloUid = '' } = req.body || {};
    if (users.hasAdmin() || !setupToken.consume(String(token || ''))) {
      return res.status(403).json({ ok: false, error: 'Link thiết lập không còn hiệu lực — chạy "npm run dashboard:setup-link" để lấy link mới.' });
    }
    try {
      const user = users.create({ username, role: 'admin', zaloUid, password });
      setSessionCookie(res, req, sessions.create(user.username));
      activity.append({ actor: user.username, action: 'setup_admin' });
      res.json({ ok: true, user });
    } catch (err) { res.status(err.statusCode || 500).json({ ok: false, error: err.message }); }
  });

  r.post('/auth/start', async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const wait = guard.locked(keys(req, username));
    if (wait) return tooMany(res, wait);
    const user = users.get(username);
    if (user && !user.disabled && user.zaloUid && await zaloReady()) {
      const code = guard.issueCode(username);
      try {
        await sidecar.loginCode({ zaloUid: user.zaloUid, code });
        return res.json({ ok: true, methods: ['zalo'] });
      } catch { /* gửi không được — rơi xuống mật khẩu */ }
    }
    res.json({ ok: true, methods: ['password'] });
  });

  r.post('/auth/verify', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const k = keys(req, username);
    const wait = guard.locked(k);
    if (wait) return tooMany(res, wait);
    const { code, password } = req.body || {};
    const ok = code ? guard.verifyCode(username, String(code)) : users.verifyPassword(username, String(password || ''));
    const user = users.get(username);
    if (!ok || !user || user.disabled) {
      guard.fail(k);
      activity.append({ actor: username || '?', action: 'login', ok: false, detail: code ? 'mã Zalo' : 'mật khẩu' });
      return res.status(401).json({ ok: false, error: 'Tên đăng nhập, mã hoặc mật khẩu không đúng.' });
    }
    guard.succeed(k);
    setSessionCookie(res, req, sessions.create(username));
    activity.append({ actor: username, action: 'login', detail: code ? 'mã Zalo' : 'mật khẩu' });
    res.json({ ok: true });
  });

  r.post('/auth/logout', requireAuth, (req, res) => {
    sessions.destroy(req.sessionToken); clearSessionCookie(res); res.json({ ok: true });
  });
  r.post('/auth/logout-all', requireAuth, (req, res) => {
    sessions.destroyAll(req.user.username); clearSessionCookie(res);
    activity.append({ actor: req.user.username, action: 'logout_all' });
    res.json({ ok: true });
  });
  r.get('/me', requireAuth, (req, res) => res.json({ ok: true, user: req.user }));
  return r;
}
```

`app.js`:

```js
import express from 'express';
import { existsSync } from 'node:fs';
import { checkOrigin, securityHeaders, sessionMiddleware } from './lib/http-guards.js';
import { authRoutes } from './routes/auth.js';

export function createDashboardApp(deps) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', checkOrigin(deps.config));
  app.use('/api', sessionMiddleware(deps));
  app.use('/api', authRoutes(deps));
  // Các router khác được gắn thêm ở Task 6–8 theo cùng mẫu: app.use('/api', xxxRoutes(deps));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  if (deps.publicDir && existsSync(deps.publicDir)) app.use(express.static(deps.publicDir, { index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Không có đường dẫn này' }));
  app.use((err, req, res, next) => {
    console.error('[dashboard]', err);
    res.status(500).json({ ok: false, error: 'Lỗi bên trong dashboard — xem nhật ký dịch vụ.' });
  });
  return app;
}
```

- [ ] **Step 5: PASS** `node --test dashboard/` → **Commit** `feat(dashboard): app Express, bảo vệ HTTP, đăng nhập bằng mã Zalo hoặc mật khẩu`.

---

### Task 6: sidecar-client, `/api/status`, `/api/zalo/*`

**Files:**
- Create: `dashboard/lib/sidecar-client.js`, `dashboard/routes/status.js`, `dashboard/routes/zalo.js`
- Modify: `dashboard/app.js` (gắn hai router)
- Test: `dashboard/lib/sidecar-client.test.js`, `dashboard/routes/status.test.js`

**Interfaces:**
- `createSidecarClient({ baseUrl = 'http://127.0.0.1:3872', token, fetchImpl = fetch, timeoutMs = 4000 })` → `{ health(), qrStart(), qr(), logout(), send({threadId,threadType,text,actor}), loginCode({zaloUid,code}), groups() }`. Mạng hỏng/timeout → ném `SidecarDown` (class export, `name = 'SidecarDown'`); HTTP ≥ 400 → ném `Error(message từ body.error)` với `statusCode`.
- `GET /api/status` → `{ ok, sidecar: 'up'|'down', zalo: { status, displayName, listener, needsRelogin }, assistant: 'connected'|'disconnected'|'unknown', traffic: { lastInboundAtMs, lastOutboundAtMs }, lastError: { code, message, atMs }|null, telegramLinked: boolean }` — không bao giờ trả `userId`.

- [ ] **Step 1: Test sidecar-client** — dùng `fetchImpl` giả: trả `{ ok:true, health:{...} }` → `health()` trả object `health`; header `Authorization: Bearer tok` được gửi; `fetchImpl` ném `TypeError('fetch failed')` → `health()` reject với `err.name === 'SidecarDown'`; `fetchImpl` không trả lời trong `timeoutMs: 20` (Promise treo nhưng tôn trọng `signal`) → `SidecarDown`; trả status 502 body `{ok:false,error:'Zalo chưa đăng nhập'}` → reject `/Zalo chưa đăng nhập/` và `statusCode === 502`.

- [ ] **Step 2: FAIL → cài đặt:**

```js
export class SidecarDown extends Error {
  constructor(message = 'Không liên lạc được với kết nối Zalo') { super(message); this.name = 'SidecarDown'; }
}

export function createSidecarClient({ baseUrl = 'http://127.0.0.1:3872', token, fetchImpl = fetch, timeoutMs = 4000 }) {
  async function call(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/control${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) { throw new SidecarDown(); }
    let json = {};
    try { json = await res.json(); } catch { /* thân rỗng */ }
    if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Lỗi ${res.status}`), { statusCode: res.status });
    return json;
  }
  return {
    health: async () => (await call('/health')).health,
    qrStart: () => call('/qr/start', { method: 'POST' }),
    qr: async () => { const { status, image, user } = await call('/qr'); return { status, image, user }; },
    logout: () => call('/logout', { method: 'POST' }),
    send: async (m) => (await call('/send', { method: 'POST', body: m })).result,
    loginCode: (m) => call('/login-code', { method: 'POST', body: m }),
    groups: async () => (await call('/groups')).groups,
  };
}
```

- [ ] **Step 3: Test route** (`dashboard/routes/status.test.js`, dùng `makeDeps`, `startApp`, `loginAs`):

```js
test('trạng thái khi mọi thứ ổn', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/status', { cookie });
  assert.equal(res.json.sidecar, 'up');
  assert.equal(res.json.zalo.status, 'logged-in');
  assert.equal(res.json.assistant, 'connected');
  assert.equal(res.json.zalo.userId, undefined);
});

test('status khi sidecar không trả lời', async (t) => {
  const { SidecarDown } = await import('../lib/sidecar-client.js');
  const deps = makeDeps(t, { sidecar: fakeSidecar({ health: async () => { throw new SidecarDown(); } }) });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const res = await call('/api/status', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.sidecar, 'down');
  assert.equal(res.json.assistant, 'unknown');
});

test('chưa đăng nhập dashboard thì 401', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/zalo/qr')).status, 401);
});

test('QR: bắt đầu và đọc ảnh; đăng xuất Zalo ghi nhật ký', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/zalo/qr/start', { method: 'POST', cookie })).status, 200);
  assert.match((await call('/api/zalo/qr', { cookie })).json.image, /^data:image\/png/);
  assert.equal((await call('/api/zalo/logout', { method: 'POST', cookie })).status, 200);
  assert.ok(deps.activity.list({}).some((e) => e.action === 'zalo_logout' && e.actor === 'khach'));
});
```

- [ ] **Step 4: FAIL → cài đặt** `routes/status.js`:

```js
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';

export function statusRoutes({ sidecar, linker }) {
  const r = express.Router();
  r.get('/status', requireAuth, async (req, res) => {
    const telegramLinked = Boolean(linker?.isLinked(req.user.username));
    try {
      const h = await sidecar.health();
      res.json({
        ok: true, sidecar: 'up', telegramLinked,
        zalo: { status: h?.zalo?.status || 'idle', displayName: h?.zalo?.displayName || '', listener: h?.zalo?.listener || null, needsRelogin: Boolean(h?.zalo?.needsRelogin) },
        assistant: (h?.bridge?.attachedClients || 0) > 0 ? 'connected' : 'disconnected',
        traffic: { lastInboundAtMs: h?.traffic?.lastInboundAtMs || null, lastOutboundAtMs: h?.traffic?.lastOutboundAtMs || null },
        lastError: h?.lastError || null,
      });
    } catch (err) {
      res.json({ ok: true, sidecar: 'down', telegramLinked, zalo: { status: 'unknown', displayName: '', listener: null, needsRelogin: false },
        assistant: 'unknown', traffic: { lastInboundAtMs: null, lastOutboundAtMs: null }, lastError: null });
    }
  });
  return r;
}
```

`routes/zalo.js`:

```js
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';

export function zaloRoutes({ sidecar, activity }) {
  const r = express.Router();
  const fail = (res, err) => res.status(err.name === 'SidecarDown' ? 503 : (err.statusCode || 502))
    .json({ ok: false, error: err.name === 'SidecarDown' ? 'Kết nối Zalo đang tắt — đợi 1–2 phút để hệ thống tự bật lại, hoặc báo người cài đặt.' : err.message });
  r.post('/zalo/qr/start', requireAuth, async (req, res) => {
    try { await sidecar.qrStart(); activity.append({ actor: req.user.username, action: 'zalo_qr_start' }); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  r.get('/zalo/qr', requireAuth, async (req, res) => {
    try { res.json({ ok: true, ...(await sidecar.qr()) }); } catch (err) { fail(res, err); }
  });
  r.post('/zalo/logout', requireAuth, async (req, res) => {
    try { await sidecar.logout(); activity.append({ actor: req.user.username, action: 'zalo_logout' }); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  return r;
}
```

Trong `app.js` gắn `app.use('/api', statusRoutes(deps)); app.use('/api', zaloRoutes(deps));` ngay sau `authRoutes`. Lưu ý `/api/zalo/qr` trả `user` — `qr-login.js` lưu `user` là kết quả `fetchProfile` (đã bỏ số điện thoại theo test sẵn có của `auth.js`); route trả nguyên.

- [ ] **Step 5: PASS → Commit** `feat(dashboard): trạng thái hợp nhất và quét QR qua dashboard`.

---

### Task 7: Telegram — Bot API, nối người dùng, route

**Files:**
- Create: `dashboard/lib/telegram.js`, `dashboard/routes/telegram.js`
- Modify: `dashboard/app.js`
- Test: `dashboard/lib/telegram.test.js`, `dashboard/routes/telegram.test.js`

**Interfaces:**
- `createTelegramApi({ token, fetchImpl = fetch, base = 'https://api.telegram.org' })` → `{ getMe(), sendMessage(chatId, text), getUpdates({ offset, timeout }) }` (ném `Error` khi `ok:false`).
- `createTelegramLinker({ file, apiFactory = (token) => createTelegramApi({ token }), now = Date.now, codeTtlMs = 10 * 60_000 })` → `{ configured(): boolean, settings(): { botUsername, tokenMasked, linkedUsers: string[] }, setToken(token): Promise<{ botUsername }>, clearToken(), linkUrl(username): string, pollOnce(timeoutSec = 0): Promise<number /* số người vừa nối */>, isLinked(username): boolean, chatIds(): string[], sendTo(username, text), broadcast(text): Promise<void> }`.
- `telegram.json`: `{ token, botUsername, offset, links: { [username]: chatId }, pending: { [sha256(code)]: { username, expiresAt } } }`.
- `setToken` kiểm `getMe()` trước khi lưu; từ chối token trùng với `TELEGRAM_BOT_TOKEN` của Hermes (truyền vào qua `hermesTelegramToken`): ném lỗi "Token này đang dùng cho bot Telegram của trợ lý — tạo một bot riêng cho cảnh báo".
- Mặt nạ token: `123456:AB…` → `123456:•••••xyz` (giữ phần trước `:` và 3 ký tự cuối).

- [ ] **Step 1: Test linker** (`fetchImpl` giả theo đường dẫn `/bot<token>/<method>`):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramApi, createTelegramLinker } from './telegram.js';

function fakeBot() {
  const sent = []; let updates = [];
  const fetchImpl = async (url, opts) => {
    const method = url.split('/').pop();
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const reply = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });
    if (method === 'getMe') return reply({ username: 'canhbao_bot' });
    if (method === 'sendMessage') { sent.push(body); return reply({ message_id: 1 }); }
    if (method === 'getUpdates') { const u = updates.filter((x) => x.update_id >= (body.offset || 0)); return reply(u); }
    throw new Error(method);
  };
  return { sent, fetchImpl, push: (u) => { updates.push(u); } };
}

function mk(t, bot, clock = { t: 0 }, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'zd-tg-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'telegram.json');
  const linker = createTelegramLinker({ file, now: () => clock.t, apiFactory: (token) => createTelegramApi({ token, fetchImpl: bot.fetchImpl }), ...extra });
  return { linker, file };
}

test('lưu token sau khi kiểm getMe, che token khi đọc', async (t) => {
  const bot = fakeBot(); const { linker, file } = mk(t, bot);
  const r = await linker.setToken('123456:ABCDEFxyz');
  assert.equal(r.botUsername, 'canhbao_bot');
  assert.equal(linker.settings().tokenMasked, '123456:•••••xyz');
  assert.ok(readFileSync(file, 'utf8').includes('123456:ABCDEFxyz')); // lưu trên đĩa (quyền 600), không trả ra API
});

test('từ chối token trùng bot Telegram của trợ lý', async (t) => {
  const bot = fakeBot(); const { linker } = mk(t, bot, { t: 0 }, { hermesTelegramToken: '123456:ABCDEFxyz' });
  await assert.rejects(linker.setToken('123456:ABCDEFxyz'), /bot riêng/);
});

test('nối người dùng bằng /start <mã> dùng một lần', async (t) => {
  const bot = fakeBot(); const clock = { t: 0 }; const { linker } = mk(t, bot, clock);
  await linker.setToken('1:tok');
  const url = linker.linkUrl('khach');
  const code = new URL(url).searchParams.get('start');
  assert.match(url, /^https:\/\/t\.me\/canhbao_bot\?start=/);
  bot.push({ update_id: 10, message: { text: `/start ${code}`, chat: { id: 555 } } });
  assert.equal(await linker.pollOnce(), 1);
  assert.equal(linker.isLinked('khach'), true);
  bot.push({ update_id: 11, message: { text: `/start ${code}`, chat: { id: 999 } } });
  assert.equal(await linker.pollOnce(), 0); // mã đã dùng
  await linker.sendTo('khach', 'thử');
  assert.equal(bot.sent.at(-1).chat_id, 555);
});

test('mã nối hết hạn sau 10 phút', async (t) => {
  const bot = fakeBot(); const clock = { t: 0 }; const { linker } = mk(t, bot, clock);
  await linker.setToken('1:tok');
  const code = new URL(linker.linkUrl('anh')).searchParams.get('start');
  clock.t = 10 * 60_000 + 1;
  bot.push({ update_id: 1, message: { text: `/start ${code}`, chat: { id: 1 } } });
  assert.equal(await linker.pollOnce(), 0);
});
```

- [ ] **Step 2: FAIL → cài đặt** `telegram.js`:

```js
import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
export const maskToken = (tok) => { const [id, rest = ''] = String(tok || '').split(':'); return tok ? `${id}:•••••${rest.slice(-3)}` : ''; };

export function createTelegramApi({ token, fetchImpl = fetch, base = 'https://api.telegram.org' }) {
  async function call(method, body = {}) {
    const res = await fetchImpl(`${base}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(((body.timeout || 0) + 15) * 1000),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || `Telegram lỗi ${method}`);
    return json.result;
  }
  return {
    getMe: () => call('getMe'),
    sendMessage: (chatId, text) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }),
    getUpdates: ({ offset = 0, timeout = 0 } = {}) => call('getUpdates', { offset, timeout, allowed_updates: ['message'] }),
  };
}

export function createTelegramLinker({ file, apiFactory = (token) => createTelegramApi({ token }), now = Date.now, codeTtlMs = 10 * 60_000, hermesTelegramToken = '' }) {
  const load = () => readJson(file, { token: '', botUsername: '', offset: 0, links: {}, pending: {} });
  const save = (d) => writeJsonAtomic(file, d);
  const api = () => { const d = load(); return d.token ? apiFactory(d.token) : null; };

  return {
    configured: () => Boolean(load().token),
    settings() { const d = load(); return { botUsername: d.botUsername, tokenMasked: maskToken(d.token), linkedUsers: Object.keys(d.links) }; },
    async setToken(token) {
      const tok = String(token || '').trim();
      if (!/^\d+:[\w-]{3,}$/.test(tok)) throw Object.assign(new Error('Token không đúng dạng — lấy token từ @BotFather.'), { statusCode: 400 });
      if (hermesTelegramToken && tok === hermesTelegramToken) {
        throw Object.assign(new Error('Token này đang dùng cho bot Telegram của trợ lý — tạo một bot riêng cho cảnh báo.'), { statusCode: 400 });
      }
      const me = await apiFactory(tok).getMe();
      const d = load();
      Object.assign(d, { token: tok, botUsername: me.username, offset: 0, links: d.token === tok ? d.links : {}, pending: {} });
      save(d);
      return { botUsername: me.username };
    },
    clearToken() { save({ token: '', botUsername: '', offset: 0, links: {}, pending: {} }); },
    linkUrl(username) {
      const d = load();
      if (!d.token) throw Object.assign(new Error('Chưa cài bot Telegram cảnh báo — báo người cài đặt.'), { statusCode: 409 });
      const code = randomBytes(12).toString('base64url');
      const t = now();
      for (const [k, p] of Object.entries(d.pending)) if (p.expiresAt < t) delete d.pending[k];
      d.pending[sha(code)] = { username, expiresAt: t + codeTtlMs };
      save(d);
      return `https://t.me/${d.botUsername}?start=${code}`;
    },
    async pollOnce(timeoutSec = 0) {
      const tg = api(); if (!tg) return 0;
      const updates = await tg.getUpdates({ offset: load().offset, timeout: timeoutSec });
      const d = load();
      let linked = 0;
      for (const u of updates) {
        d.offset = Math.max(d.offset, u.update_id + 1);
        const m = /^\/start\s+(\S+)/.exec(u.message?.text || '');
        const p = m && d.pending[sha(m[1])];
        if (p && p.expiresAt >= now()) {
          d.links[p.username] = String(u.message.chat.id);
          delete d.pending[sha(m[1])];
          linked += 1;
          await tg.sendMessage(u.message.chat.id, `Đã nối cảnh báo cho tài khoản "${p.username}". Khi bot gặp sự cố, bạn sẽ nhận tin ở đây.`).catch(() => {});
        }
      }
      save(d);
      return linked;
    },
    isLinked: (username) => Boolean(load().links[username]),
    chatIds: () => Object.values(load().links),
    async sendTo(username, text) { const tg = api(); const chat = load().links[username]; if (!tg || !chat) throw new Error('Chưa nối Telegram'); await tg.sendMessage(chat, text); },
    async broadcast(text) { const tg = api(); if (!tg) return; for (const chat of Object.values(load().links)) await tg.sendMessage(chat, text).catch((e) => console.warn('[telegram]', e.message)); },
  };
}
```

- [ ] **Step 3: Route** `routes/telegram.js` + test (`/api/telegram/link` trả `{url}` cho người đang đăng nhập; `/api/telegram/test` 409 khi chưa nối; `/api/admin/telegram` GET trả `tokenMasked` không bao giờ trả `token`; PUT với vai trò owner → 403; PUT admin gọi `setToken`):

```js
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function telegramRoutes({ linker, activity }) {
  const r = express.Router();
  const send = (res, err) => res.status(err.statusCode || 502).json({ ok: false, error: err.message });
  r.post('/telegram/link', requireAuth, (req, res) => {
    try { res.json({ ok: true, url: linker.linkUrl(req.user.username) }); } catch (err) { send(res, err); }
  });
  r.post('/telegram/test', requireAuth, async (req, res) => {
    if (!linker.isLinked(req.user.username)) return res.status(409).json({ ok: false, error: 'Bạn chưa nối Telegram — bấm "Nối Telegram của tôi" trước.' });
    try { await linker.sendTo(req.user.username, '✅ Tin thử từ dashboard — cảnh báo đang hoạt động.'); res.json({ ok: true }); } catch (err) { send(res, err); }
  });
  r.get('/admin/telegram', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true, ...linker.settings() }));
  r.put('/admin/telegram', requireAuth, requireRole('admin'), async (req, res) => {
    try {
      const out = req.body?.token ? await linker.setToken(req.body.token) : (linker.clearToken(), {});
      activity.append({ actor: req.user.username, action: 'telegram_settings', detail: out.botUsername ? `@${out.botUsername}` : 'gỡ bot' });
      res.json({ ok: true, ...linker.settings() });
    } catch (err) { send(res, err); }
  });
  return r;
}
```

Gắn trong `app.js`: `if (deps.linker) app.use('/api', telegramRoutes(deps));`. Trong `test-helpers.js` `makeDeps` thêm `linker` dựng bằng `createTelegramLinker` với `apiFactory` giả (từ `fakeBot` — chuyển `fakeBot` sang `test-helpers.js` để dùng chung).

- [ ] **Step 4: PASS → Commit** `feat(dashboard): cảnh báo Telegram — cài bot, nối người dùng bằng mã /start`.

---

### Task 8: Canh gác + khởi động lại sidecar

**Files:**
- Create: `dashboard/lib/watchdog.js`, `dashboard/lib/restart.js`
- Test: `dashboard/lib/watchdog.test.js`, `dashboard/lib/restart.test.js`

**Interfaces:**
- `createWatchdog({ sidecar, notify(text): Promise, restartSidecar(): Promise, stateFile, publicUrl, now = Date.now, zaloAfterMs = 120_000, sidecarAfterMs = 120_000, assistantAfterMs = 300_000, remindAfterMs = 6 * 3600_000, botName = () => 'Bot Zalo' })` → `{ tick(): Promise<void>, incidents(): object }`.
- Sự cố `sidecar` (health ném `SidecarDown`), `zalo` (`needsRelogin` hoặc `zalo.status !== 'logged-in'`), `assistant` (`bridge.attachedClients === 0`). Khi sidecar down: không xét `zalo`/`assistant` (giữ nguyên trạng thái cũ của chúng).
- `watchdog.json`: `{ [kind]: { since, alertedAt, restartTried } }`.
- `makeRestartSidecar({ cmd, platform = process.platform, sidecarRoot, spawnImpl = spawn })` → `async () => void`: có `cmd` → `spawnImpl(cmd, { shell: true, windowsHide: true, detached: true, stdio: 'ignore' }).unref()`; Linux không `cmd` → `spawnImpl('systemctl', ['restart', 'zalo-bridge'], …)`; Windows không `cmd` → `spawnImpl(process.execPath, ['server.js'], { cwd: sidecarRoot, detached: true, windowsHide: true, stdio: 'ignore' }).unref()`.

- [ ] **Step 1: Test watchdog**

```js
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
  clock.t = 160_000; await wd.tick();                       // cho sidecar thời gian bật lại
  assert.equal(sent.length, 0);
  clock.t = 242_000; await wd.tick();                       // vẫn hỏng sau thêm 2 phút → báo
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
```

- [ ] **Step 2: FAIL → cài đặt** `watchdog.js`:

```js
import { readJson, writeJsonAtomic } from './json-store.js';

export function createWatchdog({
  sidecar, notify, restartSidecar, stateFile, publicUrl, now = Date.now,
  zaloAfterMs = 120_000, sidecarAfterMs = 120_000, assistantAfterMs = 300_000, remindAfterMs = 6 * 3600_000,
  botName = () => 'Bot Zalo',
}) {
  let state = readJson(stateFile, {});
  const save = () => writeJsonAtomic(stateFile, state);
  const messages = {
    sidecar: (n) => `⚠️ ${n}: kết nối Zalo không chạy, đã thử tự bật lại nhưng chưa được. Báo người cài đặt kiểm tra máy chủ.\n${publicUrl}`,
    zalo: (n) => `⚠️ ${n} đang mất kết nối Zalo — cần quét mã QR đăng nhập lại.\nMở trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    assistant: (n) => `⚠️ ${n}: Trợ lý không phản hồi — tin nhắn Zalo đang không được trả lời.\n${publicUrl}`,
  };
  const recovered = { sidecar: 'kết nối Zalo', zalo: 'Zalo', assistant: 'Trợ lý' };
  const threshold = { sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs };

  async function update(kind, active) {
    const t = now();
    const s = state[kind];
    if (!active) {
      if (s) {
        delete state[kind]; save();
        if (s.alertedAt) await notify(`✅ ${botName()}: ${recovered[kind]} đã hoạt động lại.`).catch(() => {});
      }
      return;
    }
    if (!s) { state[kind] = { since: t, alertedAt: 0, restartTried: false }; save(); return; }
    if (t - s.since < threshold[kind]) return;
    if (kind === 'sidecar' && !s.restartTried) {
      s.restartTried = true; s.since = t; save();
      await restartSidecar().catch((e) => console.warn('[watchdog] không khởi động lại được:', e.message));
      return;
    }
    if (!s.alertedAt || t - s.alertedAt >= remindAfterMs) {
      s.alertedAt = t; save();
      await notify(messages[kind](botName())).catch((e) => console.warn('[watchdog] không gửi được cảnh báo:', e.message));
    }
  }

  return {
    async tick() {
      let health;
      try { health = await sidecar.health(); } catch (err) {
        if (err?.name !== 'SidecarDown') throw err;
        await update('sidecar', true);
        return;
      }
      await update('sidecar', false);
      await update('zalo', Boolean(health?.zalo?.needsRelogin) || health?.zalo?.status !== 'logged-in');
      await update('assistant', (health?.bridge?.attachedClients || 0) === 0);
    },
    incidents: () => structuredClone(state),
  };
}
```

Thiết kế: sau khi thử khởi động lại, `since` đặt lại để sidecar có đủ `sidecarAfterMs` bật lên trước khi báo.

- [ ] **Step 3: Test + cài đặt** `restart.js` (test: `spawnImpl` giả ghi lại tham số; Linux không cmd → `('systemctl', ['restart','zalo-bridge'])`; có cmd → `(cmd, {shell:true})`; Windows → `(process.execPath, ['server.js'], {cwd: sidecarRoot})`; đối tượng trả về có `unref` được gọi):

```js
import { spawn } from 'node:child_process';

export function makeRestartSidecar({ cmd, platform = process.platform, sidecarRoot, spawnImpl = spawn }) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  return async () => {
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true });
    else if (platform === 'win32') child = spawnImpl(process.execPath, ['server.js'], { ...opts, cwd: sidecarRoot });
    else child = spawnImpl('systemctl', ['restart', 'zalo-bridge'], opts);
    child.unref?.();
  };
}
```

- [ ] **Step 4: PASS → Commit** `feat(dashboard): canh gác sự cố, tự khởi động lại kết nối Zalo, cảnh báo Telegram`.

---

### Task 9: Quản lý người dùng (Quản trị) + khởi động lại trợ lý + CLI

**Files:**
- Create: `dashboard/routes/admin.js`, `dashboard/cli/setup-link.js`, `dashboard/cli/reset-admin.js`, `dashboard/lib/restart-assistant.js`
- Modify: `dashboard/app.js`, `package.json` (scripts)
- Test: `dashboard/routes/admin.test.js`, `dashboard/lib/restart-assistant.test.js`

**Interfaces:**
- `GET /api/admin/users` → `{ users: PublicUser[] }`; `POST /api/admin/users` `{username, role, zaloUid, password?}`; `PATCH /api/admin/users/:username` `{role?, zaloUid?, disabled?, password?}` (đặt `password` → `setPassword`; khoá tài khoản → `sessions.destroyAll`); không cho Quản trị tự khoá hay tự hạ vai trò của chính mình (400 "Không thể tự khoá/hạ quyền tài khoản đang dùng"); không cho khoá Quản trị cuối cùng.
- `POST /api/admin/restart-assistant` → gọi `deps.restartAssistant()`.
- `makeRestartAssistant({ platform = process.platform, hermesHome, spawnImpl = spawn })`: Linux → `systemctl restart hermes-gateway`; Windows → `hermes gateway stop` rồi chạy lại `Hermes-Online.vbs` nếu có tại `<HERMES_HOME>/Hermes-Online.vbs`, không có thì `hermes gateway run` tách rời. Biến `ZALO_ASSISTANT_RESTART_CMD` ghi đè (truyền qua `config.assistantRestartCmd` — thêm vào `loadDashboardConfig`, test bổ sung).
- `npm run dashboard` → `node dashboard/server.js`; `npm run dashboard:setup-link` → in link thiết lập (chỉ khi chưa có Quản trị; đã có thì in "đã có Quản trị — dùng dashboard:reset-admin"); `npm run dashboard:reset-admin -- --username anh --password <mới>` → đặt mật khẩu, mở khoá, gỡ mọi phiên.

- [ ] **Step 1: Test admin routes**

```js
test('Chủ bot không gọi được route Quản trị', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  for (const [method, path] of [['GET', '/api/admin/users'], ['POST', '/api/admin/users'], ['PATCH', '/api/admin/users/khach'], ['POST', '/api/admin/restart-assistant'], ['GET', '/api/admin/telegram']]) {
    assert.equal((await call(path, { method, cookie, body: {} })).status, 403, `${method} ${path}`);
  }
});

test('Quản trị tạo Chủ bot, khoá thì phiên của người đó mất', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/users', { method: 'POST', cookie: admin, body: { username: 'khach', role: 'owner', password: 'matkhau-dai' } })).status, 200);
  const khach = (await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'matkhau-dai' } })).cookie;
  await call('/api/admin/users/khach', { method: 'PATCH', cookie: admin, body: { disabled: true } });
  assert.equal((await call('/api/me', { cookie: khach })).status, 401);
});

test('không tự khoá, không khoá Quản trị cuối cùng', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/admin/users/anh', { method: 'PATCH', cookie: admin, body: { disabled: true } })).status, 400);
  assert.equal((await call('/api/admin/users/anh', { method: 'PATCH', cookie: admin, body: { role: 'owner' } })).status, 400);
});
```

- [ ] **Step 2: FAIL → cài đặt** `routes/admin.js`:

```js
import express from 'express';
import { requireAuth, requireRole } from '../lib/http-guards.js';

export function adminRoutes({ users, sessions, activity, restartAssistant }) {
  const r = express.Router();
  const guard = [requireAuth, requireRole('admin')];
  const send = (res, err) => res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  r.get('/admin/users', ...guard, (req, res) => res.json({ ok: true, users: users.list() }));
  r.post('/admin/users', ...guard, (req, res) => {
    try {
      const u = users.create(req.body || {});
      activity.append({ actor: req.user.username, action: 'user_create', detail: `${u.username} (${u.role})` });
      res.json({ ok: true, user: u });
    } catch (err) { send(res, err); }
  });
  r.patch('/admin/users/:username', ...guard, (req, res) => {
    try {
      const target = req.params.username;
      const { role, zaloUid, disabled, password } = req.body || {};
      const self = target === req.user.username;
      if (self && (disabled === true || (role && role !== 'admin'))) {
        throw Object.assign(new Error('Không thể tự khoá hoặc tự hạ quyền tài khoản đang dùng.'), { statusCode: 400 });
      }
      const admins = users.list().filter((u) => u.role === 'admin' && !u.disabled);
      const target0 = users.get(target);
      if (target0?.role === 'admin' && admins.length <= 1 && (disabled === true || (role && role !== 'admin'))) {
        throw Object.assign(new Error('Phải còn ít nhất một Quản trị.'), { statusCode: 400 });
      }
      const u = users.update(target, { role, zaloUid, disabled });
      if (password) users.setPassword(target, password);
      if (disabled === true || password) sessions.destroyAll(target);
      activity.append({ actor: req.user.username, action: 'user_update', detail: target });
      res.json({ ok: true, user: u });
    } catch (err) { send(res, err); }
  });
  r.post('/admin/restart-assistant', ...guard, async (req, res) => {
    try { await restartAssistant(); activity.append({ actor: req.user.username, action: 'restart_assistant' }); res.json({ ok: true }); } catch (err) { send(res, err); }
  });
  return r;
}
```

Gắn `app.use('/api', adminRoutes(deps));` (thêm `restartAssistant: async () => {}` vào `makeDeps`).

- [ ] **Step 3: `restart-assistant.js`** + test (cùng mẫu `makeRestartSidecar`):

```js
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function makeRestartAssistant({ cmd, platform = process.platform, hermesHome, spawnImpl = spawn }) {
  const opts = { detached: true, windowsHide: true, stdio: 'ignore' };
  return async () => {
    let child;
    if (cmd) child = spawnImpl(cmd, { ...opts, shell: true });
    else if (platform === 'win32') {
      const vbs = join(hermesHome, 'Hermes-Online.vbs');
      const script = existsSync(vbs) ? `hermes gateway stop & cscript //nologo "${vbs}"` : 'hermes gateway stop & start "" /b hermes gateway run';
      child = spawnImpl(script, { ...opts, shell: true });
    } else child = spawnImpl('systemctl', ['restart', 'hermes-gateway'], opts);
    child.unref?.();
  };
}
```

- [ ] **Step 4: CLI** `dashboard/cli/setup-link.js`:

```js
#!/usr/bin/env node
// In link thiết lập tài khoản Quản trị đầu tiên (dùng một lần, 24 giờ).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadRepoEnv, loadHermesEnv } from '../../scripts/setup-env.js';
import { resolveDashboardPaths } from '../lib/paths.js';
import { loadDashboardConfig } from '../lib/config.js';
import { createUserStore } from '../lib/users.js';
import { createSetupToken } from '../lib/setup-token.js';

const sidecarRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (existsSync(join(sidecarRoot, '.env'))) loadRepoEnv(join(sidecarRoot, '.env'));
loadHermesEnv();
const paths = resolveDashboardPaths({ sidecarRoot });
const config = loadDashboardConfig();
if (createUserStore(paths.usersFile).hasAdmin()) {
  console.log('Đã có tài khoản Quản trị. Quên mật khẩu thì chạy: npm run dashboard:reset-admin -- --username <tên> --password <mật khẩu mới>');
} else {
  const token = createSetupToken(paths.setupFile).issue();
  console.log(`Mở link sau trong 24 giờ để tạo tài khoản Quản trị:\n${config.publicUrl}/#/setup/${token}`);
}
```

`dashboard/cli/reset-admin.js`: cùng phần đầu; đọc `--username`, `--password` từ `process.argv`; thiếu → in cách dùng, `exitCode = 1`; không có người dùng → tạo Quản trị mới với tên đó; có → `setPassword`, `update({ disabled: false, role: 'admin' })`, `createSessionStore(paths.sessionsFile).destroyAll(username)`; in "Đã đặt lại".

`package.json` scripts thêm:

```json
"dashboard": "node dashboard/server.js",
"dashboard:setup-link": "node dashboard/cli/setup-link.js",
"dashboard:reset-admin": "node dashboard/cli/reset-admin.js"
```

- [ ] **Step 5: PASS → Commit** `feat(dashboard): quản lý người dùng, khởi động lại trợ lý, lệnh thiết lập và đặt lại Quản trị`.

---

### Task 10: `dashboard/server.js` — điểm chạy

**Files:**
- Create: `dashboard/server.js`
- Test: `dashboard/server.test.js`

**Interfaces:**
- Chạy trực tiếp: nạp `.env` sidecar + Hermes; dựng deps; `listen(config.port, '127.0.0.1')`; vòng `watchdog.tick()` 30 s; vòng `linker.pollOnce(25)` liên tục (long-poll, lỗi thì nghỉ 10 s); tên bot cho cảnh báo = `displayName` gần nhất từ health, dự phòng `'Bot Zalo'`.
- Xuất `buildDeps({ env, sidecarRoot })` để test dựng được mà không `listen`.
- Đọc `TELEGRAM_BOT_TOKEN` của Hermes từ `process.env` (đã nạp qua `loadHermesEnv`) truyền vào `hermesTelegramToken`.

- [ ] **Step 1: Test** — `buildDeps({ env: { HERMES_HOME: <tmp>, ZALO_BRIDGE_TOKEN: 'x'.repeat(32) }, sidecarRoot: <tmp2> })` trả đủ khoá `config, users, sessions, guard, setupToken, activity, sidecar, linker, watchdog, restartAssistant, publicDir`; `createDashboardApp(deps)` lắng nghe cổng 0 và `GET /healthz` → `{ok:true}`; thiếu `ZALO_BRIDGE_TOKEN` → ném lỗi chứa `ZALO_BRIDGE_TOKEN`.

- [ ] **Step 2: Cài đặt:**

```js
#!/usr/bin/env node
/**
 * Dashboard quản trị Zalo — tiến trình riêng. Sống độc lập với sidecar và Hermes
 * để vẫn báo lỗi và cho quét QR đúng lúc các phần kia hỏng.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRepoEnv, loadHermesEnv } from '../scripts/setup-env.js';
import { createDashboardApp } from './app.js';
import { resolveDashboardPaths } from './lib/paths.js';
import { loadDashboardConfig } from './lib/config.js';
import { createUserStore } from './lib/users.js';
import { createSessionStore } from './lib/sessions.js';
import { createLoginGuard } from './lib/login-guard.js';
import { createSetupToken } from './lib/setup-token.js';
import { createActivityLog } from './lib/activity-log.js';
import { createSidecarClient } from './lib/sidecar-client.js';
import { createTelegramLinker } from './lib/telegram.js';
import { createWatchdog } from './lib/watchdog.js';
import { makeRestartSidecar } from './lib/restart.js';
import { makeRestartAssistant } from './lib/restart-assistant.js';

const here = dirname(fileURLToPath(import.meta.url));

export function buildDeps({ env = process.env, sidecarRoot = join(here, '..') } = {}) {
  if (!env.ZALO_BRIDGE_TOKEN) throw new Error('Thiếu ZALO_BRIDGE_TOKEN trong .env của sidecar — chạy lại "npm run install:hermes".');
  const paths = resolveDashboardPaths({ env, sidecarRoot });
  const config = loadDashboardConfig(env);
  const sidecar = createSidecarClient({ token: env.ZALO_BRIDGE_TOKEN, baseUrl: `http://127.0.0.1:${Number(env.ZCA_PORT) || 3872}` });
  const linker = createTelegramLinker({ file: paths.telegramFile, hermesTelegramToken: String(env.TELEGRAM_BOT_TOKEN || '').trim() });
  let botName = 'Bot Zalo';
  const watchedSidecar = { health: async () => { const h = await sidecar.health(); if (h?.zalo?.displayName) botName = h.zalo.displayName; return h; } };
  return {
    paths, config, sidecar, linker,
    users: createUserStore(paths.usersFile),
    sessions: createSessionStore(paths.sessionsFile),
    guard: createLoginGuard(),
    setupToken: createSetupToken(paths.setupFile),
    activity: createActivityLog(paths.activityFile),
    watchdog: createWatchdog({
      sidecar: watchedSidecar, notify: (text) => linker.broadcast(text),
      restartSidecar: makeRestartSidecar({ cmd: config.restartCmd, sidecarRoot: paths.sidecarRoot }),
      stateFile: paths.watchdogFile, publicUrl: config.publicUrl, botName: () => botName,
    }),
    restartAssistant: makeRestartAssistant({ cmd: config.assistantRestartCmd, hermesHome: paths.hermesHome }),
    publicDir: join(here, 'public'),
  };
}

async function main() {
  const sidecarRoot = join(here, '..');
  if (existsSync(join(sidecarRoot, '.env'))) loadRepoEnv(join(sidecarRoot, '.env'));
  loadHermesEnv();
  const deps = buildDeps({ sidecarRoot });
  const app = createDashboardApp(deps);
  app.listen(deps.config.port, '127.0.0.1', () => console.log(`[dashboard] đang chạy tại ${deps.config.publicUrl} (127.0.0.1:${deps.config.port})`));
  const tick = () => deps.watchdog.tick().catch((e) => console.warn('[watchdog]', e.message));
  setInterval(tick, 30_000); tick();
  (async function poll() {
    for (;;) {
      if (!deps.linker.configured()) { await new Promise((r) => setTimeout(r, 15_000)); continue; }
      try { await deps.linker.pollOnce(25); } catch (e) { console.warn('[telegram]', e.message); await new Promise((r) => setTimeout(r, 10_000)); }
    }
  })();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error('[dashboard]', e.message); process.exitCode = 1; });
```

Thêm `assistantRestartCmd: String(env.ZALO_ASSISTANT_RESTART_CMD || '').trim() || null` vào `loadDashboardConfig` và sửa test Task 3 (giá trị mặc định có thêm khoá `assistantRestartCmd: null`).

- [ ] **Step 3: PASS → Commit** `feat(dashboard): điểm chạy dịch vụ — canh gác 30 giây, nhận tin Telegram`.

---

### Task 11: Giao diện — khung, đăng nhập, Tổng quan, Tài khoản Zalo, Người dùng, Cảnh báo

**Files:**
- Create: `dashboard/public/index.html`, `dashboard/public/style.css`, `dashboard/public/app.js`, `dashboard/public/api.js`, `dashboard/public/views/login.js`, `views/setup.js`, `views/shell.js`, `views/overview.js`, `views/zalo.js`, `views/users.js`, `views/alerts.js`, `views/profile.js`, `dashboard/public/vendor/preact.mjs`, `vendor/hooks.mjs`, `vendor/htm.mjs`, `dashboard/public/vendor/LICENSES.md`
- Test: kiểm tay (spec §13) + `dashboard/public/public.test.js` (chỉ kiểm tĩnh: mọi `import` trong `public/**/*.js` trỏ tới tệp tồn tại; `index.html` không tải gì từ ngoài `'self'`)

**Interfaces:**
- `api.js`: `export async function api(path, { method = 'GET', body } = {})` → JSON; luôn gửi `X-Requested-With: zalo-dashboard`, `credentials: 'same-origin'`; 401 → phát sự kiện `window.dispatchEvent(new Event('zd:logout'))` rồi ném.
- Định tuyến bằng hash: `#/login`, `#/setup/<token>`, `#/` (Tổng quan), `#/zalo`, `#/users` (admin), `#/alerts` (admin), `#/profile`.
- Dải trạng thái dính: poll `/api/status` 3 s; đỏ khi `sidecar==='down'` hoặc `zalo.needsRelogin` hoặc `zalo.status!=='logged-in'`, có nút "Quét mã đăng nhập lại" → `#/zalo`.
- `#/zalo`: khi chưa đăng nhập → nút "Hiện mã QR" gọi `POST /api/zalo/qr/start`, rồi poll `/api/zalo/qr` 1 s; hiện ảnh; `status==='logged-in'` → thông báo thành công và chuyển `#/`.

- [ ] **Step 1: Nhúng vendor** — lấy tệp ESM từ gói npm (không thêm vào dependencies):

```bash
cd dashboard/public/vendor
npm pack preact@10 htm@3 --silent
tar -xzf preact-10.*.tgz package/dist/preact.module.js package/hooks/dist/hooks.module.js package/LICENSE
cp package/dist/preact.module.js preact.mjs && cp package/hooks/dist/hooks.module.js hooks.mjs && cp package/LICENSE LICENSE-preact && rm -rf package preact-10.*.tgz
tar -xzf htm-3.*.tgz package/dist/htm.module.js package/LICENSE
cp package/dist/htm.module.js htm.mjs && cp package/LICENSE LICENSE-htm && rm -rf package htm-3.*.tgz
sed -i 's#from"preact"#from"./preact.mjs"#; s#from "preact"#from "./preact.mjs"#' hooks.mjs
```

Ghi `LICENSES.md` nêu nguồn và phiên bản (MIT). Kiểm `grep -n "preact" hooks.mjs` chỉ còn `./preact.mjs`.

- [ ] **Step 2: Test tĩnh** `public.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

test('mọi import tương đối trong giao diện đều trỏ tới tệp có thật', () => {
  for (const f of files(root).filter((x) => /\.m?js$/.test(x) && !x.endsWith('.test.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      assert.ok(existsSync(resolve(dirname(f), m[1])), `${f} → ${m[1]}`);
    }
  }
});

test('index.html không tải tài nguyên từ Internet', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
});
```

- [ ] **Step 3: `index.html`:**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard Zalo</title>
  <link rel="stylesheet" href="style.css">
  <script type="module" src="app.js"></script>
</head>
<body><div id="app"></div></body>
</html>
```

(CSP `script-src 'self'` cho phép `app.js` vì cùng nguồn; không có script nội tuyến, không importmap — mọi import dùng đường dẫn tương đối `./vendor/preact.mjs`.)

- [ ] **Step 4: `api.js`, `app.js` (định tuyến, nạp `/api/me`, `/api/brand` dự phòng tên "Dashboard Zalo"), `views/*.js`** — viết bằng `htm` gắn `preact`:

```js
// api.js
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zalo-dashboard' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* không phải JSON */ }
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('zd:logout'));
  if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Lỗi ${res.status}`), { status: res.status });
  return json;
}
```

```js
// app.js
import { h, render } from './vendor/preact.mjs';
import { useEffect, useState } from './vendor/hooks.mjs';
import htm from './vendor/htm.mjs';
import { api } from './api.js';
import { Login } from './views/login.js';
import { Setup } from './views/setup.js';
import { Shell } from './views/shell.js';

export const html = htm.bind(h);
const route = () => location.hash.replace(/^#/, '') || '/';

function App() {
  const [path, setPath] = useState(route());
  const [me, setMe] = useState(undefined); // undefined = đang tải, null = chưa đăng nhập
  useEffect(() => {
    const onHash = () => setPath(route());
    const onLogout = () => setMe(null);
    addEventListener('hashchange', onHash); addEventListener('zd:logout', onLogout);
    api('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
    return () => { removeEventListener('hashchange', onHash); removeEventListener('zd:logout', onLogout); };
  }, []);
  if (path.startsWith('/setup/')) return html`<${Setup} token=${path.slice(7)} onDone=${(u) => { setMe(u); location.hash = '#/'; }} />`;
  if (me === undefined) return html`<div class="center muted">Đang tải…</div>`;
  if (!me) return html`<${Login} onDone=${() => api('/api/me').then((r) => { setMe(r.user); location.hash = '#/'; })} />`;
  return html`<${Shell} me=${me} path=${path} />`;
}

render(html`<${App} />`, document.getElementById('app'));
```

`views/shell.js`: thanh bên chia nhóm theo spec §9 (chỉ mục đã có ở GĐ1: Tổng quan, Tài khoản Zalo, và nhóm QUẢN TRỊ: Người dùng, Cảnh báo Telegram khi `me.role==='admin'`; mục "Tài khoản của tôi" ở chân thanh bên); dải trạng thái dính (poll 3 s); vùng nội dung chọn view theo `path`. Mỗi view một tệp, nhận `{ me, status }`:

- `overview.js` — ba thẻ (Zalo, Trợ lý, Cảnh báo Telegram) với câu tiếng Việt: `logged-in` → "Đang hoạt động — <tên bot>"; `needsRelogin` → "Bị đăng xuất — cần quét QR lại"; `sidecar down` → "Kết nối Zalo đang tắt — hệ thống sẽ tự bật lại trong ít phút"; trợ lý `connected` / `disconnected` ("Trợ lý chưa phản hồi — báo người cài đặt" + với admin nút "Khởi động lại trợ lý"); "Nhận tin lần cuối / Gửi lần cuối" định dạng `Intl.DateTimeFormat('vi-VN', { dateStyle:'short', timeStyle:'short' })`; lỗi gần nhất `lastError.message`.
- `zalo.js` — đã đăng nhập: tên bot + nút "Đăng xuất Zalo" (hộp xác nhận `confirm()` "Bot sẽ ngừng trả lời tới khi quét QR lại. Tiếp tục?"); chưa: lời nhắc điện thoại + nút "Hiện mã QR" + ảnh QR + đếm ngược 60 s (hết thì gọi lại `qr/start`).
- `login.js` — bước 1 tên đăng nhập → `POST /api/auth/start`; `methods` có `zalo` → ô nhập 6 số "Mã đã gửi qua Zalo của bạn" + link "Dùng mật khẩu"; ngược lại ô mật khẩu; lỗi hiện dưới ô.
- `setup.js` — tên, UID Zalo, mật khẩu (2 lần) → `POST /api/auth/setup`.
- `users.js` (admin) — bảng người dùng, form thêm (tên, vai trò, UID, mật khẩu), nút Khoá/Mở khoá, Đặt lại mật khẩu (`prompt`).
- `alerts.js` (admin) — token che, ô nhập token mới + Lưu, "@botUsername", danh sách người đã nối.
- `profile.js` — "Nối Telegram của tôi" (mở `url` trả về trong tab mới), "Gửi thử", "Đăng xuất", "Đăng xuất mọi nơi".

- [ ] **Step 5: `style.css`** — biến màu trên `:root` (`--brand: #0f766e` mặc định, `--danger`, `--warn`, `--ok`, `--bg`, `--card`, `--border`, `--text`, `--muted`), bố cục thanh bên 240 px + nội dung; dưới 760 px thanh bên thành thanh trên cuộn ngang; dải trạng thái `position: sticky; top: 0`; nút, thẻ, bảng, ô nhập có `:focus-visible`.

- [ ] **Step 6: Gắn tĩnh** — `createDashboardApp` đã phục vụ `deps.publicDir`; `buildDeps` trỏ `dashboard/public`. Chạy `npm run test:js` → PASS.

- [ ] **Step 7: Kiểm tay trên máy local** (tắt `ELECTRON_RUN_AS_NODE` không liên quan) — chạy `node dashboard/server.js` với `.env` thật của Lăng Tiêu, `npm run dashboard:setup-link`, mở link: tạo Quản trị → thấy Tổng quan xanh → `#/zalo` thấy "Đang hoạt động" → tạo tài khoản Chủ bot → đăng nhập bằng mã Zalo nhận trên Zalo thật → Chủ bot không thấy mục QUẢN TRỊ. Chụp màn hình để báo cáo.

- [ ] **Step 8: Commit** `feat(dashboard): giao diện — đăng nhập, Tổng quan, Tài khoản Zalo, Người dùng, Cảnh báo`.

---

### Task 12: Bộ cài — dịch vụ dashboard, link thiết lập, Caddy, doctor, uninstall, tài liệu

**Files:**
- Create: `scripts/dashboard-service.js`, `scripts/dashboard-service.test.js`
- Modify: `scripts/hermes-install-lib.js` (gọi cài dịch vụ + doctor), `scripts/install-hermes.js` (in link + Caddy), `scripts/uninstall-hermes.js`, `scripts/hermes-install-lib.js:parseCliArgs` (`--no-dashboard`), `.env.example` (3 biến mới), `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json` + `package-lock.json` (2 chỗ) + `hermes-plugin/*/plugin.yaml` → `1.19.0`.

**Interfaces:**
- `renderSystemdUnit({ sidecarRoot, nodePath })` → nội dung tệp `zalo-dashboard.service` (`ExecStart=<node> <sidecarRoot>/dashboard/server.js`, `WorkingDirectory=<sidecarRoot>`, `Restart=always`, `RestartSec=5`, `After=network-online.target zalo-bridge.service`).
- `renderWindowsStartup({ sidecarRoot, nodePath })` → nội dung `.vbs` chạy ẩn `node dashboard\server.js`.
- `installDashboardService({ sidecarRoot, platform, nodePath = process.execPath, runner, writeFile, startupDir, unitDir = '/etc/systemd/system' })` → `{ installed: boolean, detail: string }` (Linux: ghi unit + `systemctl daemon-reload` + `systemctl enable --now zalo-dashboard`; không phải root/không có systemd → `installed:false` kèm hướng dẫn; Windows: ghi `<startupDir>\zalo-dashboard.vbs` + chạy nó).
- `uninstallDashboardService(...)` → gỡ đúng tệp đã ghi, `systemctl disable --now`.
- `caddySnippet(publicUrl)` → khối Caddy khi `publicUrl` là `https://…`, ngược lại chuỗi rỗng.
- Doctor thêm: `dashboard-running` (GET `http://127.0.0.1:<port>/healthz`, ok=true với chi tiết "chưa chạy — …" nếu không trả lời, theo quy ước cảnh báo của repo), `dashboard-admin` ("chưa có — chạy npm run dashboard:setup-link"), `dashboard-telegram` ("chưa cài bot cảnh báo").

- [ ] **Step 1: Test** `scripts/dashboard-service.test.js`: unit systemd chứa đúng `ExecStart`, `WorkingDirectory`, `Restart=always`; `.vbs` chứa `dashboard\server.js` và chạy ẩn (`, 0, False`); `installDashboardService` Linux với `runner` giả ghi nhận `['systemctl','daemon-reload']`, `['systemctl','enable','--now','zalo-dashboard']` và `writeFile` vào `/etc/systemd/system/zalo-dashboard.service`; Windows ghi vào `startupDir`; `caddySnippet('https://d.vn')` có `d.vn {` và `reverse_proxy 127.0.0.1:3880`; `caddySnippet('http://localhost:3880')` → `''`.

- [ ] **Step 2: FAIL → cài đặt** `scripts/dashboard-service.js` theo interface trên (dùng `spawnSync` làm `runner` mặc định; mọi đường dẫn trong unit dùng `/`).

- [ ] **Step 3: Nối vào bộ cài** — trong `installHermes` (sau bước doctor thành công, trừ khi `--no-dashboard`): gọi `installDashboardService`; nếu chưa có Quản trị thì gọi `createSetupToken(paths.setupFile).issue()` và trả link trong kết quả; `install-hermes.js` in thêm:
  - `[PASS] dashboard-service - …` hoặc `[WARN]`-kiểu (`ok:true` + chi tiết) khi không cài được dịch vụ.
  - "Mở dashboard: <link thiết lập>" (nếu có).
  - Khối Caddy nếu `ZALO_DASHBOARD_URL` là https.
  `uninstallHermes` gọi `uninstallDashboardService` và in `[REMOVED]`.

- [ ] **Step 4: Cập nhật test CLI** `scripts/cli.test.js` truyền `--no-dashboard` cho các lệnh cài hiện có (không đụng systemd/Startup thật khi test); thêm một test `parseCliArgs(['--no-dashboard'])` → `noDashboard: true`.

- [ ] **Step 5: Tài liệu** — `.env.example` thêm:

```
# Dashboard quản trị (dịch vụ riêng, chỉ nghe 127.0.0.1).
# ZALO_DASHBOARD_PORT=3880
# Địa chỉ người dùng mở — trên VPS là https://dashboard.<tên-miền> (Caddy đứng trước).
# ZALO_DASHBOARD_URL=http://localhost:3880
# Lệnh tự khởi động lại kết nối Zalo khi nó chết (mặc định: systemctl restart zalo-bridge trên Linux).
# ZALO_SIDECAR_RESTART_CMD=
# Lệnh khởi động lại trợ lý (mặc định: systemctl restart hermes-gateway trên Linux).
# ZALO_ASSISTANT_RESTART_CMD=
```

README.vi.md mục mới "Dashboard quản trị" (mở ở đâu, tạo Quản trị, tạo tài khoản khách, đăng nhập bằng mã Zalo, quét QR, cài bot Telegram cảnh báo qua @BotFather + "Nối Telegram của tôi", Caddy, quên mật khẩu, danh sách kiểm tay GĐ1). README.md tóm tắt tương ứng. CHANGELOG `## [1.19.0] — <ngày>` mục Thêm/Sửa (giãn nhịp nối lại).

- [ ] **Step 6: Bump phiên bản** 1.19.0 ở `package.json`, `package-lock.json` (2 chỗ), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`.

- [ ] **Step 7: Chạy toàn bộ** `HERMES_HOME=E:/Hermes npm test` → PASS.

- [ ] **Step 8: Commit** `feat(dashboard): bộ cài dịch vụ dashboard, link thiết lập, Caddy, doctor (v1.19.0)`.

---

### Task 13: Triển khai và kiểm thật (không phát hành tag ở bước này)

- [ ] **Step 1: Uyển Nhi (VPS)** — `cd /opt/2anh-zalo-bot && git fetch && git checkout <commit GĐ1>`; `npm ci`; `HERMES_HOME=/root/.hermes npm run install:hermes -- --hermes-home /root/.hermes` (tạo symlink `~/.hermes/hermes-agent` nếu cần như bản cài khách); đặt `ZALO_DASHBOARD_URL` trong `.env` Hermes.
- [ ] **Step 2: Tên miền** — kiểm DNS bản ghi cho `dashboard.<tên-miền đang dùng trong /opt/hermes/Caddyfile>`; **có sẵn bản ghi (hoặc wildcard) thì** thêm khối Caddy và `systemctl reload caddy`; **chưa có thì dừng, báo người dùng tạo bản ghi DNS** (thao tác ra bên ngoài).
- [ ] **Step 3: Kiểm thật** — tạo Quản trị qua link thiết lập; đăng nhập bằng mã Zalo; Tổng quan xanh; tạo bot Telegram cảnh báo (cần người dùng tạo qua @BotFather — nếu chưa có thì để trống và ghi trong báo cáo); `systemctl stop zalo-bridge` 3 phút → dashboard tự khởi động lại sidecar (kiểm `systemctl status zalo-bridge`), dải đỏ trong lúc tắt.
- [ ] **Step 4: Lăng Tiêu (local)** — chạy `npm run install:hermes` từ bản sync vào `E:\Hermes\zca-test` theo quy trình đồng bộ hiện có (sao lưu trước), kiểm `http://localhost:3880`.
- [ ] **Step 5: Ghi lại kết quả, ảnh chụp** cho báo cáo cuối.
