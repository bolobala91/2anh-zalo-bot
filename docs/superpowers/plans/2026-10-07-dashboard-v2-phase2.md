# Dashboard v2 — Giai đoạn 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm màn **Phiên chat** (danh sách hội thoại + tìm toàn văn, khung tin nhắn có bot canh phải khác màu, cuộn lên tải thêm, ô soạn nhắn tay dưới tên bot) và màn **Nhật ký** (gộp `audit_log` của bot + `activity.jsonl` của dashboard, lọc "chỉ lỗi"), cùng hai mục Tổng quan còn nợ từ GĐ1 cần SQLite: "tin hôm nay" và "5 nhóm sôi nổi nhất". Phát hành v1.20.0.

**Architecture:** Dashboard đọc thẳng `<sidecar>/data/zalo.sqlite` bằng một kết nối **chỉ đọc** (`dashboard/lib/store-reader.js`) — đúng sơ đồ spec §5 ("đọc, mode=ro"), §5.1 và test §13 "sidecar tắt vẫn đọc"; WAL cho đọc song song khi bot đang ghi. Không thêm route `/control/*` nào để đọc. Nhắn tay đi qua `/control/send` sẵn có (ghi `audit_log` với `actor_role="dashboard"`, `actor_uid=<username>`). Tên nhóm lấy từ `/control/groups` qua một lớp đệm riêng của dashboard (`thread-names.js`) để vẫn có tên khi kết nối Zalo tắt; tên người nhắn riêng lấy từ `sender_name` trong SQLite.

**Tech Stack:** Node ≥ 22 ESM, Express 5.2.1, `node:sqlite` (`DatabaseSync`, đã dùng ở `zalo-store.js`), `node:test`, Preact 10 + htm 3 (đã nhúng ở `dashboard/public/vendor/`).

**Spec:** `docs/superpowers/specs/2026-10-07-zalo-dashboard-v2-design.md`

## Global Constraints

- Node ≥ 22, `"type": "module"`; test bằng `node --test`, `import test from 'node:test'`, `import assert from 'node:assert/strict'`. Chạy cả bộ trên Windows: `HERMES_HOME=E:/Hermes npm test`.
- Không thêm dependency npm. `node:sqlite` là module có sẵn của Node.
- SQLite chỉ đọc: `new DatabaseSync(path, { readOnly: true })` **và** `PRAGMA query_only = ON` (spec §11.4 "SQLite `mode=ro`"). Chưa có tệp → ném `StoreUnavailable`, **không bao giờ tạo tệp**. Không thêm route `/control/*` để đọc tin.
- Nhắn tay chỉ qua `sidecar.send({ threadId, threadType, text, actor })` → `POST /control/send`; `threadType` là **số** `0|1`, `text` đã `trim()` và ≤ 2000 ký tự, `actor` = tên đăng nhập dashboard. Việc gửi không ghi thêm `activity.jsonl` (bot đã ghi `audit_log`, spec §11.9).
- Ma trận quyền (spec §6): Quản trị **và** Chủ bot đều xem, tìm, nhắn tay mọi hội thoại; Nhật ký: Chủ bot thấy chữ dễ hiểu, Quản trị thấy thêm mã kỹ thuật (`code`). Mọi route mới đặt `requireAuth`.
- Giới hạn: danh sách hội thoại ≤ 300 mục; trang tin nhắn 50 (tối đa 100); tìm kiếm 30 kết quả/trang; từ khoá 2–100 ký tự; nhắn tay tối đa 10 tin/phút/người dùng; Nhật ký 50 mục/trang.
- Kiểm tham số: `threadId` khớp `^\d{1,32}$`; `type`/`threadType` là `0` hoặc `1`; con trỏ tin nhắn khớp `^\d{1,16}:\d{1,16}$`; `before` của Nhật ký khớp `^\d{1,16}$`. Sai → 400 tiếng Việt kèm bước tiếp theo.
- Tin có nội dung bắt đầu bằng `Mã đăng nhập dashboard:` không bao giờ được trả ra (khung tin, dòng xem trước, kết quả tìm).
- Không trả số điện thoại, cookie, IMEI; tin nhắn trả cho giao diện không có `senderUid`.
- Giao diện: chữ chỉ đi qua htm/Preact (tự thoát HTML); cấm `innerHTML`, `dangerouslySetInnerHTML`, `insertAdjacentHTML`; không thuộc tính `style=` nội tuyến (CSP `style-src 'self'`); link chỉ khi bắt đầu `https://`, luôn `target="_blank" rel="noopener noreferrer"`.
- "Hôm nay" tính từ 0 giờ **giờ Việt Nam (UTC+7)**, không theo múi giờ máy chủ.
- Quy ước lỗi route: 4xx trả `err.message` tiếng Việt; 5xx trả câu chung tiếng Việt có bước tiếp theo + `console.error`; lỗi 401/403 từ bot → 502 (không để trình duyệt hiểu nhầm là hết phiên).
- Giao diện: tiếng Việt thường, không dùng "sidecar", "bridge", "toolset"; mọi lỗi kèm bước tiếp theo.
- Commit theo quy ước repo, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Bot chưa từng chạy / chưa có `zalo.sqlite`** → `/api/chats` trả `{ conversations: [], unavailable: true }`, xem tin trả 503 có bước tiếp theo, Tổng quan có `today: null`, Nhật ký vẫn hiện hoạt động dashboard; dashboard **không tạo** tệp. (Task 1 test `chưa có tệp…`, Task 2 test `chưa có lịch sử…`, Task 4 test `chưa có lịch sử thì today = null`, Task 5 test `chưa có lịch sử: Nhật ký vẫn có hoạt động dashboard`.)
2. **Tin mã đăng nhập dashboard còn sót trong lịch sử** (bản cũ trước 37b02aa, hoặc lỗi lọc sau này) → không hiện trong khung tin, dòng xem trước, kết quả tìm, kể cả tìm đúng 6 chữ số. (Task 1 test `tin mã đăng nhập…`.)
3. **Từ khoá có `%`, `_` hoặc chữ hoa có dấu ("HỌP")** → tìm đúng chữ, không coi là ký tự đại diện, không phân biệt hoa thường tiếng Việt. (Task 1 test `tìm toàn văn…`.)
4. **Bấm Gửi liên tục / nội dung rỗng / quá dài / hội thoại không có trong lịch sử** → 429 sau 10 tin/phút, 400, 400, 404; không có lời gọi tới bot. (Task 3 tests.)
5. **Nhiều tin trùng mili-giây ở ranh giới trang** → cuộn lên tải thêm không mất, không lặp tin; Nhật ký gộp hai nguồn trùng mili-giây cũng không mất mục. (Task 1 test `phân trang…`, Task 5 test `trùng mili-giây…`.)

---

## File Structure

**Dashboard (mới):**
- `dashboard/lib/store-reader.js` — kết nối SQLite chỉ đọc: hội thoại, tin nhắn (con trỏ), tìm kiếm, kiểm hội thoại tồn tại, số liệu hôm nay, tên người gửi, nhật ký bot.
- `dashboard/lib/thread-names.js` — đệm tên nhóm lấy từ bot; tên dự phòng.
- `dashboard/lib/route-errors.js` — `failSidecar`, `failStore` dùng chung cho route.
- `dashboard/lib/audit-feed.js` — gộp `audit_log` + `activity.jsonl`, phân trang, gắn nhãn theo vai trò.
- `dashboard/routes/chats.js` — `GET /api/chats`, `GET /api/chats/search`, `GET /api/chats/:threadId/messages`, `POST /api/chats/:threadId/send`.
- `dashboard/routes/audit.js` — `GET /api/audit`.
- `dashboard/public/views/chats.js`, `dashboard/public/views/audit.js`.

**Dashboard (sửa):** `dashboard/app.js`, `dashboard/server.js` (`buildDeps`), `dashboard/test-helpers.js`, `dashboard/routes/zalo.js` (dùng `failSidecar` — gỡ bản `fail` trùng, mục hoãn của GĐ1), `dashboard/routes/status.js` (`today`), `dashboard/lib/activity-log.js` (bỏ qua dòng hỏng — mục hoãn của GĐ1), `dashboard/public/views/shell.js`, `views/overview.js`, `ui.js`, `style.css`, `public.test.js`.

**Phát hành:** `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`.

Sidecar **không đổi** ở giai đoạn này.

---

### Task 1: `store-reader.js` — đọc lịch sử chat chỉ đọc

**Files:**
- Create: `dashboard/lib/store-reader.js`
- Test: `dashboard/lib/store-reader.test.js`

**Interfaces:**
- Consumes: `openZaloStore` (`zalo-store.js`, chỉ dùng trong test để ghi dữ liệu mẫu đúng lược đồ thật).
- Produces:
  - `export class StoreUnavailable extends Error` (`name === 'StoreUnavailable'`).
  - `export const LOGIN_CODE_PREFIX = 'Mã đăng nhập dashboard:'`.
  - `export function startOfDayVN(nowMs: number): number`.
  - `export function parseCursor(value): { ts: number, id: number } | null`.
  - `export function createStoreReader({ path: string, caseFold = true })` → object:
    - `available(): boolean` — đã mở hoặc tệp tồn tại.
    - `isReadOnly(): boolean`.
    - `listConversations({ limit? }): Array<{ threadId: string, threadType: 0|1, lastAtMs: number, total: number, lastText: string, lastMsgType: string, lastIsSelf: boolean, peerName: string }>` — mới nhất trước, ≤ 300.
    - `getMessages(threadId: string, threadType: 0|1, { before?: string|null, limit? }): { messages: Array<{ id: number, senderName: string, text: string, msgType: string, ts: number, isSelf: boolean }>, nextBefore: string|null }` — trong trang cũ trước mới sau; `nextBefore` dạng `"<ts>:<id>"`.
    - `searchMessages(query: string, { before?, limit? }): { results: Array<{ id, threadId, threadType, senderName, text, msgType, ts, isSelf }>, nextBefore: string|null }` — mới nhất trước, `text` cắt 300 ký tự.
    - `hasThread(threadId: string, threadType: 0|1): boolean`.
    - `todayStats(sinceMs: number): { received: number, sent: number, topGroups: Array<{ threadId: string, count: number }> }`.
    - `senderNames(uids: Iterable<string>): Map<string, string>`.
    - `close(): void`.
  - Mọi hàm đọc ném `StoreUnavailable` khi chưa có tệp. Tài khoản bot = `account_id` của tin mới nhất (bản cài từng đổi tài khoản Zalo chỉ hiện tài khoản đang dùng).

- [ ] **Step 1: Viết test** `dashboard/lib/store-reader.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openZaloStore } from '../../zalo-store.js';
import { createStoreReader, parseCursor, startOfDayVN, StoreUnavailable } from './store-reader.js';

const m = (n, over = {}) => ({
  threadId: '100', threadType: 0, msgId: `m${n}`, senderUid: '100', senderName: 'Lan',
  text: `tin ${n}`, msgType: 'webchat', ts: 1000 + n, isSelf: false, ...over,
});

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-store-'));
  const path = join(dir, 'zalo.sqlite');
  const readers = [];
  let writer = null;
  t.after(() => {
    for (const r of readers) r.close();
    writer?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path,
    write(messages, account = 'bot1') {
      writer ??= openZaloStore({ path });
      writer.insertMessages(account, messages, 'live');
    },
    closeWriter() { writer?.close(); writer = null; },
    reader(opts = {}) { const r = createStoreReader({ path, ...opts }); readers.push(r); return r; },
  };
}

test('chưa có tệp SQLite thì báo StoreUnavailable và không tạo tệp', (t) => {
  const s = setup(t);
  const r = s.reader();
  assert.equal(r.available(), false);
  assert.throws(() => r.listConversations(), StoreUnavailable);
  assert.throws(() => r.getMessages('100', 0), (e) => e.name === 'StoreUnavailable');
  assert.equal(existsSync(s.path), false);
});

test('kết nối chỉ đọc; đọc được khi bot đang ghi và cả khi bot đã tắt', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  const r = s.reader();
  assert.equal(r.isReadOnly(), true);
  assert.equal(r.getMessages('100', 0).messages.length, 1);
  s.write([m(2)]); // bot ghi tiếp trong lúc dashboard đang giữ kết nối đọc
  assert.equal(r.getMessages('100', 0).messages.length, 2);
  s.closeWriter(); // bot tắt
  assert.equal(r.getMessages('100', 0).messages.length, 2);
  assert.equal(s.reader().getMessages('100', 0).messages.length, 2); // mở mới sau khi bot tắt
});

test('danh sách hội thoại: mới nhất trước, xem trước 200 ký tự, tên người nhắn riêng', (t) => {
  const s = setup(t);
  s.write([
    m(1, { threadId: '100', threadType: 0, senderUid: '100', senderName: 'Lan', text: 'Chào bot', ts: 1000 }),
    m(2, { threadId: '100', threadType: 0, senderUid: '999', senderName: 'Uyển Nhi', text: 'Chào Lan', ts: 1100, isSelf: true }),
    m(3, { threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', text: 'x'.repeat(500), ts: 3000 }),
  ]);
  const list = s.reader().listConversations();
  assert.deepEqual(list.map((c) => [c.threadId, c.threadType, c.total]), [['200', 1, 1], ['100', 0, 2]]);
  assert.equal(list[0].lastText.length, 200);
  assert.equal(list[0].peerName, '');
  assert.deepEqual([list[1].peerName, list[1].lastText, list[1].lastIsSelf, list[1].lastAtMs], ['Lan', 'Chào Lan', true, 1100]);
});

test('chỉ hiện tài khoản bot đang dùng (tài khoản có tin mới nhất)', (t) => {
  const s = setup(t);
  s.write([m(1, { threadId: '100', ts: 1000 })], 'tai-khoan-cu');
  s.write([m(2, { threadId: '555', ts: 2000 })], 'bot1');
  assert.deepEqual(s.reader().listConversations().map((c) => c.threadId), ['555']);
});

test('phân trang tin cũ dần theo con trỏ, tin trùng mili-giây không mất không lặp', (t) => {
  const s = setup(t);
  s.write([1, 2, 3, 4, 5].map((n) => m(n, { ts: 5000 })).concat([m(6, { ts: 4000 }), m(7, { ts: 6000 }), m(8, { ts: 3000 })]));
  const r = s.reader();
  const seen = [];
  let before = null;
  let pages = 0;
  do {
    const page = r.getMessages('100', 0, { before, limit: 2 });
    assert.ok(page.messages.length <= 2);
    const ts = page.messages.map((x) => x.ts);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b)); // trong trang: cũ trước
    seen.push(...page.messages.map((x) => x.text));
    before = page.nextBefore;
    pages += 1;
  } while (before && pages < 10);
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  assert.equal(seen.includes('tin 7'), true);
});

test('tin trả ra không có senderUid', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  assert.deepEqual(Object.keys(s.reader().getMessages('100', 0).messages[0]).sort(), ['id', 'isSelf', 'msgType', 'senderName', 'text', 'ts']);
});

test('tin mã đăng nhập dashboard không bao giờ lộ ra: khung tin, xem trước, tìm kiếm', (t) => {
  const s = setup(t);
  s.write([
    m(1, { text: 'Chào bot', ts: 1000 }),
    m(2, { text: 'Mã đăng nhập dashboard: 123456\nMã có hiệu lực 5 phút. Đừng đưa mã này cho ai.', isSelf: true, ts: 2000 }),
  ]);
  const r = s.reader();
  assert.deepEqual(r.getMessages('100', 0).messages.map((x) => x.text), ['Chào bot']);
  assert.equal(r.searchMessages('123456').results.length, 0);
  assert.equal(r.searchMessages('Mã đăng nhập').results.length, 0);
  assert.equal(r.listConversations()[0].lastText, 'Chào bot');
});

test('tìm toàn văn: không phân biệt hoa thường tiếng Việt; % và _ là chữ thường', (t) => {
  const s = setup(t);
  s.write([
    m(1, { text: 'Họp tổ chiều nay' }), m(2, { text: 'giảm 50% học phí' }), m(3, { text: 'giảm 50 nghìn' }),
    m(4, { text: 'tên_tệp.pdf' }), m(5, { text: 'tênXtệp.pdf' }),
    m(6, { threadId: '200', threadType: 1, text: 'họp TỔ lúc 3 giờ', ts: 9000 }),
  ]);
  for (const caseFold of [true, false]) {
    const r = s.reader({ caseFold });
    assert.deepEqual(r.searchMessages('50%').results.map((x) => x.text), ['giảm 50% học phí']);
    assert.deepEqual(r.searchMessages('n_t').results.map((x) => x.text), ['tên_tệp.pdf']);
  }
  const hits = s.reader().searchMessages('HỌP TỔ').results;
  assert.deepEqual(hits.map((x) => [x.threadId, x.threadType]), [['200', 1], ['100', 0]]); // mới nhất trước
});

test('tìm kiếm có con trỏ và cắt chữ 300 ký tự', (t) => {
  const s = setup(t);
  s.write([1, 2, 3].map((n) => m(n, { text: `chung ${n} ${'y'.repeat(400)}` })));
  const r = s.reader();
  const p1 = r.searchMessages('chung', { limit: 2 });
  assert.equal(p1.results.length, 2);
  assert.equal(p1.results[0].text.length, 300);
  const p2 = r.searchMessages('chung', { limit: 2, before: p1.nextBefore });
  assert.equal(p2.results.length, 1);
  assert.equal(p2.nextBefore, null);
});

test('hasThread phân biệt loại hội thoại', (t) => {
  const s = setup(t);
  s.write([m(1, { threadId: '100', threadType: 0 })]);
  const r = s.reader();
  assert.equal(r.hasThread('100', 0), true);
  assert.equal(r.hasThread('100', 1), false);
  assert.equal(r.hasThread('101', 0), false);
});

test('số liệu hôm nay: nhận/gửi và 5 nhóm sôi nổi nhất', (t) => {
  const s = setup(t);
  const since = 100_000;
  const msgs = [m(1, { ts: since - 1 }), m(2, { ts: since + 1, isSelf: true }), m(3, { ts: since + 2 })];
  let n = 10;
  for (const [gid, count] of [['g1', 1], ['g2', 6], ['g3', 3], ['g4', 2], ['g5', 5], ['g6', 4]]) {
    for (let i = 0; i < count; i += 1) msgs.push(m(n++, { threadId: gid.replace('g', '20'), threadType: 1, ts: since + n }));
  }
  s.write(msgs);
  const stats = s.reader().todayStats(since);
  assert.equal(stats.sent, 1);
  assert.equal(stats.received, 1 + 21);
  assert.deepEqual(stats.topGroups, [
    { threadId: '202', count: 6 }, { threadId: '205', count: 5 }, { threadId: '206', count: 4 },
    { threadId: '203', count: 3 }, { threadId: '204', count: 2 },
  ]);
});

test('senderNames lấy tên mới nhất, bỏ tin của bot và UID không hợp lệ', (t) => {
  const s = setup(t);
  s.write([
    m(1, { senderUid: '100', senderName: 'Lan cũ', ts: 1 }),
    m(2, { senderUid: '100', senderName: 'Lan', ts: 2 }),
    m(3, { senderUid: '100', senderName: 'Bot', ts: 3, isSelf: true }),
  ]);
  const names = s.reader().senderNames(['100', '../x', '']);
  assert.deepEqual([...names], [['100', 'Lan']]);
});

test('startOfDayVN và parseCursor', () => {
  // 23:59 giờ VN ngày 7/10 → 0:00 giờ VN ngày 7/10 (= 17:00 UTC ngày 6/10)
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 16, 59)), Date.UTC(2026, 9, 6, 17, 0));
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 17, 0)), Date.UTC(2026, 9, 7, 17, 0));
  assert.deepEqual(parseCursor('5000:3'), { ts: 5000, id: 3 });
  for (const bad of ['x', '5:', ':3', '../5:3', '5:3;', '1'.repeat(17) + ':1', null, undefined]) assert.equal(parseCursor(bad), null);
});
```

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/lib/store-reader.test.js` → `Cannot find module './store-reader.js'`.

- [ ] **Step 3: Cài đặt** `dashboard/lib/store-reader.js`:

```js
/**
 * Đọc lịch sử chat của bot từ <sidecar>/data/zalo.sqlite — CHỈ ĐỌC (spec §5.1, §11.4).
 * SQLite chạy WAL nên đọc song song được khi bot đang ghi, và vẫn đọc được khi bot tắt.
 * Không bao giờ tạo tệp: bot chưa chạy lần nào thì ném StoreUnavailable.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const LOGIN_CODE_PREFIX = 'Mã đăng nhập dashboard:';
const SECRET = `${LOGIN_CODE_PREFIX}%`;
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const END = Number.MAX_SAFE_INTEGER;

export class StoreUnavailable extends Error {
  constructor() { super('Chưa có lịch sử trò chuyện'); this.name = 'StoreUnavailable'; }
}

/** Mốc 0 giờ hôm nay theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function startOfDayVN(nowMs) {
  return Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
}

/** Con trỏ trang "<timestamp_ms>:<rowid>"; sai dạng → null. */
export function parseCursor(value) {
  const match = /^(\d{1,16}):(\d{1,16})$/.exec(String(value ?? ''));
  return match ? { ts: Number(match[1]), id: Number(match[2]) } : null;
}

const fold = (s) => String(s ?? '').normalize('NFC').toLocaleLowerCase('vi');
const pageSize = (n, max, dflt) => {
  const x = Number.parseInt(n, 10);
  return Number.isInteger(x) ? Math.min(Math.max(x, 1), max) : dflt;
};

function toMessage(r) {
  return { id: Number(r.id), senderName: r.sender_name, text: r.text, msgType: r.msg_type, ts: Number(r.timestamp_ms), isSelf: Boolean(r.is_self) };
}

export function createStoreReader({ path, caseFold = true }) {
  let db = null;
  let folding = false;

  function open() {
    if (db) return db;
    if (!path || !existsSync(path)) throw new StoreUnavailable();
    const d = new DatabaseSync(path, { readOnly: true });
    // readOnly chỉ có từ Node 22.12 — query_only chặn mọi lệnh ghi trên mọi bản Node 22.
    d.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 2000;');
    // database.function có từ Node 22.13; bản cũ hơn tìm bằng LIKE (chỉ không phân biệt hoa thường với chữ không dấu).
    folding = caseFold && typeof d.function === 'function';
    if (folding) d.function('zd_fold', { deterministic: true }, fold);
    db = d;
    return d;
  }

  /** Tài khoản Zalo của bot = tài khoản có tin mới nhất. */
  function account() {
    const row = open().prepare('SELECT account_id FROM messages ORDER BY timestamp_ms DESC LIMIT 1').get();
    return row ? row.account_id : null;
  }

  function listConversations({ limit } = {}) {
    const acc = account();
    if (!acc) return [];
    const d = open();
    const threads = d.prepare(`
      SELECT thread_id, thread_type, MAX(timestamp_ms) AS last_at, COUNT(*) AS total
      FROM messages WHERE account_id = ?
      GROUP BY thread_type, thread_id
      ORDER BY last_at DESC LIMIT ?
    `).all(acc, pageSize(limit, 300, 300));
    const last = d.prepare(`
      SELECT text, msg_type, is_self FROM messages
      WHERE account_id = ? AND thread_type = ? AND thread_id = ? AND text NOT LIKE ?
      ORDER BY timestamp_ms DESC, rowid DESC LIMIT 1
    `);
    const peer = d.prepare(`
      SELECT sender_name FROM messages
      WHERE account_id = ? AND thread_type = 0 AND thread_id = ? AND is_self = 0 AND sender_name <> ''
      ORDER BY timestamp_ms DESC LIMIT 1
    `);
    return threads.map((t) => {
      const type = Number(t.thread_type);
      const l = last.get(acc, type, t.thread_id, SECRET);
      return {
        threadId: t.thread_id, threadType: type, lastAtMs: Number(t.last_at), total: Number(t.total),
        lastText: l ? String(l.text).slice(0, 200) : '', lastMsgType: l?.msg_type || '', lastIsSelf: Boolean(l?.is_self),
        peerName: type === 0 ? (peer.get(acc, t.thread_id)?.sender_name || '') : '',
      };
    });
  }

  function getMessages(threadId, threadType, { before = null, limit } = {}) {
    const acc = account();
    if (!acc) return { messages: [], nextBefore: null };
    const size = pageSize(limit, 100, 50);
    const c = before ? parseCursor(before) : null;
    const rows = open().prepare(`
      SELECT rowid AS id, sender_name, text, msg_type, timestamp_ms, is_self FROM messages
      WHERE account_id = ? AND thread_id = ? AND thread_type = ? AND text NOT LIKE ?
        AND (timestamp_ms < ? OR (timestamp_ms = ? AND rowid < ?))
      ORDER BY timestamp_ms DESC, rowid DESC LIMIT ?
    `).all(acc, String(threadId), Number(threadType), SECRET, c?.ts ?? END, c?.ts ?? END, c?.id ?? END, size + 1);
    const page = rows.slice(0, size);
    const oldest = page[page.length - 1];
    const nextBefore = rows.length > size ? `${oldest.timestamp_ms}:${oldest.id}` : null;
    return { messages: page.reverse().map(toMessage), nextBefore };
  }

  function searchMessages(query, { before = null, limit } = {}) {
    const acc = account();
    if (!acc) return { results: [], nextBefore: null };
    const d = open();
    const size = pageSize(limit, 50, 30);
    const c = before ? parseCursor(before) : null;
    const match = folding ? 'instr(zd_fold(text), ?) > 0' : "text LIKE ? ESCAPE '\\'";
    const needle = folding ? fold(query) : `%${String(query).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = d.prepare(`
      SELECT rowid AS id, thread_id, thread_type, sender_name, text, msg_type, timestamp_ms, is_self FROM messages
      WHERE account_id = ? AND ${match} AND text NOT LIKE ?
        AND (timestamp_ms < ? OR (timestamp_ms = ? AND rowid < ?))
      ORDER BY timestamp_ms DESC, rowid DESC LIMIT ?
    `).all(acc, needle, SECRET, c?.ts ?? END, c?.ts ?? END, c?.id ?? END, size + 1);
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      results: page.map((r) => ({ ...toMessage(r), threadId: r.thread_id, threadType: Number(r.thread_type), text: String(r.text).slice(0, 300) })),
      nextBefore: rows.length > size ? `${last.timestamp_ms}:${last.id}` : null,
    };
  }

  function hasThread(threadId, threadType) {
    const acc = account();
    if (!acc) return false;
    return Boolean(open().prepare('SELECT 1 FROM messages WHERE account_id = ? AND thread_type = ? AND thread_id = ? LIMIT 1')
      .get(acc, Number(threadType), String(threadId)));
  }

  function todayStats(sinceMs) {
    const acc = account();
    if (!acc) return { received: 0, sent: 0, topGroups: [] };
    const d = open();
    const totals = d.prepare(`
      SELECT COALESCE(SUM(is_self = 0), 0) AS received, COALESCE(SUM(is_self = 1), 0) AS sent
      FROM messages WHERE account_id = ? AND timestamp_ms >= ?
    `).get(acc, sinceMs);
    const top = d.prepare(`
      SELECT thread_id, COUNT(*) AS n FROM messages
      WHERE account_id = ? AND thread_type = 1 AND timestamp_ms >= ?
      GROUP BY thread_id ORDER BY n DESC, thread_id LIMIT 5
    `).all(acc, sinceMs);
    return { received: Number(totals.received), sent: Number(totals.sent), topGroups: top.map((g) => ({ threadId: g.thread_id, count: Number(g.n) })) };
  }

  function senderNames(uids) {
    const list = [...new Set([...uids].map(String))].filter((u) => /^\d{1,32}$/.test(u)).slice(0, 200);
    if (!list.length) return new Map();
    // SQLite: cột thường đi cùng MAX() lấy giá trị ở đúng dòng có MAX — tức tên mới nhất.
    const rows = open().prepare(`
      SELECT sender_uid, sender_name, MAX(timestamp_ms) AS last_at FROM messages
      WHERE is_self = 0 AND sender_name <> '' AND sender_uid IN (${list.map(() => '?').join(', ')})
      GROUP BY sender_uid
    `).all(...list);
    return new Map(rows.map((r) => [r.sender_uid, r.sender_name]));
  }

  return {
    available: () => Boolean(db) || Boolean(path && existsSync(path)),
    isReadOnly: () => Number(open().prepare('PRAGMA query_only').get().query_only) === 1,
    listConversations,
    getMessages,
    searchMessages,
    hasThread,
    todayStats,
    senderNames,
    close() { if (db) { db.close(); db = null; } },
  };
}
```

- [ ] **Step 4: Chạy, thấy PASS** — `node --test dashboard/lib/store-reader.test.js` → toàn bộ test PASS (cảnh báo `ExperimentalWarning: SQLite` là bình thường).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/store-reader.js dashboard/lib/store-reader.test.js
git commit -m "feat(dashboard): đọc lịch sử chat từ SQLite ở chế độ chỉ đọc

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Route đọc Phiên chat — danh sách, tin nhắn, tìm kiếm

**Files:**
- Create: `dashboard/lib/thread-names.js`, `dashboard/lib/thread-names.test.js`, `dashboard/lib/route-errors.js`, `dashboard/routes/chats.js`, `dashboard/routes/chats.test.js`
- Modify: `dashboard/routes/zalo.js` (bỏ `fail` riêng, dùng `failSidecar`), `dashboard/app.js` (gắn `chatRoutes`), `dashboard/server.js` (`buildDeps` thêm `store`, `threadNames`), `dashboard/server.test.js` (khoá bắt buộc), `dashboard/test-helpers.js`

**Interfaces:**
- Consumes: Task 1 — `createStoreReader`, `parseCursor`, `StoreUnavailable`; `sidecar.groups()` → `Array<{ id, name, members }>` (sẵn có).
- Produces:
  - `thread-names.js`: `export function fallbackName(threadId: string, threadType: 0|1): string` (`'Nhóm …<4 số cuối>'` / `'Người dùng …<4 số cuối>'`); `export function createThreadNames({ loadGroups, ttlMs = 600_000, retryMs = 60_000, now = Date.now })` → `{ cached(): Map<string,string>, load(): Promise<Map<string,string>> }` — không bao giờ ném lỗi.
  - `route-errors.js`: `export const NO_HISTORY: string`; `export function failSidecar(res, err)`; `export function failStore(res, err, fallback: string)`.
  - `chats.js`: `export function chatRoutes(deps)` dùng `deps.store`, `deps.sidecar`, `deps.threadNames` (Task 3 thêm `deps.sendLimit`, `deps.now`).
    - `GET /api/chats` → `{ ok, conversations: Array<{ threadId, threadType, name, lastAtMs, total, lastText, lastMsgType, lastIsSelf }>, unavailable?: true }`.
    - `GET /api/chats/:threadId/messages?type=0|1&before=<cursor>` → `{ ok, messages, nextBefore }`.
    - `GET /api/chats/search?q=&before=<cursor>` → `{ ok, results: Array<{ id, threadId, threadType, threadName, senderName, text, msgType, ts, isSelf }>, nextBefore }`.
  - `deps.store`, `deps.threadNames` trong `buildDeps` và `makeDeps`.
  - `test-helpers.js`: `export function chatMsg(over = {})` (tin mẫu đúng dạng `insertMessages`), `export function seedHistory(deps, { account = 'bot1', messages = [], audits = [] })` (ghi bằng `openZaloStore` thật vào `<deps.dir>/zalo.sqlite`; mỗi phần tử `audits`: `{ requestId, action, actorUid, actorRole, threadId, threadType, status?: 'succeeded'|'failed', error?, at }`); `fakeSidecar()` có thêm `send` (ghi `['send', m]` vào `calls`) và `groups` (trả `[{ id: '200', name: 'Tổ Hoá', members: 12 }]`).

- [ ] **Step 1: Test `thread-names`** — `dashboard/lib/thread-names.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadNames, fallbackName } from './thread-names.js';
import { SidecarDown } from './sidecar-client.js';

test('tên nhóm được đệm, hết hạn thì lấy lại', async () => {
  let clock = 0; let calls = 0;
  const names = createThreadNames({ loadGroups: async () => { calls += 1; return [{ id: '200', name: 'Tổ Hoá' }]; }, ttlMs: 1000, now: () => clock });
  assert.equal((await names.load()).get('200'), 'Tổ Hoá');
  await names.load();
  assert.equal(calls, 1);
  clock = 1000;
  await names.load();
  assert.equal(calls, 2);
});

test('bot không trả lời: không ném lỗi, giữ tên cũ, không thử lại dồn dập', async () => {
  let clock = 0; let fail = false; let calls = 0;
  const names = createThreadNames({
    loadGroups: async () => { calls += 1; if (fail) throw new SidecarDown(); return [{ id: '200', name: 'Tổ Hoá' }]; },
    ttlMs: 1000, retryMs: 500, now: () => clock,
  });
  await names.load();
  fail = true; clock = 1000;
  assert.equal((await names.load()).get('200'), 'Tổ Hoá');
  assert.equal(calls, 2);
  clock = 1200; await names.load();
  assert.equal(calls, 2); // chưa đủ retryMs
  clock = 1500; await names.load();
  assert.equal(calls, 3);
});

test('loadGroups ném lỗi đồng bộ vẫn không kẹt, lần sau thử lại được', async () => {
  let clock = 0; let calls = 0;
  const names = createThreadNames({ loadGroups: () => { calls += 1; throw new SidecarDown(); }, retryMs: 10, now: () => clock });
  assert.equal((await names.load()).size, 0);
  clock = 10;
  await names.load();
  assert.equal(calls, 2);
});

test('cached() trả ngay và làm mới ngầm', async () => {
  const names = createThreadNames({ loadGroups: async () => [{ id: '200', name: 'Tổ Hoá' }] });
  assert.equal(names.cached().size, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(names.cached().get('200'), 'Tổ Hoá');
});

test('tên dự phòng', () => {
  assert.equal(fallbackName('987654', 1), 'Nhóm …7654');
  assert.equal(fallbackName('123456789', 0), 'Người dùng …6789');
});
```

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/lib/thread-names.test.js` → `Cannot find module './thread-names.js'`.

- [ ] **Step 3: Cài đặt** `dashboard/lib/thread-names.js`:

```js
/**
 * Tên hội thoại cho dashboard. Tên nhóm lấy từ bot (/control/groups, bot đã đệm 10 phút);
 * dashboard đệm thêm một lớp để vẫn có tên khi kết nối Zalo tắt, và không gọi bot dồn dập khi nó hỏng.
 */
export function fallbackName(threadId, threadType) {
  const tail = String(threadId).slice(-4);
  return threadType === 1 ? `Nhóm …${tail}` : `Người dùng …${tail}`;
}

export function createThreadNames({ loadGroups, ttlMs = 10 * 60_000, retryMs = 60_000, now = Date.now }) {
  let map = new Map();
  let loadedAt = -Infinity;
  let failedAt = -Infinity;
  let inflight = null;
  const due = () => now() - loadedAt >= ttlMs && now() - failedAt >= retryMs;

  function refresh() {
    // Promise.resolve().then(...) để cả lỗi ném đồng bộ cũng đi vào nhánh lỗi, và finally luôn chạy sau khi gán inflight.
    inflight ??= Promise.resolve()
      .then(loadGroups)
      .then((groups) => {
        map = new Map((Array.isArray(groups) ? groups : []).filter((g) => g?.id && g?.name).map((g) => [String(g.id), String(g.name)]));
        loadedAt = now();
      }, (err) => {
        failedAt = now();
        if (err?.name !== 'SidecarDown') console.warn('[dashboard] chưa lấy được tên nhóm:', err?.message || err);
      })
      .finally(() => { inflight = null; })
      .then(() => map);
    return inflight;
  }

  return {
    /** Tên đang có, không chờ; quá hạn thì làm mới ngầm. */
    cached() { if (due()) refresh(); return map; },
    /** Chờ làm mới khi quá hạn; bot hỏng thì trả tên cũ, không ném lỗi. */
    async load() { if (due()) await refresh(); return map; },
  };
}
```

Chạy lại `node --test dashboard/lib/thread-names.test.js` → PASS.

- [ ] **Step 4: `route-errors.js`** — tách đúng logic `fail` hiện có trong `routes/zalo.js` (không đổi hành vi) và thêm `failStore`:

```js
// Quy ước lỗi chung của route: chỉ lộ err.message khi là 4xx rõ ràng; 5xx trả câu chung có bước tiếp theo.
export const NO_HISTORY = 'Chưa có lịch sử trò chuyện — bot cần đăng nhập Zalo và nhận tin trước. Nếu bot đã chạy lâu mà vẫn thấy dòng này, hãy báo người cài đặt.';

export function failSidecar(res, err) {
  if (err?.name === 'SidecarDown') {
    return res.status(503).json({ ok: false, error: 'Kết nối Zalo đang tắt — đợi 1–2 phút để hệ thống tự bật lại, hoặc báo người cài đặt.' });
  }
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  // 401/403 từ bot là lỗi khoá kết nối nội bộ — không được để trình duyệt thấy (sẽ bị hiểu là hết phiên đăng nhập).
  if (status >= 400 && status < 500 && status !== 401 && status !== 403) return res.status(status).json({ ok: false, error: err.message });
  console.error('[dashboard]', err);
  if (status === 401 || status === 403) {
    return res.status(502).json({ ok: false, error: 'Dashboard chưa kết nối được với bot (sai khoá kết nối). Hãy chạy lại trình cài đặt hoặc báo người cài đặt.' });
  }
  return res.status(502).json({ ok: false, error: 'Zalo chưa phản hồi đúng — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.' });
}

export function failStore(res, err, fallback) {
  if (err?.name === 'StoreUnavailable') return res.status(503).json({ ok: false, error: NO_HISTORY });
  console.error('[dashboard]', err);
  return res.status(500).json({ ok: false, error: fallback });
}
```

Trong `dashboard/routes/zalo.js`: xoá khối `const fail = (res, err) => { … };` (dòng 6–19, gồm cả hai dòng chú thích phía trên/trong) và thay bằng:

```js
import { failSidecar as fail } from '../lib/route-errors.js';
```

(đặt cạnh các import ở đầu tệp; ba route giữ nguyên lời gọi `fail(res, err)`). Chạy `node --test dashboard/routes/status.test.js` → vẫn PASS (các test 401→502, 503, 5xx đã ghim hành vi).

- [ ] **Step 5: Mở rộng `test-helpers.js`** — thêm import, hai hàm mới, và sửa `fakeSidecar`/`makeDeps`:

```js
import { openZaloStore } from '../zalo-store.js';
import { createStoreReader } from './lib/store-reader.js';
import { createThreadNames } from './lib/thread-names.js';
```

Trong `fakeSidecar`, thêm hai khoá trước `...overrides`:

```js
    send: async (m) => { calls.push(['send', m]); return { msgId: '999' }; },
    groups: async () => [{ id: '200', name: 'Tổ Hoá', members: 12 }],
```

Thay toàn bộ `makeDeps` bằng (đóng kết nối SQLite trước khi xoá thư mục — Windows không xoá được tệp đang mở):

```js
export function makeDeps(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-app-'));
  const bot = overrides.bot || fakeBot();
  const sidecar = overrides.sidecar || fakeSidecar();
  const deps = {
    bot,
    linker: createTelegramLinker({ file: join(dir, 'telegram.json'), apiFactory: (token) => createTelegramApi({ token, fetchImpl: bot.fetchImpl }) }),
    config: { port: 3880, publicUrl: 'http://localhost:3880', restartCmd: null },
    users: createUserStore(join(dir, 'users.json')),
    sessions: createSessionStore(join(dir, 'sessions.json')),
    guard: createLoginGuard({}),
    setupToken: createSetupToken(join(dir, 'setup.json')),
    activity: createActivityLog(join(dir, 'activity.jsonl')),
    sidecar,
    store: createStoreReader({ path: join(dir, 'zalo.sqlite') }),
    threadNames: createThreadNames({ loadGroups: () => sidecar.groups() }),
    restartAssistant: async () => {},
    publicDir: join(dir, 'public'),
    dir,
    ...overrides,
  };
  t.after(() => {
    try { deps.store?.close(); } catch { /* đã đóng */ }
    rmSync(dir, { recursive: true, force: true });
  });
  return deps;
}

let seq = 0;
/** Một tin mẫu đúng dạng zalo-store.insertMessages. */
export function chatMsg(over = {}) {
  seq += 1;
  return { threadId: '100', threadType: 0, msgId: `m${seq}`, senderUid: '100', senderName: 'Lan', text: `tin ${seq}`, msgType: 'webchat', ts: 1_000_000 + seq, isSelf: false, ...over };
}

/** Ghi lịch sử/nhật ký mẫu bằng chính zalo-store của bot vào <deps.dir>/zalo.sqlite. */
export function seedHistory(deps, { account = 'bot1', messages = [], audits = [] } = {}) {
  let clock = Date.now();
  const store = openZaloStore({ path: join(deps.dir, 'zalo.sqlite'), now: () => clock });
  try {
    if (messages.length) store.insertMessages(account, messages, 'live');
    for (const a of audits) {
      clock = a.at ?? Date.now();
      store.beginAudit({ accountId: account, category: 'send', ...a });
      if (a.status) store.finishAudit(a.requestId, a.status, { error: a.error });
    }
  } finally { store.close(); }
}
```

- [ ] **Step 6: Test route** — `dashboard/routes/chats.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SidecarDown } from '../lib/sidecar-client.js';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

function seedChats(deps) {
  seedHistory(deps, { messages: [
    chatMsg({ msgId: 'd1', threadId: '100', threadType: 0, senderUid: '100', senderName: 'Lan', text: 'Chào bot', ts: 1000 }),
    chatMsg({ msgId: 'd2', threadId: '100', threadType: 0, senderUid: '999', senderName: 'Uyển Nhi', text: 'Chào Lan', ts: 1001, isSelf: true }),
    chatMsg({ msgId: 'g1', threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', text: 'Họp tổ chiều nay', ts: 2000 }),
    chatMsg({ msgId: 'x1', threadId: '987654', threadType: 1, senderUid: '301', senderName: 'Hà', text: '<img src=x onerror=alert(1)>', ts: 1500 }),
  ] });
}

async function ready(t, { seed = true, ...overrides } = {}) {
  const deps = makeDeps(t, overrides);
  if (seed) seedChats(deps);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  return { deps, call, cookie };
}

test('phiên chat cần đăng nhập', async (t) => {
  const { call } = await startApp(t, makeDeps(t));
  for (const p of ['/api/chats', '/api/chats/100/messages?type=0', '/api/chats/search?q=chao']) {
    assert.equal((await call(p)).status, 401, p);
  }
});

test('danh sách hội thoại: mới nhất trước, tên nhóm từ bot, tên người từ tin nhắn, nhóm lạ có tên dự phòng', async (t) => {
  const { call, cookie } = await ready(t);
  const res = await call('/api/chats', { cookie });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.conversations.map((c) => [c.threadId, c.threadType, c.name]), [
    ['200', 1, 'Tổ Hoá'], ['987654', 1, 'Nhóm …7654'], ['100', 0, 'Lan'],
  ]);
  const dm = res.json.conversations[2];
  assert.equal(dm.lastText, 'Chào Lan');
  assert.equal(dm.lastIsSelf, true);
  assert.equal('peerName' in dm, false);
});

test('tin nhắn trả nguyên văn (giao diện tự thoát HTML), cũ trước mới sau', async (t) => {
  const { call, cookie } = await ready(t);
  const x = await call('/api/chats/987654/messages?type=1', { cookie });
  assert.equal(x.status, 200);
  assert.equal(x.json.messages[0].text, '<img src=x onerror=alert(1)>');
  const dm = await call('/api/chats/100/messages?type=0', { cookie });
  assert.deepEqual(dm.json.messages.map((m) => [m.text, m.isSelf]), [['Chào bot', false], ['Chào Lan', true]]);
  assert.equal(dm.json.nextBefore, null);
});

test('tham số sai bị từ chối 400 (kể cả chuỗi đường dẫn)', async (t) => {
  const { call, cookie } = await ready(t);
  for (const p of [
    '/api/chats/abc/messages?type=0',
    '/api/chats/..%2F..%2Fetc/messages?type=0',
    '/api/chats/100/messages?type=2',
    '/api/chats/100/messages',
    '/api/chats/100/messages?type=0&before=..%2F',
    '/api/chats/search?q=a',
    `/api/chats/search?q=${'a'.repeat(101)}`,
    '/api/chats/search?q=chao&before=x',
  ]) {
    const res = await call(p, { cookie });
    assert.equal(res.status, 400, p);
    assert.match(res.json.error, /—/, p); // có bước tiếp theo
  }
});

test('tìm toàn văn không phân biệt hoa thường, kèm tên hội thoại', async (t) => {
  const { call, cookie } = await ready(t);
  const g = await call(`/api/chats/search?q=${encodeURIComponent('HỌP TỔ')}`, { cookie });
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.results.map((r) => [r.threadId, r.threadName]), [['200', 'Tổ Hoá']]);
  const d = await call(`/api/chats/search?q=${encodeURIComponent('chào lan')}`, { cookie });
  assert.deepEqual(d.json.results.map((r) => [r.threadId, r.threadName, r.isSelf]), [['100', 'Lan', true]]);
});

test('chưa có lịch sử: danh sách rỗng có cờ unavailable, xem tin trả 503 có bước tiếp theo, không tạo tệp', async (t) => {
  const { deps, call, cookie } = await ready(t, { seed: false });
  const list = await call('/api/chats', { cookie });
  assert.deepEqual([list.status, list.json.conversations, list.json.unavailable], [200, [], true]);
  const msgs = await call('/api/chats/100/messages?type=0', { cookie });
  assert.equal(msgs.status, 503);
  assert.match(msgs.json.error, /báo người cài đặt/);
  assert.equal((await call('/api/chats/search?q=chao', { cookie })).status, 503);
  assert.equal(existsSync(join(deps.dir, 'zalo.sqlite')), false);
});

test('kết nối Zalo tắt vẫn xem được hội thoại, nhóm dùng tên dự phòng', async (t) => {
  const { call, cookie } = await ready(t, { sidecar: fakeSidecar({ groups: async () => { throw new SidecarDown(); } }) });
  const res = await call('/api/chats', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.conversations[0].name, 'Nhóm …200');
});
```

- [ ] **Step 7: Chạy, thấy FAIL** — `node --test dashboard/routes/chats.test.js` → `Cannot find module '../routes/chats.js'` hoặc 404 cho `/api/chats`.

- [ ] **Step 8: Cài đặt** `dashboard/routes/chats.js`:

```js
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { parseCursor } from '../lib/store-reader.js';
import { fallbackName } from '../lib/thread-names.js';
import { failStore } from '../lib/route-errors.js';

const THREAD_ID = /^\d{1,32}$/;
const READ_FAIL = 'Chưa đọc được lịch sử trò chuyện — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.';
const BAD_THREAD = 'Hội thoại không hợp lệ — chọn lại từ danh sách.';
const BAD_CURSOR = 'Vị trí trang không hợp lệ — tải lại trang rồi thử lại.';

export const parseType = (v) => (v === 0 || v === '0' ? 0 : v === 1 || v === '1' ? 1 : null);
const cursorOk = (v) => v === undefined || v === '' || (typeof v === 'string' && parseCursor(v) !== null);

export function chatRoutes({ store, threadNames }) {
  const r = express.Router();
  const bad = (res, error) => res.status(400).json({ ok: false, error });
  const nameOf = (groups, id, type, peerName = '') => (type === 1 ? groups.get(id) : peerName) || fallbackName(id, type);

  r.get('/chats', requireAuth, async (req, res) => {
    try {
      if (!store.available()) return res.json({ ok: true, conversations: [], unavailable: true });
      const list = store.listConversations();
      const groups = await threadNames.load();
      res.json({ ok: true, conversations: list.map(({ peerName, ...c }) => ({ ...c, name: nameOf(groups, c.threadId, c.threadType, peerName) })) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/search', requireAuth, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 100) return bad(res, 'Từ khoá cần 2–100 ký tự — sửa lại rồi tìm.');
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      const { results, nextBefore } = store.searchMessages(q, { before: req.query.before || null });
      const groups = await threadNames.load();
      const peers = store.senderNames(results.filter((x) => x.threadType === 0).map((x) => x.threadId));
      res.json({
        ok: true, nextBefore,
        results: results.map((x) => ({ ...x, threadName: nameOf(groups, x.threadId, x.threadType, peers.get(x.threadId)) })),
      });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  r.get('/chats/:threadId/messages', requireAuth, (req, res) => {
    const type = parseType(req.query.type);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    if (!cursorOk(req.query.before)) return bad(res, BAD_CURSOR);
    try {
      res.json({ ok: true, ...store.getMessages(req.params.threadId, type, { before: req.query.before || null }) });
    } catch (err) { failStore(res, err, READ_FAIL); }
  });

  return r;
}
```

Trong `dashboard/app.js` thêm `import { chatRoutes } from './routes/chats.js';` và ngay sau dòng `app.use('/api', zaloRoutes(deps));` thêm `app.use('/api', chatRoutes(deps));`.

Trong `dashboard/server.js` thêm import:

```js
import { createStoreReader } from './lib/store-reader.js';
import { createThreadNames } from './lib/thread-names.js';
```

và trong object trả về của `buildDeps`, ngay sau dòng `paths, config, sidecar, linker,`:

```js
    store: createStoreReader({ path: paths.sqliteFile }),
    threadNames: createThreadNames({ loadGroups: () => sidecar.groups() }),
```

Trong `dashboard/server.test.js`, mảng `requiredKeys` thêm `'store', 'threadNames'`.

- [ ] **Step 9: Chạy, thấy PASS** — `node --test dashboard/routes/chats.test.js dashboard/lib/thread-names.test.js dashboard/routes/status.test.js dashboard/server.test.js` → PASS; rồi `npm run test:js` → PASS (mọi test cũ dùng `makeDeps` vẫn chạy).

- [ ] **Step 10: Commit**

```bash
git add dashboard/lib/thread-names.js dashboard/lib/thread-names.test.js dashboard/lib/route-errors.js dashboard/routes/chats.js dashboard/routes/chats.test.js dashboard/routes/zalo.js dashboard/app.js dashboard/server.js dashboard/server.test.js dashboard/test-helpers.js
git commit -m "feat(dashboard): xem hội thoại, tin nhắn và tìm toàn văn từ lịch sử

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Nhắn tay dưới tên bot — `POST /api/chats/:threadId/send`

**Files:**
- Modify: `dashboard/routes/chats.js`
- Test: `dashboard/routes/chats-send.test.js` (mới), `dashboard/lib/sidecar-contract.test.js` (thêm một test)

**Interfaces:**
- Consumes: Task 2 — `chatRoutes`, `parseType`, `failStore`, `failSidecar`, `seedHistory`, `chatMsg`; Task 1 — `store.hasThread`; `sidecar.send({ threadId, threadType, text, actor })` (sẵn có, gọi `/control/send`).
- Produces: `POST /api/chats/:threadId/send` body `{ text: string, threadType: 0|1|'0'|'1' }` → `{ ok: true }`; lỗi: 400 (hội thoại/nội dung), 404 (hội thoại không có trong lịch sử), 429 (quá 10 tin/phút/người dùng), 503/502 theo `failSidecar`. `chatRoutes` nhận thêm `deps.sendLimit = { max: 10, windowMs: 60_000 }` và `deps.now = Date.now` (để test).

- [ ] **Step 1: Test** — `dashboard/routes/chats-send.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidecarDown } from '../lib/sidecar-client.js';
import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

async function ready(t, overrides = {}) {
  const deps = makeDeps(t, overrides);
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '100', threadType: 0, text: 'Chào bot' }),
    chatMsg({ threadId: '200', threadType: 1, text: 'Chào cả nhóm' }),
  ] });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const send = (threadId, body, c = cookie) => call(`/api/chats/${threadId}/send`, { method: 'POST', cookie: c, body });
  const sends = () => deps.sidecar.calls.filter((c) => c[0] === 'send').map((c) => c[1]);
  return { deps, call, cookie, send, sends };
}

test('Chủ bot nhắn tay: gửi qua bot với tên người gửi, nội dung đã cắt khoảng trắng', async (t) => {
  const { send, sends } = await ready(t);
  const res = await send('100', { text: '  Dạ em chào chị  ', threadType: 0 });
  assert.equal(res.status, 200);
  assert.deepEqual(sends(), [{ threadId: '100', threadType: 0, text: 'Dạ em chào chị', actor: 'khach' }]);
});

test('nội dung rỗng, quá 2000 ký tự, loại hội thoại sai → 400, không gọi bot', async (t) => {
  const { send, sends } = await ready(t);
  for (const body of [{ text: '   ', threadType: 0 }, { text: 'x'.repeat(2001), threadType: 0 }, { text: 'chào' }, { text: 'chào', threadType: 2 }, { text: 42, threadType: 0 }]) {
    const res = await send('100', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(res.json.error, /—/);
  }
  assert.equal((await send('abc', { text: 'chào', threadType: 0 })).status, 400);
  assert.equal((await send('100', { text: 'x'.repeat(2000), threadType: 0 })).status, 200); // đúng 2000 vẫn được
  assert.equal(sends().length, 1);
});

test('hội thoại không có trong lịch sử (hoặc sai loại) → 404, không gọi bot', async (t) => {
  const { send, sends } = await ready(t);
  assert.equal((await send('555', { text: 'chào', threadType: 0 })).status, 404);
  assert.equal((await send('100', { text: 'chào', threadType: 1 })).status, 404);
  assert.equal(sends().length, 0);
});

test('quá 10 tin/phút/người dùng → 429; người khác vẫn gửi được; hết phút thì gửi lại được', async (t) => {
  let clock = 1_000_000;
  const { deps, call, send, sends } = await ready(t, { now: () => clock });
  for (let i = 0; i < 10; i += 1) assert.equal((await send('100', { text: `tin ${i}`, threadType: 0 })).status, 200);
  const blocked = await send('100', { text: 'tin 11', threadType: 0 });
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /đợi/);
  const admin = await loginAs(t, deps, call);
  assert.equal((await send('100', { text: 'của anh', threadType: 0 }, admin)).status, 200);
  clock += 60_001;
  assert.equal((await send('100', { text: 'tin 12', threadType: 0 })).status, 200);
  assert.equal(sends().length, 12);
});

test('bot tắt → 503 tiếng Việt; bot báo Zalo chưa đăng nhập (502) → câu chung, không lộ chữ gốc', async (t) => {
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw new SidecarDown(); } }) });
  const down = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(down.status, 503);
  assert.doesNotMatch(down.json.error, /sidecar|bridge/i);
});

test('lỗi 502 từ bot không lộ nội dung gốc', async (t) => {
  const orig = console.error; console.error = () => {};
  t.after(() => { console.error = orig; });
  const { send } = await ready(t, { sidecar: fakeSidecar({ send: async () => { throw Object.assign(new Error('Zalo chưa đăng nhập'), { statusCode: 502 }); } }) });
  const res = await send('100', { text: 'chào', threadType: 0 });
  assert.equal(res.status, 502);
  assert.doesNotMatch(res.json.error, /Zalo chưa đăng nhập/);
});

test('chưa đăng nhập → 401; Origin lạ → 403', async (t) => {
  const { call } = await ready(t);
  assert.equal((await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 } })).status, 401);
  const res = await call('/api/chats/100/send', { method: 'POST', body: { text: 'x', threadType: 0 }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});
```

Thêm vào cuối `dashboard/lib/sidecar-contract.test.js` (và mở rộng dòng import từ `../test-helpers.js` thành `import { chatMsg, makeDeps, seedHistory, startApp, loginAs } from '../test-helpers.js';`):

```js
test('hợp đồng: nhắn tay từ Phiên chat tới bot đúng dạng (threadType là số, có actor)', async (t) => {
  const { client, calls } = await startControl(t);
  const deps = makeDeps(t, { sidecar: client });
  seedHistory(deps, { messages: [chatMsg({ threadId: '200', threadType: 1 })] });
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const res = await call('/api/chats/200/send', { method: 'POST', cookie, body: { text: '  Chào cả nhóm  ', threadType: '1' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1), ['send', { threadId: '200', threadType: 1, text: 'Chào cả nhóm', actor: 'khach' }]);
});
```

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/routes/chats-send.test.js` → 404 `Không có đường dẫn này` ở test đầu.

- [ ] **Step 3: Cài đặt** trong `dashboard/routes/chats.js`:

Đổi dòng import lỗi thành `import { failSidecar, failStore } from '../lib/route-errors.js';`, thêm hằng `const MAX_TEXT = 2000;` cạnh `THREAD_ID`, đổi chữ ký hàm thành:

```js
export function chatRoutes({ store, sidecar, threadNames, sendLimit = { max: 10, windowMs: 60_000 }, now = Date.now }) {
```

và thêm trước `return r;`:

```js
  // Gửi tay đi qua sendSystemNotice của bot — đường này không qua bộ giãn nhịp của trợ lý,
  // nên dashboard tự chặn: mỗi người tối đa sendLimit.max tin trong sendLimit.windowMs.
  const recent = new Map(); // username → mốc thời gian các lần gửi còn trong cửa sổ
  function allowSend(username) {
    const t = now();
    const kept = (recent.get(username) || []).filter((x) => t - x < sendLimit.windowMs);
    const ok = kept.length < sendLimit.max;
    if (ok) kept.push(t);
    recent.set(username, kept);
    return ok;
  }

  r.post('/chats/:threadId/send', requireAuth, async (req, res) => {
    const { text, threadType } = req.body || {};
    const type = parseType(threadType);
    if (!THREAD_ID.test(req.params.threadId) || type === null) return bad(res, BAD_THREAD);
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return bad(res, 'Nội dung đang trống — gõ tin nhắn rồi gửi.');
    if (body.length > MAX_TEXT) return bad(res, `Tin nhắn dài quá ${MAX_TEXT} ký tự — rút gọn hoặc chia làm nhiều tin.`);
    try {
      if (!store.hasThread(req.params.threadId, type)) {
        return res.status(404).json({ ok: false, error: 'Không thấy hội thoại này trong lịch sử — chọn lại từ danh sách.' });
      }
    } catch (err) { return failStore(res, err, READ_FAIL); }
    if (!allowSend(req.user.username)) {
      return res.status(429).json({ ok: false, error: 'Bạn đang gửi quá nhanh — đợi một phút rồi gửi tiếp.' });
    }
    try {
      await sidecar.send({ threadId: req.params.threadId, threadType: type, text: body, actor: req.user.username });
      res.json({ ok: true });
    } catch (err) { failSidecar(res, err); }
  });
```

(Không ghi `activity.jsonl`: bot đã ghi `audit_log` `action="dashboard_send"`, `actor_role="dashboard"`, `actor_uid=<username>` — Nhật ký ở Task 5 hiện từ đó.)

- [ ] **Step 4: Chạy, thấy PASS** — `node --test dashboard/routes/chats-send.test.js dashboard/lib/sidecar-contract.test.js dashboard/routes/chats.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/chats.js dashboard/routes/chats-send.test.js dashboard/lib/sidecar-contract.test.js
git commit -m "feat(dashboard): nhắn tay dưới tên bot, giới hạn 10 tin mỗi phút

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tổng quan — tin hôm nay và 5 nhóm sôi nổi nhất

Spec §9 đặt hai mục này ở màn Tổng quan và §7.1 ghi `/api/status` trả "tin hôm nay", nhưng GĐ1 chưa có bộ đọc SQLite nên chưa làm; làm ở đây vì phụ thuộc Task 1.

**Files:**
- Modify: `dashboard/routes/status.js`, `dashboard/public/views/overview.js`, `dashboard/public/ui.js` (biểu tượng `chat`), `dashboard/public/style.css`
- Test: `dashboard/routes/status.test.js`

**Interfaces:**
- Consumes: Task 1 — `store.available()`, `store.todayStats(sinceMs)`, `startOfDayVN`; Task 2 — `threadNames.cached()`, `fallbackName`; `deps.now` (mặc định `Date.now`).
- Produces: `GET /api/status` thêm trường `today: { received: number, sent: number, topGroups: Array<{ threadId: string, name: string, count: number }> } | null` ở **cả** nhánh `sidecar: 'up'` lẫn `'down'`. Tên nhóm chỉ lấy từ bộ đệm (`cached()`), không chờ bot — giữ `/api/status` ≤ 4 giây khi bot treo (Review Focus 1 của GĐ1).

- [ ] **Step 1: Test** — thêm vào `dashboard/routes/status.test.js` (mở rộng import thành `import { chatMsg, fakeSidecar, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';`):

```js
test('tin hôm nay và 5 nhóm sôi nổi nhất đọc từ lịch sử, kể cả khi kết nối Zalo tắt', async (t) => {
  const NOW = Date.UTC(2026, 9, 7, 5, 0);      // 12:00 giờ Việt Nam
  const TODAY = Date.UTC(2026, 9, 6, 17, 0);   // 0:00 giờ Việt Nam
  const { SidecarDown } = await import('../lib/sidecar-client.js');
  let down = false;
  const base = fakeSidecar();
  const sidecar = fakeSidecar({ health: async () => { if (down) throw new SidecarDown(); return base.health(); } });
  const deps = makeDeps(t, { sidecar, now: () => NOW });
  seedHistory(deps, { messages: [
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY - 1 }),               // hôm qua: không tính
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY + 1 }),
    chatMsg({ threadId: '200', threadType: 1, ts: TODAY + 2 }),
    chatMsg({ threadId: '987654', threadType: 1, ts: TODAY + 3 }),
    chatMsg({ threadId: '100', threadType: 0, ts: TODAY + 4, isSelf: true }),
  ] });
  await deps.threadNames.load();
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const expected = { received: 3, sent: 1, topGroups: [
    { threadId: '200', count: 2, name: 'Tổ Hoá' }, { threadId: '987654', count: 1, name: 'Nhóm …7654' },
  ] };
  assert.deepEqual((await call('/api/status', { cookie })).json.today, expected);
  down = true;
  const res = await call('/api/status', { cookie });
  assert.equal(res.json.sidecar, 'down');
  assert.deepEqual(res.json.today, expected);
});

test('chưa có lịch sử thì today = null', async (t) => {
  const deps = makeDeps(t);
  const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  assert.equal((await call('/api/status', { cookie })).json.today, null);
});
```

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/routes/status.test.js` → `today` là `undefined`.

- [ ] **Step 3: Cài đặt** — toàn bộ `dashboard/routes/status.js` sau khi sửa (so với hiện tại chỉ thêm hai import, tham số `store, threadNames, now`, hàm `today`, và `today: today(),` ở cả hai nhánh):

```js
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { startOfDayVN } from '../lib/store-reader.js';
import { fallbackName } from '../lib/thread-names.js';

export function statusRoutes({ sidecar, linker, store, threadNames, now = Date.now }) {
  const r = express.Router();
  // Đọc thẳng SQLite nên vẫn có số liệu khi kết nối Zalo tắt. Tên nhóm chỉ lấy từ bộ đệm
  // (không chờ bot) để /api/status không chậm thêm khi bot treo.
  const today = () => {
    try {
      if (!store?.available()) return null;
      const s = store.todayStats(startOfDayVN(now()));
      const names = threadNames?.cached() || new Map();
      return { received: s.received, sent: s.sent, topGroups: s.topGroups.map((g) => ({ ...g, name: names.get(g.threadId) || fallbackName(g.threadId, 1) })) };
    } catch (err) {
      console.error('[dashboard] đọc số liệu hôm nay lỗi:', err);
      return null;
    }
  };
  r.get('/status', requireAuth, async (req, res) => {
    const telegramLinked = Boolean(linker?.isLinked(req.user.username));
    try {
      const h = await sidecar.health();
      res.json({
        ok: true, sidecar: 'up', telegramLinked,
        zalo: { status: h?.zalo?.status || 'idle', displayName: h?.zalo?.displayName || '', listener: h?.zalo?.listener || null, needsRelogin: Boolean(h?.zalo?.needsRelogin) },
        assistant: (h?.bridge?.attachedClients || 0) > 0 ? 'connected' : 'disconnected',
        traffic: { lastInboundAtMs: h?.traffic?.lastInboundAtMs || null, lastOutboundAtMs: h?.traffic?.lastOutboundAtMs || null },
        lastError: h?.lastError ? { code: h.lastError.code ?? null, message: h.lastError.message ?? '', atMs: h.lastError.atMs ?? null } : null,
        today: today(),
      });
    } catch (err) {
      if (err?.name !== 'SidecarDown') console.error('[dashboard] đọc trạng thái lỗi:', err);
      res.json({ ok: true, sidecar: 'down', telegramLinked, zalo: { status: 'unknown', displayName: '', listener: null, needsRelogin: false },
        assistant: 'unknown', traffic: { lastInboundAtMs: null, lastOutboundAtMs: null }, lastError: null, today: today() });
    }
  });
  return r;
}
```

- [ ] **Step 4: Chạy, thấy PASS** — `node --test dashboard/routes/status.test.js` → PASS.

- [ ] **Step 5: Giao diện Tổng quan** — trong `dashboard/public/ui.js`, thêm vào `PATHS`:

```js
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
```

Trong `dashboard/public/views/overview.js`, thêm component (trên `export function Overview`):

```js
function TodayCard({ today }) {
  return html`<section class="card">
    <h2>Tin nhắn hôm nay</h2>
    ${today ? html`
      <dl class="facts">
        <div><dt><${Icon} name="inbox" size=${16} /> Bot đã nhận</dt><dd>${today.received}</dd></div>
        <div><dt><${Icon} name="send" size=${16} /> Bot đã gửi</dt><dd>${today.sent}</dd></div>
      </dl>
      <h3 class="subhead">5 nhóm sôi nổi nhất</h3>
      ${today.topGroups.length
        ? html`<ul class="list">${today.topGroups.map((g) => html`<li key=${g.threadId}><span>${g.name}</span><span class="muted push">${g.count} tin</span></li>`)}</ul>`
        : html`<p class="muted small">Hôm nay chưa có nhóm nào nhắn tin.</p>`}
      <a class="btn btn-secondary btn-sm" href="#/chats"><${Icon} name="chat" size=${16} /> Xem phiên chat</a>`
    : html`<p class="muted">Chưa có số liệu — bot cần đăng nhập Zalo và nhận tin trước.</p>`}
  </section>`;
}
```

và trong `Overview`, đặt `<${TodayCard} today=${s.today} />` làm thẻ thứ ba trong `<div class="grid grid-2">` (sau thẻ "Lỗi gần nhất").

Trong `dashboard/public/style.css` (trước khối `/* ---------- Điện thoại ---------- */`):

```css
.subhead { font-size: 14px; font-weight: 650; margin: 16px 0 6px; }
.list .push { margin-left: auto; white-space: nowrap; }
```

- [ ] **Step 6: Chạy** `npm run test:js` → PASS (gồm `public.test.js`: import tồn tại).

- [ ] **Step 7: Commit**

```bash
git add dashboard/routes/status.js dashboard/routes/status.test.js dashboard/public/views/overview.js dashboard/public/ui.js dashboard/public/style.css
git commit -m "feat(dashboard): Tổng quan có tin hôm nay và 5 nhóm sôi nổi nhất

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Nhật ký — gộp `audit_log` và `activity.jsonl`, nhãn theo vai trò

**Files:**
- Modify: `dashboard/lib/store-reader.js` (thêm `listAudit`), `dashboard/lib/activity-log.js` (bỏ qua dòng hỏng, `limit` không phải số), `dashboard/app.js` (gắn `auditRoutes`)
- Create: `dashboard/lib/audit-feed.js`, `dashboard/lib/audit-feed.test.js`, `dashboard/routes/audit.js`, `dashboard/routes/audit.test.js`
- Test: `dashboard/lib/store-reader.test.js`, `dashboard/lib/activity-log.test.js` (thêm test)

**Interfaces:**
- Consumes: Task 1 (`createStoreReader`, `StoreUnavailable`), Task 2 (`threadNames.load()`, `fallbackName`, `failStore`, `seedHistory`, `chatMsg`), `activity.list({ before, limit })` sẵn có (mục `{ at, actor, action, detail, ok }`).
- Produces:
  - `store.listAudit({ beforeMs = Number.MAX_SAFE_INTEGER, limit = 70, failedOnly = false })` → `Array<{ id, at, actorUid, actorRole, action, category, threadId, threadType: 0|1|null, ok: boolean, error: string|null }>` — chỉ dòng kết thúc (`succeeded`/`failed`; mỗi việc bot ghi hai dòng `attempted` + kết quả), bỏ `typing` và `ack_message` (chiếm > 90 % bảng, là tín hiệu "đang gõ"/"đã xem"), mới nhất trước, `created_at_ms < beforeMs`. Không phụ thuộc tài khoản Zalo.
  - `audit-feed.js`: `export const ACTION_LABELS`, `export function describe(entry, { role, names, groups })`, `export function createAuditFeed({ store, activity, threadNames })` → `{ list({ role, beforeMs, limit = 50, failedOnly }): Promise<{ items: Array<AuditItem>, nextBefore: number|null }> }` với `AuditItem = { at, source: 'zalo'|'dashboard', who, what, where, ok, result, code? }`; `code` chỉ có khi `role === 'admin'`.
  - `GET /api/audit?status=failed&before=<ms>` → `{ ok, items, nextBefore }` (cả hai vai trò).

- [ ] **Step 1: Test `listAudit`** — thêm vào `dashboard/lib/store-reader.test.js`:

```js
test('listAudit: chỉ dòng kết quả, bỏ "đang gõ"/"đã xem", lọc lỗi, trước mốc', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  s.closeWriter();
  let clock = 0;
  const w = openZaloStore({ path: s.path, now: () => clock });
  const add = (requestId, action, at, status, error) => {
    clock = at;
    w.beginAudit({ requestId, accountId: 'bot1', actorUid: '555', actorRole: 'owner', action, category: 'send', threadId: '200', threadType: 1 });
    if (status) w.finishAudit(requestId, status, { error });
  };
  add('r1', 'send', 1000, 'succeeded');
  add('r2', 'typing', 1100, 'succeeded');
  add('r3', 'ack_message', 1200, 'succeeded');
  add('r4', 'dashboard_send', 1300, 'failed', 'operation_failed');
  add('r5', 'send', 1400); // chỉ có attempted
  w.close();
  const r = s.reader();
  assert.deepEqual(r.listAudit().map((x) => [x.action, x.at, x.ok]), [['dashboard_send', 1300, false], ['send', 1000, true]]);
  assert.deepEqual(r.listAudit({ failedOnly: true }).map((x) => [x.action, x.error]), [['dashboard_send', 'operation_failed']]);
  assert.deepEqual(r.listAudit({ beforeMs: 1300 }).map((x) => x.action), ['send']);
  assert.equal(r.listAudit()[0].threadType, 1);
});
```

- [ ] **Step 2: Test `activity-log`** — thêm vào `dashboard/lib/activity-log.test.js` (thêm `writeFileSync` vào import `node:fs`):

```js
test('dòng hỏng, null hoặc thiếu at bị bỏ qua; limit không phải số dùng mặc định', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'zd-act-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  const file = join(d, 'a.jsonl');
  writeFileSync(file, 'null\n"chuỗi"\n{hỏng\n{"actor":"x"}\n{"at":5,"actor":"anh","action":"login","ok":true}\n');
  const log = createActivityLog(file);
  assert.deepEqual(log.list({}).map((e) => e.actor), ['anh']);
  assert.equal(log.list({ limit: Number.NaN }).length, 1);
  assert.equal(log.list({ limit: 'abc' }).length, 1);
});
```

- [ ] **Step 3: Chạy, thấy FAIL** — `node --test dashboard/lib/store-reader.test.js dashboard/lib/activity-log.test.js` → `r.listAudit is not a function`; `Cannot read properties of null (reading 'at')`.

- [ ] **Step 4: Cài đặt `listAudit`** — trong `createStoreReader`, thêm hàm và đưa `listAudit` vào object trả về:

```js
  function listAudit({ beforeMs = END, limit = 70, failedOnly = false } = {}) {
    const rows = open().prepare(`
      SELECT id, created_at_ms, actor_uid, actor_role, action, category, thread_id, thread_type, status, error
      FROM audit_log
      WHERE status IN ('succeeded', 'failed') AND action NOT IN ('typing', 'ack_message')
        AND (? = 0 OR status = 'failed') AND created_at_ms < ?
      ORDER BY created_at_ms DESC, id DESC LIMIT ?
    `).all(failedOnly ? 1 : 0, Number(beforeMs), pageSize(limit, 300, 70));
    return rows.map((r) => ({
      id: Number(r.id), at: Number(r.created_at_ms), actorUid: r.actor_uid, actorRole: r.actor_role,
      action: r.action, category: r.category, threadId: r.thread_id,
      threadType: r.thread_type == null ? null : Number(r.thread_type),
      ok: r.status === 'succeeded', error: r.error || null,
    }));
  }
```

Trong `dashboard/lib/activity-log.js`, sửa `list`:

```js
    list({ before = Infinity, limit = 50 } = {}) {
      const n = Number.parseInt(limit, 10);
      return [...readLines(`${path}.1`), ...readLines(path)]
        .filter((e) => e && typeof e === 'object' && Number.isFinite(e.at) && e.at < before)
        .sort((a, b) => b.at - a.at)
        .slice(0, Number.isInteger(n) ? Math.min(Math.max(n, 1), 200) : 50);
    },
```

Chạy lại hai tệp test ở Step 3 → PASS.

- [ ] **Step 5: Test `audit-feed`** — `dashboard/lib/audit-feed.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditFeed, describe } from './audit-feed.js';

const fakeStore = (rows, { available = true } = {}) => ({
  available: () => available,
  listAudit: ({ beforeMs, limit, failedOnly }) => rows.filter((r) => r.at < beforeMs && (!failedOnly || !r.ok)).sort((a, b) => b.at - a.at).slice(0, limit),
  senderNames: () => new Map([['555', 'Anh Chủ'], ['100', 'Lan']]),
});
const fakeActivity = (entries) => ({ list: ({ before, limit }) => entries.filter((e) => e.at < before).sort((a, b) => b.at - a.at).slice(0, limit) });
const names = { load: async () => new Map([['200', 'Tổ Hoá']]) };
const row = (at, over = {}) => ({ id: at, at, actorUid: '555', actorRole: 'owner', action: 'send', category: 'send', threadId: '200', threadType: 1, ok: true, error: null, ...over });

test('gộp hai nguồn, mới nhất trước; trùng mili-giây ở ranh giới trang không mất mục', async () => {
  const feed = createAuditFeed({
    store: fakeStore([row(10), row(9), row(9, { id: 91 }), row(8)]),
    activity: fakeActivity([{ at: 9, actor: 'anh', action: 'login', detail: '', ok: true }]),
    threadNames: names,
  });
  const p1 = await feed.list({ role: 'admin', limit: 2 });
  assert.deepEqual(p1.items.map((i) => i.at), [10, 9, 9, 9]); // kéo dài trang tới hết mốc 9
  assert.equal(p1.nextBefore, 9);
  const p2 = await feed.list({ role: 'admin', limit: 2, beforeMs: p1.nextBefore });
  assert.deepEqual(p2.items.map((i) => i.at), [8]);
  assert.equal(p2.nextBefore, null);
});

test('lọc chỉ lỗi ở cả hai nguồn', async () => {
  const feed = createAuditFeed({
    store: fakeStore([row(10), row(9, { ok: false, error: 'operation_failed', action: 'dashboard_send', actorRole: 'dashboard', actorUid: 'khach' })]),
    activity: fakeActivity([{ at: 8, actor: 'x', action: 'login', detail: 'mật khẩu', ok: false }, { at: 7, actor: 'anh', action: 'login', ok: true }]),
    threadNames: names,
  });
  const { items } = await feed.list({ role: 'owner', failedOnly: true });
  assert.deepEqual(items.map((i) => [i.what, i.ok]), [['Nhắn tay từ dashboard', false], ['Đăng nhập dashboard', false]]);
});

test('chưa có lịch sử bot: chỉ hiện hoạt động dashboard', async () => {
  const feed = createAuditFeed({ store: fakeStore([], { available: false }), activity: fakeActivity([{ at: 5, actor: 'anh', action: 'zalo_logout', ok: true }]), threadNames: names });
  const { items } = await feed.list({ role: 'owner' });
  assert.deepEqual(items.map((i) => [i.who, i.what, i.where]), [['anh (dashboard)', 'Đăng xuất Zalo', 'Dashboard']]);
});

test('nhãn: Chủ bot chữ dễ hiểu không có mã; Quản trị có mã; việc lạ không lộ mã với Chủ bot', () => {
  const ctx = { names: new Map([['555', 'Anh Chủ'], ['100', 'Lan']]), groups: new Map([['200', 'Tổ Hoá']]) };
  const owner = describe({ src: 'zalo', ...row(1) }, { role: 'owner', ...ctx });
  assert.deepEqual(owner, { at: 1, source: 'zalo', who: 'Chủ nhân Anh Chủ', what: 'Bot trả lời tin nhắn', where: 'Tổ Hoá', ok: true, result: 'Thành công' });
  const failed = describe({ src: 'zalo', ...row(2, { action: 'dashboard_send', actorRole: 'dashboard', actorUid: 'khach', threadId: '100', threadType: 0, ok: false, error: 'operation_failed' }) }, { role: 'owner', ...ctx });
  assert.deepEqual([failed.who, failed.where, failed.result], ['khach (dashboard)', 'Lan', 'Không thành công — Zalo từ chối hoặc mạng lỗi']);
  const odd = { src: 'zalo', ...row(3, { action: 'createNote', actorRole: 'system', threadId: '', threadType: null }) };
  assert.equal(describe(odd, { role: 'owner', ...ctx }).what, 'Thao tác khác của bot');
  assert.equal(describe(odd, { role: 'owner', ...ctx }).who, 'Bot (tự động)');
  assert.equal(describe(odd, { role: 'owner', ...ctx }).where, '—');
  const admin = describe(odd, { role: 'admin', ...ctx });
  assert.equal(admin.what, 'createNote');
  assert.deepEqual(admin.code, { action: 'createNote', category: 'send', actorUid: '555', actorRole: 'system', threadId: '', error: null });
  const act = describe({ src: 'dashboard', at: 4, actor: 'anh', action: 'user_create', detail: 'khach (owner)', ok: true }, { role: 'admin', ...ctx });
  assert.deepEqual(act.code, { action: 'user_create', detail: 'khach (owner)' });
  assert.equal('code' in describe({ src: 'dashboard', at: 4, actor: 'anh', action: 'user_create', detail: 'khach (owner)', ok: true }, { role: 'owner', ...ctx }), false);
});
```

- [ ] **Step 6: Chạy, thấy FAIL** — `node --test dashboard/lib/audit-feed.test.js` → `Cannot find module './audit-feed.js'`.

- [ ] **Step 7: Cài đặt** `dashboard/lib/audit-feed.js`:

```js
/**
 * Màn Nhật ký (spec §6, §9): gộp audit_log của bot (đọc SQLite) với activity.jsonl của dashboard.
 * Chủ bot thấy chữ dễ hiểu; Quản trị thấy thêm mã kỹ thuật trong `code`.
 */
import { fallbackName } from './thread-names.js';

export const ACTION_LABELS = {
  // audit_log của bot
  send: 'Bot trả lời tin nhắn',
  sendMessage: 'Bot gửi tin nhắn',
  sendVoice: 'Bot gửi tin thoại',
  sendSticker: 'Bot gửi nhãn dán',
  sendLink: 'Bot gửi liên kết',
  uploadAttachment: 'Bot gửi tệp',
  undo: 'Thu hồi tin của bot',
  send_system_notice: 'Bot gửi thông báo hệ thống',
  dashboard_send: 'Nhắn tay từ dashboard',
  dashboard_login_code: 'Gửi mã đăng nhập dashboard',
  createReminder: 'Tạo lời nhắc',
  removeReminder: 'Xoá lời nhắc',
  createPoll: 'Tạo bình chọn',
  changeGroupName: 'Đổi tên nhóm',
  addUserToGroup: 'Thêm người vào nhóm',
  removeUserFromGroup: 'Mời người ra khỏi nhóm',
  addGroupDeputy: 'Thêm phó nhóm',
  removeGroupDeputy: 'Bỏ phó nhóm',
  // activity.jsonl của dashboard
  login: 'Đăng nhập dashboard',
  logout_all: 'Đăng xuất mọi nơi',
  setup_admin: 'Tạo tài khoản Quản trị đầu tiên',
  user_create: 'Tạo tài khoản dashboard',
  user_update: 'Sửa tài khoản dashboard',
  restart_assistant: 'Khởi động lại trợ lý',
  zalo_qr_start: 'Mở mã QR đăng nhập Zalo',
  zalo_logout: 'Đăng xuất Zalo',
  telegram_settings: 'Đổi cài đặt Telegram cảnh báo',
};

const REASONS = {
  operation_failed: 'Zalo từ chối hoặc mạng lỗi',
  zalo_not_logged_in: 'Bot chưa đăng nhập Zalo',
  owner_required: 'Không đủ quyền',
  cross_thread_denied: 'Không đủ quyền ở hội thoại này',
  confirmation_required: 'Cần xác nhận trước',
  command_denied: 'Lệnh không được phép',
  auth_required: 'Thiếu thông tin người gọi',
  friend_tools_disabled: 'Tính năng kết bạn đang tắt',
  own_message_not_found: 'Không tìm thấy tin để thu hồi',
};

const ROLE_LABELS = { owner: 'Chủ nhân', public: 'Thành viên' };

export function describe(x, { role, names = new Map(), groups = new Map() }) {
  const admin = role === 'admin';
  if (x.src === 'dashboard') {
    return {
      at: x.at, source: 'dashboard', who: `${x.actor} (dashboard)`,
      what: ACTION_LABELS[x.action] || (admin ? x.action : 'Thao tác khác trên dashboard'),
      where: 'Dashboard', ok: x.ok, result: x.ok ? 'Thành công' : 'Không thành công',
      ...(admin ? { code: { action: x.action, detail: x.detail || '' } } : {}),
    };
  }
  let who;
  if (x.actorRole === 'dashboard') who = `${x.actorUid} (dashboard)`;
  else if (x.actorRole === 'system') who = 'Bot (tự động)';
  else who = [ROLE_LABELS[x.actorRole] || 'Người dùng', names.get(x.actorUid)].filter(Boolean).join(' ');
  const type = x.threadType === 1 ? 1 : 0;
  const where = !x.threadId ? '—' : (type === 1 ? groups.get(x.threadId) : names.get(x.threadId)) || fallbackName(x.threadId, type);
  return {
    at: x.at, source: 'zalo', who,
    what: ACTION_LABELS[x.action] || (admin ? x.action : 'Thao tác khác của bot'),
    where, ok: x.ok,
    result: x.ok ? 'Thành công' : `Không thành công${REASONS[x.error] ? ` — ${REASONS[x.error]}` : ''}`,
    ...(admin ? { code: { action: x.action, category: x.category, actorUid: x.actorUid, actorRole: x.actorRole, threadId: x.threadId, error: x.error } } : {}),
  };
}

export function createAuditFeed({ store, activity, threadNames }) {
  return {
    async list({ role, beforeMs = Number.MAX_SAFE_INTEGER, limit = 50, failedOnly = false }) {
      const want = limit + 20; // dư ra để kéo dài trang qua các mục trùng mili-giây
      const fromBot = store.available() ? store.listAudit({ beforeMs, limit: want, failedOnly }) : [];
      const fromDashboard = activity.list({ before: beforeMs, limit: want }).filter((e) => !failedOnly || !e.ok);
      const merged = [
        ...fromBot.map((r) => ({ src: 'zalo', ...r })),
        ...fromDashboard.map((e) => ({ src: 'dashboard', at: e.at, actor: e.actor, action: e.action, detail: e.detail, ok: e.ok })),
      ].sort((a, b) => b.at - a.at);
      // Con trỏ là mốc thời gian (lấy "< before"), nên trang phải chứa trọn mọi mục cùng mốc cuối.
      let n = Math.min(limit, merged.length);
      while (n > 0 && n < merged.length && merged[n].at === merged[n - 1].at) n += 1;
      const page = merged.slice(0, n);
      const uids = page.filter((x) => x.src === 'zalo').flatMap((x) => [x.actorUid, x.threadType === 0 ? x.threadId : null]).filter(Boolean);
      const names = uids.length && store.available() ? store.senderNames(uids) : new Map();
      const groups = await threadNames.load();
      return {
        items: page.map((x) => describe(x, { role, names, groups })),
        nextBefore: merged.length > n ? page[page.length - 1].at : null,
      };
    },
  };
}
```

Chạy `node --test dashboard/lib/audit-feed.test.js` → PASS.

- [ ] **Step 8: Test route** — `dashboard/routes/audit.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createActivityLog } from '../lib/activity-log.js';
import { chatMsg, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

async function ready(t, { seed = true } = {}) {
  const deps = makeDeps(t);
  let clock = 5000;
  deps.activity = createActivityLog(join(deps.dir, 'activity-test.jsonl'), { now: () => clock });
  if (seed) seedHistory(deps, {
    messages: [
      chatMsg({ threadId: '100', threadType: 0, senderUid: '100', senderName: 'Lan' }),
      chatMsg({ threadId: '200', threadType: 1, senderUid: '555', senderName: 'Anh Chủ' }),
    ],
    audits: [
      { requestId: 'r1', action: 'send', actorUid: '555', actorRole: 'owner', threadId: '200', threadType: 1, status: 'succeeded', at: 3000 },
      { requestId: 'r2', action: 'typing', actorUid: '555', actorRole: 'owner', threadId: '200', threadType: 1, status: 'succeeded', at: 3500 },
      { requestId: 'r3', action: 'dashboard_send', actorUid: 'khach', actorRole: 'dashboard', threadId: '100', threadType: 0, status: 'failed', error: 'operation_failed', at: 2000 },
      { requestId: 'r4', action: 'send', actorUid: '', actorRole: 'system', threadId: '100', threadType: 0, at: 2500 }, // chỉ attempted
    ],
  });
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);                                      // 'login' lúc 5000
  clock = 5001;
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' }); // 'login' lúc 5001
  clock = 2800;
  deps.activity.append({ actor: 'anh', action: 'user_create', detail: 'khach (owner)' });
  return { call, admin, owner };
}

test('Nhật ký gộp hoạt động bot + dashboard, mới nhất trước, bỏ "đang gõ" và dòng chưa có kết quả', async (t) => {
  const { call, admin } = await ready(t);
  const res = await call('/api/audit', { cookie: admin });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.items.map((i) => [i.at, i.what]), [
    [5001, 'Đăng nhập dashboard'], [5000, 'Đăng nhập dashboard'], [3000, 'Bot trả lời tin nhắn'],
    [2800, 'Tạo tài khoản dashboard'], [2000, 'Nhắn tay từ dashboard'],
  ]);
  const sent = res.json.items[2];
  assert.deepEqual([sent.who, sent.where, sent.result], ['Chủ nhân Anh Chủ', 'Tổ Hoá', 'Thành công']);
  assert.equal(sent.code.action, 'send');
  assert.equal(res.json.nextBefore, null);
});

test('Chủ bot thấy chữ dễ hiểu, không có mã kỹ thuật; lọc chỉ lỗi', async (t) => {
  const { call, owner } = await ready(t);
  const all = await call('/api/audit', { cookie: owner });
  assert.ok(all.json.items.every((i) => !('code' in i)));
  const failed = await call('/api/audit?status=failed', { cookie: owner });
  assert.deepEqual(failed.json.items.map((i) => [i.what, i.who, i.where, i.result]), [
    ['Nhắn tay từ dashboard', 'khach (dashboard)', 'Lan', 'Không thành công — Zalo từ chối hoặc mạng lỗi'],
  ]);
});

test('phân trang theo before', async (t) => {
  const { call, admin } = await ready(t);
  const res = await call('/api/audit?before=3000', { cookie: admin });
  assert.deepEqual(res.json.items.map((i) => i.at), [2800, 2000]);
});

test('tham số sai → 400; chưa đăng nhập → 401', async (t) => {
  const { call, admin } = await ready(t);
  for (const q of ['?status=all', '?before=abc', '?before=-1', `?before=${'9'.repeat(17)}`]) {
    const res = await call(`/api/audit${q}`, { cookie: admin });
    assert.equal(res.status, 400, q);
    assert.match(res.json.error, /—/);
  }
  assert.equal((await call('/api/audit')).status, 401);
});

test('chưa có lịch sử: Nhật ký vẫn có hoạt động dashboard', async (t) => {
  const { call, admin } = await ready(t, { seed: false });
  const res = await call('/api/audit', { cookie: admin });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.items.map((i) => i.source), ['dashboard', 'dashboard', 'dashboard']);
});
```

- [ ] **Step 9: Chạy, thấy FAIL** — `node --test dashboard/routes/audit.test.js` → 404.

- [ ] **Step 10: Cài đặt** `dashboard/routes/audit.js`:

```js
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { createAuditFeed } from '../lib/audit-feed.js';
import { failStore } from '../lib/route-errors.js';

export function auditRoutes({ store, activity, threadNames }) {
  const r = express.Router();
  const feed = createAuditFeed({ store, activity, threadNames });
  r.get('/audit', requireAuth, async (req, res) => {
    const status = req.query.status ?? '';
    const before = req.query.before ?? '';
    if (status !== '' && status !== 'failed') return res.status(400).json({ ok: false, error: 'Bộ lọc không hợp lệ — tải lại trang rồi thử lại.' });
    if (before !== '' && !(typeof before === 'string' && /^\d{1,16}$/.test(before))) {
      return res.status(400).json({ ok: false, error: 'Vị trí trang không hợp lệ — tải lại trang rồi thử lại.' });
    }
    try {
      res.json({ ok: true, ...(await feed.list({
        role: req.user.role,
        beforeMs: before ? Number(before) : Number.MAX_SAFE_INTEGER,
        failedOnly: status === 'failed',
      })) });
    } catch (err) { failStore(res, err, 'Chưa đọc được nhật ký — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
  return r;
}
```

Trong `dashboard/app.js` thêm `import { auditRoutes } from './routes/audit.js';` và ngay sau `app.use('/api', chatRoutes(deps));` thêm `app.use('/api', auditRoutes(deps));`.

- [ ] **Step 11: Chạy, thấy PASS** — `node --test dashboard/routes/audit.test.js dashboard/lib/audit-feed.test.js dashboard/lib/store-reader.test.js dashboard/lib/activity-log.test.js` → PASS; `npm run test:js` → PASS.

- [ ] **Step 12: Commit**

```bash
git add dashboard/lib/store-reader.js dashboard/lib/store-reader.test.js dashboard/lib/activity-log.js dashboard/lib/activity-log.test.js dashboard/lib/audit-feed.js dashboard/lib/audit-feed.test.js dashboard/routes/audit.js dashboard/routes/audit.test.js dashboard/app.js
git commit -m "feat(dashboard): Nhật ký gộp hoạt động của bot và dashboard

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Giao diện Phiên chat

**Files:**
- Create: `dashboard/public/views/chats.js`
- Modify: `dashboard/public/views/shell.js` (route `/chats`, nhóm thanh bên "Hội thoại"), `dashboard/public/ui.js` (biểu tượng `search`), `dashboard/public/style.css`
- Test: `dashboard/public/public.test.js` (hàm thuần + quét tĩnh) + kiểm tay

**Interfaces:**
- Consumes: Task 2 (`GET /api/chats`, `/api/chats/search`, `/api/chats/:threadId/messages`), Task 3 (`POST /api/chats/:threadId/send`), Task 4 (biểu tượng `chat`).
- Produces: `export function Chats()`; hàm thuần `export function messageView(m: { msgType, text }): { label: string|null, text: string, link: string|null }`, `export function mergeMessages(a, b)` (gộp theo `id`, sắp `ts` rồi `id` tăng dần), `export function preview(c)`.

- [ ] **Step 1: Test** — thêm vào `dashboard/public/public.test.js`:

```js
test('tin nhắn: ảnh/tệp hiện nhãn + link https; chữ giữ nguyên, không bao giờ thành HTML hay link lạ', async () => {
  const { messageView, mergeMessages, preview } = await import('./views/chats.js');
  assert.deepEqual(messageView({ msgType: 'chat.photo', text: 'https://photo-stal-1.zdn.vn/a.jpg' }), { label: 'Ảnh', text: '', link: 'https://photo-stal-1.zdn.vn/a.jpg' });
  assert.deepEqual(messageView({ msgType: 'chat.sticker', text: '[Nhãn dán]' }), { label: 'Nhãn dán', text: '', link: null });
  assert.deepEqual(messageView({ msgType: 'webchat', text: '<img src=x onerror=alert(1)>' }), { label: null, text: '<img src=x onerror=alert(1)>', link: null });
  for (const text of ['javascript:alert(1)', 'http://evil.vn', 'data:text/html,x', 'https://a.vn có chữ']) {
    assert.equal(messageView({ msgType: 'webchat', text }).link, null, text);
  }
  assert.deepEqual(mergeMessages([{ id: 2, ts: 5 }, { id: 1, ts: 5 }], [{ id: 2, ts: 5 }, { id: 3, ts: 4 }]).map((m) => m.id), [3, 1, 2]);
  assert.equal(preview({ lastMsgType: 'chat.photo', lastText: 'https://x.zdn.vn/a.jpg', lastIsSelf: true }), 'Bot: [Ảnh]');
  assert.equal(preview({ lastMsgType: 'webchat', lastText: 'Chào', lastIsSelf: false }), 'Chào');
});

test('giao diện không dùng innerHTML và không có style nội tuyến (CSP)', () => {
  for (const f of files(root).filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/, f);
    assert.doesNotMatch(src, /\sstyle=/, f);
  }
});
```

(`vendor/*.mjs` không khớp `.js` nên không bị quét.)

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/public/public.test.js` → `Cannot find module './views/chats.js'`.

- [ ] **Step 3: Cài đặt** `dashboard/public/views/chats.js`:

```js
// Phiên chat (spec §9): trái là hội thoại + tìm toàn văn; phải là tin nhắn (bot canh phải, khác màu),
// cuộn lên tải tin cũ, ô soạn gửi dưới tên bot. Chữ tin nhắn chỉ đi qua htm — không bao giờ thành HTML.
import { useEffect, useLayoutEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner, fmtTime } from '../ui.js';

const LIST_MS = 10_000;
const THREAD_MS = 5_000;
const MAX_TEXT = 2000;

const TYPE_LABELS = {
  'chat.photo': 'Ảnh', 'chat.sticker': 'Nhãn dán', 'share.file': 'Tệp', 'chat.voice': 'Tin thoại',
  'chat.video.msg': 'Video', 'group.poll': 'Bình chọn', 'chat.recommended': 'Danh thiếp', 'chat.delete': 'Tin đã thu hồi',
  'chat.gif': 'Ảnh động', 'chat.location.new': 'Vị trí', 'chat.link': 'Liên kết',
};

const fold = (s) => String(s ?? '').normalize('NFC').toLocaleLowerCase('vi');
const keyOf = (c) => `${c.threadType}:${c.threadId}`;

export function messageView(m) {
  const label = TYPE_LABELS[m.msgType] || null;
  const raw = String(m.text ?? '');
  const trimmed = raw.trim();
  if (/^https:\/\/\S+$/.test(trimmed)) return { label: label || 'Liên kết', text: '', link: trimmed };
  // Bot lưu sẵn "[Nhãn dán]"… cho tin không có chữ — nhãn đã nói đủ, không lặp lại.
  return { label, text: label && /^\[[^\]]*\]$/.test(trimmed) ? '' : raw, link: null };
}

export function mergeMessages(a, b) {
  const byId = new Map();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.ts - y.ts || x.id - y.id);
}

export function preview(c) {
  const v = messageView({ msgType: c.lastMsgType, text: c.lastText });
  return `${c.lastIsSelf ? 'Bot: ' : ''}${v.text || (v.label ? `[${v.label}]` : '')}`;
}

function ConvItem({ c, active, onSelect }) {
  return html`<li><button type="button" class=${`conv${active ? ' active' : ''}`} aria-current=${active ? 'true' : undefined} onClick=${() => onSelect(c)}>
    <span class="conv-top"><span class="conv-name">${c.name}</span><time class="conv-time">${fmtTime(c.lastAtMs)}</time></span>
    <span class="conv-sub">${c.threadType === 1 ? html`<span class="tag">Nhóm</span>` : null}<span class="conv-preview">${preview(c)}</span></span>
  </button></li>`;
}

function ResultItem({ r, onSelect }) {
  const v = messageView(r);
  const who = r.isSelf ? 'Bot: ' : r.senderName ? `${r.senderName}: ` : '';
  return html`<li><button type="button" class="conv" onClick=${() => onSelect({ threadId: r.threadId, threadType: r.threadType, name: r.threadName })}>
    <span class="conv-top"><span class="conv-name">${r.threadName}</span><time class="conv-time">${fmtTime(r.ts)}</time></span>
    <span class="conv-preview conv-wrap">${who}${v.text || (v.label ? `[${v.label}]` : '')}</span>
  </button></li>`;
}

function Bubble({ m, group }) {
  const v = messageView(m);
  return html`<li class=${`msg${m.isSelf ? ' msg-self' : ''}`}>
    ${group && !m.isSelf ? html`<span class="msg-from">${m.senderName || 'Thành viên'}</span>` : null}
    <div class="msg-bubble">
      ${v.label ? html`<span class="msg-kind">[${v.label}]</span> ` : null}
      ${v.link ? html`<a href=${v.link} target="_blank" rel="noopener noreferrer">Mở ${v.label ? v.label.toLowerCase() : 'liên kết'}</a>` : null}
      ${v.text ? html`<span class="msg-text">${v.text}</span>` : null}
    </div>
    <time class="msg-time" datetime=${new Date(m.ts).toISOString()}>${m.isSelf ? 'Bot · ' : ''}${fmtTime(m.ts)}</time>
  </li>`;
}

function Compose({ conv, onSent }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) { setMsg({ error: 'Nội dung đang trống — gõ tin nhắn rồi gửi.' }); return; }
    if (body.length > MAX_TEXT) { setMsg({ error: `Tin nhắn dài quá ${MAX_TEXT} ký tự — rút gọn hoặc chia làm nhiều tin.` }); return; }
    setBusy(true); setMsg({});
    try {
      await api(`/api/chats/${encodeURIComponent(conv.threadId)}/send`, { method: 'POST', body: { text: body, threadType: conv.threadType } });
      setText(''); setMsg({ ok: 'Đã gửi dưới tên bot.' }); onSent();
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  return html`<form class="compose" onSubmit=${send} novalidate>
    <label for="chat-compose" class="sr-only">Tin nhắn gửi dưới tên bot</label>
    <textarea id="chat-compose" rows="2" maxlength=${MAX_TEXT} value=${text} placeholder="Nhắn dưới tên bot… (Ctrl+Enter để gửi)"
      aria-describedby="chat-compose-help" onInput=${(e) => setText(e.currentTarget.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }}></textarea>
    <div class="compose-foot">
      <small id="chat-compose-help" class="muted">Tin gửi dưới tên bot, ghi vào Nhật ký kèm tên bạn. ${text.length}/${MAX_TEXT}</small>
      <button class="btn btn-primary btn-sm" disabled=${busy}><${Icon} name="send" size=${16} /> ${busy ? 'Đang gửi…' : 'Gửi'}</button>
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

function Thread({ conv, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [older, setOlder] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  const atBottom = useRef(true);   // đang ở đáy → có tin mới thì cuộn theo
  const anchor = useRef(null);     // khoảng cách tới đáy trước khi chèn tin cũ — giữ nguyên chỗ đang đọc
  const olderBusy = useRef(false);
  const kick = useRef(() => {});
  const base = `/api/chats/${encodeURIComponent(conv.threadId)}/messages?type=${conv.threadType}`;

  // Poll trang mới nhất 5 s/lần, không chồng yêu cầu; gộp theo id nên tin cũ đã tải không mất.
  useEffect(() => {
    let alive = true; let timer = null; let inflight = false; let again = false; let first = true;
    const tick = async () => {
      if (inflight) { again = true; return; }
      clearTimeout(timer); inflight = true;
      try {
        const r = await api(base);
        if (!alive) return;
        setMsgs((cur) => mergeMessages(cur || [], r.messages));
        if (first) { setOlder(r.nextBefore); first = false; }
        setError('');
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        inflight = false;
        const next = again ? 0 : THREAD_MS; again = false;
        if (alive) timer = setTimeout(tick, next);
      }
    };
    kick.current = () => { atBottom.current = true; tick(); };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [base]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current != null) { el.scrollTop = el.scrollHeight - anchor.current; anchor.current = null; }
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function loadOlder() {
    if (!older || olderBusy.current) return;
    olderBusy.current = true; setLoadingOlder(true);
    try {
      const r = await api(`${base}&before=${encodeURIComponent(older)}`);
      const el = box.current;
      anchor.current = el ? el.scrollHeight - el.scrollTop : null;
      setMsgs((cur) => mergeMessages(r.messages, cur || []));
      setOlder(r.nextBefore);
    } catch (err) { setError(err.message); } finally { olderBusy.current = false; setLoadingOlder(false); }
  }

  function onScroll(e) {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 40) loadOlder();
  }

  const group = conv.threadType === 1;
  return html`
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${conv.name}</h2>
      ${group ? html`<span class="tag">Nhóm</span>` : null}
    </header>
    <${Live} error=${error} />
    ${msgs === null ? html`<${Spinner} />` : html`
      <ol class="msgs" ref=${box} onScroll=${onScroll} aria-label=${`Tin nhắn với ${conv.name}`}>
        <li class="msgs-top">
          ${older
            ? html`<button type="button" class="btn btn-ghost btn-sm" disabled=${loadingOlder} onClick=${loadOlder}>${loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}</button>`
            : html`<span class="muted small">${msgs.length ? 'Đầu cuộc trò chuyện' : 'Chưa có tin nhắn nào.'}</span>`}
        </li>
        ${msgs.map((m) => html`<${Bubble} key=${m.id} m=${m} group=${group} />`)}
      </ol>`}
    <${Compose} conv=${conv} onSent=${() => kick.current()} />`;
}

export function Chats() {
  const [list, setList] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [listError, setListError] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // { q, items, next } khi đang xem kết quả tìm
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true; let timer = null;
    const tick = async () => {
      try {
        const r = await api('/api/chats');
        if (!alive) return;
        setList(r.conversations); setUnavailable(Boolean(r.unavailable)); setListError('');
      } catch (err) {
        if (alive) { setListError(err.message); setList((cur) => cur || []); }
      }
      if (alive) timer = setTimeout(tick, LIST_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  async function search(e, before = null) {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2 || q.length > 100) { setSearchError('Nhập từ 2 đến 100 ký tự để tìm trong tin nhắn.'); return; }
    setSearching(true); setSearchError('');
    try {
      const params = new URLSearchParams(before ? { q, before } : { q });
      const r = await api(`/api/chats/search?${params}`);
      setFound((cur) => ({ q, items: before && cur ? [...cur.items, ...r.results] : r.results, next: r.nextBefore }));
    } catch (err) { setSearchError(err.message); } finally { setSearching(false); }
  }

  const needle = fold(query.trim());
  const shown = (list || []).filter((c) => !needle || fold(c.name).includes(needle));
  let left;
  if (found) {
    left = html`
      <div class="row found-head">
        <span class="muted small">${found.items.length ? `Kết quả cho “${found.q}”` : `Không thấy tin nào có “${found.q}”.`}</span>
        <button type="button" class="link" onClick=${() => { setFound(null); setQuery(''); }}>Quay lại danh sách</button>
      </div>
      <ul class="conv-list">${found.items.map((r) => html`<${ResultItem} key=${r.id} r=${r} onSelect=${setSelected} />`)}</ul>
      ${found.next ? html`<button type="button" class="btn btn-ghost btn-sm" disabled=${searching} onClick=${() => search(null, found.next)}>Xem thêm kết quả</button>` : null}`;
  } else if (list === null) {
    left = html`<${Spinner} />`;
  } else if (!shown.length) {
    left = html`<p class="muted small">${list.length ? 'Không có hội thoại nào trùng tên — bấm Enter để tìm trong nội dung tin nhắn.' : 'Chưa có hội thoại nào.'}</p>`;
  } else {
    left = html`<ul class="conv-list">${shown.map((c) => html`<${ConvItem} key=${keyOf(c)} c=${c}
      active=${Boolean(selected) && keyOf(selected) === keyOf(c)} onSelect=${setSelected} />`)}</ul>`;
  }

  return html`
    <${PageHead} title="Phiên chat" sub="Xem tin nhắn của bot và nhắn tay dưới tên bot khi cần." />
    ${unavailable ? html`<${Notice} kind="info">Chưa có lịch sử trò chuyện — bot cần đăng nhập Zalo và nhận tin trước. Nếu bot đã chạy lâu mà vẫn thấy dòng này, hãy báo người cài đặt.<//>` : null}
    <div class=${`chat${selected ? ' has-thread' : ''}`}>
      <section class="card chat-list" aria-label="Hội thoại">
        <form class="chat-search" role="search" onSubmit=${search} novalidate>
          <label for="chat-q" class="sr-only">Lọc theo tên, hoặc Enter để tìm trong tin nhắn</label>
          <input id="chat-q" type="search" maxlength="100" placeholder="Lọc tên, Enter để tìm trong tin nhắn" value=${query}
            onInput=${(e) => { setQuery(e.currentTarget.value); if (!e.currentTarget.value) setFound(null); }} />
          <button class="btn btn-secondary btn-sm" disabled=${searching} aria-label="Tìm trong tin nhắn"><${Icon} name="search" size=${16} /></button>
        </form>
        <${Live} error=${searchError || listError} />
        ${left}
      </section>
      <section class="card chat-thread" aria-label="Tin nhắn">
        ${selected
          ? html`<${Thread} key=${keyOf(selected)} conv=${selected} onBack=${() => setSelected(null)} />`
          : html`<p class="muted chat-empty">Chọn một hội thoại bên trái để xem tin nhắn.</p>`}
      </section>
    </div>`;
}
```

- [ ] **Step 4: Gắn vào khung** — `dashboard/public/views/shell.js`: thêm `import { Chats } from './chats.js';`; trong `ROUTES` thêm `'/chats': { view: Chats },`; trong `GROUPS` chèn nhóm mới **giữa** "Tổng quan" và "Hệ thống":

```js
  { label: 'Hội thoại', items: [{ path: '/chats', text: 'Phiên chat', icon: 'chat' }] },
```

`dashboard/public/ui.js`, thêm vào `PATHS`:

```js
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
```

- [ ] **Step 5: CSS** — `dashboard/public/style.css`, thêm trước khối `/* ---------- Điện thoại ---------- */`:

```css
/* ---------- Phiên chat ---------- */
textarea {
  width: 100%; min-height: 64px; padding: 9px 12px; resize: vertical;
  border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: var(--text); font: inherit;
}
textarea:focus-visible { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.chat { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 20px; height: calc(100vh - 190px); min-height: 480px; }
.chat > .card { margin: 0; display: flex; flex-direction: column; min-height: 0; }
.chat-search { display: flex; gap: 8px; margin-bottom: 8px; }
.conv-list { list-style: none; margin: 0 -8px; padding: 0; overflow-y: auto; flex: 1; }
.conv {
  display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 10px 8px; border: 0; border-radius: 9px;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.conv:hover { background: #f1f5f9; }
.conv.active { background: var(--brand-soft); }
.conv:focus-visible { outline: none; box-shadow: var(--focus); }
.conv-top { display: flex; justify-content: space-between; gap: 8px; }
.conv-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-time { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.conv-sub { display: flex; align-items: center; gap: 6px; min-width: 0; }
.conv-preview { color: var(--muted); font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-wrap { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.found-head { justify-content: space-between; margin-bottom: 6px; }
.thread-head { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.msgs { list-style: none; margin: 0; padding: 12px 2px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.msgs-top { align-self: center; }
.msg { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; max-width: 78%; }
.msg-self { align-self: flex-end; align-items: flex-end; }
.msg-from { font-size: 12.5px; font-weight: 600; color: var(--muted); }
.msg-bubble { padding: 8px 12px; border-radius: 14px 14px 14px 4px; background: #f1f5f9; overflow-wrap: anywhere; }
.msg-self .msg-bubble { background: var(--brand); color: #fff; border-radius: 14px 14px 4px 14px; }
.msg-self .msg-bubble a { color: #fff; }
.msg-text { white-space: pre-wrap; }
.msg-kind { font-style: italic; opacity: .85; }
.msg-time { font-size: 12px; color: var(--muted); }
.compose { border-top: 1px solid var(--border); padding-top: 12px; }
.compose-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; }
.chat-empty { margin: auto; }
.only-mobile { display: none; }
```

và **bên trong** khối `@media (max-width: 760px) { … }` có sẵn, thêm:

```css
  .chat { grid-template-columns: minmax(0, 1fr); height: auto; min-height: 0; }
  .chat.has-thread .chat-list, .chat:not(.has-thread) .chat-thread { display: none; }
  .chat-list { max-height: calc(100vh - 220px); }
  .chat-thread { height: calc(100vh - 160px); }
  .only-mobile { display: inline-flex; }
  .msg { max-width: 90%; }
```

(Chữ trắng trên `--brand #0f766e` đạt tương phản 5,4 : 1.)

- [ ] **Step 6: Chạy, thấy PASS** — `node --test dashboard/public/public.test.js` → PASS; `npm run test:js` → PASS.

- [ ] **Step 7: Kiểm tay** (Lăng Tiêu local, `node dashboard/server.js` với `.env` thật): mục "Phiên chat" có trong thanh bên ở cả hai vai trò; danh sách đúng thứ tự, tên nhóm đúng; mở một nhóm → tin bot canh phải nền xanh, tin thành viên canh trái có tên người gửi; cuộn lên đầu → tải thêm tin cũ, chỗ đang đọc không nhảy; gõ "họp" + Enter → kết quả, bấm vào mở đúng hội thoại; nhắn tay một tin vào nhóm thử → thấy trên Zalo thật và hiện trong khung sau ≤ 5 s; thu hẹp cửa sổ < 760 px → chỉ thấy danh sách, chọn hội thoại → chỉ thấy tin + nút "← Danh sách". Gửi một tin có `<b>x</b>` vào nhóm thử → dashboard hiện đúng chữ `<b>x</b>`. Chụp màn hình cho báo cáo.

- [ ] **Step 8: Commit**

```bash
git add dashboard/public/views/chats.js dashboard/public/views/shell.js dashboard/public/ui.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): giao diện Phiên chat — hội thoại, tìm, tin nhắn, nhắn tay

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Giao diện Nhật ký

**Files:**
- Create: `dashboard/public/views/audit.js`
- Modify: `dashboard/public/views/shell.js` (route `/audit`, mục "Nhật ký" trong nhóm "Hệ thống"), `dashboard/public/ui.js` (biểu tượng `list`), `dashboard/public/style.css`
- Test: `dashboard/public/public.test.js` + kiểm tay

**Interfaces:**
- Consumes: Task 5 — `GET /api/audit?status=failed&before=<ms>` → `{ items: Array<{ at, source, who, what, where, ok, result, code? }>, nextBefore }`.
- Produces: `export function Audit({ me })`; `export function codeText(code): string` (nối `khoá=giá trị` bằng ` · `, bỏ trường rỗng/null).

- [ ] **Step 1: Test** — thêm vào `dashboard/public/public.test.js`:

```js
test('Nhật ký: mã kỹ thuật cho Quản trị gọn một dòng, bỏ trường rỗng', async () => {
  const { codeText } = await import('./views/audit.js');
  assert.equal(codeText({ action: 'send', category: 'send', actorUid: '555', threadId: '', error: null }), 'action=send · category=send · actorUid=555');
  assert.equal(codeText(undefined), '');
});
```

- [ ] **Step 2: Chạy, thấy FAIL** — `node --test dashboard/public/public.test.js` → `Cannot find module './views/audit.js'`.

- [ ] **Step 3: Cài đặt** `dashboard/public/views/audit.js`:

```js
// Nhật ký (spec §9): lúc nào · ai · làm gì · ở đâu · kết quả; lọc "chỉ lỗi". Quản trị thấy thêm mã kỹ thuật.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner, fmtTime } from '../ui.js';

export function codeText(code) {
  if (!code) return '';
  return Object.entries(code).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(' · ');
}

export function Audit({ me }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const url = (before) => {
    const p = new URLSearchParams();
    if (failedOnly) p.set('status', 'failed');
    if (before) p.set('before', String(before));
    const qs = p.toString(); // không dùng p.size — trình duyệt cũ chưa có
    return `/api/audit${qs ? `?${qs}` : ''}`;
  };

  useEffect(() => {
    let alive = true;
    setItems(null); setError('');
    api(url(null))
      .then((r) => { if (alive) { setItems(r.items); setNext(r.nextBefore); } })
      .catch((err) => { if (alive) { setItems([]); setNext(null); setError(err.message); } });
    return () => { alive = false; };
  }, [failedOnly, round]);

  async function more() {
    setBusy(true); setError('');
    try {
      const r = await api(url(next));
      setItems([...(items || []), ...r.items]); setNext(r.nextBefore);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const admin = me.role === 'admin';
  let body;
  if (items === null) body = html`<${Spinner} />`;
  else if (!items.length) body = html`<p class="muted">${failedOnly ? 'Không có lỗi nào.' : 'Chưa có hoạt động nào được ghi lại.'}</p>`;
  else {
    body = html`
      <div class="table-wrap"><table class="table audit-table">
        <thead><tr><th scope="col">Lúc nào</th><th scope="col">Ai</th><th scope="col">Làm gì</th><th scope="col">Ở đâu</th><th scope="col">Kết quả</th></tr></thead>
        <tbody>${items.map((it, i) => html`<tr key=${`${it.at}-${i}`}>
          <td>${fmtTime(it.at)}</td>
          <td>${it.who}</td>
          <td>${it.what}${admin && it.code ? html`<div class="mono muted small">${codeText(it.code)}</div>` : null}</td>
          <td>${it.where}</td>
          <td><span class=${`badge ${it.ok ? 'badge-ok' : 'badge-danger'}`}><${Icon} name=${it.ok ? 'check' : 'error'} size=${14} /> ${it.result}</span></td>
        </tr>`)}</tbody>
      </table></div>
      ${next ? html`<button type="button" class="btn btn-secondary btn-sm load-more" disabled=${busy} onClick=${more}>${busy ? 'Đang tải…' : 'Xem cũ hơn'}</button>` : null}`;
  }

  return html`
    <${PageHead} title="Nhật ký" sub="Ai đã làm gì với bot: tin bot gửi, thao tác trên dashboard, và kết quả." />
    <section class="card">
      <div class="toolbar">
        <label class="check"><input type="checkbox" checked=${failedOnly} onChange=${(e) => setFailedOnly(e.currentTarget.checked)} /> Chỉ hiện lỗi</label>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setRound(round + 1)}><${Icon} name="refresh" size=${16} /> Làm mới</button>
      </div>
      <${Live} error=${error} />
      ${body}
    </section>`;
}
```

- [ ] **Step 4: Gắn vào khung** — `shell.js`: `import { Audit } from './audit.js';`, `ROUTES` thêm `'/audit': { view: Audit },`, nhóm "Hệ thống" thành:

```js
  { label: 'Hệ thống', items: [
    { path: '/zalo', text: 'Tài khoản Zalo', icon: 'phone' },
    { path: '/audit', text: 'Nhật ký', icon: 'list' },
  ] },
```

`ui.js`, thêm vào `PATHS`:

```js
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
```

`style.css`, thêm trước khối `/* ---------- Điện thoại ---------- */`:

```css
/* ---------- Nhật ký ---------- */
.toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
.check { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
.check input { width: 18px; height: 18px; min-height: 0; margin: 0; padding: 0; }
.audit-table td { white-space: normal; vertical-align: top; }
.audit-table td:first-child { white-space: nowrap; }
.load-more { margin-top: 12px; }
```

- [ ] **Step 5: Chạy, thấy PASS** — `node --test dashboard/public/public.test.js` → PASS; `npm run test:js` → PASS.

- [ ] **Step 6: Kiểm tay** — đăng nhập Quản trị: "Nhật ký" có dòng "Nhắn tay từ dashboard" của tin thử ở Task 6 với tên mình, dòng "Đăng nhập dashboard", có dòng mã kỹ thuật xám; tích "Chỉ hiện lỗi" → chỉ dòng đỏ; "Xem cũ hơn" nối tiếp không lặp. Đăng nhập Chủ bot: cùng các dòng nhưng không có dòng mã kỹ thuật. Chụp màn hình.

- [ ] **Step 7: Commit**

```bash
git add dashboard/public/views/audit.js dashboard/public/views/shell.js dashboard/public/ui.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): giao diện Nhật ký, lọc chỉ lỗi

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tài liệu và phát hành v1.20.0

**Files:**
- Modify: `README.vi.md` (mục "Dashboard quản trị"), `README.md` (mục "Admin dashboard"), `CHANGELOG.md`, `package.json`, `package-lock.json` (2 chỗ), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`

**Interfaces:**
- Consumes: mọi task trên.
- Produces: phiên bản `1.20.0` đồng bộ ở 5 chỗ; tài liệu người dùng cho hai màn mới + danh sách kiểm tay GĐ2.

- [ ] **Step 1: README.vi.md** — trong mục `## Dashboard quản trị`, ngay **trước** `### Kiểm tay sau khi cài (Giai đoạn 1)`, thêm:

```markdown
### Phiên chat

Mục **Phiên chat** hiện mọi hội thoại bot đã lưu, mới nhất trên cùng. Gõ vào ô trên cùng để lọc theo tên; bấm Enter để tìm trong nội dung tin nhắn (không phân biệt hoa thường). Mở một hội thoại: tin của bot nằm bên phải, nền màu; kéo lên đầu để xem tin cũ hơn.

Ô soạn ở dưới gửi tin **dưới tên bot** — dùng khi cần trả lời thay bot hoặc sửa một câu bot trả lời sai. Mỗi tin gửi tay được ghi vào Nhật ký kèm tên người gửi. Mỗi người gửi tối đa 10 tin mỗi phút. Chỉ gửi được vào hội thoại đã có trong lịch sử.

Dashboard đọc lịch sử thẳng từ tệp `data/zalo.sqlite` của bot ở chế độ chỉ đọc, nên kết nối Zalo tắt vẫn xem được (chỉ không gửi được).

### Nhật ký

Mục **Nhật ký** ghi ai đã làm gì: tin bot gửi, việc bot làm theo lệnh chủ nhân, tin nhắn tay từ dashboard, đăng nhập dashboard, tạo/sửa tài khoản, quét QR, đăng xuất Zalo. Tích **Chỉ hiện lỗi** để xem việc không thành công. Quản trị thấy thêm mã kỹ thuật dưới mỗi dòng.
```

và **sau** danh sách kiểm tay GĐ1 (trước dòng "Gỡ cài đặt (`npm run uninstall:hermes`) …"), thêm:

```markdown
### Kiểm tay sau khi cài (Giai đoạn 2)

- [ ] Tổng quan có thẻ "Tin nhắn hôm nay" với số nhận/gửi và 5 nhóm sôi nổi nhất.
- [ ] Phiên chat hiện danh sách hội thoại với tên nhóm đúng; mở một nhóm thấy tin bot bên phải.
- [ ] Kéo lên đầu hội thoại thì tải thêm tin cũ.
- [ ] Tìm một từ có dấu (ví dụ "họp") ra đúng tin.
- [ ] Nhắn tay một tin vào nhóm thử: tin tới Zalo thật và hiện trong khung.
- [ ] Nhật ký có dòng "Nhắn tay từ dashboard" kèm tên mình; "Chỉ hiện lỗi" lọc đúng.
- [ ] Tài khoản Chủ bot dùng được Phiên chat và Nhật ký, không thấy mã kỹ thuật.
- [ ] Tắt bot (`systemctl stop zalo-bridge` hoặc dừng tiến trình): Phiên chat vẫn xem được; gửi tin báo lỗi tiếng Việt.
```

- [ ] **Step 2: README.md** — trong `## Admin dashboard`, thêm một đoạn:

```markdown
Phase 2 adds **Chats** (conversation list with full-text search, message view with the bot's messages on the right, scroll up for older messages, and a compose box that sends as the bot — 10 messages per minute per user, existing conversations only) and **Activity log** (bot actions from `audit_log` merged with dashboard actions, "errors only" filter; admins also see technical codes). The dashboard reads `data/zalo.sqlite` read-only, so history stays visible while the Zalo connection is down. The Overview now shows today's message counts and the five busiest groups.
```

- [ ] **Step 3: CHANGELOG.md** — chèn ngay dưới dòng "Theo chuẩn [Keep a Changelog]…":

```markdown
## [1.20.0] — <ngày phát hành>

### Thêm

- **Dashboard: Phiên chat.** Danh sách hội thoại, tìm trong nội dung tin nhắn (không phân biệt hoa thường), xem tin với tin của bot bên phải, kéo lên để tải tin cũ, nhắn tay dưới tên bot (tối đa 10 tin/phút mỗi người, chỉ vào hội thoại đã có). Đọc lịch sử ở chế độ chỉ đọc nên kết nối Zalo tắt vẫn xem được.
- **Dashboard: Nhật ký.** Gộp việc bot làm và việc làm trên dashboard: lúc nào, ai, làm gì, ở đâu, kết quả; lọc "chỉ lỗi". Chủ bot thấy chữ dễ hiểu, Quản trị thấy thêm mã kỹ thuật.
- Tổng quan có thẻ "Tin nhắn hôm nay" (nhận/gửi tính từ 0 giờ giờ Việt Nam) và 5 nhóm sôi nổi nhất.

### Sửa

- Nhật ký hoạt động của dashboard bỏ qua dòng hỏng thay vì báo lỗi.
```

(`<ngày phát hành>` thay bằng ngày thật lúc phát hành, dạng `2026-10-0X`.)

- [ ] **Step 4: Bump phiên bản** `1.19.0` → `1.20.0` ở: `package.json` (`"version"`), `package-lock.json` (hai chỗ: trường `"version"` ở gốc và ở `packages[""]`), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`. Kiểm:

```bash
grep -n '"version": "1.20.0"' package.json package-lock.json
grep -n "^version: 1.20.0" hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
```

Expected: 1 dòng ở `package.json`, 2 dòng ở `package-lock.json` (dòng 3 và 9), 1 dòng ở mỗi `plugin.yaml`.

- [ ] **Step 5: Chạy toàn bộ** — `HERMES_HOME=E:/Hermes npm test` → PASS cả JS lẫn Python.

- [ ] **Step 6: Commit**

```bash
git add README.vi.md README.md CHANGELOG.md package.json package-lock.json hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
git commit -m "docs(dashboard): Phiên chat, Nhật ký, kiểm tay giai đoạn 2 (v1.20.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Triển khai lên Uyển Nhi/Lăng Tiêu, gắn tag và GitHub Release do người điều phối làm sau review cuối, như GĐ1.)

---

## Self-Review

**1. Phủ spec:**
- §5.1 `store-reader.js` "hội thoại, tin nhắn (phân trang), tìm kiếm, nhật ký" → Task 1 + `listAudit` ở Task 5.
- §7.1 `GET /api/chats`, `/api/chats/:threadId/messages?before=`, `/api/chats/search?q=` → Task 2 (thêm `type=0|1` bắt buộc vì một `threadId` cần đi kèm loại hội thoại); `POST /api/chats/:threadId/send` `{text, threadType}` → Task 3; `GET /api/audit?status=&before=` → Task 5; `/api/status` "tin hôm nay" → Task 4.
- §6 ma trận: Phiên chat (xem, tìm, nhắn tay) cả hai vai trò → test Chủ bot ở Task 2, 3; Nhật ký "kèm mã kỹ thuật" / "chữ dễ hiểu" → Task 5 tests; §6 "màn Nhật ký gộp hai nguồn" → Task 5.
- §9 Phiên chat (trái: hội thoại + tìm toàn văn; phải: tin, bot canh phải khác màu, cuộn lên tải thêm, ô soạn) → Task 6; Nhật ký (lúc nào · ai · làm gì · ở đâu · kết quả; lọc chỉ lỗi) → Task 7; Tổng quan (tin hôm nay; 5 nhóm sôi nổi nhất) → Task 4.
- §11.4 `mode=ro`, chặn path traversal → Task 1 (`readOnly` + `query_only`, `isReadOnly` test), Task 2 test tham số; §11.6 không lộ số điện thoại → không thêm trường nào, tin không có `senderUid` (Task 1 test); §11.9 dấu vết gửi tin → `audit_log` của bot (Task 3, hiện ở Task 5).
- §13 store-reader "đọc mode=ro, phân trang, tìm kiếm, chặn traversal, sidecar tắt vẫn đọc" → Task 1, Task 2.
- §14 GĐ2 → Task 1–8. Kiểm tay trong README → Task 8.

**2. Placeholder:** chỉ còn `<ngày phát hành>` trong CHANGELOG, là giá trị biết lúc phát hành — có chỉ dẫn thay.

**3. Nhất quán kiểu:** `createStoreReader` → `available/isReadOnly/listConversations/getMessages/searchMessages/hasThread/todayStats/senderNames/listAudit/close` dùng đúng tên ở Task 2–5; `createThreadNames` → `cached()/load()` dùng ở Task 2 (load), Task 4 (cached), Task 5 (load); `fallbackName(id, type)` số `0|1`; `failSidecar/failStore` Task 2–5; `seedHistory(deps, { messages, audits })` + `chatMsg` Task 2–5; `parseType` export từ `chats.js` dùng trong Task 3 cùng tệp; con trỏ tin `"<ts>:<id>"` (string), con trỏ Nhật ký số ms.

**4. Review Focus:** năm mục ở đầu đều có test đặt trong task sở hữu mã (đã ghi tên test ở từng dòng).
