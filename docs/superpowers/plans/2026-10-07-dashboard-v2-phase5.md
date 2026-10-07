# Dashboard v2 — Giai đoạn 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm mục **Nhắn riêng** vào Phân quyền Bot (ai được nhắn riêng: chỉ chủ nhân / danh sách / mọi người; 8 nút tính năng; ghi đè theo từng người — thực thi ở cả plugin lẫn kết nối Zalo) và trang **Sức khoẻ máy chủ** (CPU/RAM/ổ đĩa/thời gian chạy với biểu đồ 24 giờ, trạng thái dịch vụ, cảnh báo Telegram khi quá tải, lượt gọi AI + token theo ngày). Phát hành v1.23.0.

**Architecture:** Quyền nhắn riêng là mục `dm` mới trong `<HERMES_HOME>/zalo/permissions.json` (vẫn `version: 1`). Một module dùng chung `dm-rules.js` (gốc repo) chuẩn hoá mục này cho kết nối Zalo (`zalo-policy.js` chặn lệnh đi ra của lượt tin riêng) và dashboard; plugin Python đọc cùng lược đồ trong `group_permissions.py` (đọc nóng theo mtime) và chặn ở cửa vào (`adapter.py`) + điểm gọi công cụ (`guard_member_tool_call`). Sức khoẻ máy chủ chạy hoàn toàn trong tiến trình dashboard: số đo từ `node:os` + `fs.statfsSync` (không lệnh), dịch vụ từ đúng một lệnh `systemctl list-units` chỉ đọc trên Linux hoặc dò cổng/PID trên Windows, lượt gọi AI từ `state.db` của Hermes (`node:sqlite` chỉ đọc, lấy phần tăng của tổng cộng dồn), cảnh báo qua `watchdog.js` + bot Telegram sẵn có.

**Tech Stack:** Node ≥ 22 ESM, Express 5.2.1, `node:test`, `node:sqlite`, `node:net`, Preact 10 + htm 3 (đã nhúng), Python 3.11 `unittest` trong venv Hermes. Không thêm gói npm nào.

**Spec:** `docs/superpowers/specs/2026-10-07-dashboard-v2-phase5-addendum.md` (§16) — bổ sung cho `docs/superpowers/specs/2026-10-07-zalo-dashboard-v2-design.md` (§6, §8, §9, §10, §11).

## Global Constraints

- Không thêm gói npm. Không bước build. Giao diện chỉ dùng Preact + htm đã nhúng.
- CSP giữ nguyên: `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'`. Không `style=` nội tuyến, không `innerHTML` trong `dashboard/public/**` (test `public.test.js` quét cả chữ trong chú thích). Biểu đồ là SVG dựng bằng htm, màu/nét qua class trong `style.css`.
- Chữ giao diện tiếng Việt thường; **không** dùng "sidecar", "bridge", "toolset" trong chữ hiển thị (tên đơn vị systemd chỉ hiện trong `detail` cho Quản trị). Mọi lỗi kèm bước tiếp theo (dấu "—").
- Lỗi route theo `dashboard/lib/route-errors.js` / mẫu `fail()` của `routes/permissions.js`: 4xx lộ `err.message`, 5xx câu chung.
- Vai trò (spec §6 + §16.5): Nhắn riêng — Quản trị ✅ Chủ bot ✅ (`requireAuth`); Sức khoẻ máy chủ — cả hai (`requireAuth`), `services[].detail` chỉ Quản trị.
- `permissions.json` **giữ `version: 1`**; khoá mới `dm` là tuỳ chọn. Dashboard phải giữ `dm` qua mọi lần lưu nhóm/mặc định.
- Chủ nhân (`ZALO_ALLOWED_USERS`) **luôn được miễn** ở mọi lớp — kết nối Zalo xét theo UID, không theo vai trò khai.
- Plugin Python: mọi đường đọc quyền bọc `try/except`; lỗi → hành vi trước giai đoạn 5 (`ZALO_DM_POLICY`, mọi nút bật), không bao giờ làm sập gateway, không bao giờ mở rộng quyền vào vì lỗi.
- Lệnh hệ thống: chỉ `systemctl list-units …` (đọc), `execFile` với `{ windowsHide: true, timeout: 5000 }`. Không start/stop/restart gì.
- Tệp dữ liệu mới trong `<HERMES_HOME>/zalo/dashboard/`: `health-history.json`, `ai-usage.json` — quyền 600 (`writeFileAtomic`/`writeJsonAtomic`).
- Repo checkout với `core.autocrlf=true` (tệp làm việc CRLF): sửa tệp có sẵn bằng công cụ Edit, đừng dùng script thay chuỗi giả định `\n`.
- Chạy test: `HERMES_HOME=E:/Hermes npm test` (Windows) — JS `node --test`, Python qua `scripts/run-python-tests.js`.
- Commit theo quy ước repo, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Quyết định (người dùng chưa chốt, hoặc spec gốc không nói)

1. **`groupCron` không có trong tin riêng** → 8 nút. `zalo_group_cron` đã tự trả "chỉ dùng được trong nhóm Zalo".
2. **Tệp thắng `ZALO_DM_POLICY` khi đã chọn `who`** — kể cả hẹp hơn (`ZALO_DM_POLICY=open` + tệp `list` → chỉ danh sách). Chưa chọn → biến môi trường như cũ, dashboard hiện "Đang theo cài đặt lúc cài bot".
3. **Ghi đè theo người áp cả ở `list` lẫn `everyone`**; ở `owners` danh sách được giữ nhưng không dùng (nút bị khoá trên giao diện).
4. **Kết nối Zalo chỉ chặn lệnh đi ra**, không lọc tin đi vào; chỉ ánh xạ được nút Nhắc hẹn (3 lệnh reminder). `/sethome` của người lạ vẫn trả lời được nhờ `auth.notice = 'sethome'`.
5. **Không tự bật `ZALO_ALLOW_ALL_USERS`** — chỉ báo vàng khi lựa chọn chưa có tác dụng.
6. **Ngưỡng quá tải**: vào > 90 %, ra < 85 %; ổ đĩa báo ở lần đo thứ hai liên tiếp (~1 phút), RAM sau 5 phút, CPU sau 10 phút. "Cao" của CPU = trung bình mỗi phút > 90 %.
7. **Lượt gọi AI = toàn bộ Hermes** (Zalo + cron + kênh khác) từ `state.db`, lấy mẫu 5 phút/lần, giữ 30 ngày, bắt đầu từ lúc cài; **không hiện tiền**.
8. **Sức khoẻ máy chủ cho cả hai vai trò**; tên đơn vị/cổng/PID chỉ Quản trị.
9. **Windows dò dịch vụ không cần lệnh**: cổng TCP + `gateway.pid` + cổng `127.0.0.1` trong `config.yaml` Hermes. Không hiện Caddy trên Windows (không có).
10. **API mới tên `/api/server-health`** (không phải `/api/health`, trùng tên với route của kết nối Zalo dễ nhầm khi đọc log).

## Review Focus

1. **Người lạ nhắn riêng khi tệp nói "danh sách" nhưng plugin cũ/lỗi vẫn trả lời** → câu trả lời không đi ra được (kết nối Zalo từ chối `dm_not_allowed`), riêng `/sethome` vẫn đi. (Task 1 `nhắn riêng: người ngoài danh sách bị chặn mọi lệnh…`, `nhắn riêng: cầu nối áp mục dm…`.)
2. **`permissions.json` hỏng / bản cài dở / lỗi đọc** → không bao giờ rộng hơn `ZALO_DM_POLICY`, không im với chủ nhân. (Task 3 `test_errors_and_half_install_fall_back_to_env_policy_never_wider`.)
3. **Lưu nhóm hoặc mặc định sau khi đã lưu Nhắn riêng** → mục `dm` còn nguyên, plugin vẫn đọc đúng. (Task 4 `nhắn riêng: lưu ghi who…`, `test_s3_dm_section_written_by_dashboard_is_read_by_plugin`.)
4. **Số đo dao động quanh 90 % / dashboard khởi động lại giữa sự cố** → không báo lặp, không báo trùng. (Task 9 `RAM > 90 % phải kéo dài…`, `máy chủ: khởi động lại dashboard không báo trùng…`.)
5. **Phiên Hermes kéo dài nhiều ngày, Hermes dọn phiên làm tổng giảm** → số theo ngày không dồn vào một ngày, không ra số âm. (Task 8 `theo ngày giờ Việt Nam…`, `tổng giảm…`.)

---

## File Structure

**Dùng chung / kết nối Zalo:**
- Create `dm-rules.js` (+ `dm-rules.test.js`) — lược đồ `dm`, `dmVerdict`, đọc nóng tệp.
- Modify `zalo-policy.js` (+ test), `hermes-bridge.js` (+ test), `server.js`.

**Plugin Hermes:**
- Modify `hermes-plugin/zalo_tools/group_permissions.py`, `hermes-plugin/zalo_tools/tools.py`, `hermes-plugin/zalo/adapter.py`; test `test_zalo_permissions.py`.

**Dashboard (mới):** `dashboard/public/views/dm-permissions.js`, `dashboard/lib/host-metrics.js`, `dashboard/lib/health-history.js`, `dashboard/lib/host-metrics.test.js`, `dashboard/lib/services.js` (+ test), `dashboard/lib/ai-usage.js` (+ test), `dashboard/lib/health-monitor.js`, `dashboard/routes/health.js` (+ test), `dashboard/public/views/health.js`.

**Dashboard (sửa):** `dashboard/lib/permissions.js` (+ test), `dashboard/routes/permissions.js` (+ test), `dashboard/lib/audit-feed.js`, `dashboard/lib/watchdog.js` (+ test), `dashboard/lib/paths.js` (+ test), `dashboard/app.js`, `dashboard/server.js` (+ test), `dashboard/test-helpers.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/views/permissions.js`, `dashboard/public/views/shell.js`, `dashboard/public/public.test.js`.

**Phát hành:** `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`.

---

### Task 1: Lược đồ `dm` dùng chung + lớp chặn ở kết nối Zalo

**Files:**
- Create: `dm-rules.js`, `dm-rules.test.js`
- Modify: `zalo-policy.js`, `zalo-policy.test.js`, `hermes-bridge.js`, `hermes-bridge.test.js`, `server.js`

**Interfaces:**
- Consumes: không.
- Produces:
  - `dm-rules.js`: `DM_WHO = ['owners','list','everyone']`, `DM_FEATURE_KEYS` (8 khoá theo thứ tự `web, files, voice, reminders, kb, people, academic, video`), `normalizeDm(raw) → null | { who?, features: {partial}, people: { [uid]: { name?, features: {partial} } } }`, `dmVerdict(dm, uid) → { allowed: true|false|null, features: {8 bool} }`, `permissionsFileFromEnv(env) → string|null`, `createDmRules({ file, statImpl?, readImpl?, warn? }) → () => dm|null`.
  - `authorizeBridgeCommand(command, { ownerUids, dmRules })` — mã từ chối mới `dm_not_allowed`, `feature_disabled`.
  - `startHermesBridge({ …, dmRules })`.
  - Lượt plugin có thể gửi `auth.notice = 'sethome'` (Task 2 sinh ra).

- [ ] **Step 1: Viết test** — tạo `dm-rules.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DM_FEATURE_KEYS, createDmRules, dmVerdict, normalizeDm, permissionsFileFromEnv } from './dm-rules.js';

const A = '1111111111111111111';
const B = '2222222222222222222';

test('normalizeDm: giữ khoá biết, đúng kiểu; bỏ who lạ, UID không phải số, nút groupCron', () => {
  assert.equal(normalizeDm(undefined), null);
  assert.equal(normalizeDm([]), null);
  assert.deepEqual(normalizeDm({
    who: 'list', features: { web: false, groupCron: false, kb: 'no' },
    people: { [A]: { name: '  Cô Lan ', features: { voice: false, nope: true } }, 'abc': { name: 'x' }, [B]: 'rác' },
  }), {
    who: 'list', features: { web: false },
    people: { [A]: { name: 'Cô Lan', features: { voice: false } }, [B]: { features: {} } },
  });
  assert.equal(normalizeDm({ who: 'all' }).who, undefined);
  assert.deepEqual(DM_FEATURE_KEYS, ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video']);
});

test('dmVerdict: who quyết ai vào; tính năng gộp mặc định ← dm ← người', () => {
  const dm = normalizeDm({ who: 'list', features: { web: false }, people: { [A]: { features: { web: true, video: false } } } });
  assert.deepEqual(dmVerdict(dm, A), { allowed: true, features: { web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: false } });
  assert.equal(dmVerdict(dm, B).allowed, false);
  assert.equal(dmVerdict(dm, B).features.web, false);
  assert.equal(dmVerdict({ ...dm, who: 'everyone' }, B).allowed, true);
  assert.equal(dmVerdict({ ...dm, who: 'owners' }, A).allowed, false, 'chỉ chủ nhân: người trong danh sách cũng không vào');
  assert.equal(dmVerdict(normalizeDm({ features: { kb: false } }), B).allowed, null, 'chưa chọn who → theo ZALO_DM_POLICY');
  assert.equal(dmVerdict(null, B).allowed, null);
  assert.ok(Object.values(dmVerdict(null, B).features).every(Boolean));
});

test('permissionsFileFromEnv: ZALO_PERMISSIONS_FILE thắng HERMES_HOME; thiếu cả hai → null', () => {
  assert.equal(permissionsFileFromEnv({ ZALO_PERMISSIONS_FILE: '/x/p.json', HERMES_HOME: '/h' }), '/x/p.json');
  assert.equal(permissionsFileFromEnv({ HERMES_HOME: '/h' }), join('/h', 'zalo', 'permissions.json'));
  assert.equal(permissionsFileFromEnv({}), null);
});

test('createDmRules: đọc lại khi tệp đổi; không có tệp, tệp hỏng, phiên bản lạ → null', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-rules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'permissions.json');
  const warnings = [];
  const rules = createDmRules({ file, warn: (m) => warnings.push(m) });
  assert.equal(rules(), null);
  let stamp = 1_700_000_000;
  const write = (text) => { writeFileSync(file, text); stamp += 10; utimesSync(file, stamp, stamp); };
  write(JSON.stringify({ version: 1, defaults: {}, groups: {} }));
  assert.equal(rules(), null, 'tệp chưa có mục dm');
  write(`﻿${JSON.stringify({ version: 1, dm: { who: 'everyone' } })}`);
  assert.equal(rules().who, 'everyone', 'bỏ BOM như plugin');
  write('{hỏng');
  assert.equal(rules(), null);
  assert.equal(warnings.length, 1);
  write(JSON.stringify({ version: 2, dm: { who: 'everyone' } }));
  assert.equal(rules(), null);
  assert.equal(createDmRules({ file: null })(), null);
});
```

Thêm vào **cuối** `zalo-policy.test.js`:

```js
// --- Nhắn riêng (spec §16): lớp chặn thứ hai sau plugin ---
const dmAuth = (uid, extra = {}) => ({ actorUid: uid, actorRole: 'public', sourceThreadId: uid, sourceThreadType: 0, confirmed: false, ...extra });
const dmOptions = (dm) => ({ ownerUids: new Set(['owner-1']), dmRules: () => dm });
const sendTo = (uid) => ({ type: 'send', threadId: uid, threadType: 0 });

test('nhắn riêng: người ngoài danh sách bị chặn mọi lệnh, trừ câu trả lời /sethome', () => {
  const opts = dmOptions({ who: 'list', features: {}, people: { 'friend-1': { features: {} } } });
  assert.equal(authorizeBridgeCommand({ ...sendTo('friend-1'), auth: dmAuth('friend-1') }, opts).allowed, true);
  assert.equal(authorizeBridgeCommand({ ...sendTo('stranger'), auth: dmAuth('stranger') }, opts).code, 'dm_not_allowed');
  assert.equal(authorizeBridgeCommand({ type: 'typing', threadId: 'stranger', threadType: 0, auth: dmAuth('stranger') }, opts).code, 'dm_not_allowed');
  assert.equal(authorizeBridgeCommand({ ...sendTo('stranger'), auth: dmAuth('stranger', { notice: 'sethome' }) }, opts).allowed, true);
  assert.equal(authorizeBridgeCommand({
    type: 'invoke', method: 'sendSticker', args: [{ id: '1' }, 'stranger', 0], auth: dmAuth('stranger', { notice: 'sethome' }),
  }, opts).code, 'dm_not_allowed', 'dấu /sethome chỉ mở đúng lệnh gửi chữ');
});

test('nhắn riêng: chủ nhân luôn được miễn, kể cả lượt bị hạ xuống quyền công khai', () => {
  const opts = dmOptions({ who: 'owners', features: { reminders: false }, people: {} });
  assert.equal(authorizeBridgeCommand({ ...sendTo('owner-1'), auth: dmAuth('owner-1') }, opts).allowed, true);
  assert.equal(authorizeBridgeCommand({
    type: 'invoke', method: 'createReminder', args: [{ title: 'x' }, 'owner-1', 0], auth: dmAuth('owner-1'),
  }, opts).allowed, true);
});

test('nhắn riêng: nút Nhắc hẹn tắt chặn lệnh nhắc hẹn; nhóm và lượt hệ thống không bị ảnh hưởng', () => {
  const opts = dmOptions({ who: 'everyone', features: { reminders: false }, people: { 'vip': { features: { reminders: true } } } });
  for (const [method, args] of [['createReminder', [{ title: 'x' }, 'u2', 0]], ['removeReminder', ['r1', 'u2', 0]], ['getListReminder', ['u2', 0]]]) {
    assert.equal(authorizeBridgeCommand({ type: 'invoke', method, args, auth: dmAuth('u2') }, opts).code, 'feature_disabled', method);
  }
  assert.equal(authorizeBridgeCommand({ type: 'invoke', method: 'createReminder', args: [{ title: 'x' }, 'vip', 0], auth: dmAuth('vip') }, opts).allowed, true, 'ghi đè riêng từng người');
  assert.equal(authorizeBridgeCommand({ type: 'invoke', method: 'sendVoice', args: [{}, 'u2', 0], auth: dmAuth('u2') }, opts).allowed, true);
  assert.equal(authorizeBridgeCommand({
    type: 'invoke', method: 'createReminder', args: [{ title: 'x' }, 'group-1', 1], auth: publicAuth,
  }, opts).allowed, true, 'trong nhóm: bảng nhóm do plugin lo');
  const system = { actorUid: '', actorRole: 'system', sourceThreadId: '', sourceThreadType: 0, confirmed: false };
  assert.equal(authorizeBridgeCommand({ ...sendTo('u2'), auth: system }, opts).allowed, true);
});

test('nhắn riêng: không có mục dm, chưa chọn who, hoặc đọc lỗi → không chặn thêm', () => {
  for (const dmRules of [() => null, () => ({ features: {}, people: {} }), () => { throw new Error('hỏng'); }, null]) {
    assert.equal(authorizeBridgeCommand({ ...sendTo('stranger'), auth: dmAuth('stranger') }, { ownerUids: new Set(['owner-1']), dmRules }).allowed, true);
  }
});
```

Thêm vào **cuối** `hermes-bridge.test.js`:

```js
test('nhắn riêng: cầu nối áp mục dm của permissions.json — người ngoài danh sách bị từ chối, chủ nhân thì không', async (t) => {
  const dm = { who: 'list', features: {}, people: {} };
  const sent = [];
  const api = { sendMessage: async (content, threadId) => { sent.push(threadId); return { msgId: `s${sent.length}` }; } };
  const server = startHermesBridge({ api, profile: { user_id: 'bot' }, port: 0, store: testStore(t), ownerUids: ['owner'], dmRules: () => dm });
  await new Promise((resolve) => server.once('listening', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  try {
    const hello = onceMessage(ws, (msg) => msg.type === 'hello');
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    await hello;
    ws.send(JSON.stringify({ type: 'send', reqId: 'dm1', threadId: 'stranger', threadType: 0, text: 'chào', auth: auth('stranger', 0, { actorUid: 'stranger' }) }));
    const denied = await onceMessage(ws, (msg) => msg.type === 'ack' && msg.reqId === 'dm1');
    assert.equal(denied.ok, false);
    assert.equal(denied.errorCode, 'dm_not_allowed');
    assert.equal(denied.error, 'Người này chưa được phép nhắn riêng với bot');
    ws.send(JSON.stringify({ type: 'send', reqId: 'dm2', threadId: 'owner', threadType: 0, text: 'chào chủ', auth: auth('owner', 0) }));
    const ok = await onceMessage(ws, (msg) => msg.type === 'ack' && msg.reqId === 'dm2');
    assert.equal(ok.ok, true);
    assert.deepEqual(sent, ['owner']);
  } finally {
    ws.close();
    stopHermesBridge();
  }
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test dm-rules.test.js zalo-policy.test.js hermes-bridge.test.js`
Expected: FAIL — `Cannot find module './dm-rules.js'`; sau khi có module, các test "nhắn riêng" của policy hỏng vì `dm_not_allowed` chưa có.

- [ ] **Step 3: Tạo `dm-rules.js`**

```js
/**
 * Quyền nhắn riêng (spec §16): mục `dm` trong `<HERMES_HOME>/zalo/permissions.json`.
 * Dùng chung cho kết nối Zalo (chặn lệnh của lượt nhắn riêng) và dashboard (đọc/ghi).
 * Plugin Python đọc cùng lược đồ ở hermes-plugin/zalo_tools/group_permissions.py — hai bên phải khớp.
 *
 * {
 *   "who": "owners" | "list" | "everyone",
 *   "features": { "web": false },                    // chỉ khoá khác "bật"
 *   "people": { "<uid>": { "name": "Cô Lan", "features": { "voice": false } } }
 * }
 * Không có mục `dm` → null: mọi nơi giữ hành vi cũ (ZALO_DM_POLICY, mọi tính năng bật).
 * Chủ nhân không bao giờ bị mục này chặn — bên gọi tự miễn trừ trước.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DM_WHO = ['owners', 'list', 'everyone'];
// "Hẹn giờ cho nhóm" không có nghĩa trong tin nhắn riêng (công cụ tự từ chối ngoài nhóm).
export const DM_FEATURE_KEYS = ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video'];
const UID_KEY = /^\d{1,32}$/;
const MAX_NAME = 80;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function bools(raw) {
  const out = {};
  if (isObj(raw)) for (const k of DM_FEATURE_KEYS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

/** Chuẩn hoá mục `dm`; không phải object → null. Khoá lạ, sai kiểu bị bỏ — giống `_dm` bên Python. */
export function normalizeDm(raw) {
  if (!isObj(raw)) return null;
  const out = { features: bools(raw.features), people: {} };
  if (DM_WHO.includes(raw.who)) out.who = raw.who;
  if (isObj(raw.people)) {
    for (const [uid, entry] of Object.entries(raw.people)) {
      if (!UID_KEY.test(uid)) continue;
      const person = { features: bools(isObj(entry) ? entry.features : null) };
      const name = isObj(entry) && typeof entry.name === 'string' ? entry.name.trim().slice(0, MAX_NAME) : '';
      if (name) person.name = name;
      out.people[uid] = person;
    }
  }
  return out;
}

/**
 * Quyết định cho một người KHÔNG phải chủ nhân.
 * `allowed`: true/false theo `who`; null khi tệp chưa chọn `who` (bên gọi dùng ZALO_DM_POLICY).
 * `features`: đủ 8 nút — mặc định bật ← `dm.features` ← `people[uid].features`.
 */
export function dmVerdict(dm, uid) {
  const person = dm?.people?.[String(uid ?? '')];
  const features = Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, true]));
  Object.assign(features, dm?.features || {}, person?.features || {});
  const who = dm?.who;
  const allowed = who == null ? null : who === 'everyone' || (who === 'list' && Boolean(person));
  return { allowed, features };
}

/** Đường dẫn permissions.json mà plugin cũng đọc: ZALO_PERMISSIONS_FILE hoặc <HERMES_HOME>/zalo/permissions.json. */
export function permissionsFileFromEnv(env = process.env) {
  const explicit = String(env.ZALO_PERMISSIONS_FILE || '').trim();
  if (explicit) return explicit;
  const home = String(env.HERMES_HOME || '').trim();
  return home ? join(home, 'zalo', 'permissions.json') : null;
}

/**
 * Đọc nóng mục `dm` (theo mtime + cỡ tệp). Trả hàm `() => dm | null`.
 * Không có tệp / tệp hỏng / không phải phiên bản 1 → null (không chặn gì thêm), cảnh báo một lần mỗi lần tệp đổi.
 */
export function createDmRules({ file, statImpl = statSync, readImpl = (p) => readFileSync(p, 'utf8'), warn = console.warn }) {
  let key = null;
  let value = null;
  return () => {
    if (!file) return null;
    let st;
    try { st = statImpl(file); } catch { key = null; value = null; return null; }
    const next = `${st.mtimeMs}:${st.size}`;
    if (next === key) return value;
    key = next;
    try {
      const data = JSON.parse(String(readImpl(file)).replace(/^﻿/, ''));
      value = isObj(data) && data.version === 1 ? normalizeDm(data.dm) : null;
    } catch (err) {
      warn(`[dm] ${file} hỏng — bỏ qua quyền nhắn riêng trong tệp: ${err.message}`);
      value = null;
    }
    return value;
  };
}
```

- [ ] **Step 4: Sửa `zalo-policy.js`**

Đầu tệp, trước `const PUBLIC_READ_METHODS`:

```js
import { dmVerdict } from './dm-rules.js';

```

Ngay sau dòng `const PUBLIC_COMMANDS = new Set([...]);` thêm:

```js

// Lệnh Zalo gắn đúng một nút tính năng nhắn riêng. Gửi tệp/thoại không có ở đây: adapter cũng
// dùng uploadAttachment/sendVoice để gửi tệp kèm câu trả lời, nên chỉ plugin phân biệt được.
const DM_METHOD_FEATURE = new Map([
  ['createReminder', 'reminders'], ['removeReminder', 'reminders'], ['getListReminder', 'reminders'],
]);
```

Thay dòng `export function authorizeBridgeCommand(command, { ownerUids = new Set() } = {}) {` bằng:

```js
/**
 * Lượt nhắn riêng của người không phải chủ nhân: kiểm mục `dm` của permissions.json (lớp thứ hai,
 * sau plugin). `dmRules()` trả dm đã chuẩn hoá hoặc null (không có mục / lỗi → không chặn thêm).
 * Chủ nhân luôn được miễn — xét theo UID, kể cả khi adapter hạ lượt của chủ xuống quyền công khai.
 */
function dmDenial(command, auth, owners, dmRules) {
  if (!dmRules || Number(auth.sourceThreadType) !== 0 || owners.has(String(auth.actorUid))) return null;
  let dm = null;
  try { dm = dmRules(); } catch { dm = null; }
  if (!dm) return null;
  const verdict = dmVerdict(dm, auth.actorUid);
  // Câu trả lời /sethome (chỉ cho người lạ biết UID của chính họ) vẫn phải đi được.
  if (verdict.allowed === false && !(command.type === 'send' && auth.notice === 'sethome')) return 'dm_not_allowed';
  const feature = command.type === 'invoke' ? DM_METHOD_FEATURE.get(String(command.method || '')) : null;
  if (feature && verdict.features[feature] === false) return 'feature_disabled';
  return null;
}

export function authorizeBridgeCommand(command, { ownerUids = new Set(), dmRules = null } = {}) {
```

Trong thân hàm, giữa khối `owner_required` và khối `cross_thread_denied`:

```js
  if (rule.minimumRole === 'owner' && role !== 'owner') {
    return denied(role, 'owner_required', rule.category);
  }
  const dmCode = role === 'public' ? dmDenial(command, auth, owners, dmRules) : null;
  if (dmCode) return denied(role, dmCode, rule.category);
  if (role === 'public' && !sameThread(command, auth)) {
```

- [ ] **Step 5: Sửa `hermes-bridge.js`**

1. Sau `let activeOwnerUids = new Set();` thêm:
```js
// () => mục `dm` của permissions.json (dm-rules.js) hoặc null — lớp chặn thứ hai cho tin nhắn riêng.
let activeDmRules = null;
```
2. Trong chữ ký `startHermesBridge`, dòng `bridgeToken = process.env.ZALO_BRIDGE_TOKEN,` → `bridgeToken = process.env.ZALO_BRIDGE_TOKEN, dmRules = null,`.
3. Ngay sau khối gán `activeOwnerUids = new Set(...)` trong `startHermesBridge`: `activeDmRules = typeof dmRules === 'function' ? dmRules : null;`
4. Trong `stopHermesBridge`, sau `activeOwnerUids = new Set();`: `activeDmRules = null;`
5. `policyErrorMessage`: thêm hai mục
```js
    dm_not_allowed: 'Người này chưa được phép nhắn riêng với bot',
    feature_disabled: 'Chủ bot đang tắt tính năng này khi nhắn riêng',
```
6. Trong `handleCommand`: `authorizeBridgeCommand(cmd, { ownerUids: activeOwnerUids })` → `authorizeBridgeCommand(cmd, { ownerUids: activeOwnerUids, dmRules: activeDmRules })`.

- [ ] **Step 6: Sửa `server.js` (kết nối Zalo)**

Sau `import { createGroupDirectory } from './group-directory.js';`:
```js
import { createDmRules, permissionsFileFromEnv } from './dm-rules.js';
```
Sau `const runtimeHealth = createRuntimeHealth({ store: zaloStore });`:
```js
// Quyền nhắn riêng do dashboard ghi (permissions.json), đọc lại khi tệp đổi — lớp chặn thứ hai sau plugin.
const dmRules = createDmRules({ file: permissionsFileFromEnv() });
```
Trong `activateZaloRuntime`: `startHermesBridge({ api, profile: loginInfo, store: zaloStore, health: runtimeHealth });` → `startHermesBridge({ api, profile: loginInfo, store: zaloStore, health: runtimeHealth, dmRules });`

- [ ] **Step 7: Chạy test**

Run: `node --test dm-rules.test.js zalo-policy.test.js hermes-bridge.test.js`
Expected: PASS (69 test, 0 fail).

- [ ] **Step 8: Commit**

```bash
git add dm-rules.js dm-rules.test.js zalo-policy.js zalo-policy.test.js hermes-bridge.js hermes-bridge.test.js server.js
git commit -m "feat(zalo): kết nối Zalo áp quyền nhắn riêng của permissions.json (lớp chặn thứ hai)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Plugin — đọc mục `dm`, chặn công cụ khi nhắn riêng, dấu `/sethome`

**Files:**
- Modify: `hermes-plugin/zalo_tools/group_permissions.py`, `hermes-plugin/zalo_tools/tools.py`
- Test: `test_zalo_permissions.py`

**Interfaces:**
- Consumes: lược đồ `dm` của Task 1 (giống `normalizeDm`).
- Produces: `group_permissions.DM_FEATURES` (tuple 8), `DM_WHO`, `dm_settings(uid) -> {"who": str|None, "listed": bool, "features": {8 bool}}`, `dm_allows(uid) -> True|False|None`, `dm_disabled_features(uid) -> list`; `tools._feature_block(turn, name, args)` (đổi tên từ `_group_feature_block`); `current_authorization()` thêm `"notice": "sethome"` khi lượt có `"sethome": True`.

- [ ] **Step 1: Viết test** — trong `test_zalo_permissions.py`, chèn ngay **trước** dòng `if __name__ == "__main__":` (Task 3 và 4 chèn tiếp ở cùng chỗ):

```python
STRANGER = "5555555555555555555"


class DmPermissionsTest(PermissionsFile, unittest.TestCase):
    """Mục "dm" của permissions.json (spec §16)."""

    def test_missing_dm_section_means_env_policy_and_everything_on(self):
        self.assertIsNone(gp.dm_allows(MEMBER))
        self.write({"version": 1, "defaults": {"features": {"web": False}}, "groups": {}})
        self.assertIsNone(gp.dm_allows(MEMBER))
        self.assertEqual(gp.dm_disabled_features(MEMBER), [], "bảng nhóm không áp cho tin nhắn riêng")

    def test_who_list_everyone_owners(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {MEMBER: {"name": "Cô Lan"}}}})
        self.assertIs(gp.dm_allows(MEMBER), True)
        self.assertIs(gp.dm_allows(STRANGER), False)
        self.write({"version": 1, "dm": {"who": "everyone"}})
        self.assertIs(gp.dm_allows(STRANGER), True)
        self.write({"version": 1, "dm": {"who": "owners", "people": {MEMBER: {}}}})
        self.assertIs(gp.dm_allows(MEMBER), False)
        self.write({"version": 1, "dm": {"who": "ai cũng được"}})
        self.assertIsNone(gp.dm_allows(MEMBER), "who lạ → theo ZALO_DM_POLICY")

    def test_features_merge_default_dm_then_person(self):
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False, "groupCron": False},
                                         "people": {MEMBER: {"features": {"web": True, "video": False, "kb": "no"}}}}})
        self.assertEqual(gp.dm_disabled_features(STRANGER), ["web"])
        self.assertEqual(gp.dm_disabled_features(MEMBER), ["video"])
        self.assertNotIn("groupCron", gp.dm_settings(MEMBER)["features"])
        self.assertEqual(gp.DM_FEATURES, tuple(f for f in gp.FEATURES if f != "groupCron"))

    def test_non_digit_uid_keys_and_garbage_are_ignored(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {"abc": {}, "１２３": {}, MEMBER: "rác"}}})
        self.assertIs(gp.dm_allows("abc"), False)
        self.assertIs(gp.dm_allows("１２３"), False, "chữ số toàn khổ không phải UID")
        self.assertIs(gp.dm_allows(MEMBER), True, "mục rác vẫn là có tên trong danh sách — giống dm-rules.js")
        self.write({"version": 1, "dm": "rác"})
        self.assertIsNone(gp.dm_allows(MEMBER))


class GuardDmFeatureTest(PermissionsFile, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False},
                                         "people": {MEMBER: {"features": {"web": True, "kb": False}}}}})
        self.addCleanup(zalo_tools.bind_turn, None)

    def dm_turn(self, uid, owner=False):
        zalo_tools.bind_turn({"sender_uid": uid, "thread_id": uid, "is_group": False, "is_owner": owner, "text": ""})

    def test_dm_feature_off_is_refused_with_dm_wording(self):
        self.dm_turn(STRANGER)
        verdict = zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"})
        self.assertEqual(verdict["action"], "block")
        self.assertIn("khi nhắn riêng", verdict["message"])
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_kb_list", {}))

    def test_per_person_override_and_owner_exempt(self):
        self.dm_turn(MEMBER)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))
        self.assertEqual(zalo_tools.guard_member_tool_call("zalo_kb_read", {"name": "a"})["action"], "block")
        message = zalo_tools.guard_member_tool_call("terminal", {"command": "ls"})["message"]
        self.assertNotIn("zalo_kb_list", message, "không gợi ý công cụ đang tắt với người này")
        self.dm_turn(OWNER, owner=True)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_group_cron_is_not_a_dm_switch_and_group_turns_ignore_dm_section(self):
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False}}})
        self.dm_turn(STRANGER)
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_group_cron", {"action": "create"}))
        zalo_tools.bind_turn({"sender_uid": STRANGER, "thread_id": GROUP_A, "is_group": True, "is_owner": False, "text": ""})
        self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_unreadable_dm_rules_do_not_block(self):
        self.dm_turn(STRANGER)
        with patch.object(gp, "dm_settings", side_effect=RuntimeError("hỏng")), \
                self.assertLogs(zalo_tools.logger, level="WARNING"):
            self.assertIsNone(zalo_tools.guard_member_tool_call("zalo_web_search", {"query": "x"}))

    def test_sethome_turn_marks_the_authorization(self):
        zalo_tools.bind_turn({"sender_uid": STRANGER, "thread_id": STRANGER, "is_group": False,
                              "is_owner": False, "text": "/sethome", "sethome": True})
        self.assertEqual(zalo_tools.current_authorization()["notice"], "sethome")
        self.dm_turn(STRANGER)
        self.assertNotIn("notice", zalo_tools.current_authorization())
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `HERMES_HOME=E:/Hermes npm run test:py`
Expected: FAIL ở `test_zalo_permissions.py` — `AttributeError: module 'plugins.zalo_tools.group_permissions' has no attribute 'dm_allows'`.

- [ ] **Step 3: Sửa `group_permissions.py`**

Sau dòng `_TOOL_FEATURE = {...}` thêm:

```python

# Nhắn riêng (mục ``dm`` của tệp, spec §16). "Hẹn giờ cho nhóm" không có nghĩa
# ngoài nhóm — zalo_group_cron tự từ chối khi nhắn riêng — nên không có nút này.
DM_FEATURES = tuple(feature for feature in FEATURES if feature != "groupCron")
DM_WHO = ("owners", "list", "everyone")
```

Thay toàn bộ hàm `_parse` bằng:

```python
def _dm(raw: Any) -> Dict[str, Any]:
    """Mục ``dm``: ``who`` hợp lệ, 8 nút đúng kiểu, ``people`` khoá là UID số — giống ``normalizeDm`` (dm-rules.js)."""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Any] = {"features": _bools(raw.get("features"), DM_FEATURES), "people": {}}
    if raw.get("who") in DM_WHO:
        out["who"] = raw["who"]
    people = raw.get("people") if isinstance(raw.get("people"), dict) else {}
    for uid, entry in people.items():
        if not (str(uid).isascii() and str(uid).isdigit()) or len(str(uid)) > 32:
            continue
        out["people"][str(uid)] = {
            "features": _bools(entry.get("features") if isinstance(entry, dict) else None, DM_FEATURES),
        }
    return out


def _parse(text: str) -> Dict[str, Any]:
    data = json.loads(text)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("không phải permissions.json phiên bản 1")
    groups = data.get("groups") if isinstance(data.get("groups"), dict) else {}
    return {
        "defaults": _layer(data.get("defaults")),
        "groups": {str(gid): _layer(entry) for gid, entry in groups.items()},
        "dm": _dm(data.get("dm")),
    }
```

Thêm vào cuối tệp:

```python
def dm_settings(uid: str) -> Dict[str, Any]:
    """Quyền nhắn riêng của một người KHÔNG phải chủ nhân (bên gọi tự miễn trừ chủ nhân).

    ``who``: "owners" | "list" | "everyone", hoặc None khi tệp chưa chọn (theo
    ``ZALO_DM_POLICY`` của adapter). ``listed``: người này có trong danh sách.
    ``features``: đủ 8 nút — mặc định bật ← ``dm.features`` ← ``dm.people[uid].features``.
    """
    dm = _load().get("dm") or {}
    person = (dm.get("people") or {}).get(str(uid or ""))
    features = {feature: True for feature in DM_FEATURES}
    features.update(dm.get("features") or {})
    if person:
        features.update(person.get("features") or {})
    return {"who": dm.get("who"), "listed": person is not None, "features": features}


def dm_allows(uid: str) -> Optional[bool]:
    """Người này (không phải chủ nhân) có được nhắn riêng không; None = tệp không nói, theo ZALO_DM_POLICY."""
    settings = dm_settings(uid)
    if settings["who"] is None:
        return None
    return settings["who"] == "everyone" or (settings["who"] == "list" and settings["listed"])


def dm_disabled_features(uid: str) -> List[str]:
    """Các nút đang tắt khi người này nhắn riêng, theo thứ tự DM_FEATURES."""
    features = dm_settings(uid)["features"]
    return [feature for feature in DM_FEATURES if not features[feature]]
```

- [ ] **Step 4: Sửa `tools.py`**

1. Trong `current_authorization`, thay
```python
    if turn.get("cron_job_id"):
        auth["cronJobId"] = str(turn["cron_job_id"])
    return auth
```
bằng
```python
    if turn.get("cron_job_id"):
        auth["cronJobId"] = str(turn["cron_job_id"])
    if turn.get("sethome"):
        # Câu trả lời /sethome cho người lạ: kết nối Zalo vẫn cho gửi dù người này
        # chưa được nhắn riêng (dm-rules.js / zalo-policy.js).
        auth["notice"] = "sethome"
    return auth
```
2. Thay phần đầu hàm `_group_feature_block` (chữ ký, docstring, `if not turn.get("is_group"): return None`) bằng:
```python
def _feature_block(turn: Dict[str, Any], name: str, args: Any) -> Optional[Dict[str, str]]:
    """Lượt không phải của chủ nhân gọi công cụ thuộc nút đang tắt → chặn.

    Đọc ``permissions.json`` qua group_permissions (đọc lại khi tệp đổi). Trong
    nhóm: bảng của nhóm đó; ``zalo_group_cron`` chỉ bị chặn khi tạo mới — xem và
    xoá việc đã có vẫn được (spec §8.3). Nhắn riêng: mục ``dm`` (spec §16) — nút
    chung cho tin nhắn riêng, ghi đè theo từng người. Đọc lỗi → không chặn.
    """
    real, real_args = name, args if isinstance(args, dict) else {}
```
(giữ nguyên khối tháo `tool_call` ngay sau đó.)
3. Ngay sau
```python
    feature = group_permissions.feature_of(real)
    if feature is None:
        return None
```
chèn:
```python
    if not turn.get("is_group"):
        if feature not in group_permissions.DM_FEATURES:
            return None
        try:
            if group_permissions.dm_settings(str(turn.get("sender_uid") or ""))["features"][feature]:
                return None
        except Exception as exc:  # đọc quyền hỏng không được làm hỏng lượt
            logger.warning("[zalo] không đọc được quyền nhắn riêng: %s", exc)
            return None
        label = group_permissions.FEATURE_LABELS[feature]
        logger.info("[zalo] chặn %s — nhắn riêng với %s đang tắt %s", real, turn.get("sender_uid"), feature)
        return {
            "action": "block",
            "message": (f"Chủ bot chưa bật tính năng {label} khi nhắn riêng với người này. Hãy nói ngắn gọn "
                        f"với người hỏi rằng {label} đang tắt trong tin nhắn riêng; đừng gọi lại công cụ này "
                        "và đừng dùng công cụ khác để làm thay."),
        }
```
4. Trong `guard_member_tool_call`: `blocked = _group_feature_block(turn, name, args)` → `blocked = _feature_block(turn, name, args)`; và thay khối tính `off`
```python
    off: set = set()
    if turn.get("is_group"):
        try:
            off = set(group_permissions.disabled_features(str(turn.get("thread_id") or "")))
        except Exception as exc:
            logger.warning("[zalo] không đọc được quyền nhóm: %s", exc)
```
bằng
```python
    off: set = set()
    try:
        if turn.get("is_group"):
            off = set(group_permissions.disabled_features(str(turn.get("thread_id") or "")))
        else:
            off = set(group_permissions.dm_disabled_features(str(turn.get("sender_uid") or "")))
    except Exception as exc:
        logger.warning("[zalo] không đọc được quyền nhóm/nhắn riêng: %s", exc)
```

- [ ] **Step 5: Chạy test**

Run: `HERMES_HOME=E:/Hermes npm run test:py`
Expected: `Tất cả test Python đều xanh.` (thêm 9 test; `test_other_group_dm_and_owner_are_not_affected` cũ vẫn xanh vì bảng nhóm không áp cho tin riêng.)

- [ ] **Step 6: Commit**

```bash
git add hermes-plugin/zalo_tools/group_permissions.py hermes-plugin/zalo_tools/tools.py test_zalo_permissions.py
git commit -m "feat(plugin): đọc quyền nhắn riêng, chặn công cụ đang tắt khi nhắn riêng, dấu /sethome

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Plugin — cửa vào tin nhắn riêng trong adapter

**Files:**
- Modify: `hermes-plugin/zalo/adapter.py`
- Test: `test_zalo_permissions.py`

**Interfaces:**
- Consumes: `group_permissions.dm_allows`, `dm_settings`, `DM_FEATURES`, `FEATURE_LABELS` (Task 2); `zalo_tools.bind_turn`.
- Produces: `ZaloAdapter._dm_allowed(uid) -> bool`, `ZaloAdapter._dm_rules(uid) -> dict|None` (staticmethod).

- [ ] **Step 1: Viết test** — chèn trước `if __name__ == "__main__":`:

```python
class AdapterDmTest(PermissionsFile, AdapterHarness, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch.dict(os.environ, {"ZALO_ALLOWED_USERS": OWNER}))

    def dm_adapter(self, policy="owner-only"):
        adapter = self.make_adapter()
        adapter._dm_policy = policy
        return adapter

    async def dm(self, adapter, msg_id, sender, text):
        frame = {"type": "message", "id": msg_id, "threadId": sender,
                 "threadType": zalo_adapter.THREAD_TYPE_USER, "senderUid": sender,
                 "senderName": "Lan", "text": text}
        with patch.object(zalo_adapter, "_zalo_tools", return_value=zalo_tools):
            await adapter._on_message(frame)

    async def test_without_dm_section_env_policy_decides_as_before(self):
        adapter = self.dm_adapter("owner-only")
        await self.dm(adapter, "d1", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        await self.dm(adapter, "d2", OWNER, "chào bot")
        self.assertEqual(len(self.handled), 1)
        adapter = self.dm_adapter("open")  # adapter mới, self.handled làm lại từ đầu
        await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(len(self.handled), 1)

    async def test_dashboard_list_overrides_env_policy_both_ways(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {MEMBER: {}}}})
        adapter = self.dm_adapter("owner-only")
        await self.dm(adapter, "d1", MEMBER, "chào bot")
        await self.dm(adapter, "d2", STRANGER, "chào bot")
        self.assertEqual([e.source.user_id for e in self.handled], [MEMBER])
        adapter = self.dm_adapter("open")  # adapter mới, self.handled làm lại từ đầu
        await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(self.handled, [], "tệp nói danh sách thì ZALO_DM_POLICY=open không mở thêm")
        self.write({"version": 1, "dm": {"who": "owners", "people": {MEMBER: {}}}})
        await self.dm(adapter, "d4", MEMBER, "chào bot")
        await self.dm(adapter, "d5", OWNER, "chào bot")
        self.assertEqual([e.source.user_id for e in self.handled], [OWNER], "chỉ chủ nhân: người trong danh sách cũng không vào")

    async def test_member_dm_lists_disabled_features_and_skips_people_profile(self):
        from plugins.zalo_tools import people

        self.enterContext(patch.dict(os.environ, {"ZALO_PEOPLE_FILE": os.path.join(self.dir, "people.json")}))
        people.remember_person(MEMBER, name="Lan", note="Giáo viên Hoá")
        self.write({"version": 1, "dm": {"who": "everyone", "features": {"web": False, "people": False}}})
        adapter = self.dm_adapter()
        await self.dm(adapter, "d1", MEMBER, "tra giá vàng")
        self.assertIn("Tin nhắn riêng này đang tắt: tra cứu web, sổ người quen", self.handled[0].channel_context)
        self.assertNotIn("Giáo viên Hoá", self.handled[0].text)
        await self.dm(adapter, "d2", OWNER, "tra giá vàng")
        self.assertNotIn("đang tắt", self.handled[1].channel_context or "")

    async def test_errors_and_half_install_fall_back_to_env_policy_never_wider(self):
        self.write({"version": 1, "dm": {"who": "everyone"}})
        adapter = self.dm_adapter("owner-only")
        with patch.object(gp, "dm_allows", side_effect=RuntimeError("hỏng")), \
                patch.object(gp, "dm_settings", side_effect=RuntimeError("hỏng")), \
                self.assertLogs(zalo_adapter.logger, level="WARNING"):
            await self.dm(adapter, "d1", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        with patch.object(zalo_adapter, "_group_permissions", None):
            await self.dm(adapter, "d2", STRANGER, "chào bot")
        self.assertEqual(self.handled, [])
        self.write("{hỏng")
        adapter = self.dm_adapter("open")
        with self.assertLogs(gp.logger, level="WARNING"):
            await self.dm(adapter, "d3", STRANGER, "chào bot")
        self.assertEqual(len(self.handled), 1, "tệp hỏng → ZALO_DM_POLICY=open như trước")

    async def test_stranger_sethome_reply_carries_the_sethome_notice(self):
        self.write({"version": 1, "dm": {"who": "list", "people": {}}})
        adapter = self.dm_adapter()
        sent = []

        async def command(payload, expect_ack=False):
            sent.append(zalo_tools.current_authorization())
            return {"ok": True, "msgId": "1"}

        adapter._command = command
        await self.dm(adapter, "d1", STRANGER, "/sethome")
        self.assertEqual(self.handled, [])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["notice"], "sethome")
        self.assertEqual(sent[0]["actorUid"], STRANGER)
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `HERMES_HOME=E:/Hermes npm run test:py`
Expected: FAIL — `test_dashboard_list_overrides_env_policy_both_ways` (MEMBER bị bỏ qua dù có trong danh sách), `test_stranger_sethome_reply_carries_the_sethome_notice` (`KeyError: 'notice'`).

- [ ] **Step 3: Sửa `adapter.py`**

1. Cổng tin riêng trong `_on_message`: thay
```python
        # có ai khác trong nhóm nhìn thấy để mà kiểm chứng.
        if not is_group and self._dm_policy != "open" and not self._is_owner(sender_uid):
```
bằng
```python
        # có ai khác trong nhóm nhìn thấy để mà kiểm chứng. Dashboard mở thêm
        # được (mục "Nhắn riêng" của permissions.json); không có thì theo ZALO_DM_POLICY.
        if not is_group and not self._dm_allowed(sender_uid):
```
2. Sau dòng `group_rules = self._group_rules(thread_id) if is_group else None` thêm:
```python
        # Nút tính năng khi nhắn riêng (mục "dm"); chủ nhân không bao giờ bị chặn.
        dm_rules = self._dm_rules(sender_uid) if not is_group and not is_owner else None
```
3. Ngay sau khối "Không hứa suông" của nhóm (kết thúc bằng `channel_context = f"{channel_context}\n{note}" if channel_context else note`, thụt trong `if off:`), ở cùng mức thụt với `if group_rules and not is_owner …`, thêm:
```python
        if dm_rules and _group_permissions is not None:
            off = [feature for feature in _group_permissions.DM_FEATURES if not dm_rules["features"][feature]]
            if off:
                labels = ", ".join(_group_permissions.FEATURE_LABELS[feature] for feature in off)
                note = (f"[Tin nhắn riêng này đang tắt: {labels}. Đừng hứa hay thử làm những việc đó; "
                        "nếu được nhờ, nói rõ chủ bot chưa bật tính năng này khi nhắn riêng.]")
                channel_context = f"{channel_context}\n{note}" if channel_context else note
```
4. Thay
```python
        people_off = bool(group_rules and not is_owner and not group_rules["features"].get("people", True))
```
bằng
```python
        people_off = bool(group_rules and not is_owner and not group_rules["features"].get("people", True)) \
            or bool(dm_rules and not dm_rules["features"].get("people", True))
```
5. Ngay trước `def _skip_inactive_group_cron`, thêm:
```python
    @staticmethod
    def _dm_rules(sender_uid: str) -> Optional[Dict[str, Any]]:
        """Quyền nhắn riêng của người này từ permissions.json; lỗi bất ngờ → None (mọi nút bật như trước)."""
        if _group_permissions is None:
            return None
        try:
            return _group_permissions.dm_settings(sender_uid)
        except Exception as exc:
            logger.warning("[zalo] không đọc được quyền nhắn riêng của %s: %s", sender_uid, exc)
            return None

    def _dm_allowed(self, sender_uid: str) -> bool:
        """Người này có được nhắn riêng với bot không.

        Chủ nhân: luôn được. Còn lại: mục "Nhắn riêng" trên dashboard nếu đã chọn
        (chỉ chủ nhân / danh sách / mọi người); chưa chọn, bản cài dở hoặc đọc
        lỗi → ZALO_DM_POLICY như trước giai đoạn 5 — không bao giờ rộng hơn thế
        chỉ vì một lỗi đọc tệp.
        """
        if self._is_owner(sender_uid):
            return True
        if _group_permissions is not None:
            try:
                verdict = _group_permissions.dm_allows(sender_uid)
            except Exception as exc:
                logger.warning("[zalo] không đọc được quyền nhắn riêng — theo ZALO_DM_POLICY: %s", exc)
                verdict = None
            if verdict is not None:
                return verdict
        return self._dm_policy == "open"

```
6. Trong `_reply_sethome`, thay
```python
        _zalo_tools().set_turn_context(
            sender_uid=sender_uid, thread_id=thread_id, is_group=False,
            is_owner=False, text=text, msg_id=msg_id,
        )
```
bằng
```python
        # Dấu "sethome": kết nối Zalo cho câu này đi dù người lạ chưa được nhắn riêng.
        _zalo_tools().bind_turn({
            "sender_uid": str(sender_uid), "thread_id": str(thread_id), "is_group": False,
            "is_owner": False, "text": str(text or ""), "msg_id": str(msg_id or ""), "sethome": True,
        })
```

- [ ] **Step 4: Chạy test**

Run: `HERMES_HOME=E:/Hermes npm run test:py`
Expected: `Tất cả test Python đều xanh.` (`test_stranger_dm_sethome_gets_only_their_uid` trong `test_zalo_adapter.py` vẫn xanh.)

- [ ] **Step 5: Commit**

```bash
git add hermes-plugin/zalo/adapter.py test_zalo_permissions.py
git commit -m "feat(plugin): cửa vào tin nhắn riêng theo mục Nhắn riêng của dashboard, lùi về ZALO_DM_POLICY khi lỗi

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Dashboard — lưu/đọc mục Nhắn riêng, route `PUT /api/permissions/dm`

**Files:**
- Modify: `dashboard/lib/permissions.js`, `dashboard/lib/permissions.test.js`, `dashboard/routes/permissions.js`, `dashboard/routes/permissions.test.js`, `dashboard/lib/audit-feed.js`, `dashboard/server.js`
- Test: `test_zalo_permissions.py` (hợp đồng JS → Python)

**Interfaces:**
- Consumes: `DM_FEATURE_KEYS`, `DM_WHO`, `normalizeDm` (`../../dm-rules.js`, Task 1); `ZALO_UID` (`./users.js`); `dm_allows`/`dm_disabled_features` (Task 2, cho test hợp đồng).
- Produces:
  - `permissions.js`: `DM_FEATURES` (`[{key,label,hint}]` × 8), `makeDmEnv({ envFile, configFile, inherited }) → () => { legacyWho: 'owners'|'everyone', gatewayOpen: bool }`, `parseDm(body) → { who, features: {8}, people: [{ uid, name, features: {8}|null }] }`, `createPermissionsStore({ …, dmEnv })` có thêm `setDm(settings)`; `get()`/mọi hàm lưu trả thêm `dm: { who, explicit, gatewayOpen, features, people: [{ uid, name, custom, features }] }`.
  - `routes/permissions.js`: `WHO_LABELS`, `describeDm(s)`; mọi phản hồi phân quyền có thêm `dmFeatures`.
  - `buildDeps({ …, inheritedDm })`.

- [ ] **Step 1: Viết test**

`dashboard/lib/permissions.test.js`: đổi dòng import thành
```js
import { createPermissionsStore, FEATURE_KEYS, InvalidPermissions, makeDmEnv, makeGlobalReplyOnlyTagged, normalize, parseDm, parseSettings } from './permissions.js';
```
và thêm vào cuối:
```js
// --- Nhắn riêng (spec §16) ---
const P1 = '1234567890123456';
const P2 = '2234567890123456789';
const dm8 = (over = {}) => ({ web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: true, ...over });

test('nhắn riêng: chưa có mục dm → theo ZALO_DM_POLICY, mọi nút bật; báo Hermes có đang chặn người ngoài không', (t) => {
  const s = setup(t, { dmEnv: () => ({ legacyWho: 'everyone', gatewayOpen: false }) });
  assert.deepEqual(s.store.get().dm, { who: 'everyone', explicit: false, gatewayOpen: false, features: dm8(), people: [] });
});

test('nhắn riêng: lưu ghi who + 8 nút chung, người chỉ ghi nút khác; lưu nhóm sau đó không làm mất mục dm', (t) => {
  const s = setup(t);
  const state = s.store.setDm(parseDm({
    who: 'list', features: dm8({ web: false }),
    people: [{ uid: P1, name: '  Cô   Lan ', features: dm8({ web: true, voice: false }) }, { uid: P2, features: null }, { uid: P1, name: 'trùng', features: null }],
  }));
  assert.deepEqual(s.disk().dm, {
    who: 'list', features: dm8({ web: false }),
    people: { [P1]: { name: 'Cô Lan', features: { web: true, voice: false } }, [P2]: {} },
  });
  assert.deepEqual(state.dm.people, [
    { uid: P1, name: 'Cô Lan', custom: true, features: dm8({ voice: false }) },
    { uid: P2, name: '', custom: false, features: dm8({ web: false }) },
  ]);
  assert.equal(state.dm.explicit, true);
  s.store.setGroup(G, settings({}, { web: false }), 'Tổ Hoá');
  s.store.setDefaults(settings({}, { kb: false }));
  assert.equal(s.disk().dm.who, 'list', 'lưu nhóm/mặc định giữ nguyên mục dm');
  assert.equal(s.disk().version, 1, 'không đổi phiên bản tệp — bản v1.21+ vẫn đọc được');
});

test('parseDm: từ chối who lạ, thiếu nút, nút groupCron, UID là số điện thoại, quá 200 người', () => {
  const ok = { who: 'everyone', features: dm8(), people: [] };
  assert.deepEqual(parseDm(ok), ok);
  const bad = [
    [{ ...ok, who: 'all' }, /Chưa chọn ai/],
    [{ ...ok, features: { ...dm8(), groupCron: true } }, /tính năng/],
    [{ ...ok, features: { web: true } }, /tính năng/],
    [{ ...ok, people: 'x' }, /Danh sách người/],
    [{ ...ok, people: [{ uid: '0912345678' }] }, /không phải UID Zalo — .*\/sethome/],
    [{ ...ok, people: [{ uid: P1, features: { web: false } }] }, /Tính năng riêng/],
    [{ ...ok, people: Array.from({ length: 201 }, (_, i) => ({ uid: String(1234567890123456n + BigInt(i)) })) }, /tối đa 200/],
    [null, /Chưa chọn ai/],
  ];
  for (const [body, re] of bad) assert.throws(() => parseDm(body), (e) => e instanceof InvalidPermissions && re.test(e.message), JSON.stringify(body)?.slice(0, 60));
});

test('makeDmEnv: config.yaml thắng .env; "open" → mọi người; cờ mở cổng của Hermes; đọc lại khi tệp đổi', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-dmenv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  const read = makeDmEnv({ envFile, configFile, inherited: { ZALO_ALLOW_ALL_USERS: 'true' } });
  assert.deepEqual(read(), { legacyWho: 'owners', gatewayOpen: true }, 'không có tệp: mặc định owner-only, cờ từ môi trường dịch vụ');
  let stamp = 1_700_000_000;
  const put = (path, text) => { writeFileSync(path, text); stamp += 10; utimesSync(path, stamp, stamp); };
  put(envFile, 'ZALO_DM_POLICY=open\nZALO_ALLOW_ALL_USERS=false\n');
  assert.deepEqual(read(), { legacyWho: 'everyone', gatewayOpen: false });
  put(configFile, 'platforms:\n  zalo:\n    extra:\n      dm_policy: owner-only\n');
  assert.equal(read().legacyWho, 'owners', 'extra.dm_policy trong config.yaml thắng .env như adapter');
  put(envFile, 'GATEWAY_ALLOW_ALL_USERS=1\n');
  assert.equal(read().gatewayOpen, true);
});
```

`dashboard/routes/permissions.test.js` — thêm vào cuối:
```js
test('nhắn riêng: Chủ bot lưu được, tệp có mục dm, Nhật ký ghi dòng dễ đọc; 401 khi chưa đăng nhập; 400 kèm bước tiếp theo', async (t) => {
  const { call, owner, disk, deps } = await ready(t);
  const dm8 = (over = {}) => ({ web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: true, ...over });
  const payload = { who: 'list', features: dm8({ video: false }), people: [{ uid: '1234567890123456', name: 'Cô Lan', features: dm8({ voice: false }) }] };
  assert.equal((await call('/api/permissions/dm', { method: 'PUT', body: payload })).status, 401);
  const first = await call('/api/permissions', { cookie: owner });
  assert.deepEqual(first.json.dmFeatures.map((f) => f.key), ['web', 'files', 'voice', 'reminders', 'kb', 'people', 'academic', 'video']);
  assert.equal(first.json.dm.explicit, false);
  const saved = await call('/api/permissions/dm', { method: 'PUT', cookie: owner, body: payload });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.dm.who, 'list');
  assert.deepEqual(saved.json.dmFeatures.map((f) => f.key), first.json.dmFeatures.map((f) => f.key));
  assert.deepEqual(disk().dm.people, { '1234567890123456': { name: 'Cô Lan', features: { voice: false, video: true } } });
  const log = readFileSync(join(deps.dir, 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(log.action, 'permissions_dm');
  assert.equal(log.detail, 'Những người trong danh sách · tắt: Video · 1 người trong danh sách (1 chỉnh riêng)');
  const bad = await call('/api/permissions/dm', { method: 'PUT', cookie: owner, body: { ...payload, people: [{ uid: '0912345678' }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /—/);
  const group = await call(`/api/permissions/groups/${G}`, { method: 'PUT', cookie: owner, body: body({}, { web: false }) });
  assert.equal(group.json.dm.who, 'list', 'lưu nhóm trả kèm mục dm để giao diện không mất');
  assert.ok(Array.isArray(group.json.dmFeatures));
});
```

`test_zalo_permissions.py` — trong `_NODE_FIXTURE`: dòng `const { createPermissionsStore, makeGlobalReplyOnlyTagged } = await import(modUrl);` → `const { createPermissionsStore, makeGlobalReplyOnlyTagged, parseDm } = await import(modUrl);`, và ngay sau `for (const step of JSON.parse(stepsJson)) {` thêm dòng `  if (step.dm) { store.setDm(parseDm(step.dm)); continue; }`. Thêm phương thức cuối lớp `DashboardContractTest` (sau `test_s2_…`):
```python
    async def test_s3_dm_section_written_by_dashboard_is_read_by_plugin(self):
        # Lưu nhóm trước và sau mục Nhắn riêng: không lần lưu nào làm mất phần của lần kia.
        all8 = {feature: True for feature in gp.DM_FEATURES}
        lan = "1234567890123456"
        self.dashboard_saves([
            {"group": GROUP_A, "features": {"web": False}},
            {"dm": {"who": "list", "features": {**all8, "video": False},
                    "people": [{"uid": lan, "name": "Cô Lan", "features": {**all8, "voice": False}}]}},
            {"group": GROUP_B, "features": {"kb": False}},
        ])
        self.assertIs(gp.dm_allows(lan), True)
        self.assertIs(gp.dm_allows(MEMBER), False)
        self.assertEqual(gp.dm_disabled_features(lan), ["voice"], "người có nút riêng: video bật lại, thoại tắt")
        self.assertEqual(gp.dm_disabled_features(MEMBER), ["video"])
        self.assertEqual(gp.disabled_features(GROUP_A), ["web"])
        self.assertEqual(gp.disabled_features(GROUP_B), ["kb"])
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test dashboard/lib/permissions.test.js dashboard/routes/permissions.test.js`
Expected: FAIL — `parseDm`/`makeDmEnv` không được export; route `PUT /api/permissions/dm` trả 404.

- [ ] **Step 3: Sửa `dashboard/lib/permissions.js`**

1. Import, sau `import { writeJsonAtomic } from './json-store.js';`:
```js
import { ZALO_UID } from './users.js';
import { DM_FEATURE_KEYS, DM_WHO, normalizeDm } from '../../dm-rules.js';
```
2. Thay khối hằng
```js
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
const SWITCHES = ['active', 'replyOnlyTagged'];
export const GROUP_ID = /^\d{1,32}$/;
const MAX_NAME = 120;
const MAX_GROUPS = 500;
```
bằng
```js
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
// Nút cho tin nhắn riêng (spec §16): 8 nút, không có "Hẹn giờ cho nhóm"; lời gợi ý viết cho một người.
const DM_HINTS = { kb: 'Đọc tài liệu chủ bot đã mở cho mọi người', people: 'Bot nhớ hồ sơ người nhắn để xưng hô đúng' };
export const DM_FEATURES = FEATURES.filter((f) => DM_FEATURE_KEYS.includes(f.key)).map((f) => ({ ...f, hint: DM_HINTS[f.key] || f.hint }));
const SWITCHES = ['active', 'replyOnlyTagged'];
export const GROUP_ID = /^\d{1,32}$/;
const MAX_NAME = 120;
const MAX_GROUPS = 500;
const MAX_DM_PEOPLE = 200;
const MAX_PERSON_NAME = 80;
```
3. Ngay trước chú thích `/** Một lớp: chỉ giữ khoá biết và đúng kiểu boolean — giống `_layer` bên Python. */` thêm:
```js
/**
 * Hai giá trị Hermes đang dùng cho tin nhắn riêng, đọc lại khi .env/config.yaml đổi:
 * - `legacyWho`: ZALO_DM_POLICY ("open" → 'everyone', còn lại → 'owners') — áp khi tệp chưa có mục dm.
 *   Adapter: `extra.get("dm_policy", get_secret("ZALO_DM_POLICY", "owner-only"))` — config.yaml thắng .env.
 * - `gatewayOpen`: ZALO_ALLOW_ALL_USERS hoặc GATEWAY_ALLOW_ALL_USERS bật. Tắt thì Hermes tự chặn mọi người
 *   ngoài chủ nhân trước khi tới bot, nên chọn "danh sách"/"mọi người" chưa có tác dụng.
 * `inherited`: các biến đó trong môi trường dịch vụ, chụp trước khi nạp .env của thư mục bot.
 */
export function makeDmEnv({ envFile, configFile, inherited = {} }) {
  let key = null;
  let value = { legacyWho: 'owners', gatewayOpen: false };
  return () => {
    const next = `${fileStamp(envFile)}|${configFile ? fileStamp(configFile) : '-'}`;
    if (next === key) return value;
    let env = {};
    const text = readText(envFile);
    if (text !== null) {
      try { env = parseEnv(text); } catch { /* .env hỏng: Hermes cũng bỏ qua */ }
    }
    const pick = (name) => (Object.hasOwn(env, name) ? env[name] : inherited[name]);
    let extra;
    if (configFile) {
      try { extra = YAML.parse(readText(configFile) ?? '')?.platforms?.zalo?.extra; } catch { extra = undefined; }
    }
    const policy = isObj(extra) && Object.hasOwn(extra, 'dm_policy') ? extra.dm_policy : (pick('ZALO_DM_POLICY') ?? 'owner-only');
    value = {
      legacyWho: String(policy).trim().toLowerCase() === 'open' ? 'everyone' : 'owners',
      gatewayOpen: truthy(pick('ZALO_ALLOW_ALL_USERS')) || truthy(pick('GATEWAY_ALLOW_ALL_USERS')),
    };
    key = next;
    return value;
  };
}
```
4. Trong `normalize`, thay dòng `return { version: 1, defaults: layer(raw.defaults), groups };` bằng:
```js
  // Mục `dm` (giai đoạn 5) phải sống qua mọi lần lưu nhóm/mặc định.
  const dm = normalizeDm(raw.dm);
  return { version: 1, defaults: layer(raw.defaults), groups, ...(dm ? { dm } : {}) };
```
và ngay sau hàm `normalize` thêm:
```js
/**
 * Kiểm thân PUT /api/permissions/dm: `{ who, features: 8 nút, people: [{ uid, name?, features: 8 nút | null }] }`.
 * `features: null` ở một người = theo nút chung. UID trùng giữ mục đầu.
 */
export function parseDm(body) {
  if (!isObj(body) || !DM_WHO.includes(body.who)) throw new InvalidPermissions('Chưa chọn ai được nhắn riêng với bot — tải lại trang rồi thử lại.');
  const full = (f) => isObj(f) && !Object.keys(f).some((k) => !DM_FEATURE_KEYS.includes(k)) && DM_FEATURE_KEYS.every((k) => typeof f[k] === 'boolean');
  const pick8 = (f) => Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, f[k]]));
  if (!full(body.features)) throw new InvalidPermissions('Danh sách tính năng không hợp lệ — tải lại trang rồi thử lại.');
  if (!Array.isArray(body.people)) throw new InvalidPermissions('Danh sách người không hợp lệ — tải lại trang rồi thử lại.');
  if (body.people.length > MAX_DM_PEOPLE) throw new InvalidPermissions(`Danh sách tối đa ${MAX_DM_PEOPLE} người — bỏ bớt rồi lưu lại.`);
  const seen = new Set();
  const people = [];
  for (const p of body.people) {
    const uid = String(isObj(p) ? p.uid ?? '' : '').trim();
    if (!ZALO_UID.test(uid)) {
      throw new InvalidPermissions(`"${uid.slice(0, 30)}" không phải UID Zalo — UID là dãy 15–22 chữ số; nhờ người đó nhắn /sethome cho bot để biết.`);
    }
    if (p.features != null && !full(p.features)) throw new InvalidPermissions('Tính năng riêng của một người không hợp lệ — tải lại trang rồi thử lại.');
    if (seen.has(uid)) continue;
    seen.add(uid);
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim().slice(0, MAX_PERSON_NAME) : '';
    people.push({ uid, name, features: p.features == null ? null : pick8(p.features) });
  }
  return { who: body.who, features: pick8(body.features), people };
}
```
5. Chữ ký kho: `export function createPermissionsStore({ file, globalReplyOnlyTagged = true }) {` → `export function createPermissionsStore({ file, globalReplyOnlyTagged = true, dmEnv = () => ({ legacyWho: 'owners', gatewayOpen: true }) }) {`
6. Thay hàm `view` bằng:
```js
  /** Mục nhắn riêng đã gộp: chưa có trong tệp → `who` theo ZALO_DM_POLICY (`explicit: false`), mọi nút bật. */
  const dmView = (dm) => {
    const env = dmEnv();
    const features = { ...Object.fromEntries(DM_FEATURE_KEYS.map((k) => [k, true])), ...(dm?.features || {}) };
    const people = Object.entries(dm?.people || {}).map(([uid, p]) => ({
      uid, name: p.name || '', custom: Object.keys(p.features || {}).length > 0, features: { ...features, ...(p.features || {}) },
    }));
    return { who: dm?.who || env.legacyWho, explicit: Boolean(dm?.who), gatewayOpen: env.gatewayOpen, features, people };
  };

  const view = ({ data, exists, corrupt }) => {
    const defaults = merge(builtin(), data.defaults);
    const groups = Object.fromEntries(Object.entries(data.groups).map(([id, g]) => [id, { name: g.name || '', custom: true, ...merge(defaults, g) }]));
    return { exists, corrupt, defaults, groups, dm: dmView(data.dm) };
  };
```
7. Thêm phương thức cuối đối tượng trả về (sau `setGroup(...) { … },`):
```js
    /**
     * Lưu mục nhắn riêng (đã qua parseDm): `who` + đủ 8 nút chung; mỗi người chỉ ghi nút khác nút chung.
     * Tệp vẫn là phiên bản 1 — plugin/dashboard v1.21–1.22 bỏ qua khoá `dm` khi đọc.
     */
    setDm(settings) {
      const { data } = read();
      const people = {};
      for (const p of settings.people) {
        const diff = p.features ? Object.fromEntries(DM_FEATURE_KEYS.filter((k) => p.features[k] !== settings.features[k]).map((k) => [k, p.features[k]])) : {};
        people[p.uid] = { ...(p.name ? { name: p.name } : {}), ...(Object.keys(diff).length ? { features: diff } : {}) };
      }
      data.dm = { who: settings.who, features: { ...settings.features }, people };
      write(data);
      return view({ data, exists: true, corrupt: false });
    },
```

- [ ] **Step 4: Sửa `dashboard/routes/permissions.js`**

1. Import: `import { FEATURES, GROUP_ID, parseSettings } from '../lib/permissions.js';` → `import { DM_FEATURES, FEATURES, GROUP_ID, parseDm, parseSettings } from '../lib/permissions.js';`
2. Ba chỗ `features: FEATURES, ...` (GET `/permissions`, PUT defaults, PUT group) → `features: FEATURES, dmFeatures: DM_FEATURES, ...` (giao diện thay cả `perms` bằng phản hồi, thiếu `dmFeatures` là mất 8 nút).
3. Sau hàm `describeSettings` thêm:
```js
export const WHO_LABELS = { owners: 'Chỉ chủ nhân', list: 'Những người trong danh sách', everyone: 'Mọi người' };

/** Dòng Nhật ký cho mục Nhắn riêng: "Chỉ chủ nhân · tắt: Video · 2 người trong danh sách (1 chỉnh riêng)". */
export function describeDm(s) {
  const off = DM_FEATURES.filter((f) => !s.features[f.key]).map((f) => f.label);
  const custom = s.people.filter((p) => p.features).length;
  return [WHO_LABELS[s.who], off.length ? `tắt: ${off.join(', ')}` : 'bật mọi tính năng',
    `${s.people.length} người trong danh sách${custom ? ` (${custom} chỉnh riêng)` : ''}`].join(' · ');
}
```
4. Ngay trước `r.put('/permissions/groups/:groupId', …` thêm:
```js
  r.put('/permissions/dm', requireAuth, (req, res) => {
    try {
      const s = parseDm(req.body);
      const state = permissions.setDm(s);
      try {
        activity.append({ actor: req.user.username, action: 'permissions_dm', detail: describeDm(s) });
      } catch (err) { console.error('[dashboard] không ghi được Nhật ký phân quyền:', err); }
      res.json({ ok: true, features: FEATURES, dmFeatures: DM_FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });
```

- [ ] **Step 5: Sửa `dashboard/lib/audit-feed.js`** — trong `ACTION_LABELS` sau `permissions_group: …,` thêm `permissions_dm: 'Đổi quyền nhắn riêng',`; trong `REASONS` sau `own_message_not_found: …,` thêm:
```js
  dm_not_allowed: 'Người này chưa được phép nhắn riêng với bot',
  feature_disabled: 'Tính năng đang tắt khi nhắn riêng',
```

- [ ] **Step 6: Sửa `dashboard/server.js`**

1. Import: `import { createPermissionsStore, makeGlobalReplyOnlyTagged } from './lib/permissions.js';` → `import { createPermissionsStore, makeDmEnv, makeGlobalReplyOnlyTagged } from './lib/permissions.js';`
2. Chữ ký: `export function buildDeps({ env = process.env, sidecarRoot = join(here, '..'), inheritedReplyOnlyTagged, inheritedOwners } = {}) {` → thêm `, inheritedDm = {}` trước `} = {}`.
3. Trong `createPermissionsStore({ … })`, sau khối `globalReplyOnlyTagged: makeGlobalReplyOnlyTagged({ … }),` thêm:
```js
      dmEnv: makeDmEnv({ envFile: paths.hermesEnvFile, configFile: paths.hermesConfigFile, inherited: inheritedDm }),
```
4. Trong `main()`, sau `const inheritedOwners = process.env.ZALO_ALLOWED_USERS; // trước khi nạp .env nào` thêm:
```js
  const inheritedDm = Object.fromEntries(['ZALO_DM_POLICY', 'ZALO_ALLOW_ALL_USERS', 'GATEWAY_ALLOW_ALL_USERS'].map((k) => [k, process.env[k]]));
```
và `buildDeps({ sidecarRoot, inheritedReplyOnlyTagged, inheritedOwners })` → `buildDeps({ sidecarRoot, inheritedReplyOnlyTagged, inheritedOwners, inheritedDm })`.

- [ ] **Step 7: Chạy test**

Run: `node --test dashboard/lib/permissions.test.js dashboard/routes/permissions.test.js dashboard/server.test.js dashboard/lib/audit-feed.test.js` rồi `HERMES_HOME=E:/Hermes npm run test:py`
Expected: JS PASS (37 test); Python `Tất cả test Python đều xanh.` (có `test_s3_dm_section_written_by_dashboard_is_read_by_plugin`).

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/permissions.js dashboard/lib/permissions.test.js dashboard/routes/permissions.js dashboard/routes/permissions.test.js dashboard/lib/audit-feed.js dashboard/server.js test_zalo_permissions.py
git commit -m "feat(dashboard): lưu quyền nhắn riêng vào permissions.json (giữ version 1), PUT /api/permissions/dm

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Giao diện mục "Nhắn riêng"

**Files:**
- Create: `dashboard/public/views/dm-permissions.js`
- Modify: `dashboard/public/ui.js`, `dashboard/public/views/permissions.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `GET /api/permissions` → `{ dm, dmFeatures }`, `PUT /api/permissions/dm` (Task 4); `GET /api/chats` → `conversations[{ threadId, threadType, name }]`.
- Produces: `ui.js` `Toggle({ id, checked, onChange, label, hint })` (chuyển từ `views/permissions.js`); `views/dm-permissions.js`: `WHO_OPTIONS`, `MAX_PEOPLE`, `dmDraft(dm)`, `dmPayload(draft)`, `sameDm(a, b)`, `addPerson(draft, uid, name) → { draft } | { error }`, `suggestions(conversations, draft)`, `dmBadge(dm)`, `DmEditor({ dm, features, onSaved, onBack, onDirty })`; `views/permissions.js` `DM_KEY = 'dm'`.

- [ ] **Step 1: Viết test** — `dashboard/public/public.test.js`: trong test "phân quyền: hỏi trước khi bỏ thay đổi…", ngay sau `assert.equal(staysListed(DEFAULTS_KEY, perms, []), true);` thêm `assert.equal(staysListed('dm', perms, []), true, 'mục Nhắn riêng luôn còn');`. Thêm vào cuối tệp:

```js
test('nhắn riêng: bản nháp, thân gửi đi, thêm người (kiểm UID, trùng), gợi ý từ Phiên chat, nhãn danh sách', async () => {
  const { dmDraft, dmPayload, sameDm, addPerson, suggestions, dmBadge, WHO_OPTIONS } = await import('./views/dm-permissions.js');
  const on = { web: true, files: true, voice: true, reminders: true, kb: true, people: true, academic: true, video: true };
  const dm = { who: 'list', explicit: true, gatewayOpen: true, features: { ...on, video: false },
    people: [{ uid: '1234567890123456', name: 'Cô Lan', custom: true, features: { ...on, voice: false } }] };
  const d = dmDraft(dm);
  d.features.web = false;
  assert.equal(dm.features.web, true, 'không sửa nhầm vào dữ liệu máy chủ');
  assert.equal(sameDm(dmDraft(dm), dm), true);
  assert.equal(sameDm(d, dm), false);
  const added = addPerson(dmDraft(dm), ' 2234567890123456 ', 'Thầy Nam');
  assert.equal(added.error, undefined);
  assert.deepEqual(dmPayload(added.draft).people, [
    { uid: '1234567890123456', name: 'Cô Lan', features: { ...on, voice: false } },
    { uid: '2234567890123456', name: 'Thầy Nam', features: null },
  ]);
  assert.match(addPerson(d, '0912345678').error, /không phải số điện thoại — .*\/sethome/);
  assert.match(addPerson(d, '1234567890123456').error, /đã có trong danh sách/);
  const full = { ...d, people: Array.from({ length: 200 }, (_, i) => ({ uid: String(3234567890123456n + BigInt(i)) })) };
  assert.match(addPerson(full, '2234567890123456').error, /tối đa 200/);
  assert.deepEqual(suggestions([
    { threadId: '1234567890123456', threadType: 0, name: 'Cô Lan' },
    { threadId: '5234567890123456', threadType: 0, name: 'Khách' },
    { threadId: '2054797107487294899', threadType: 1, name: 'Nhóm' },
  ], d), [{ uid: '5234567890123456', name: 'Khách' }]);
  assert.deepEqual(dmBadge(dm), { kind: 'ok', text: '1 người' });
  assert.deepEqual(dmBadge({ ...dm, who: 'owners' }), { kind: 'idle', text: 'Chỉ chủ nhân' });
  assert.deepEqual(WHO_OPTIONS.map((o) => o.value), ['owners', 'list', 'everyone']);
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test dashboard/public/public.test.js`
Expected: FAIL — `Cannot find module './views/dm-permissions.js'`, `staysListed('dm', …)` trả `false`.

- [ ] **Step 3: Chuyển `Toggle` sang `ui.js`** — xoá hàm `Toggle` khỏi `dashboard/public/views/permissions.js` và thêm vào `dashboard/public/ui.js` ngay trước `export function PageHead`:

```js
/** Ô bật/tắt có nhãn và dòng gợi ý (Phân quyền Bot: nhóm và nhắn riêng). */
export function Toggle({ id, checked, onChange, label, hint }) {
  return html`<div class="perm-row">
    <label class="check" for=${id}><input id=${id} type="checkbox" checked=${checked}
      aria-describedby=${hint ? `${id}-hint` : undefined} onChange=${(e) => onChange(e.currentTarget.checked)} />${label}</label>
    ${hint ? html`<small id=${`${id}-hint`} class="muted">${hint}</small>` : null}
  </div>`;
}

```

- [ ] **Step 4: Tạo `dashboard/public/views/dm-permissions.js`**

```js
// Mục "Nhắn riêng" trong Phân quyền Bot (spec §16): ai được nhắn riêng với bot, 8 nút tính năng,
// danh sách người kèm tính năng riêng từng người. Lưu là có hiệu lực ngay. Chủ nhân luôn được miễn.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Notice, Toggle } from '../ui.js';

const UID = /^[1-9]\d{14,21}$/;
export const MAX_PEOPLE = 200;

export const WHO_OPTIONS = [
  { value: 'owners', label: 'Chỉ chủ nhân', hint: 'Người khác nhắn riêng thì bot không trả lời (trừ lệnh /sethome để biết UID của chính họ).' },
  { value: 'list', label: 'Chủ nhân và những người trong danh sách', hint: 'Thêm người ở phần Danh sách bên dưới.' },
  { value: 'everyone', label: 'Mọi người', hint: 'Ai nhắn riêng bot cũng trả lời, với các tính năng bật bên dưới. Danh sách dùng để chỉnh tính năng riêng cho từng người.' },
];

/** Bản nháp sửa được, tách khỏi dữ liệu máy chủ. */
export function dmDraft(dm) {
  return {
    who: dm.who,
    features: { ...dm.features },
    people: dm.people.map((p) => ({ uid: p.uid, name: p.name, custom: p.custom, features: { ...p.features } })),
  };
}

/** Thân PUT /api/permissions/dm: người không bật "tính năng riêng" gửi `features: null` (theo nút chung). */
export function dmPayload(d) {
  return {
    who: d.who,
    features: { ...d.features },
    people: d.people.map((p) => ({ uid: p.uid, name: p.name, features: p.custom ? { ...p.features } : null })),
  };
}

export const sameDm = (a, b) => JSON.stringify(dmPayload(a)) === JSON.stringify(dmPayload(b));

/** Thêm một người: `{ draft }` khi được, `{ error }` kèm cách sửa khi không. Tính năng riêng bắt đầu bằng nút chung. */
export function addPerson(d, uid, name = '') {
  const id = String(uid || '').trim();
  if (!UID.test(id)) return { error: 'UID Zalo là dãy 15–22 chữ số, không phải số điện thoại — nhờ người đó nhắn /sethome cho bot để biết.' };
  if (d.people.some((p) => p.uid === id)) return { error: 'Người này đã có trong danh sách.' };
  if (d.people.length >= MAX_PEOPLE) return { error: `Danh sách tối đa ${MAX_PEOPLE} người — bỏ bớt rồi thêm.` };
  const person = { uid: id, name: String(name || '').trim().slice(0, 80), custom: false, features: { ...d.features } };
  return { draft: { ...d, people: [...d.people, person] } };
}

/** Người đã từng nhắn riêng cho bot (từ Phiên chat) mà chưa có trong danh sách — để chọn nhanh. */
export function suggestions(conversations, d) {
  const have = new Set(d.people.map((p) => p.uid));
  return (conversations || [])
    .filter((c) => c.threadType === 0 && UID.test(String(c.threadId)) && !have.has(String(c.threadId)))
    .map((c) => ({ uid: String(c.threadId), name: String(c.name || '') }));
}

/** Nhãn cạnh mục "Nhắn riêng" ở danh sách bên trái. */
export function dmBadge(dm) {
  if (dm.who === 'owners') return { kind: 'idle', text: 'Chỉ chủ nhân' };
  if (dm.who === 'everyone') return { kind: 'warn', text: 'Mọi người' };
  return { kind: 'ok', text: `${dm.people.length} người` };
}

function Person({ p, base, features, onChange, onRemove }) {
  const id = `dm-p-${p.uid}`;
  return html`<li class="dm-person">
    <div class="dm-person-head">
      <span class="owner-main"><strong>${p.name || 'Chưa rõ tên'}</strong><small class="mono muted">${p.uid}</small></span>
      <button type="button" class="btn btn-danger-outline btn-sm" onClick=${onRemove}>Bỏ</button>
    </div>
    <${Toggle} id=${`${id}-custom`} checked=${p.custom} label="Tính năng riêng cho người này"
      hint=${p.custom ? 'Các nút dưới đây chỉ áp cho người này.' : 'Đang theo các nút chung ở trên.'}
      onChange=${(v) => onChange({ custom: v, features: { ...(v ? base : p.features) } })} />
    ${p.custom ? html`<div class="dm-person-features">
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${p.features[f.key]} label=${f.label}
        onChange=${(v) => onChange({ features: { ...p.features, [f.key]: v } })} />`)}
    </div>` : null}
  </li>`;
}

export function DmEditor({ dm, features, onSaved, onBack, onDirty }) {
  const [draft, setDraft] = useState(() => dmDraft(dm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const [known, setKnown] = useState([]);
  const [pick, setPick] = useState('');
  const [uid, setUid] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const dirty = !sameDm(draft, dm);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => () => onDirty(false), []);
  useEffect(() => {
    let alive = true;
    // Gợi ý người đã nhắn riêng cho bot; lịch sử chưa có thì chỉ còn ô nhập UID.
    api('/api/chats').then((r) => { if (alive) setKnown(r.conversations || []); }, () => {});
    return () => { alive = false; };
  }, []);

  const update = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setPerson = (i, patch) => update({ people: draft.people.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const add = (id, nm) => {
    const r = addPerson(draft, id, nm);
    if (r.error) { setAddError(r.error); return; }
    setAddError(''); setDraft(r.draft); setMsg({}); setPick(''); setUid(''); setName('');
  };
  const options = suggestions(known, draft);

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/permissions/dm', { method: 'PUT', body: dmPayload(draft) });
      onSaved(r);
      setDraft(dmDraft(r.dm));
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const ownersOnly = draft.who === 'owners';
  return html`<form onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>Nhắn riêng</h2>
    </header>
    <p class="muted small perm-note">Ai được nhắn riêng với bot và bot được làm gì trong tin nhắn riêng. Chủ nhân bot luôn nhắn riêng được và dùng được mọi tính năng.</p>
    ${dm.explicit ? null : html`<${Notice} kind="info">Đang theo cài đặt lúc cài bot (${WHO_OPTIONS.find((o) => o.value === dm.who)?.label}). Bấm Lưu để quản lý từ đây.<//>`}
    ${!ownersOnly && !dm.gatewayOpen ? html`<${Notice} kind="warn">Trợ lý đang chỉ nhận tin của chủ nhân, nên lựa chọn này chưa có tác dụng. Nhờ người cài đặt đặt <code>ZALO_ALLOW_ALL_USERS=true</code> trong .env của Hermes rồi khởi động lại trợ lý.<//>` : null}
    <fieldset class="perm-set">
      <legend>Ai được nhắn riêng với bot</legend>
      ${WHO_OPTIONS.map((o) => html`<div class="perm-row" key=${o.value}>
        <label class="check" for=${`dm-who-${o.value}`}><input id=${`dm-who-${o.value}`} type="radio" name="dm-who" value=${o.value}
          checked=${draft.who === o.value} aria-describedby=${`dm-who-${o.value}-hint`} onChange=${() => update({ who: o.value })} />${o.label}</label>
        <small id=${`dm-who-${o.value}-hint`} class="muted">${o.hint}</small>
      </div>`)}
    </fieldset>
    <fieldset class="perm-set" disabled=${ownersOnly}>
      <legend>Tính năng khi nhắn riêng</legend>
      ${ownersOnly ? html`<p class="muted small">Chỉ chủ nhân nhắn riêng được, nên các nút này chưa dùng tới.</p>` : null}
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`dm-${f.key}`} checked=${draft.features[f.key]}
        onChange=${(v) => update({ features: { ...draft.features, [f.key]: v } })} label=${f.label} hint=${f.hint} />`)}
    </fieldset>
    <fieldset class="perm-set" disabled=${ownersOnly}>
      <legend>Danh sách (${draft.people.length})</legend>
      ${options.length ? html`<div class="dm-add">
        <label for="dm-pick" class="sr-only">Chọn người đã nhắn riêng cho bot</label>
        <select id="dm-pick" value=${pick} onChange=${(e) => setPick(e.currentTarget.value)}>
          <option value="">Chọn người đã nhắn riêng cho bot…</option>
          ${options.map((o) => html`<option key=${o.uid} value=${o.uid}>${o.name || 'Chưa rõ tên'} · ${o.uid}</option>`)}
        </select>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${!pick}
          onClick=${() => add(pick, options.find((o) => o.uid === pick)?.name)}>Thêm</button>
      </div>` : null}
      <div class="dm-add">
        <label for="dm-uid" class="sr-only">UID Zalo</label>
        <input id="dm-uid" inputmode="numeric" maxlength="22" placeholder="UID Zalo (15–22 chữ số)" value=${uid}
          aria-describedby="dm-add-error" onInput=${(e) => { setUid(e.currentTarget.value); setAddError(''); }} />
        <label for="dm-name" class="sr-only">Tên gợi nhớ</label>
        <input id="dm-name" maxlength="80" placeholder="Tên gợi nhớ (tuỳ chọn)" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        <button type="button" class="btn btn-secondary btn-sm" disabled=${!uid.trim()} onClick=${() => add(uid, name)}>Thêm</button>
      </div>
      <p id="dm-add-error" class="small dm-add-error" aria-live="polite">${addError}</p>
      ${draft.people.length ? html`<ul class="dm-people">
        ${draft.people.map((p, i) => html`<${Person} key=${p.uid} p=${p} base=${draft.features} features=${features}
          onChange=${(patch) => setPerson(i, patch)} onRemove=${() => update({ people: draft.people.filter((_, k) => k !== i) })} />`)}
      </ul>` : html`<p class="muted small">Chưa có ai. ${draft.who === 'list' ? 'Thêm ít nhất một người — nếu không, chỉ chủ nhân nhắn riêng được.' : ''}</p>`}
    </fieldset>
    <div class="row">
      <button class="btn btn-primary" disabled=${busy || !dirty}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      ${dirty ? html`<small class="muted">Có thay đổi chưa lưu.</small>` : null}
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}
```

- [ ] **Step 5: Sửa `dashboard/public/views/permissions.js`**

1. Import + hằng:
```js
import { html, Icon, Live, Notice, PageHead, Spinner, Toggle } from '../ui.js';
import { fold } from '../fold.js';
import { DmEditor, dmBadge } from './dm-permissions.js';

export const DEFAULTS_KEY = 'defaults';
// Mục "Nhắn riêng" ở đầu danh sách; mã nhóm Zalo luôn là số nên không trùng.
export const DM_KEY = 'dm';
```
2. `staysListed`: `return id === DEFAULTS_KEY || Boolean(…` → `return id === DEFAULTS_KEY || id === DM_KEY || Boolean(…`.
3. Câu chú thích của mục Mặc định: `…; tin nhắn riêng không theo bảng này.'}` → `…; tin nhắn riêng chỉnh ở mục Nhắn riêng.'}`.
4. `PageHead` của trang: `sub="Chọn bot được làm gì trong từng nhóm. Lưu là có hiệu lực ngay."` → `sub="Chọn ai được nhắn riêng với bot và bot được làm gì trong từng nhóm. Lưu là có hiệu lực ngay."`.
5. `<div class=${`perm${target ? ' has-sel' : ''}`}>` → `<div class=${`perm${target || selected === DM_KEY ? ' has-sel' : ''}`}>`.
6. Trong `<ul class="conv-list">`, trước `<li>` của "Mặc định cho nhóm mới" thêm:
```js
          <li><button type="button" class=${`conv${selected === DM_KEY ? ' active' : ''}`}
            aria-current=${selected === DM_KEY ? 'true' : undefined} onClick=${() => choose(DM_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="user" size=${16} /> Nhắn riêng</span>
              <span class=${`badge badge-${dmBadge(perms.dm).kind}`}>${dmBadge(perms.dm).text}</span></span>
            <span class="conv-preview">Ai được nhắn riêng với bot và bot được làm gì trong tin nhắn riêng.</span>
          </button></li>
```
7. Khung bên phải: thay
```js
      <section class="card perm-edit" aria-label="Quyền của nhóm">
        ${target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
```
bằng
```js
      <section class="card perm-edit" aria-label=${selected === DM_KEY ? 'Quyền nhắn riêng' : 'Quyền của nhóm'}>
        ${selected === DM_KEY
          ? html`<${DmEditor} key=${DM_KEY} dm=${perms.dm} features=${perms.dmFeatures}
              onSaved=${(r) => setPerms(r)} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
```
và câu trống `Chọn "Mặc định" hoặc một nhóm bên trái để chỉnh.` → `Chọn "Nhắn riêng", "Mặc định" hoặc một nhóm bên trái để chỉnh.`

- [ ] **Step 6: `dashboard/public/style.css`** — ngay sau `.perm-row small { padding-left: 26px; }` thêm:

```css
.check input[type="radio"] { accent-color: var(--brand); }
.dm-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.dm-add input, .dm-add select { flex: 1 1 180px; min-width: 0; }
.dm-add .btn { flex: none; }
.dm-add-error { color: var(--danger); min-height: 1em; margin: 6px 0 0; }
.dm-people { list-style: none; margin: 8px 0 0; padding: 0; }
.dm-person { padding: 10px 0; border-bottom: 1px solid var(--border); }
.dm-person:last-child { border-bottom: 0; }
.dm-person-head { display: flex; align-items: center; gap: 12px; }
.dm-person-features { margin-left: 26px; padding-left: 12px; border-left: 2px solid var(--border); }
```

- [ ] **Step 7: Chạy test + kiểm tay**

Run: `node --test dashboard/public/public.test.js` → PASS.
Kiểm tay (Edge/Chromium, 1280 px và 390 px): Phân quyền Bot → "Nhắn riêng" → chọn "Chủ nhân và những người trong danh sách", nhập `0912345678` → báo lỗi có "/sethome"; nhập UID 16 số + tên → thêm; bật "Tính năng riêng cho người này", tắt "Tin nhắn thoại"; tắt "Video" chung; Lưu → "Đã lưu — bot áp dụng ngay"; nhãn bên trái "1 người"; `permissions.json` có `dm.people["<uid>"].features = { voice: false, video: true }`. Không cảnh báo CSP trong console, không cuộn ngang ở 390 px.

- [ ] **Step 8: Commit**

```bash
git add dashboard/public/ui.js dashboard/public/views/dm-permissions.js dashboard/public/views/permissions.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): mục Nhắn riêng trong Phân quyền Bot — ai được nhắn, 8 nút, tính năng riêng từng người

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Số đo máy chủ + kho cuộn 24 giờ

**Files:**
- Create: `dashboard/lib/host-metrics.js`, `dashboard/lib/health-history.js`, `dashboard/lib/host-metrics.test.js`

**Interfaces:**
- Consumes: `readJson`, `writeFileAtomic` (`json-store.js`).
- Produces: `createCpuMeter({ cpus? }) → { sample(): number }`; `readHost({ cpu, diskPath, osImpl?, statfsImpl?, now? }) → { at, cpuPct, ramPct, ramUsedMb, ramTotalMb, diskPct|null, diskUsedGb|null, diskTotalGb|null, uptimeSec, cores }`; `createHealthHistory({ file, now?, windowMs?, saveEvery? }) → { add(sample), points(): [t, cpu, ram, disk][], flush() }`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/host-metrics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCpuMeter, readHost } from './host-metrics.js';
import { createHealthHistory } from './health-history.js';

const core = (busy, idle) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test('CPU: phần trăm bận trung bình mọi nhân giữa hai lần đo; không đổi gì → 0', () => {
  let snap = [core(100, 900), core(100, 900)];
  const cpu = createCpuMeter({ cpus: () => snap });
  snap = [core(190, 910), core(160, 940)]; // +90/+10 và +60/+40 → 150 bận / 200
  assert.equal(cpu.sample(), 75);
  assert.equal(cpu.sample(), 0);
});

test('readHost: RAM, ổ đĩa (đúng ổ chứa dữ liệu bot), thời gian chạy; ổ đĩa lỗi → null', () => {
  const osImpl = { totalmem: () => 4 * 1024 ** 3, freemem: () => 1024 ** 3, uptime: () => 3600.4, cpus: () => [{}, {}] };
  const seen = [];
  const statfsImpl = (p) => { seen.push(p); return { blocks: 1000, bsize: 1024 ** 2, bavail: 100 }; };
  const s = readHost({ cpu: { sample: () => 12.3 }, diskPath: '/root/.hermes', osImpl, statfsImpl, now: () => 5 });
  assert.deepEqual(s, {
    at: 5, cpuPct: 12.3, ramPct: 75, ramUsedMb: 3072, ramTotalMb: 4096,
    diskPct: 90, diskUsedGb: 0.9, diskTotalGb: 1, uptimeSec: 3600, cores: 2,
  });
  assert.deepEqual(seen, ['/root/.hermes']);
  const broken = readHost({ cpu: { sample: () => 0 }, diskPath: 'Z:/khong-co', osImpl, statfsImpl: () => { throw new Error('ENOENT'); } });
  assert.equal(broken.diskPct, null);
  assert.equal(broken.diskTotalGb, null);
});

test('readHost chạy được trên máy thật (Linux lẫn Windows) không cần lệnh nào', () => {
  const s = readHost({ cpu: createCpuMeter(), diskPath: tmpdir() });
  assert.ok(s.ramPct > 0 && s.ramPct <= 100);
  assert.ok(s.diskPct > 0 && s.diskPct <= 100);
  assert.ok(s.cores >= 1);
});

test('lịch sử 24 giờ: bỏ điểm quá 24 giờ, ghi tệp quyền 600 mỗi 5 điểm, khởi động lại đọc lại; tệp hỏng → trống', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-health-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'health-history.json');
  let clock = 0;
  const h = createHealthHistory({ file, now: () => clock });
  for (let i = 0; i < 5; i++) { clock = i * 60_000; h.add({ at: clock, cpuPct: i, ramPct: 50, diskPct: null }); }
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).points[4], [240_000, 4, 50, null]);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  clock = 24 * 3600_000 + 90_000; // điểm 0 và 1 quá 24 giờ
  const again = createHealthHistory({ file, now: () => clock });
  assert.deepEqual(again.points().map((p) => p[0]), [120_000, 180_000, 240_000]);
  writeFileSync(file, '{hỏng');
  assert.deepEqual(createHealthHistory({ file, now: () => clock }).points(), []);
});
```

- [ ] **Step 2: Chạy để thấy hỏng** — `node --test dashboard/lib/host-metrics.test.js` → FAIL `Cannot find module './host-metrics.js'`.

- [ ] **Step 3: Tạo `dashboard/lib/host-metrics.js`**

```js
/**
 * Số đo máy chủ cho trang Sức khoẻ máy chủ (spec §16.B) — chỉ dùng `node:os` và `fs.statfsSync`,
 * không chạy lệnh nào, chạy giống nhau trên Linux và Windows.
 * RAM "đã dùng" = tổng − khả dụng (`os.freemem()` trên Linux là MemAvailable từ Node 22).
 */
import os from 'node:os';
import { statfsSync } from 'node:fs';

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (used, total) => (total > 0 ? round1((used / total) * 100) : 0);

/** CPU % trung bình mọi nhân giữa hai lần gọi `sample()`. Lần đầu so với lúc tạo. */
export function createCpuMeter({ cpus = os.cpus } = {}) {
  const totals = () => {
    let idle = 0; let all = 0;
    for (const c of cpus()) {
      const t = c.times;
      idle += t.idle;
      all += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle, all };
  };
  let prev = totals();
  return {
    sample() {
      const cur = totals();
      const all = cur.all - prev.all;
      const idle = cur.idle - prev.idle;
      prev = cur;
      return all > 0 ? Math.min(100, Math.max(0, round1(((all - idle) / all) * 100))) : 0;
    },
  };
}

/**
 * Một lần đo. `diskPath`: thư mục dữ liệu của bot (HERMES_HOME) — đo đúng ổ đĩa chứa nó.
 * Ổ đĩa đọc lỗi → các trường đĩa là null (giao diện ghi "Chưa đo được").
 */
export function readHost({ cpu, diskPath, osImpl = os, statfsImpl = statfsSync, now = Date.now }) {
  const total = osImpl.totalmem();
  const used = total - osImpl.freemem();
  let disk = { diskPct: null, diskUsedGb: null, diskTotalGb: null };
  try {
    const s = statfsImpl(diskPath);
    const size = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    disk = { diskPct: pct(size - free, size), diskUsedGb: round1((size - free) / 1024 ** 3), diskTotalGb: round1(size / 1024 ** 3) };
  } catch { /* để null */ }
  return {
    at: now(),
    cpuPct: cpu.sample(),
    ramPct: pct(used, total),
    ramUsedMb: Math.round(used / 1024 ** 2),
    ramTotalMb: Math.round(total / 1024 ** 2),
    ...disk,
    uptimeSec: Math.round(osImpl.uptime()),
    cores: osImpl.cpus().length,
  };
}
```

- [ ] **Step 4: Tạo `dashboard/lib/health-history.js`**

```js
/**
 * Kho cuộn 24 giờ cho biểu đồ Sức khoẻ máy chủ: mỗi phút một điểm `[t, cpu, ram, disk]`.
 * Giữ trong bộ nhớ, ghi `<dashboard>/health-history.json` (quyền 600) mỗi `saveEvery` điểm để khởi động
 * lại không mất biểu đồ. Tệp hỏng/thiếu → bắt đầu trống. Khoảng ~1440 điểm ≈ 40 KB.
 */
import { readJson, writeFileAtomic } from './json-store.js';

const DAY_MS = 24 * 3600_000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function createHealthHistory({ file, now = Date.now, windowMs = DAY_MS, saveEvery = 5 }) {
  const raw = readJson(file, null);
  let points = Array.isArray(raw?.points)
    ? raw.points.filter((p) => Array.isArray(p) && p.length === 4 && num(p[0]) !== null).map((p) => [p[0], num(p[1]), num(p[2]), num(p[3])])
    : [];
  let unsaved = 0;
  const prune = () => { const cut = now() - windowMs; points = points.filter((p) => p[0] >= cut); };
  prune();

  function save() {
    unsaved = 0;
    try { writeFileAtomic(file, JSON.stringify({ v: 1, points })); } catch (e) { console.warn('[health] không ghi được lịch sử:', e.message); }
  }

  return {
    /** Thêm một lần đo của `readHost`. */
    add(sample) {
      points.push([sample.at, num(sample.cpuPct), num(sample.ramPct), num(sample.diskPct)]);
      prune();
      if (++unsaved >= saveEvery) save();
    },
    /** Các điểm trong 24 giờ, cũ trước. */
    points() { prune(); return points.map((p) => [...p]); },
    flush: save,
  };
}
```

- [ ] **Step 5: Chạy test** — `node --test dashboard/lib/host-metrics.test.js` → PASS (4 test). Test "chạy được trên máy thật" phải xanh trên cả Windows lẫn Linux (VPS: chạy lại khi triển khai).

- [ ] **Step 6: Commit**

```bash
git add dashboard/lib/host-metrics.js dashboard/lib/health-history.js dashboard/lib/host-metrics.test.js
git commit -m "feat(dashboard): đo CPU/RAM/ổ đĩa/thời gian chạy không cần lệnh, kho cuộn 24 giờ

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Trạng thái dịch vụ (Linux systemctl / Windows dò cổng)

**Files:**
- Create: `dashboard/lib/services.js`, `dashboard/lib/services.test.js`

**Interfaces:**
- Consumes: không.
- Produces: `UNIT_LABELS`, `parseSystemctl(stdout) → Service[]`, `configPorts(text) → number[]`, `tcpOpen(port, opts?) → Promise<bool>`, `pidAlive(pid, kill?) → bool`, `createServiceChecker({ platform?, hermesHome, sidecarPort?, dashboardPort?, execImpl?, tcpImpl?, readImpl?, killImpl?, now?, ttlMs? }) → { check(): Promise<Service[]> }` với `Service = { id, label, state: 'up'|'down'|'starting'|'missing', detail }`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/services.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { configPorts, createServiceChecker, parseSystemctl, pidAlive, tcpOpen } from './services.js';

const VPS = `9router.service           loaded active running 9Router AI Gateway
caddy.service             loaded active running Caddy
hermes-gateway.service    loaded failed failed  Hermes Agent Gateway - Messaging Platform Integration
● hermes-rag.service      loaded activating start Hermes Agent — RAG MCP service (local retrieval)
zalo-bridge.service       loaded active running 2Anh Zalo Bot sidecar (zca-js bridge for Hermes)
zalo-dashboard.service    loaded active running Zalo dashboard quản trị
hermes-old.service        not-found inactive dead hermes-old.service
`;

test('parseSystemctl: nhãn tiếng Việt, trạng thái chạy/dừng/đang bật/không có; bỏ dấu ● của dịch vụ lỗi', () => {
  const list = parseSystemctl(VPS);
  const by = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.deepEqual(by['zalo-bridge'], { id: 'zalo-bridge', label: 'Kết nối Zalo', state: 'up', detail: 'zalo-bridge.service · active/running' });
  assert.equal(by['hermes-gateway'].state, 'down');
  assert.equal(by['hermes-rag'].state, 'starting');
  assert.equal(by['hermes-old'].state, 'missing');
  assert.equal(by['9router'].label, 'Cổng AI (9router)');
  for (const s of list) assert.doesNotMatch(s.label, /sidecar|bridge|toolset/i, 'nhãn không dùng thuật ngữ hạ tầng');
});

test('Linux: một lệnh systemctl chỉ đọc, có timeout và windowsHide; thiếu dịch vụ lõi thì báo "không có"; có đệm 10 giây', async () => {
  const calls = [];
  let clock = 0;
  const checker = createServiceChecker({
    platform: 'linux', hermesHome: '/root/.hermes', now: () => clock,
    execImpl: async (file, args, opts) => { calls.push([file, args, opts]); return { stdout: '9router.service loaded active running 9Router\n' }; },
  });
  const list = await checker.check();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'systemctl');
  assert.equal(calls[0][1][0], 'list-units');
  assert.ok(!calls[0][1].some((a) => /^(start|stop|restart|enable|disable)$/.test(a)), 'không bao giờ đổi trạng thái dịch vụ');
  assert.deepEqual(calls[0][2], { windowsHide: true, timeout: 5000 });
  assert.deepEqual(list.map((s) => [s.id, s.state]), [['zalo-bridge', 'missing'], ['zalo-dashboard', 'missing'], ['hermes-gateway', 'missing'], ['9router', 'up']]);
  await checker.check();
  assert.equal(calls.length, 1, 'trong 10 giây dùng lại kết quả');
  clock = 11_000;
  await checker.check();
  assert.equal(calls.length, 2);
});

test('Windows: không chạy lệnh nào — dò cổng, gateway.pid còn sống, dịch vụ cục bộ trong config.yaml', async () => {
  const home = 'E:/Hermes';
  const files = {
    [join(home, 'gateway.pid')]: '{"pid": 21336, "kind": "hermes-gateway"}',
    [join(home, 'config.yaml')]: 'model:\n  base_url: http://127.0.0.1:20128/v1\nx: http://localhost:3880\nplatforms:\n  zalo:\n    extra:\n      bridge_url: ws://127.0.0.1:3872\n',
  };
  const open = new Set([3872]);
  const checker = createServiceChecker({
    platform: 'win32', hermesHome: home,
    execImpl: async () => { throw new Error('không được chạy lệnh trên Windows'); },
    tcpImpl: async (port) => open.has(port),
    readImpl: (p) => { if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files[p]; },
    killImpl: (pid) => { if (pid !== 21336) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); },
  });
  assert.deepEqual((await checker.check()).map((s) => [s.id, s.label, s.state]), [
    ['zalo-bridge', 'Kết nối Zalo', 'up'],
    ['zalo-dashboard', 'Dashboard quản trị', 'up'],
    ['hermes-gateway', 'Trợ lý (Hermes)', 'up'],
    ['port-20128', 'Cổng AI (9router)', 'down'],
  ]);
});

test('máy Linux không có systemd → chuyển sang dò cổng', async () => {
  const checker = createServiceChecker({
    platform: 'linux', hermesHome: '/h',
    execImpl: async () => { throw Object.assign(new Error('spawn systemctl ENOENT'), { code: 'ENOENT' }); },
    tcpImpl: async () => false, readImpl: () => { throw new Error('ENOENT'); },
  });
  assert.deepEqual((await checker.check()).map((s) => [s.id, s.state]), [['zalo-bridge', 'down'], ['zalo-dashboard', 'up'], ['hermes-gateway', 'down']]);
});

test('configPorts, pidAlive, tcpOpen thật', async (t) => {
  assert.deepEqual(configPorts('a: http://127.0.0.1:20128/v1\nb: https://localhost:1933\nc: http://10.0.0.1:80\nd: http://127.0.0.1:20128/v1beta'), [20128, 1933]);
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(123, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }), true, 'có nhưng thuộc người dùng khác');
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  assert.equal(await tcpOpen(server.address().port), true);
  const closed = server.address().port;
  await new Promise((r) => server.close(r));
  assert.equal(await tcpOpen(closed, { timeoutMs: 500 }), false);
});
```

- [ ] **Step 2: Chạy để thấy hỏng** — `node --test dashboard/lib/services.test.js` → FAIL `Cannot find module './services.js'`.

- [ ] **Step 3: Tạo `dashboard/lib/services.js`**

```js
/**
 * Trạng thái các dịch vụ của bot cho trang Sức khoẻ máy chủ (spec §16.B). Chỉ ĐỌC, không bật/tắt gì.
 * Linux: một lệnh `systemctl list-units` (windowsHide, timeout 5 s) cho zalo-*, hermes-*, caddy, 9router.
 * Windows (hoặc máy không có systemd): không chạy lệnh nào — dò cổng TCP 127.0.0.1, đọc gateway.pid của
 * Hermes và hỏi hệ điều hành tiến trình còn sống không (`process.kill(pid, 0)`), cùng các dịch vụ cục bộ
 * mà config.yaml của Hermes trỏ tới (vd. 9router ở :20128).
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export const UNIT_LABELS = {
  'zalo-bridge': 'Kết nối Zalo',
  'zalo-dashboard': 'Dashboard quản trị',
  'hermes-gateway': 'Trợ lý (Hermes)',
  caddy: 'Máy chủ web (HTTPS)',
  '9router': 'Cổng AI (9router)',
  'hermes-dashboard': 'Trang quản trị Hermes',
  'hermes-openviking': 'Bộ nhớ dài hạn',
  'hermes-rag': 'Tra cứu tài liệu',
  'hermes-mgmt': 'Dịch vụ quản lý máy chủ',
};
const CORE = ['zalo-bridge', 'zalo-dashboard', 'hermes-gateway'];
const PORT_LABELS = { 20128: 'Cổng AI (9router)', 1933: 'Bộ nhớ dài hạn' };
const ORDER = (id) => { const i = Object.keys(UNIT_LABELS).indexOf(id); return i < 0 ? 99 : i; };

const defaultExec = (file, args, opts) => new Promise((resolve, reject) => {
  execFile(file, args, opts, (err, stdout) => (err ? reject(err) : resolve({ stdout: String(stdout) })));
});

/** Phân tích đầu ra `systemctl list-units --plain --no-legend`: unit load active sub mô tả… */
export function parseSystemctl(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const cols = line.trim().replace(/^[●*]\s*/, '').split(/\s+/);
    if (cols.length < 4 || !cols[0].endsWith('.service')) continue;
    const [unit, load, active, sub] = cols;
    const id = unit.slice(0, -'.service'.length);
    let state = 'down';
    if (active === 'active') state = 'up';
    else if (active === 'activating' || active === 'reloading') state = 'starting';
    if (load !== 'loaded') state = 'missing';
    out.push({ id, label: UNIT_LABELS[id] || cols.slice(4).join(' ') || id, state, detail: `${unit} · ${active}/${sub}` });
  }
  return out;
}

/** Cổng http(s)://127.0.0.1|localhost:<cổng> mà config.yaml của Hermes trỏ tới. */
export function configPorts(text) {
  const ports = new Set();
  for (const m of String(text || '').matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})\b/g)) ports.add(Number(m[1]));
  return [...ports];
}

export function tcpOpen(port, { host = '127.0.0.1', timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Tiến trình còn sống không: EPERM nghĩa là có nhưng thuộc người dùng khác. */
export function pidAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

export function createServiceChecker({
  platform = process.platform, hermesHome, sidecarPort = 3872, dashboardPort = 3880,
  execImpl = defaultExec, tcpImpl = tcpOpen, readImpl = (p) => readFileSync(p, 'utf8'), killImpl = process.kill,
  now = Date.now, ttlMs = 10_000,
}) {
  async function viaSystemctl() {
    const { stdout } = await execImpl('systemctl', [
      'list-units', '--type=service', '--all', '--no-legend', '--plain', '--no-pager',
      'zalo-*', 'hermes-*', 'caddy.service', '9router.service',
    ], { windowsHide: true, timeout: 5000 });
    const found = parseSystemctl(stdout);
    for (const id of CORE) {
      if (!found.some((s) => s.id === id)) found.push({ id, label: UNIT_LABELS[id], state: 'missing', detail: `${id}.service · không có trên máy này` });
    }
    return found.sort((a, b) => ORDER(a.id) - ORDER(b.id));
  }

  async function viaProbes() {
    const list = [];
    list.push({ id: 'zalo-bridge', label: UNIT_LABELS['zalo-bridge'], state: (await tcpImpl(sidecarPort)) ? 'up' : 'down', detail: `cổng ${sidecarPort}` });
    list.push({ id: 'zalo-dashboard', label: UNIT_LABELS['zalo-dashboard'], state: 'up', detail: `cổng ${dashboardPort}` });
    let pid = null;
    try { pid = Number(JSON.parse(readImpl(join(hermesHome, 'gateway.pid'))).pid); } catch { /* chưa chạy lần nào hoặc tệp lạ */ }
    list.push({
      id: 'hermes-gateway', label: UNIT_LABELS['hermes-gateway'], state: pidAlive(pid, killImpl) ? 'up' : 'down',
      detail: pid ? `gateway.pid ${pid}` : 'không có gateway.pid',
    });
    let config = '';
    try { config = readImpl(join(hermesHome, 'config.yaml')); } catch { /* không có config */ }
    for (const port of configPorts(config)) {
      if (port === sidecarPort || port === dashboardPort) continue;
      list.push({ id: `port-${port}`, label: PORT_LABELS[port] || `Dịch vụ cục bộ cổng ${port}`, state: (await tcpImpl(port)) ? 'up' : 'down', detail: `127.0.0.1:${port} (config.yaml của Hermes)` });
    }
    return list;
  }

  let cache = null;
  let inflight = null;
  return {
    /** `[{ id, label, state: 'up'|'down'|'starting'|'missing', detail }]` — `detail` chỉ dành cho Quản trị. */
    async check() {
      if (cache && now() - cache.at < ttlMs) return cache.list;
      if (inflight) return inflight;
      inflight = (async () => {
        let list;
        if (platform === 'win32') list = await viaProbes();
        else {
          try { list = await viaSystemctl(); } catch (err) {
            if (err?.code !== 'ENOENT') console.warn('[health] systemctl lỗi, chuyển sang dò cổng:', err?.message || err);
            list = await viaProbes();
          }
        }
        cache = { at: now(), list };
        return list;
      })().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
```

- [ ] **Step 4: Chạy test** — `node --test dashboard/lib/services.test.js` → PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/services.js dashboard/lib/services.test.js
git commit -m "feat(dashboard): trạng thái dịch vụ — systemctl chỉ đọc trên Linux, dò cổng và gateway.pid trên Windows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Lượt gọi AI và token theo ngày từ `state.db` của Hermes

**Files:**
- Create: `dashboard/lib/ai-usage.js`, `dashboard/lib/ai-usage.test.js`

**Interfaces:**
- Consumes: `readJson`, `writeJsonAtomic`; `node:sqlite`.
- Produces: `UsageUnavailable`, `readUsageTotals(dbPath) → { calls, input, output, cached }`, `vnDate(ms) → 'YYYY-MM-DD'`, `createAiUsage({ dbPath, file, now?, keepDays?, readTotals? }) → { sample(), report(): { since, error: null|'missing'|'unreadable', days: [{ date, calls, input, output, cached }] } }`.

- [ ] **Step 1: Viết test** — tạo `dashboard/lib/ai-usage.test.js`:

```js
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
```

- [ ] **Step 2: Chạy để thấy hỏng** — `node --test dashboard/lib/ai-usage.test.js` → FAIL `Cannot find module './ai-usage.js'`.

- [ ] **Step 3: Tạo `dashboard/lib/ai-usage.js`**

```js
/**
 * Lượt gọi AI và token theo ngày (spec §16.B) từ CSDL của chính Hermes: `<HERMES_HOME>/state.db`,
 * bảng `session_model_usage` (cộng dồn theo phiên — một phiên có thể kéo dài nhiều tuần, nên KHÔNG
 * chia ngày theo `last_seen`). Cách làm: mỗi lần lấy mẫu đọc TỔNG cộng dồn (chỉ đọc), lấy phần tăng so
 * với lần trước và cộng vào ngày hiện tại (giờ Việt Nam). Lưu ở `<dashboard>/ai-usage.json` (quyền 600).
 * Số liệu bắt đầu từ lần lấy mẫu đầu tiên sau khi cài bản này — không đoán ngược quá khứ.
 * Không có tiền: Hermes ghi chi phí 0/"unknown" với cổng AI tuỳ chỉnh, và 9router dùng chung cho
 * nhiều ứng dụng khác trên máy nên con số của nó không phải của riêng bot.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readJson, writeJsonAtomic } from './json-store.js';

const FIELDS = ['calls', 'input', 'output', 'cached'];
const SQL_USAGE = `SELECT COALESCE(SUM(api_call_count), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS input,
  COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(cache_read_tokens), 0) AS cached FROM session_model_usage`;
// Bản Hermes cũ chưa có session_model_usage: số tổng nằm ngay trên bảng sessions.
const SQL_SESSIONS = SQL_USAGE.replace('session_model_usage', 'sessions');

export class UsageUnavailable extends Error {
  constructor(message) { super(message); this.name = 'UsageUnavailable'; }
}

/** Tổng cộng dồn `{ calls, input, output, cached }` — mở CSDL chỉ đọc rồi đóng ngay. */
export function readUsageTotals(dbPath) {
  if (!existsSync(dbPath)) throw new UsageUnavailable('Chưa có state.db của Hermes');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    let row;
    try { row = db.prepare(SQL_USAGE).get(); } catch { row = db.prepare(SQL_SESSIONS).get(); }
    return Object.fromEntries(FIELDS.map((k) => [k, Number(row[k]) || 0]));
  } finally { db.close(); }
}

/** Ngày theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
export const vnDate = (ms) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export function createAiUsage({ dbPath, file, now = Date.now, keepDays = 30, readTotals = readUsageTotals }) {
  let state = readJson(file, { v: 1, since: null, last: null, days: {} });
  if (!state || typeof state !== 'object' || typeof state.days !== 'object' || state.days === null) state = { v: 1, since: null, last: null, days: {} };
  let error = null;
  const save = () => { try { writeJsonAtomic(file, state); } catch (e) { console.warn('[usage] không ghi được:', e.message); } };

  return {
    /** Lấy một mẫu. Không bao giờ ném lỗi — lỗi đọc được giữ lại để trang hiện câu dễ hiểu. */
    sample() {
      let cur;
      try { cur = readTotals(dbPath); error = null; } catch (e) {
        error = e?.name === 'UsageUnavailable' ? 'missing' : 'unreadable';
        if (error === 'unreadable') console.warn('[usage] không đọc được state.db:', e?.message || e);
        return;
      }
      const t = now();
      if (state.last) {
        const day = vnDate(t);
        const bucket = state.days[day] || Object.fromEntries(FIELDS.map((k) => [k, 0]));
        // Tổng giảm (Hermes dọn phiên cũ, thay CSDL): coi phần giảm là 0, lấy mốc mới.
        for (const k of FIELDS) bucket[k] += Math.max(0, cur[k] - (Number(state.last[k]) || 0));
        state.days[day] = bucket;
        const cut = vnDate(t - (keepDays - 1) * 86_400_000);
        for (const d of Object.keys(state.days)) if (d < cut) delete state.days[d];
      } else {
        state.since = t;
      }
      state.last = cur;
      save();
    },
    /** `{ since, error: null|'missing'|'unreadable', days: [{ date, calls, input, output, cached }] }` — cũ trước. */
    report() {
      return {
        since: state.since,
        error,
        days: Object.entries(state.days).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v })),
      };
    },
  };
}
```

- [ ] **Step 4: Chạy test** — PASS (3 test). Kiểm đọc thật, chỉ đọc: `node -e "import('./dashboard/lib/ai-usage.js').then(m => console.log(m.readUsageTotals('E:/Hermes/state.db')))"` → in `{ calls, input, output, cached }` là số (ví dụ 07/10: `calls: 6588`).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/ai-usage.js dashboard/lib/ai-usage.test.js
git commit -m "feat(dashboard): lượt gọi AI và token theo ngày từ state.db của Hermes (chỉ đọc, không tiền)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Cảnh báo quá tải, nhịp đo, `GET /api/server-health`

**Files:**
- Create: `dashboard/lib/health-monitor.js`, `dashboard/routes/health.js`, `dashboard/routes/health.test.js`
- Modify: `dashboard/lib/watchdog.js`, `dashboard/lib/watchdog.test.js`, `dashboard/lib/paths.js`, `dashboard/lib/paths.test.js`, `dashboard/app.js`, `dashboard/server.js`, `dashboard/server.test.js`, `dashboard/test-helpers.js`

**Interfaces:**
- Consumes: Task 6 (`createCpuMeter`, `readHost`, `createHealthHistory`), Task 7 (`createServiceChecker`), Task 8 (`createAiUsage`); `requireAuth`.
- Produces:
  - `watchdog.js`: `HOST_ON_PCT = 90`, `HOST_OFF_PCT = 85`, `createWatchdog({ …, diskAfterMs = 0, ramAfterMs = 300_000, cpuAfterMs = 600_000 })` có `checkHost(sample)`; sự cố mới `disk`/`ram`/`cpu` trong `watchdog.json`.
  - `health-monitor.js`: `createHealthMonitor({ diskPath, historyFile, usageFile, stateDb, services, watchdog?, now?, usageEvery?, cpu?, read? }) → { tick(), latest(), points(), usage(), services() }`.
  - `routes/health.js`: `healthRoutes({ health, watchdog })` — `GET /api/server-health`.
  - `paths`: `healthHistoryFile`, `aiUsageFile`, `hermesStateDb`. `deps.health` trong `buildDeps` và `makeDeps`; `test-helpers.js` `fakeHealth(overrides)`.

- [ ] **Step 1: Viết test**

Thêm vào cuối `dashboard/lib/watchdog.test.js`:
```js
// --- Máy chủ quá tải (spec §16.B) ---
const host = (over = {}) => ({ cpuPct: 20, ramPct: 50, diskPct: 40, ...over });

test('ổ đĩa > 90 %: báo ở lần đo thứ hai liên tiếp, kèm số % và link trang Sức khoẻ; hồi phục dưới 85 % thì báo', async (t) => {
  const clock = { t: 0 };
  const { make, sent } = mk(t, { h: ok }, clock); const wd = make();
  await wd.checkHost(host({ diskPct: 93.4 }));
  assert.equal(sent.length, 0, 'một lần đo lẻ chưa báo');
  clock.t = 60_000; await wd.checkHost(host({ diskPct: 93.5 }));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Uyển Nhi: ổ đĩa máy chủ đã đầy 93\.5%/);
  assert.match(sent[0], /https:\/\/d\.vn\/#\/health/);
  clock.t = 120_000; await wd.checkHost(host({ diskPct: 88 }));
  assert.equal(sent.length, 1, '88 % vẫn trên ngưỡng hết (85 %) — chưa báo hồi phục');
  clock.t = 180_000; await wd.checkHost(host({ diskPct: 80 }));
  assert.equal(sent.at(-1), '✅ Uyển Nhi: ổ đĩa máy chủ đã trở lại bình thường.');
});

test('RAM > 90 % phải kéo dài 5 phút, CPU > 90 % kéo dài 10 phút; một lần xuống dưới 85 % thì đếm lại', async (t) => {
  const clock = { t: 0 };
  const { make, sent } = mk(t, { h: ok }, clock); const wd = make();
  for (let m = 0; m <= 4; m++) { clock.t = m * 60_000; await wd.checkHost(host({ ramPct: 95, cpuPct: 97 })); }
  assert.equal(sent.length, 0, '4 phút: chưa báo');
  clock.t = 5 * 60_000; await wd.checkHost(host({ ramPct: 95, cpuPct: 97 }));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /RAM\) máy chủ đang dùng 95% suốt hơn 5 phút/);
  clock.t = 6 * 60_000; await wd.checkHost(host({ ramPct: 95, cpuPct: 50 })); // CPU hạ → đếm lại
  for (let m = 7; m <= 16; m++) { clock.t = m * 60_000; await wd.checkHost(host({ ramPct: 95, cpuPct: 97 })); }
  assert.equal(sent.filter((s) => /CPU/.test(s)).length, 0, 'chưa đủ 10 phút liên tục');
  clock.t = 17 * 60_000; await wd.checkHost(host({ ramPct: 95, cpuPct: 97 }));
  assert.match(sent.at(-1), /CPU máy chủ bận 97% suốt hơn 10 phút/);
  assert.equal(sent.filter((s) => /RAM/.test(s)).length, 1, 'RAM chỉ báo một lần, nhắc lại sau 6 giờ');
  clock.t = 5 * 60_000 + 6 * 3600_000; await wd.checkHost(host({ ramPct: 96, cpuPct: 97 }));
  assert.match(sent.filter((s) => /RAM/.test(s)).at(-1), /96%/);
});

test('máy chủ: khởi động lại dashboard không báo trùng; số đo null giữ nguyên trạng thái; không đụng các sự cố Zalo', async (t) => {
  const clock = { t: 0 };
  const { make, sent } = mk(t, { h: ok }, clock);
  let wd = make();
  await wd.checkHost(host({ diskPct: 95 })); clock.t = 60_000; await wd.checkHost(host({ diskPct: 95 }));
  assert.equal(sent.length, 1);
  wd = make(); // khởi động lại
  clock.t = 120_000; await wd.checkHost(host({ diskPct: 95 }));
  clock.t = 180_000; await wd.checkHost(host({ diskPct: null }));
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(wd.incidents()), ['disk']);
  await wd.tick();
  assert.deepEqual(Object.keys(wd.incidents()), ['disk']);
});
```

Tạo `dashboard/routes/health.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeHealth, loginAs, makeDeps, startApp } from '../test-helpers.js';
import { createWatchdog } from '../lib/watchdog.js';
import { createHealthMonitor } from '../lib/health-monitor.js';

test('Sức khoẻ máy chủ: 401 khi chưa đăng nhập; Chủ bot thấy số đo + nhãn dịch vụ, không thấy tên dịch vụ hệ thống', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/server-health')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const r = await call('/api/server-health', { cookie: owner });
  assert.equal(r.status, 200);
  assert.equal(r.json.host.ramPct, 61);
  assert.equal(r.json.history.stepMs, 60_000);
  assert.equal(r.json.history.points.length, 2);
  assert.deepEqual(r.json.services[0], { id: 'zalo-bridge', label: 'Kết nối Zalo', state: 'up' });
  assert.doesNotMatch(JSON.stringify(r.json.services), /\.service|bridge·|detail/);
  assert.equal(r.json.usage.days[0].calls, 6);
  assert.deepEqual(r.json.threshold, { on: 90, off: 85 });
});

test('Quản trị thấy thêm chi tiết dịch vụ; cảnh báo máy chủ đang mở hiện ở alerts; đọc dịch vụ lỗi vẫn trả số đo', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-hr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 0;
  const watchdog = createWatchdog({ sidecar: { health: async () => ({}) }, notify: async () => {}, restartSidecar: async () => {},
    stateFile: join(dir, 'wd.json'), publicUrl: 'http://localhost:3880', now: () => clock });
  await watchdog.checkHost({ diskPct: 95, ramPct: 40, cpuPct: 10 });
  clock = 60_000; await watchdog.checkHost({ diskPct: 95, ramPct: 40, cpuPct: 10 });
  const deps = makeDeps(t, { watchdog, health: fakeHealth({ services: async () => { throw new Error('systemctl treo'); } }) });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  const r = await call('/api/server-health', { cookie: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.servicesError, true);
  assert.deepEqual(r.json.services, []);
  assert.deepEqual(r.json.alerts, [{ kind: 'disk', since: 0, alerted: true }]);
  const again = makeDeps(t);
  const app2 = await startApp(t, again);
  const admin2 = await loginAs(t, again, app2.call);
  const r2 = await app2.call('/api/server-health', { cookie: admin2 });
  assert.equal(r2.json.services[1].detail, 'hermes-gateway.service · failed/failed');
});

test('health monitor: mỗi lần tick đo một lần, lấy mẫu AI mỗi 5 lần, đưa số đo cho canh gác', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-hm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checked = [];
  let n = 0;
  const m = createHealthMonitor({
    diskPath: dir, historyFile: join(dir, 'h.json'), usageFile: join(dir, 'u.json'), stateDb: join(dir, 'khong-co.db'),
    services: { check: async () => [] }, watchdog: { checkHost: async (s) => { checked.push(s.cpuPct); } },
    read: () => ({ at: ++n * 60_000, cpuPct: n, ramPct: 50, diskPct: 40 }), now: () => n * 60_000,
  });
  assert.equal(m.latest(), null, 'chưa đo lần nào');
  for (let i = 0; i < 6; i++) await m.tick();
  assert.equal(m.latest().cpuPct, 6);
  assert.equal(m.points().length, 6);
  assert.deepEqual(checked, [1, 2, 3, 4, 5, 6]);
  assert.equal(m.usage().error, 'missing', 'chưa có state.db → báo thiếu, không ném lỗi');
});
```

`dashboard/lib/paths.test.js` — cuối test đầu tiên thêm:
```js
  assert.equal(p.healthHistoryFile, join(resolve('/h'), 'zalo', 'dashboard', 'health-history.json'));
  assert.equal(p.aiUsageFile, join(resolve('/h'), 'zalo', 'dashboard', 'ai-usage.json'));
  assert.equal(p.hermesStateDb, join(resolve('/h'), 'state.db'));
```

`dashboard/server.test.js` — `requiredKeys` thêm `'health'`.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `node --test dashboard/lib/watchdog.test.js dashboard/routes/health.test.js dashboard/lib/paths.test.js dashboard/server.test.js`
Expected: FAIL — `wd.checkHost is not a function`, `fakeHealth` không được export, thiếu khoá `health`.

- [ ] **Step 3: Sửa `dashboard/lib/watchdog.js`**

1. Sau dòng import thêm:
```js

// Máy chủ quá tải (spec §16.B): vượt ON thì bắt đầu đếm, chỉ coi là hết khi xuống dưới OFF — tránh báo/hết
// liên tục khi số đo dao động quanh ngưỡng.
export const HOST_ON_PCT = 90;
export const HOST_OFF_PCT = 85;
const HOST_KINDS = [['disk', 'diskPct'], ['ram', 'ramPct'], ['cpu', 'cpuPct']];
```
2. Tham số: sau dòng `zaloAfterMs = 120_000, …, remindAfterMs = 6 * 3600_000,` thêm dòng `  diskAfterMs = 0, ramAfterMs = 300_000, cpuAfterMs = 600_000,`.
3. Sau `const save = …;` thêm `const healthUrl = `${publicUrl}/#/health`;`. Trong `messages`, sau mục `assistant` thêm:
```js
    disk: (n, v) => `⚠️ ${n}: ổ đĩa máy chủ đã đầy ${v}%. Dọn bớt tệp (bản sao lưu, nhật ký cũ) hoặc báo người cài đặt — đầy hẳn thì bot ngừng lưu tin nhắn.\n${healthUrl}`,
    ram: (n, v) => `⚠️ ${n}: bộ nhớ (RAM) máy chủ đang dùng ${v}% suốt hơn 5 phút — bot có thể chậm hoặc tự khởi động lại. Báo người cài đặt nếu kéo dài.\n${healthUrl}`,
    cpu: (n, v) => `⚠️ ${n}: CPU máy chủ bận ${v}% suốt hơn 10 phút — bot có thể trả lời chậm. Báo người cài đặt nếu kéo dài.\n${healthUrl}`,
```
4. Thay `const recovered = { sidecar: 'kết nối Zalo', zalo: 'Zalo', assistant: 'Trợ lý' };` bằng:
```js
  const recovered = {
    sidecar: 'kết nối Zalo đã hoạt động lại', zalo: 'Zalo đã hoạt động lại', assistant: 'Trợ lý đã hoạt động lại',
    disk: 'ổ đĩa máy chủ đã trở lại bình thường', ram: 'bộ nhớ (RAM) máy chủ đã trở lại bình thường', cpu: 'CPU máy chủ đã trở lại bình thường',
  };
```
và trong `update`: `` notify(`✅ ${botName()}: ${recovered[kind]} đã hoạt động lại.`) `` → `` notify(`✅ ${botName()}: ${recovered[kind]}.`) `` (chữ của ba sự cố cũ không đổi).
5. Bảng ngưỡng: `{ sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs }[kind]` → `{ sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs, disk: diskAfterMs, ram: ramAfterMs, cpu: cpuAfterMs }[kind]`.
6. `async function update(kind, active, reason = kind) {` → `async function update(kind, active, reason = kind, detail = undefined) {`; `await notify(messages[reason](botName()));` → `await notify(messages[reason](botName(), detail));`.
7. Trong đối tượng trả về, trước `incidents: …` thêm:
```js
    /**
     * Mỗi lần đo máy chủ (1 phút/lần): ổ đĩa > 90 % (báo ở lần đo thứ hai liên tiếp), RAM > 90 % suốt 5 phút,
     * CPU > 90 % suốt 10 phút. Cùng cách báo một lần / nhắc sau 6 giờ / báo hồi phục như các sự cố khác.
     * Số đo null (vd. không đọc được ổ đĩa) thì giữ nguyên trạng thái.
     */
    async checkHost(sample) {
      for (const [kind, key] of HOST_KINDS) {
        const v = sample?.[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        await update(kind, state[kind] ? v >= HOST_OFF_PCT : v > HOST_ON_PCT, kind, v);
      }
    },
```

- [ ] **Step 4: Tạo `dashboard/lib/health-monitor.js`**

```js
/**
 * Gom phần đo của trang Sức khoẻ máy chủ: mỗi phút một lần đo (CPU/RAM/đĩa) vào kho 24 giờ và đưa cho
 * canh gác; mỗi 5 phút lấy một mẫu lượt gọi AI. server.js gọi `tick()` theo nhịp; route chỉ đọc.
 */
import { createCpuMeter, readHost } from './host-metrics.js';
import { createHealthHistory } from './health-history.js';
import { createAiUsage } from './ai-usage.js';

export function createHealthMonitor({
  diskPath, historyFile, usageFile, stateDb, services, watchdog = null, now = Date.now, usageEvery = 5,
  cpu = createCpuMeter(), read = readHost,
}) {
  const history = createHealthHistory({ file: historyFile, now });
  const usage = createAiUsage({ dbPath: stateDb, file: usageFile, now });
  let latest = null;
  let ticks = 0;
  return {
    async tick() {
      latest = read({ cpu, diskPath, now });
      history.add(latest);
      if (ticks++ % usageEvery === 0) usage.sample();
      if (watchdog) await watchdog.checkHost(latest);
    },
    latest: () => latest,
    points: () => history.points(),
    usage: () => usage.report(),
    services: () => services.check(),
  };
}
```

- [ ] **Step 5: Tạo `dashboard/routes/health.js`**

```js
// Sức khoẻ máy chủ (spec §16.B): Quản trị và Chủ bot đều xem; tên dịch vụ hệ thống, cổng, PID chỉ Quản trị thấy.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { HOST_OFF_PCT, HOST_ON_PCT } from '../lib/watchdog.js';

const HOST_KINDS = ['disk', 'ram', 'cpu'];

export function healthRoutes({ health, watchdog }) {
  const r = express.Router();
  r.get('/server-health', requireAuth, async (req, res) => {
    const admin = req.user.role === 'admin';
    let services = [];
    let servicesError = false;
    try { services = await health.services(); } catch (err) {
      console.error('[dashboard] đọc trạng thái dịch vụ lỗi:', err);
      servicesError = true;
    }
    const incidents = watchdog?.incidents() || {};
    res.json({
      ok: true,
      host: health.latest(),
      history: { stepMs: 60_000, points: health.points() },
      services: services.map((s) => (admin ? s : { id: s.id, label: s.label, state: s.state })),
      servicesError,
      usage: health.usage(),
      alerts: HOST_KINDS.filter((k) => incidents[k]).map((k) => ({ kind: k, since: incidents[k].since, alerted: Boolean(incidents[k].alertedAt) })),
      threshold: { on: HOST_ON_PCT, off: HOST_OFF_PCT },
    });
  });
  return r;
}
```

- [ ] **Step 6: Nối dây**

`dashboard/lib/paths.js` — sau `pendingRestartFile: …,`:
```js
    healthHistoryFile: join(dataDir, 'health-history.json'),
    aiUsageFile: join(dataDir, 'ai-usage.json'),
    hermesStateDb: join(hermesHome, 'state.db'),
```

`dashboard/app.js` — import `import { healthRoutes } from './routes/health.js';` và sau dòng `if (deps.linker) app.use('/api', telegramRoutes(deps));` thêm `if (deps.health) app.use('/api', healthRoutes(deps));`.

`dashboard/server.js`:
1. Import sau `createOwnersStore`:
```js
import { createServiceChecker } from './lib/services.js';
import { createHealthMonitor } from './lib/health-monitor.js';
```
2. Trong `buildDeps`, tách canh gác ra biến để dùng chung — sau dòng `const watchedSidecar = …;`:
```js
  const watchdog = createWatchdog({
    sidecar: watchedSidecar, notify: (text) => linker.broadcast(text),
    restartSidecar,
    stateFile: paths.watchdogFile, publicUrl: config.publicUrl, botName: () => botName,
  });
```
và trong đối tượng trả về thay khối `watchdog: createWatchdog({ … }),` bằng:
```js
    watchdog,
    // Sức khoẻ máy chủ: đo ổ đĩa chứa dữ liệu bot (HERMES_HOME); lượt gọi AI từ state.db của Hermes (chỉ đọc).
    health: createHealthMonitor({
      diskPath: paths.hermesHome, historyFile: paths.healthHistoryFile, usageFile: paths.aiUsageFile, stateDb: paths.hermesStateDb,
      services: createServiceChecker({ hermesHome: paths.hermesHome, sidecarPort, dashboardPort: config.port }), watchdog,
    }),
```
3. Trong `main()`, sau `setInterval(tick, 30_000); tick();`:
```js
  // Đo máy chủ mỗi phút; lần đầu sau 5 giây để CPU có một khoảng đo thật.
  const healthTick = async () => { try { await deps.health.tick(); } catch (e) { console.warn('[health]', e.message); } };
  setTimeout(healthTick, 5_000); setInterval(healthTick, 60_000);
```

`dashboard/test-helpers.js` — trước `export function makeDeps` thêm:
```js
/** Sức khoẻ máy chủ giả: một lần đo, hai điểm lịch sử, ba dịch vụ, một ngày dùng AI. */
export function fakeHealth(overrides = {}) {
  return {
    latest: () => ({ at: 1, cpuPct: 12.5, ramPct: 61, ramUsedMb: 2390, ramTotalMb: 3915, diskPct: 50, diskUsedGb: 14, diskTotalGb: 28, uptimeSec: 3600, cores: 4 }),
    points: () => [[0, 10, 60, 50], [60_000, 12.5, 61, 50]],
    usage: () => ({ since: 0, error: null, days: [{ date: '2026-10-07', calls: 6, input: 85206, output: 4968, cached: 73327 }] }),
    services: async () => [
      { id: 'zalo-bridge', label: 'Kết nối Zalo', state: 'up', detail: 'zalo-bridge.service · active/running' },
      { id: 'hermes-gateway', label: 'Trợ lý (Hermes)', state: 'down', detail: 'hermes-gateway.service · failed/failed' },
      { id: '9router', label: 'Cổng AI (9router)', state: 'up', detail: '9router.service · active/running' },
    ],
    ...overrides,
  };
}
```
và trong `makeDeps`, sau dòng `brand: createBrandStore({ … }),` thêm `    health: fakeHealth(),`.

- [ ] **Step 7: Chạy test** — `node --test dashboard/lib/watchdog.test.js dashboard/routes/health.test.js dashboard/lib/paths.test.js dashboard/server.test.js` → PASS (watchdog 17, health 3, paths 6, server 3).

- [ ] **Step 8: Commit**

```bash
git add dashboard/lib/watchdog.js dashboard/lib/watchdog.test.js dashboard/lib/health-monitor.js dashboard/routes/health.js dashboard/routes/health.test.js dashboard/lib/paths.js dashboard/lib/paths.test.js dashboard/app.js dashboard/server.js dashboard/server.test.js dashboard/test-helpers.js
git commit -m "feat(dashboard): cảnh báo Telegram khi máy chủ quá tải, đo mỗi phút, GET /api/server-health

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Màn "Sức khoẻ máy chủ"

**Files:**
- Create: `dashboard/public/views/health.js`
- Modify: `dashboard/public/views/shell.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `GET /api/server-health` (Task 9).
- Produces: `views/health.js`: `fmtNum`, `fmtPct`, `fmtUptime(sec)`, `level(v)`, `chartSegments(points, col, { to, stepMs })`, `peak(points, col)`, `serviceBadge(state)`, `usageRows(usage)`, `Health({ me })`; biểu tượng `activity`, `server`, `disk` trong `ui.js`; route `#/health`.

- [ ] **Step 1: Viết test** — thêm vào cuối `dashboard/public/public.test.js`:

```js
test('sức khoẻ máy chủ: đoạn biểu đồ ngắt ở chỗ thiếu số đo, thời gian chạy dễ đọc, mức màu, nhãn dịch vụ', async () => {
  const { chartSegments, peak, fmtUptime, fmtPct, level, serviceBadge, usageRows } = await import('./views/health.js');
  const to = 24 * 3600_000;
  const pts = [[0, 0, 50, 100], [60_000, 100, 50, null], [120_000, 50, 50, 100], [10 * 60_000, 20, 50, 100], [to + 1, 5, 5, 5]];
  assert.deepEqual(chartSegments(pts, 1, { to }), ['0.0,120.0 0.4,0.0 0.8,60.0', '4.2,96.0 4.2,96.0']);
  assert.deepEqual(chartSegments(pts, 3, { to }), ['0.0,0.0 0.0,0.0', '0.8,0.0 0.8,0.0', '4.2,0.0 4.2,0.0'], 'null ngắt đoạn; điểm lẻ thành chấm');
  assert.deepEqual(chartSegments([], 1, { to }), []);
  assert.equal(peak(pts, 3), 100);
  assert.equal(peak([[0, null, null, null]], 1), null);
  assert.equal(fmtUptime(45 * 60), '45 phút');
  assert.equal(fmtUptime(5 * 3600 + 12 * 60), '5 giờ 12 phút');
  assert.equal(fmtUptime(2 * 86400 + 3 * 3600), '2 ngày 3 giờ');
  assert.equal(fmtUptime(24 * 86400), '3 tuần 3 ngày');
  assert.equal(fmtPct(null), 'Chưa đo được');
  assert.deepEqual([level(10), level(80), level(90), level(90.1), level(null)], ['ok', 'warn', 'warn', 'danger', 'idle']);
  assert.deepEqual(serviceBadge('missing'), { kind: 'idle', text: 'Không có trên máy này' });
  assert.equal(serviceBadge('lạ').text, 'Không rõ');
  const days = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, calls: i }));
  assert.deepEqual(usageRows({ days }).map((d) => d.calls).slice(0, 2), [19, 18]);
  assert.equal(usageRows({ days }).length, 14);
  assert.deepEqual(usageRows(undefined), []);
});

test('thanh bên: Sức khoẻ máy chủ nằm trong nhóm Hệ thống, cả hai vai trò đều thấy', () => {
  const src = readFileSync(join(root, 'views', 'shell.js'), 'utf8');
  assert.match(src, /'\/health': \{ view: Health \}/);
  assert.ok(src.indexOf("'Sức khoẻ máy chủ'") > src.indexOf("'Thương hiệu'") && src.indexOf("'Sức khoẻ máy chủ'") < src.indexOf("label: 'Quản trị'"));
});
```

- [ ] **Step 2: Chạy để thấy hỏng** — `node --test dashboard/public/public.test.js` → FAIL `Cannot find module './views/health.js'`.

- [ ] **Step 3: Tạo `dashboard/public/views/health.js`**

```js
// Sức khoẻ máy chủ (spec §16.B): CPU/RAM/ổ đĩa/thời gian chạy, biểu đồ 24 giờ (SVG dựng bằng htm,
// hợp CSP), trạng thái dịch vụ, lượt gọi AI theo ngày. Tự làm mới mỗi 30 giây.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Notice, PageHead, Spinner, fmtTime } from '../ui.js';

const REFRESH_MS = 30_000;
const W = 600;
const H = 120;
const DAY_MS = 24 * 3600_000;
const nf = new Intl.NumberFormat('vi-VN');
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
export const fmtNum = (n) => (n == null ? '—' : nf.format(n));
export const fmtPct = (n) => (n == null ? 'Chưa đo được' : `${nf1.format(n)}%`);

/** "3 tuần 2 ngày", "5 giờ 12 phút", "45 phút". */
export function fmtUptime(sec) {
  const m = Math.floor((Number(sec) || 0) / 60);
  const d = Math.floor(m / 1440);
  if (d >= 7) return `${Math.floor(d / 7)} tuần${d % 7 ? ` ${d % 7} ngày` : ''}`;
  if (d >= 1) return `${d} ngày${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} giờ` : ''}`;
  if (m >= 60) return `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  return `${m} phút`;
}

/** Mức màu của một số đo: dưới 75 % ổn, 75–90 % chú ý, trên 90 % nguy. */
export function level(v) {
  if (v == null) return 'idle';
  if (v > 90) return 'danger';
  return v >= 75 ? 'warn' : 'ok';
}

/**
 * Các đoạn đường `points="x,y …"` cho một cột số đo (1 = CPU, 2 = RAM, 3 = ổ đĩa) trong khung 24 giờ đến `to`.
 * Ngắt đoạn khi thiếu số đo hoặc hai điểm cách nhau hơn 2 bước (dashboard tắt) — không vẽ đường giả.
 */
export function chartSegments(points, col, { to, stepMs = 60_000 } = {}) {
  const from = to - DAY_MS;
  const segs = [];
  let cur = [];
  let prevT = null;
  for (const p of points || []) {
    const t = p[0];
    const v = p[col];
    if (t < from || t > to) continue;
    if (v == null || (prevT != null && t - prevT > 2 * stepMs)) { if (cur.length) segs.push(cur); cur = []; }
    if (v != null) {
      const x = ((t - from) / DAY_MS) * W;
      const y = H - (Math.min(100, Math.max(0, v)) / 100) * H;
      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    prevT = t;
  }
  if (cur.length) segs.push(cur);
  // Một điểm lẻ không vẽ được đường — nhân đôi để thành một chấm ngắn.
  return segs.map((s) => (s.length === 1 ? [s[0], s[0]] : s).join(' '));
}

/** Cao nhất trong 24 giờ của một cột, bỏ số đo thiếu. */
export function peak(points, col) {
  const vals = (points || []).map((p) => p[col]).filter((v) => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

export function serviceBadge(state) {
  return {
    up: { kind: 'ok', text: 'Đang chạy' },
    down: { kind: 'danger', text: 'Đã dừng' },
    starting: { kind: 'warn', text: 'Đang khởi động' },
    missing: { kind: 'idle', text: 'Không có trên máy này' },
  }[state] || { kind: 'idle', text: 'Không rõ' };
}

/** 14 ngày gần nhất, mới trước. */
export const usageRows = (usage) => [...(usage?.days || [])].reverse().slice(0, 14);

const ALERT_TEXT = { disk: 'Ổ đĩa đang trên 90 %', ram: 'RAM đang trên 90 %', cpu: 'CPU đang bận trên 90 %' };

function Chart({ title, points, col, to, limit, now }) {
  const segs = chartSegments(points, col, { to });
  const y = (v) => H - (v / 100) * H;
  const top = peak(points, col);
  return html`<figure class="chart-box">
    <figcaption><strong>${title}</strong> <span class="muted small">${now != null ? `hiện ${fmtPct(now)}` : ''}${top != null ? ` · cao nhất ${fmtPct(top)}` : ''}</span></figcaption>
    <svg class="chart" viewBox=${`0 0 ${W} ${H + 18}`} role="img"
      aria-label=${`${title} 24 giờ qua${now != null ? `: hiện ${fmtPct(now)}` : ''}${top != null ? `, cao nhất ${fmtPct(top)}` : ''}`}>
      <line class="chart-grid" x1="0" x2=${W} y1=${y(100)} y2=${y(100)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${y(50)} y2=${y(50)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
      <line class="chart-limit" x1="0" x2=${W} y1=${y(limit)} y2=${y(limit)} />
      ${segs.map((s, i) => html`<polyline key=${i} class="chart-line" points=${s} />`)}
      <text class="chart-axis" x="0" y=${H + 14}>24 giờ trước</text>
      <text class="chart-axis" x=${W / 2} y=${H + 14} text-anchor="middle">12 giờ trước</text>
      <text class="chart-axis" x=${W} y=${H + 14} text-anchor="end">Bây giờ</text>
    </svg>
    ${segs.length ? null : html`<p class="muted small">Chưa có số đo — biểu đồ hiện sau vài phút.</p>`}
  </figure>`;
}

function Tile({ icon, title, value, sub, kind }) {
  return html`<section class="card stat">
    <div class="stat-head"><span class="stat-icon" aria-hidden="true"><${Icon} name=${icon} /></span><h2>${title}</h2></div>
    <p class=${`stat-value stat-${kind}`}>${value}</p>
    ${sub ? html`<p class="muted small">${sub}</p>` : null}
  </section>`;
}

function UsageBars({ rows }) {
  const days = [...rows].reverse();
  const max = Math.max(1, ...days.map((d) => d.calls));
  const bw = W / Math.max(days.length, 1);
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H + 18}`} role="img" aria-label="Số lượt gọi AI mỗi ngày">
    <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
    ${days.map((d, i) => {
      const h = (d.calls / max) * (H - 4);
      return html`<rect key=${d.date} class="chart-bar" x=${(i * bw + bw * 0.15).toFixed(1)} y=${(H - h).toFixed(1)}
        width=${(bw * 0.7).toFixed(1)} height=${h.toFixed(1)}><title>${d.date}: ${fmtNum(d.calls)} lượt</title></rect>`;
    })}
    ${days.length ? html`<text class="chart-axis" x="0" y=${H + 14}>${days[0].date.slice(5).split('-').reverse().join('/')}</text>
      <text class="chart-axis" x=${W} y=${H + 14} text-anchor="end">${days.at(-1).date.slice(5).split('-').reverse().join('/')}</text>` : null}
  </svg>`;
}

function Usage({ usage }) {
  const rows = usageRows(usage);
  const note = usage?.error === 'missing'
    ? 'Chưa tìm thấy dữ liệu của trợ lý trên máy này — số liệu sẽ hiện khi trợ lý đã chạy.'
    : usage?.error === 'unreadable' ? 'Tạm thời chưa đọc được dữ liệu của trợ lý — dashboard sẽ thử lại sau ít phút.' : null;
  return html`<section class="card">
    <h2>Dùng AI theo ngày</h2>
    <p class="muted small">Toàn bộ trợ lý (Zalo, việc hẹn giờ và các kênh khác), theo giờ Việt Nam${usage?.since ? `, tính từ ${fmtTime(usage.since)}` : ''}. Chưa có chi phí bằng tiền: cổng AI không báo giá đáng tin cho riêng bot này.</p>
    ${note ? html`<${Notice} kind="warn">${note}<//>` : null}
    ${rows.length ? html`
      <${UsageBars} rows=${rows} />
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>Ngày</th><th>Lượt gọi AI</th><th>Token gửi đi</th><th>Token nhận về</th><th class="th-wrap">Token dùng lại từ bộ nhớ đệm</th></tr></thead>
        <tbody>${rows.map((d) => html`<tr key=${d.date}>
          <td data-label="Ngày">${d.date.split('-').reverse().join('/')}</td>
          <td data-label="Lượt gọi AI">${fmtNum(d.calls)}</td>
          <td data-label="Token gửi đi">${fmtNum(d.input)}</td>
          <td data-label="Token nhận về">${fmtNum(d.output)}</td>
          <td data-label="Token dùng lại từ bộ nhớ đệm">${fmtNum(d.cached)}</td>
        </tr>`)}</tbody>
      </table></div>`
    : note ? null : html`<p class="muted">Chưa có số liệu — số đầu tiên hiện sau khoảng 5–10 phút.</p>`}
  </section>`;
}

export function Health({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let timer = null;
    const load = async () => {
      try { const r = await api('/api/server-health'); if (alive) { setData(r); setError(''); } } catch (err) {
        if (alive && err.status !== 401) setError(err.message);
      } finally { if (alive) timer = setTimeout(load, REFRESH_MS); }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const head = html`<${PageHead} title="Sức khoẻ máy chủ"
    sub="Cập nhật mỗi phút. Cảnh báo Telegram khi ổ đĩa đầy trên 90 %, RAM trên 90 % suốt 5 phút, hoặc CPU bận trên 90 % suốt 10 phút." />`;
  if (!data) return html`${head}${error ? html`<${Notice} kind="danger">${error}<//>` : html`<${Spinner} />`}`;

  const h = data.host;
  const to = h?.at || Date.now();
  const points = data.history?.points || [];
  return html`${head}
    ${error ? html`<${Notice} kind="warn">Không cập nhật được: ${error} Đang hiện số đo lần trước.<//>` : null}
    ${(data.alerts || []).map((a) => html`<${Notice} key=${a.kind} kind="danger">${ALERT_TEXT[a.kind]} từ ${fmtTime(a.since)}${a.alerted ? ' — đã báo Telegram.' : '.'} ${me.role === 'admin' ? 'Kiểm tra máy chủ hoặc dọn bớt tệp.' : 'Báo người cài đặt nếu kéo dài.'}<//>`)}
    ${h ? html`<div class="grid grid-4">
      <${Tile} icon="activity" title="CPU" value=${fmtPct(h.cpuPct)} kind=${level(h.cpuPct)} sub=${`${h.cores} nhân`} />
      <${Tile} icon="server" title="RAM" value=${fmtPct(h.ramPct)} kind=${level(h.ramPct)}
        sub=${`${nf1.format(h.ramUsedMb / 1024)} / ${nf1.format(h.ramTotalMb / 1024)} GB`} />
      <${Tile} icon="disk" title="Ổ đĩa" value=${fmtPct(h.diskPct)} kind=${level(h.diskPct)}
        sub=${h.diskTotalGb != null ? `${nf1.format(h.diskUsedGb)} / ${nf1.format(h.diskTotalGb)} GB` : 'Không đọc được ổ đĩa chứa dữ liệu bot'} />
      <${Tile} icon="clock" title="Đã chạy liên tục" value=${fmtUptime(h.uptimeSec)} kind="ok" sub="Kể từ lần khởi động máy gần nhất" />
    </div>` : html`<${Notice} kind="info">Đang đo lần đầu — số liệu hiện sau ít giây.<//>`}
    <section class="card">
      <h2>24 giờ qua</h2>
      <p class="muted small">Đường đứt đỏ là ngưỡng cảnh báo ${data.threshold?.on ?? 90} %. Khoảng trống là lúc dashboard không chạy.</p>
      <div class="charts">
        <${Chart} title="CPU" points=${points} col=${1} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.cpuPct} />
        <${Chart} title="RAM" points=${points} col=${2} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.ramPct} />
        <${Chart} title="Ổ đĩa" points=${points} col=${3} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.diskPct} />
      </div>
    </section>
    <section class="card">
      <h2>Dịch vụ</h2>
      ${data.servicesError ? html`<${Notice} kind="warn">Chưa đọc được trạng thái dịch vụ — thử tải lại trang sau ít phút.<//>` : null}
      <ul class="list svc-list">${(data.services || []).map((s) => {
        const b = serviceBadge(s.state);
        return html`<li key=${s.id}><span class="svc-main"><span>${s.label}</span>
          ${s.detail ? html`<small class="mono muted">${s.detail}</small>` : null}</span>
          <span class=${`badge badge-${b.kind} push`}>${b.text}</span></li>`;
      })}</ul>
    </section>
    <${Usage} usage=${data.usage} />`;
}
```

- [ ] **Step 4: Biểu tượng + thanh bên**

`dashboard/public/ui.js` — trong `PATHS`, sau mục `crown`:
```js
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  server: 'M4 3h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 10h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm3-6h.01M7 17h.01',
  disk: 'M22 12H2m3.45-6.89L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01',
```

`dashboard/public/views/shell.js` — `import { Health } from './health.js';`; trong `ROUTES` sau `'/brand': { view: Brand },` thêm `'/health': { view: Health },`; trong nhóm "Hệ thống" sau mục Thương hiệu thêm `{ path: '/health', text: 'Sức khoẻ máy chủ', icon: 'activity' },`.

- [ ] **Step 5: `dashboard/public/style.css`** — trước `/* ---------- Điện thoại ---------- */`:

```css
/* ---------- Sức khoẻ máy chủ ---------- */
.grid-4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.stat-value { font-size: 28px; font-weight: 700; line-height: 1.1; }
.stat-ok { color: var(--ok); }
.stat-warn { color: var(--warn); }
.stat-danger { color: var(--danger); }
.stat-idle { color: var(--muted); }
.charts { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-top: 12px; }
.chart-box { margin: 0; min-width: 0; }
.chart-box figcaption { margin-bottom: 6px; }
.chart { display: block; width: 100%; height: auto; overflow: visible; }
.chart-grid { stroke: var(--border); stroke-width: 1; }
.chart-limit { stroke: var(--danger); stroke-width: 1; stroke-dasharray: 6 4; }
.chart-line { fill: none; stroke: var(--brand); stroke-width: 2; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.chart-bar { fill: var(--brand); }
.chart-axis { font-size: 12px; fill: var(--muted); }
.svc-list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.svc-list li:last-child { border-bottom: 0; }
.svc-main { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
```

- [ ] **Step 6: Chạy test + kiểm tay**

Run: `node --test dashboard/public/public.test.js` → PASS (17 test, gồm quét CSP).
Kiểm tay trên Chromium 1280 px (Quản trị) và 390 px (Chủ bot): `#/health` có 4 ô, 3 biểu đồ đường + vạch đứt đỏ 90 %, khoảng trống ở chỗ không có số đo, danh sách dịch vụ (Chủ bot **không** thấy dòng `….service`), cột + bảng lượt gọi AI; không cảnh báo CSP; 390 px không cuộn ngang.

- [ ] **Step 7: Commit**

```bash
git add dashboard/public/views/health.js dashboard/public/views/shell.js dashboard/public/ui.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): màn Sức khoẻ máy chủ — số đo, biểu đồ 24 giờ SVG, dịch vụ, lượt gọi AI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Tài liệu, phát hành v1.23.0 và danh sách tệp triển khai

**Files:**
- Modify: `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` (2 chỗ), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`

**Interfaces:**
- Consumes: mọi task trên.
- Produces: phiên bản `1.23.0` ở 5 chỗ; tài liệu + kiểm tay GĐ5; danh sách tệp triển khai.

- [ ] **Step 1: README.vi.md** — trong `## Dashboard quản trị`, trước `### Kiểm tay sau khi cài (Giai đoạn 1)`, thêm:

```markdown
### Nhắn riêng

Trong **Phân quyền Bot**, mục **Nhắn riêng** (Quản trị và Chủ bot) chọn ai được nhắn riêng với bot: **Chỉ chủ nhân**, **Chủ nhân và những người trong danh sách**, hoặc **Mọi người**; 8 nút tính năng cho tin nhắn riêng (như nhóm, không có "Hẹn giờ cho nhóm"); và tính năng riêng cho từng người trong danh sách. Thêm người bằng cách chọn từ những ai đã nhắn riêng cho bot, hoặc nhập UID (nhờ người đó nhắn `/sethome` cho bot để biết). Lưu là có hiệu lực ngay. Chủ nhân bot luôn nhắn riêng được và dùng được mọi tính năng.

Chưa lưu lần nào thì bot vẫn theo `ZALO_DM_POLICY` như trước. Muốn người ngoài chủ nhân nhắn được, `.env` của Hermes phải có `ZALO_ALLOW_ALL_USERS=true` — trang sẽ báo vàng nếu chưa có.

### Sức khoẻ máy chủ

Mục **Sức khoẻ máy chủ** (Quản trị và Chủ bot) cho thấy CPU, RAM, ổ đĩa (ổ chứa dữ liệu bot), thời gian máy đã chạy, biểu đồ 24 giờ, trạng thái các dịch vụ của bot và số lượt gọi AI + token theo ngày. Số đo cập nhật mỗi phút. Telegram cảnh báo khi ổ đĩa trên 90 %, RAM trên 90 % suốt 5 phút, hoặc CPU bận trên 90 % suốt 10 phút; báo lại khi đã bình thường. Lượt gọi AI lấy từ dữ liệu của chính trợ lý (`state.db`), tính từ lúc cài bản 1.23.0, không có chi phí bằng tiền. Quản trị thấy thêm tên dịch vụ hệ thống.
```

và sau danh sách kiểm tay GĐ4 thêm:

```markdown
### Kiểm tay sau khi cài (Giai đoạn 5)

- [ ] Nhắn riêng: chọn "Chủ nhân và những người trong danh sách", thêm UID một người thử, Lưu → người đó nhắn riêng được bot trả lời; một người khác nhắn thì bot im (gõ `/sethome` vẫn nhận được UID).
- [ ] Tắt "Tra cứu web" ở Nhắn riêng → người thử nhờ tra web thì bot nói tính năng đang tắt; bật "Tính năng riêng cho người này" + bật lại web cho riêng người đó → tra được.
- [ ] Chủ nhân nhắn riêng vẫn dùng mọi tính năng; lưu một nhóm ở Phân quyền Bot không làm mất mục Nhắn riêng.
- [ ] Sức khoẻ máy chủ: số đo khớp `free -m`/`df -h` (VPS) hoặc Task Manager (Windows) trong khoảng vài %; dịch vụ hiện đúng; Chủ bot không thấy tên `….service`.
- [ ] Sau ~10 phút có số lượt gọi AI hôm nay; nhắn bot một câu → số tăng sau tối đa 5 phút.
- [ ] Nhật ký có dòng "Đổi quyền nhắn riêng" kèm tên mình.
```

Trong bảng `### Cấu hình nằm ở đâu` thêm dòng: `| Ai được nhắn riêng, tính năng khi nhắn riêng | mục \`dm\` trong \`<HERMES_HOME>/zalo/permissions.json\` (sửa ở **Phân quyền Bot → Nhắn riêng**); chưa có thì \`ZALO_DM_POLICY\` |`.

- [ ] **Step 2: README.md** — trong `## Admin dashboard`, sau đoạn "Phase 4 adds …", thêm:

```markdown
Phase 5 adds **Direct messages** and **Server health**. Direct messages (Bot permissions → "Nhắn riêng", both roles) chooses who may DM the bot — owners only, a list of people, or everyone — eight feature switches for DMs (the group switches minus group cron), and per-person overrides. It is stored as an optional `dm` section of `permissions.json` (still `version: 1`, ignored by older readers) and enforced twice: the Hermes plugin gates inbound DMs and tool calls, and the Zalo bridge refuses outgoing commands for DM turns of people who are not allowed (owners are always exempt; `/sethome` replies still go out). Without a saved `dm.who` the bot keeps following `ZALO_DM_POLICY`. Server health (both roles; systemd unit names, ports and PIDs for admins only) shows CPU, RAM, disk and uptime with 24-hour SVG charts sampled every minute, service states (`systemctl list-units` on Linux; port/PID probes on Windows), Telegram alerts for disk > 90 %, RAM > 90 % for 5 minutes or CPU > 90 % for 10 minutes, and AI calls and tokens per day read from the Hermes `state.db` (no money figures: neither Hermes nor 9router reports a reliable per-bot cost).
```

- [ ] **Step 3: CHANGELOG.md** — chèn ngay dưới dòng "Theo chuẩn [Keep a Changelog]…":

```markdown
## [1.23.0] — <ngày phát hành>

### Thêm

- **Dashboard: Nhắn riêng** trong Phân quyền Bot. Chọn ai được nhắn riêng với bot (chỉ chủ nhân, một danh sách người, hoặc mọi người), bật/tắt 8 tính năng khi nhắn riêng, và tính năng riêng cho từng người. Lưu là có hiệu lực ngay; chủ nhân luôn được miễn. Chưa lưu thì bot vẫn theo `ZALO_DM_POLICY`.
- **Dashboard: Sức khoẻ máy chủ.** CPU, RAM, ổ đĩa, thời gian chạy và biểu đồ 24 giờ; trạng thái các dịch vụ của bot; lượt gọi AI và token theo ngày. Chạy trên cả VPS Linux và máy Windows.
- **Cảnh báo Telegram khi máy chủ quá tải**: ổ đĩa trên 90 %, RAM trên 90 % suốt 5 phút, CPU bận trên 90 % suốt 10 phút — báo một lần, nhắc lại sau 6 giờ, báo khi bình thường lại.

### An toàn

- Quyền nhắn riêng được kiểm ở cả plugin Hermes lẫn kết nối Zalo: người không được phép nhắn riêng thì bot không trả lời được dù một lớp gặp lỗi. Đọc quyền lỗi thì quay về `ZALO_DM_POLICY`, không bao giờ mở rộng hơn.
- Trang Sức khoẻ máy chủ chỉ chạy lệnh đọc (`systemctl list-units`) trên Linux, không chạy lệnh nào trên Windows; tên dịch vụ hệ thống chỉ Quản trị thấy.
```

- [ ] **Step 4: Bump phiên bản** `1.22.0` → `1.23.0` ở `package.json`, `package-lock.json` (gốc và `packages[""]`), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`. Kiểm:

```bash
grep -n '"version": "1.23.0"' package.json package-lock.json
grep -n "^version: 1.23.0" hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
```

Expected: 1 dòng ở `package.json`, 2 ở `package-lock.json`, 1 ở mỗi `plugin.yaml`.

- [ ] **Step 5: Chạy toàn bộ** — `HERMES_HOME=E:/Hermes npm test` → JS `# fail 0` (khoảng 556 test, 4 bỏ qua trên Windows; +35 so với v1.22.0); Python khoảng 289 test, kết thúc bằng `Tất cả test Python đều xanh.`

- [ ] **Step 6: Commit**

```bash
git add README.vi.md README.md CHANGELOG.md package.json package-lock.json hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
git commit -m "docs: Nhắn riêng, Sức khoẻ máy chủ, kiểm tay giai đoạn 5 (v1.23.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Triển khai (người điều phối làm sau review cuối)** — cả **ba phần** phải lên cùng lúc, trước khi ai bấm Lưu ở mục Nhắn riêng (dashboard cũ ghi đè sẽ làm rơi mục `dm`).

  **Plugin Hermes** — sao lưu rồi chép `hermes-plugin/zalo/adapter.py`, `hermes-plugin/zalo/plugin.yaml` → `<hermes-agent>/plugins/platforms/zalo/`; `hermes-plugin/zalo_tools/group_permissions.py`, `hermes-plugin/zalo_tools/tools.py`, `hermes-plugin/zalo_tools/plugin.yaml` → `<hermes-agent>/plugins/zalo_tools/` (Lăng Tiêu: `<hermes-agent>` = `E:/Hermes/hermes-agent`). **Khởi động lại gateway** (VPS `systemctl restart hermes-gateway`; Windows chạy ẩn như GĐ3).

  **Kết nối Zalo** — mới `dm-rules.js`; sửa `zalo-policy.js`, `hermes-bridge.js`, `server.js` (Lăng Tiêu: chép vào `E:/Hermes/zca-test`; Uyển Nhi: checkout tag `v1.23.0` ở `/opt/2anh-zalo-bot`). **Khởi động lại** (`systemctl restart zalo-bridge`; Windows như Task 4 GĐ4) — bot tạm ngừng ~1 phút, làm giờ vắng.

  **Dashboard** — mới: `dashboard/public/views/dm-permissions.js`, `dashboard/public/views/health.js`, `dashboard/lib/host-metrics.js`, `dashboard/lib/health-history.js`, `dashboard/lib/services.js`, `dashboard/lib/ai-usage.js`, `dashboard/lib/health-monitor.js`, `dashboard/routes/health.js`; sửa: `dashboard/lib/permissions.js`, `dashboard/routes/permissions.js`, `dashboard/lib/audit-feed.js`, `dashboard/lib/watchdog.js`, `dashboard/lib/paths.js`, `dashboard/app.js`, `dashboard/server.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/views/permissions.js`, `dashboard/public/views/shell.js`; cùng `package.json`/`package-lock.json`. Dashboard import `../../dm-rules.js` nên tệp đó phải có trong thư mục bot. **Khởi động lại** `zalo-dashboard`.

  Sau triển khai: `stat -c %a /root/.hermes/zalo/dashboard/{health-history,ai-usage}.json` → `600`; `/api/server-health` (đã đăng nhập) trên VPS liệt kê 9 dịch vụ; chạy danh sách kiểm tay GĐ5 trên cả hai bot; gắn tag `v1.23.0`, GitHub Release, gộp vào `main`.

---

## Self-Review

**1. Phủ spec (§16):**
- A1 ai được nhắn riêng → Task 1 (`DM_WHO`, `dmVerdict`), 2 (`dm_allows`), 3 (`_dm_allowed`), 4 (`parseDm`, `setDm`), 5 (radio). A2 nút tính năng (8, bỏ groupCron) → Task 2 (`_feature_block`), 3 (dòng ngữ cảnh, sổ người quen), 1 (Nhắc hẹn ở kết nối Zalo), 5. A3 ghi đè theo người → Task 1/2 (gộp `people[uid].features`), 4 (chỉ ghi khác biệt), 5 ("Tính năng riêng cho người này"). A4 chủ nhân miễn + hai lớp → Task 1 (miễn theo UID, test lượt bị hạ quyền), 3 (test chủ nhân ở `owners`). Thay/mở rộng `ZALO_DM_POLICY` → Task 3 (tệp thắng khi có `who`; thiếu → env), 4 (`makeDmEnv` hiển thị giá trị đang dùng).
- B1 số đo + 24 giờ + mẫu mỗi phút, không gói npm, SVG htm → Task 6, 9 (nhịp 60 s), 10. B2 dịch vụ Linux/Windows, lệnh đọc + windowsHide + timeout → Task 7. B3 cảnh báo dùng lại canh gác/linker → Task 9 (`checkHost`, `update` chung). B4 AI + token theo ngày, nguồn, không tiền → Task 8, 10 (câu giải thích).
- Ràng buộc: CSP → Task 5/10 (test quét); tiếng Việt, không thuật ngữ → test nhãn dịch vụ (Task 7) và Chủ bot không thấy `detail` (Task 9); `requireAuth` + vai trò → Task 4, 9; plugin fail-open → Task 3; `permissions.json` tương thích → Task 4 (giữ `version: 1`, giữ `dm` khi lưu nhóm); danh sách tệp triển khai → Task 11.

**2. Placeholder:** chỉ còn `<ngày phát hành>` (CHANGELOG) và `<hermes-agent>` trong bước triển khai — biết lúc phát hành, có chỉ dẫn.

**3. Nhất quán kiểu:** `DM_FEATURE_KEYS` (JS) và `DM_FEATURES` (Python) cùng 8 khoá cùng thứ tự; `normalizeDm` (JS) và `_dm` (Python) cùng quy tắc UID số ASCII ≤ 32 ký tự, mục rác vẫn tính là có tên trong danh sách. `dmVerdict().allowed` ↔ `dm_allows()` cùng ba giá trị. Phản hồi `/api/permissions*` luôn có `dm` + `dmFeatures` (Task 4) — `views/permissions.js` truyền `perms.dm`, `perms.dmFeatures` (Task 5). `createHealthMonitor` trả `latest/points/usage/services` (Task 9) — `routes/health.js` và `fakeHealth` dùng đúng các tên đó; `GET /api/server-health` trả `host, history.points, services, servicesError, usage, alerts, threshold` — `views/health.js` đọc đúng các khoá. `HOST_ON_PCT`/`HOST_OFF_PCT` xuất từ `watchdog.js`, dùng ở route.

**4. Review Focus:** năm mục ở đầu đều có test trong task sở hữu mã. Đã chạy toàn bộ mã của kế hoạch trên một bản sao (clone `feat/dashboard-v2-phase5`): `HERMES_HOME=E:/Hermes npm test` → JS 556 test (552 pass, 4 bỏ qua, 0 fail; trước đó 521), Python 289 test xanh (trước đó 274). Kiểm bằng Chromium (Playwright) trên bản sao chạy với `HERMES_HOME` tạm: 1280 px Quản trị và 390 px Chủ bot — trang Sức khoẻ có 6 đoạn đường (khoảng trống đúng chỗ thiếu số đo), 14 cột AI, Chủ bot 0 dòng chi tiết dịch vụ; Nhắn riêng: UID là số điện thoại bị báo lỗi, thêm người + tính năng riêng + Lưu ghi đúng `dm` vào tệp, nhãn đổi "1 người"/"Mọi người"; không cảnh báo CSP, không cuộn ngang. Đọc thật chỉ đọc: `state.db` của hai máy (schema 28/30) có `session_model_usage`; `systemctl list-units` trên VPS trả 9 đơn vị.
