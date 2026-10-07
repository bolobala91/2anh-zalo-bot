# Dashboard v2 — Giai đoạn 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn tất dashboard v2: màn **Thương hiệu** (logo, tên, màu có kiểm tương phản, "Vận hành bởi 2Anh AI", xem trước, khôi phục mặc định) cùng `/api/brand` công khai cho trang đăng nhập; màn **Chủ nhân bot** sửa `ZALO_ALLOWED_USERS` trong `.env` của Hermes kèm banner vàng "cần khởi động lại trợ lý"; hoàn thiện **Người dùng** (lần đăng nhập gần nhất) và thẻ "Lỗi gần nhất" của Tổng quan. Phát hành v1.22.0.

**Architecture:** Thương hiệu lưu ở `<HERMES_HOME>/zalo/dashboard/brand.json` + `brand/logo.png` (quyền 600). Trình duyệt tự thu logo về ≤ 256 px và xuất PNG bằng canvas; máy chủ chỉ nhận `data:image/png;base64,…` và kiểm byte (chữ ký PNG, IHDR ≤ 256×256, IEND, ≤ 400 KB) — không giải mã ảnh, không thêm thư viện. Màu được áp bằng stylesheet sinh động `/brand.css` (công khai, cùng nguồn, nạp sau `style.css`, chỉ ghi đè biến `:root`); xem trước trực tiếp đặt biến CSS qua CSSOM (`el.style.setProperty`), thứ CSP `style-src 'self'` không chặn. Chủ nhân bot: `dashboard/lib/env-file.js` chỉ đọc/sửa đúng khoá `ZALO_ALLOWED_USERS` trong `.env` Hermes (giữ `.env.bak`, ghi tạm rồi đổi tên); cờ "chờ khởi động lại" lưu ở `pending-restart.json`; nút "Khởi động lại trợ lý" khởi động lại **kết nối Zalo rồi trợ lý** khi có thay đổi chủ nhân đang chờ, vì cả hai chỉ đọc biến này lúc khởi động.

**Tech Stack:** Node ≥ 22 ESM, Express 5.2.1, `node:test`, `node:util.parseEnv`, Preact 10 + htm 3 (đã nhúng ở `dashboard/public/vendor/`). Không thêm gói npm nào.

**Spec:** `docs/superpowers/specs/2026-10-07-zalo-dashboard-v2-design.md` (§4 #8, §5.1, §6, §7.1, §9, §11.5, §11.6, §11.7, §11.8, §14 GĐ4)

## Global Constraints

- Không thêm gói npm. Không bước build. Mã giao diện chỉ dùng Preact + htm đã nhúng.
- CSP giữ nguyên (`dashboard/lib/http-guards.js`): `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'`. Logo phải phục vụ **cùng nguồn**; không có `style=` nội tuyến trong mã giao diện (test `public.test.js` đã quét `\sstyle=`) — biến CSS động chỉ đặt qua CSSOM.
- Dữ liệu dashboard: `<HERMES_HOME>/zalo/dashboard/` — `brand.json`, `brand/logo.png`, `pending-restart.json`. Mọi tệp quyền 600, thư mục 700 (`writeFileAtomic`/`writeJsonAtomic`).
- Logo (spec §11.8): kiểm magic bytes, lưu PNG, **từ chối SVG**, cạnh ≤ 256 px. Trình duyệt nhận PNG/JPEG/WebP ≤ 5 MB rồi chuyển thành PNG; máy chủ chỉ nhận PNG ≤ 400 KB.
- Màu: 6 gợi ý + mã hex; chữ trắng trên màu phải đạt tương phản **≥ 4,5 : 1** (WCAG). Máy chủ cũng từ chối màu không đạt.
- `GET /api/brand` **công khai, chỉ đọc**, chỉ trả `name`, `color`, `logoUrl`, `poweredBy` (+ `suggestions` cố định). `/brand.css`, `/brand/logo.png` công khai. Mọi route ghi thương hiệu: `requireAuth` (Quản trị **và** Chủ bot — spec §6).
- `.env` (spec §11.5): chỉ đọc/ghi `ZALO_ALLOWED_USERS`; sửa đúng dòng của khoá đó, giữ nguyên mọi dòng khác; ghi tệp tạm rồi đổi tên, giữ `.env.bak`; **không bao giờ** trả giá trị khoá khác.
- Chủ nhân bot: chỉ Quản trị (spec §6). Không bao giờ để danh sách rỗng (không khoá mất chủ nhân cuối). UID khớp `^[1-9]\d{14,21}$` (cùng quy tắc `dashboard/lib/users.js`), tối đa 20, bỏ trùng.
- Mọi thay đổi chỉ dashboard làm ghi `activity.jsonl` với tên người dùng dashboard (spec §6, §11.9): `brand_update`, `brand_logo`, `brand_logo_remove`, `brand_reset`, `owners_update`; có nhãn tiếng Việt trong `ACTION_LABELS`.
- Giao diện: tiếng Việt thường; mọi lỗi kèm bước tiếp theo; màn Chủ bot không dùng chữ "sidecar", "bridge", "toolset", "plugin" (màn Quản trị được nhắc `.env`/`ZALO_ALLOWED_USERS` vì người cài cần sửa tay); dùng được ở 390 px không cuộn ngang.
- Repo checkout với `core.autocrlf=true` (tệp làm việc CRLF): sửa tệp có sẵn bằng công cụ Edit, đừng dùng script thay chuỗi giả định `\n`.
- Commit theo quy ước repo, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Quyết định (spec không chốt, hoặc spec và mã lệch nhau)

1. **Thu nhỏ logo trong trình duyệt, máy chủ chỉ kiểm byte.** Spec §5.1/§11.8 nói "thu nhỏ phía máy chủ, lưu PNG". Node không có bộ giải mã ảnh và kế hoạch không được thêm gói npm, nên giải mã JPEG/WebP phía máy chủ là không làm được. Trình duyệt vẽ ảnh lên canvas ≤ 256 px rồi `toDataURL('image/png')` — tiện thể bỏ EXIF/GPS và mọi phần đuôi lạ. Máy chủ vẫn giữ đủ lời hứa của spec: chỉ lưu PNG, kiểm chữ ký + IHDR (cạnh 1–256) + IEND, ≤ 400 KB (PNG 256×256 RGBA không nén được ≈ 263 KB).
2. **Gửi logo dạng base64 trong JSON, không dùng thân thô.** Dùng lại `api()` (đã có `X-Requested-With`, kiểm Origin, xử lý lỗi tiếng Việt) và `express.json({ limit: '2mb' })` sẵn có; 400 KB → ≈ 540 KB base64, dư sức. Thân thô cần thêm `express.raw` riêng cho route và một đường gọi fetch khác ở giao diện — thêm mã mà không được gì (33 % phình không đáng kể ở cỡ này).
3. **Từ chối SVG ở cả hai đầu.** SVG mở thẳng tại `/brand/logo.png` cùng nguồn có thể chạy mã; làm sạch SVG đúng nghĩa cần thư viện. `accept` của ô chọn tệp không có SVG, `checkLogoFile` báo lỗi rõ, máy chủ chỉ nhận chữ ký PNG.
4. **Màu qua `/brand.css` sinh động + CSSOM cho xem trước.** `/brand.css` (công khai, `Cache-Control: no-cache`) là stylesheet cùng nguồn nên hợp `style-src 'self'`, có hiệu lực ngay khung đầu của trang đăng nhập (không nháy màu, không cần JS). Màu mặc định thì `/brand.css` chỉ là một dòng chú thích → giao diện y hệt bản trước. Xem trước chưa lưu và chấm màu gợi ý đặt biến bằng `el.style.setProperty` — CSP chỉ chặn thuộc tính `style` viết trong HTML, không chặn CSSOM (đã kiểm bằng Edge: không có cảnh báo CSP). Lưu xong, `app.js` đổi `href` của `<link id="brand-css">` sang `brand.css?v=<giờ>` để nạp lại. Phương án "class + bảng màu cố định" bị loại vì người dùng được nhập mã hex tuỳ ý.
5. **Máy chủ từ chối màu tương phản < 4,5 : 1**, không chỉ cảnh báo ở giao diện — chữ trắng trên nút chính dùng màu này, và `brand.json` sửa tay sai cũng bị bỏ qua (về mặc định).
6. **"Vận hành bởi 2Anh AI" là công tắc, mặc định bật**, hiện cuối thẻ đăng nhập và dưới "Tài khoản của tôi" ở thanh bên (ẩn trên điện thoại vì thanh bên thành một hàng). Cả hai vai trò bật/tắt được, theo ma trận §6 (Thương hiệu ✅ cả hai).
7. **Khôi phục mặc định = `DELETE /api/brand`** (xoá `brand.json` và logo, một dòng Nhật ký). Spec §7.1 không liệt kê route này; gộp vào một lệnh thay vì PUT + DELETE logo để không còn trạng thái nửa vời.
8. **Logo phục vụ tại `/brand/logo.png?v=<logoAt>`**, `Content-Type: image/png`, `nosniff` (đã có toàn cục), `Cache-Control: no-cache`. `?v=` đổi mỗi lần tải logo mới.
9. **Khởi động lại khi đổi chủ nhân = kết nối Zalo rồi trợ lý.** Spec §4 #8/§9 chỉ nói "khởi động lại trợ lý", nhưng mã cho thấy kết nối Zalo cũng chỉ đọc `ZALO_ALLOWED_USERS` lúc khởi động: `hermes-bridge.js` chụp `activeOwnerUids` khi `startHermesBridge` (quyền lệnh chủ nhân), `bot-handler.js` dùng nó cho tin riêng và tin báo lỗi. Plugin đọc qua `get_secret` (môi trường gateway, nạp `.env` Hermes lúc khởi động). Vì vậy `POST /api/admin/restart-assistant` (route sẵn có, cùng nút ở Tổng quan) khởi động lại kết nối Zalo trước rồi trợ lý **khi và chỉ khi** có thay đổi chủ nhân đang chờ, xong thì xoá cờ; lỗi giữa chừng thì cờ còn nguyên (banner vàng còn).
10. **Cờ "chờ khởi động lại" lưu ra `pending-restart.json`** (`{ since, by }`) để tải lại trang vẫn thấy banner; lưu danh sách y hệt danh sách cũ thì không ghi `.env`, không bật cờ.
11. **`.env` của thư mục bot đè lên `.env` Hermes.** Kết nối Zalo nạp `.env` của chính nó trước (`loadRepoEnv`), `loadHermesEnv` không ghi đè biến đã có. Nếu tệp đó cũng đặt `ZALO_ALLOWED_USERS` khác → màn Chủ nhân báo đỏ kèm cách sửa (`shadowed: true`). Không tự sửa tệp đó (ngoài phạm vi §11.5).
12. **Tên cho UID**: tên Zalo mới nhất trong lịch sử (`store.senderNames`, ưu tiên tin riêng) + tài khoản dashboard có cùng `zaloUid`. Chưa có thì "Chưa rõ tên — người này chưa nhắn cho bot". Mục trong `.env` không phải UID (vd. số điện thoại) hiện nhãn vàng và bị bỏ ở lần lưu kế.
13. **Người dùng: thêm "Đăng nhập gần nhất", không thêm xoá tài khoản.** Spec §6/§9 chỉ có "tạo/sửa/khoá, đặt lại mật khẩu" — đã đủ từ GĐ1 (sửa UID/vai trò thêm ở bản sửa cuối GĐ1). Xoá tài khoản làm Nhật ký mất người tương ứng; khoá là đủ. `lastLoginAt` ghi ở `/auth/verify` thành công và `/auth/setup`.
14. **Tổng quan: "Lỗi gần nhất" thành câu dễ hiểu** (mục hoãn từ GĐ1 Task 11). `runtime-health` luôn trả một câu chung có chữ "log cục bộ"; giao diện đổi theo `code` sang câu tiếng Việt + bước tiếp theo, Quản trị thấy thêm mã.

## Review Focus

1. **Tệp logo giả hoặc độc** (SVG có `onload`, JPEG đổi đuôi, PNG cụt, PNG 4000 px, thân 3 MB) → 400/413 kèm bước tiếp theo, không ghi gì, trang đăng nhập vẫn hiện biểu tượng mặc định. (Task 1 `decodeLogo: chỉ PNG thật…`; Task 2 `logo SVG / không phải PNG…`, `màu không đủ tương phản…; thân quá 2 MB bị 413`.)
2. **`brand.json` sửa tay sai** (màu nhạt, thiếu khoá, logo đã mất) → dashboard về mặc định, không vỡ trang đăng nhập. (Task 1 `kho: … tệp sửa tay sai thì về mặc định`.)
3. **`.env` của Hermes có khoá bí mật, CRLF, `export`, dấu nháy, BOM, khoá trùng** → chỉ dòng `ZALO_ALLOWED_USERS` đổi, khoá khác không bao giờ ra API. (Task 4 `ghi: chỉ đổi dòng của khoá…`, `đọc như Hermes…`, `GET: … không lộ khoá khác`.)
4. **Bỏ chủ nhân cuối cùng / nhập số điện thoại thay UID** → 400, `.env` không đổi; nút "Bỏ" bị khoá khi chỉ còn một người. (Task 4 `PUT: không cho bỏ chủ nhân cuối cùng…`; Task 5 `chủ nhân: kiểm UID…`.)
5. **Khởi động lại lỗi giữa chừng sau khi đổi chủ nhân** → banner vàng còn, lần bấm sau làm lại đủ hai bước. (Task 4 `khởi động lại lỗi giữa chừng thì vẫn giữ cờ chờ…`.)

---

## File Structure

**Dashboard (mới):**
- `dashboard/public/brand-color.js` — màu dùng chung trình duyệt + máy chủ: gợi ý, chuẩn hoá hex, tương phản WCAG, biến CSS suy ra.
- `dashboard/lib/brand.js` (+ `.test.js`) — kiểm thân PUT, kiểm logo PNG, sinh `/brand.css`, kho `brand.json` + `logo.png`.
- `dashboard/routes/brand.js` (+ `.test.js`) — `/api/brand*`, `/brand.css`, `/brand/logo.png`.
- `dashboard/public/views/brand.js` — màn Thương hiệu.
- `dashboard/lib/env-file.js` (+ `.test.js`) — đọc/sửa đúng một khoá `.env` (spec §5.1 đã liệt kê, chưa có trong mã).
- `dashboard/lib/owners.js` (+ `.test.js`) — danh sách chủ nhân, cờ chờ khởi động lại, phát hiện `.env` thư mục bot đè lên.
- `dashboard/routes/owners.test.js` — test route `/api/admin/owners` + khởi động lại.
- `dashboard/public/views/owners.js` — màn Chủ nhân bot.

**Dashboard (sửa):** `dashboard/lib/json-store.js` (+ test), `dashboard/lib/paths.js` (+ test), `dashboard/lib/users.js` (+ test), `dashboard/lib/audit-feed.js`, `dashboard/routes/admin.js` (+ test), `dashboard/routes/auth.js`, `dashboard/app.js`, `dashboard/server.js` (+ test), `dashboard/test-helpers.js`, `dashboard/public/index.html`, `dashboard/public/app.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/views/{login,shell,users,overview}.js`, `dashboard/public/public.test.js`.

**Phát hành:** `README.vi.md`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`.

Sidecar (`server.js`, `control-api.js`, `bot-handler.js`, `hermes-bridge.js`) và plugin Python **không đổi**.

---

### Task 1: Thương hiệu — lõi màu, kiểm logo, kho `brand.json`

**Files:**
- Create: `dashboard/public/brand-color.js`
- Create: `dashboard/lib/brand.js`
- Create: `dashboard/lib/brand.test.js`
- Modify: `dashboard/lib/json-store.js` (thêm `writeFileAtomic`), `dashboard/lib/json-store.test.js`
- Modify: `dashboard/lib/paths.js`, `dashboard/lib/paths.test.js`
- Modify: `dashboard/test-helpers.js` (thêm `pngOf`)

**Interfaces:**
- Consumes: `readJson`, `writeJsonAtomic` (`dashboard/lib/json-store.js`).
- Produces:
  - `dashboard/public/brand-color.js`: `DEFAULT_COLOR = '#0f766e'`, `MIN_CONTRAST = 4.5`, `SUGGESTIONS: {color, label}[6]`, `normalizeHex(v) → '#rrggbb' | null`, `contrastWithWhite(hex) → number`, `brandVars(hex) → { '--brand', '--brand-dark', '--brand-soft', '--focus' }`.
  - `dashboard/lib/json-store.js`: `writeFileAtomic(path, data: string|Buffer, opts?)` (tệp tạm 600 rồi đổi tên, thử lại EPERM/EBUSY/EACCES trên Windows như `writeJsonAtomic`).
  - `dashboard/lib/brand.js`: `DEFAULT_NAME`, `MAX_NAME = 40`, `LOGO_MAX_SIDE = 256`, `LOGO_MAX_BYTES = 409600`, `class InvalidBrand` (`name='InvalidBrand'`, `statusCode=400`), `parseBrand(body) → {name, color, poweredBy}`, `decodeLogo(dataUrl) → Buffer`, `brandCss(color) → string`, `createBrandStore({ file, logoFile, now? }) → { get(), set(body), setLogo(dataUrl), removeLogo(), reset(), logo() → Buffer|null, css() → string }`; `get()`/`set()`/… đều trả `{ name, color, poweredBy, logoUrl }` với `logoUrl = '/brand/logo.png?v=<n>' | null`.
  - `paths`: `brandLogoFile = <dataDir>/brand/logo.png`, `pendingRestartFile = <dataDir>/pending-restart.json`, `sidecarEnvFile = <sidecarRoot>/.env`.
  - `test-helpers.js`: `pngOf(width, height) → Buffer` (PNG RGBA thật, CRC đúng).

- [ ] **Step 1: Viết test**

Tạo `dashboard/lib/brand.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidBrand, brandCss, createBrandStore, decodeLogo, parseBrand } from './brand.js';
import { SUGGESTIONS, brandVars, contrastWithWhite, normalizeHex } from '../public/brand-color.js';
import { pngOf } from '../test-helpers.js';

function store(t) {
  const d = mkdtempSync(join(tmpdir(), 'zd-brand-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  let clock = 1000;
  return { d, s: createBrandStore({ file: join(d, 'brand.json'), logoFile: join(d, 'brand', 'logo.png'), now: () => clock++ }) };
}
const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

test('màu: chuẩn hoá mã, tương phản chữ trắng, 6 gợi ý đều đạt 4,5 : 1', () => {
  assert.equal(normalizeHex(' #0F766E '), '#0f766e');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  for (const bad of ['', '#12345', 'red', '#ggg000', null]) assert.equal(normalizeHex(bad), null, String(bad));
  assert.equal(contrastWithWhite('#ffffff').toFixed(2), '1.00');
  assert.equal(contrastWithWhite('#000000').toFixed(2), '21.00');
  assert.ok(contrastWithWhite('#777777') < 4.5, '#777 vừa dưới ngưỡng');
  assert.equal(SUGGESTIONS.length, 6);
  for (const { color } of SUGGESTIONS) assert.ok(contrastWithWhite(color) >= 4.5, color);
  assert.deepEqual(brandVars('#1d4ed8'), {
    '--brand': '#1d4ed8', '--brand-dark': '#173ead', '--brand-soft': '#e8edfb', '--focus': '0 0 0 3px rgba(29, 78, 216, 0.35)',
  });
});

test('parseBrand: chuẩn hoá tên, từ chối màu nhạt, tên rỗng/dài, sai kiểu', () => {
  assert.deepEqual(parseBrand({ name: '  Trường\nCNT  ', color: '1D4ED8', poweredBy: false }), { name: 'Trường CNT', color: '#1d4ed8', poweredBy: false });
  const bad = [
    [{ name: '', color: '#1d4ed8', poweredBy: true }, /trống/],
    [{ name: 'x'.repeat(41), color: '#1d4ed8', poweredBy: true }, /40 ký tự/],
    [{ name: 'A', color: '#777777', poweredBy: true }, /quá nhạt/],
    [{ name: 'A', color: 'đỏ', poweredBy: true }, /Mã màu/],
    [{ name: 'A', color: '#1d4ed8', poweredBy: 'true' }, /Vận hành bởi/],
    [{ name: 5, color: '#1d4ed8', poweredBy: true }, /Tên/],
    [null, /Tên/],
  ];
  for (const [body, re] of bad) assert.throws(() => parseBrand(body), (e) => e instanceof InvalidBrand && e.statusCode === 400 && re.test(e.message));
  assert.equal(parseBrand({ name: '🙂'.repeat(40), color: '#1d4ed8', poweredBy: true }).name.length, 80, 'đếm theo ký tự, không theo đơn vị UTF-16');
});

test('decodeLogo: chỉ PNG thật ≤ 256 px; SVG, JPEG, PNG cụt, PNG quá to, chuỗi lạ bị từ chối', () => {
  assert.equal(decodeLogo(dataUrl(pngOf(256, 64))).length > 0, true);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(0)]);
  for (const bad of [
    `data:image/svg+xml;base64,${svg.toString('base64')}`,
    dataUrl(svg),
    dataUrl(jpeg),
    dataUrl(pngOf(257, 10)),
    dataUrl(pngOf(10, 300)),
    dataUrl(pngOf(10, 10).subarray(0, 40)),
    'data:image/png;base64,@@@',
    'https://evil.vn/logo.png',
    undefined,
  ]) {
    assert.throws(() => decodeLogo(bad), InvalidBrand, String(bad).slice(0, 40));
  }
  const huge = Buffer.concat([pngOf(4, 4).subarray(0, 33), Buffer.alloc(400 * 1024), pngOf(4, 4).subarray(-12)]);
  assert.throws(() => decodeLogo(dataUrl(huge)), /quá lớn/);
});

test('brandCss: màu mặc định không ghi đè; màu khác chỉ có biến trong :root', () => {
  assert.doesNotMatch(brandCss('#0f766e'), /--brand/);
  const css = brandCss('#be123c');
  assert.match(css, /^:root \{\n {2}--brand: #be123c;\n/);
  assert.match(css, /--focus: 0 0 0 3px rgba\(190, 18, 60, 0\.35\);/);
  assert.doesNotMatch(css, /[<>"'\\]|url\(|@import/);
});

test('kho: mặc định → lưu → logo → gỡ logo → khôi phục; tệp quyền 600; tệp sửa tay sai thì về mặc định', (t) => {
  const { d, s } = store(t);
  assert.deepEqual(s.get(), { name: 'Dashboard Zalo', color: '#0f766e', poweredBy: true, logoUrl: null });
  assert.equal(s.logo(), null);
  s.set({ name: 'Trường CNT', color: '#1d4ed8', poweredBy: false });
  const withLogo = s.setLogo(dataUrl(pngOf(64, 64)));
  assert.equal(withLogo.name, 'Trường CNT');
  assert.match(withLogo.logoUrl, /^\/brand\/logo\.png\?v=\d+$/);
  assert.ok(s.logo().subarray(1, 4).toString() === 'PNG');
  const again = s.setLogo(dataUrl(pngOf(32, 32)));
  assert.notEqual(again.logoUrl, withLogo.logoUrl, 'đổi logo thì đổi ?v= để trình duyệt tải lại');
  assert.equal(s.set({ name: 'Trường CNT', color: '#be123c', poweredBy: false }).logoUrl, again.logoUrl, 'lưu màu giữ logo');
  assert.match(s.css(), /--brand: #be123c/);
  if (process.platform !== 'win32') {
    assert.equal(statSync(join(d, 'brand.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(d, 'brand', 'logo.png')).mode & 0o777, 0o600);
  }
  assert.equal(s.removeLogo().logoUrl, null);
  assert.equal(existsSync(join(d, 'brand', 'logo.png')), false);
  s.setLogo(dataUrl(pngOf(8, 8)));
  assert.deepEqual(s.reset(), { name: 'Dashboard Zalo', color: '#0f766e', poweredBy: true, logoUrl: null });
  assert.equal(existsSync(join(d, 'brand', 'logo.png')), false);
  writeFileSync(join(d, 'brand.json'), JSON.stringify({ name: 'X', color: '#ffffff', poweredBy: true, logoAt: 5 }));
  assert.deepEqual(s.get(), { name: 'Dashboard Zalo', color: '#0f766e', poweredBy: true, logoUrl: null }, 'màu nhạt sửa tay + logo đã mất');
});
```

Trong `dashboard/lib/json-store.test.js`, đổi dòng import:

```js
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeFileAtomic, writeJsonAtomic } from './json-store.js';
```

và thay test `'quyền tệp 600 trên hệ điều hành có quyền POSIX'` bằng:

```js
test('quyền tệp 600 trên hệ điều hành có quyền POSIX', { skip: process.platform === 'win32' }, (t) => {
  const p = join(tmp(t), 'k.json');
  writeJsonAtomic(p, {});
  assert.equal(statSync(p).mode & 0o777, 0o600);
  const b = join(tmp(t), 'x', 'logo.png');
  writeFileAtomic(b, Buffer.from([1, 2, 3]));
  assert.equal(statSync(b).mode & 0o777, 0o600);
});

test('writeFileAtomic ghi đúng từng byte của Buffer và chuỗi, không để lại tệp tạm', (t) => {
  const d = tmp(t);
  writeFileAtomic(join(d, 'a.bin'), Buffer.from([0, 255, 13, 10]));
  assert.deepEqual([...readFileSync(join(d, 'a.bin'))], [0, 255, 13, 10]);
  writeFileAtomic(join(d, 'b.txt'), 'Chủ nhân\n');
  assert.equal(readFileSync(join(d, 'b.txt'), 'utf8'), 'Chủ nhân\n');
  assert.deepEqual(readdirSync(d).sort(), ['a.bin', 'b.txt']);
});
```

Trong `dashboard/lib/paths.test.js`, cuối test `'đường dẫn dựng từ HERMES_HOME và thư mục sidecar'` (sau dòng `assert.equal(p.sqliteFile, …)`), thêm:

```js
  assert.equal(p.brandLogoFile, join(resolve('/h'), 'zalo', 'dashboard', 'brand', 'logo.png'));
  assert.equal(p.pendingRestartFile, join(resolve('/h'), 'zalo', 'dashboard', 'pending-restart.json'));
  assert.equal(p.sidecarEnvFile, join(resolve('/s'), '.env'));
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/lib/brand.test.js dashboard/lib/json-store.test.js dashboard/lib/paths.test.js`
Expected: FAIL — `Cannot find module …/brand.js`; `writeFileAtomic` không được xuất; `p.brandLogoFile` là `undefined`.

- [ ] **Step 3: Viết mã**

Tạo `dashboard/public/brand-color.js`:

```js
// Màu thương hiệu — dùng chung cho trình duyệt (xem trước, kiểm tương phản) và máy chủ (/brand.css, kiểm khi lưu).
export const DEFAULT_COLOR = '#0f766e';
export const MIN_CONTRAST = 4.5;

/** Sáu gợi ý — đều cho chữ trắng tương phản ≥ 4,5 : 1. */
export const SUGGESTIONS = [
  { color: '#0f766e', label: 'Xanh ngọc' },
  { color: '#1d4ed8', label: 'Xanh dương' },
  { color: '#6d28d9', label: 'Tím' },
  { color: '#be123c', label: 'Đỏ son' },
  { color: '#c2410c', label: 'Cam đất' },
  { color: '#334155', label: 'Xám than' },
];

/** "#ABC", "abc123", " #0F766E " → "#0f766e"; không hợp lệ → null. */
export function normalizeHex(value) {
  const s = String(value ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join('')}`;
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tỉ lệ tương phản WCAG giữa chữ trắng và nền màu `hex` (đã chuẩn hoá). */
export function contrastWithWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

const toHex = (parts) => `#${parts.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex, target, t) => toHex(rgb(hex).map((v) => v + (target - v) * t));

/** Bộ biến CSS suy ra từ một màu: đậm hơn (di chuột, chữ trên nền nhạt), nền nhạt, viền focus. */
export function brandVars(hex) {
  const [r, g, b] = rgb(hex);
  return {
    '--brand': hex,
    '--brand-dark': mix(hex, 0, 0.2),
    '--brand-soft': mix(hex, 255, 0.9),
    '--focus': `0 0 0 3px rgba(${r}, ${g}, ${b}, 0.35)`,
  };
}
```

Tạo `dashboard/lib/brand.js`:

```js
// Thương hiệu (spec §5.1, §9, §11.8): tên, màu, logo, dòng "Vận hành bởi 2Anh AI".
// Logo chỉ nhận PNG ≤ 256 px đã được trình duyệt thu nhỏ; máy chủ kiểm byte, không giải mã ảnh.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DEFAULT_COLOR, MIN_CONTRAST, brandVars, contrastWithWhite, normalizeHex } from '../public/brand-color.js';
import { readJson, writeFileAtomic, writeJsonAtomic } from './json-store.js';

export const DEFAULT_NAME = 'Dashboard Zalo';
export const MAX_NAME = 40;
export const LOGO_MAX_SIDE = 256;
export const LOGO_MAX_BYTES = 400 * 1024;

export class InvalidBrand extends Error {
  constructor(message) { super(message); this.name = 'InvalidBrand'; this.statusCode = 400; }
}

/** Kiểm thân PUT /api/brand; trả bản đã chuẩn hoá hoặc ném InvalidBrand (chữ tiếng Việt có bước tiếp theo). */
export function parseBrand(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof b.name !== 'string') throw new InvalidBrand('Tên hiển thị không hợp lệ — nhập lại tên.');
  // eslint-disable-next-line no-control-regex
  const name = b.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw new InvalidBrand('Tên hiển thị đang trống — nhập tên rồi lưu lại.');
  if ([...name].length > MAX_NAME) throw new InvalidBrand(`Tên hiển thị tối đa ${MAX_NAME} ký tự — rút gọn rồi lưu lại.`);
  const color = normalizeHex(b.color);
  if (!color) throw new InvalidBrand('Mã màu không hợp lệ — nhập dạng #0f766e hoặc chọn một màu gợi ý.');
  if (contrastWithWhite(color) < MIN_CONTRAST) {
    throw new InvalidBrand('Màu này quá nhạt, chữ trắng trên nút sẽ khó đọc — chọn màu đậm hơn.');
  }
  if (typeof b.poweredBy !== 'boolean') throw new InvalidBrand('Lựa chọn "Vận hành bởi 2Anh AI" không hợp lệ — tải lại trang rồi thử lại.');
  return { name, color, poweredBy: b.poweredBy };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** Nhận `data:image/png;base64,…` → Buffer PNG đã kiểm (chữ ký, IHDR, kích thước, IEND). SVG/JPEG/khác → InvalidBrand. */
export function decodeLogo(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl ?? ''));
  if (!m) throw new InvalidBrand('Logo phải là ảnh PNG, JPG hoặc WebP — chọn ảnh khác.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > LOGO_MAX_BYTES) throw new InvalidBrand('Logo quá lớn — chọn ảnh đơn giản hơn hoặc nhỏ hơn.');
  const ok = buf.length >= 8 + 25 + 12
    && buf.subarray(0, 8).equals(PNG_SIGNATURE)
    && buf.readUInt32BE(8) === 13 && buf.toString('latin1', 12, 16) === 'IHDR'
    && buf.subarray(buf.length - 12).equals(IEND);
  if (!ok) throw new InvalidBrand('Tệp không phải ảnh PNG hợp lệ — chọn ảnh khác.');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width < 1 || height < 1 || width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE) {
    throw new InvalidBrand(`Logo phải nhỏ hơn ${LOGO_MAX_SIDE}×${LOGO_MAX_SIDE} điểm ảnh — tải lại trang rồi chọn lại ảnh.`);
  }
  return buf;
}

/** Nội dung /brand.css: ghi đè biến màu khi khác mặc định; mặc định thì để style.css quyết. */
export function brandCss(color) {
  if (color === DEFAULT_COLOR) return '/* Màu mặc định — xem style.css */\n';
  const vars = Object.entries(brandVars(color)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {\n${vars}\n}\n`;
}

export function createBrandStore({ file, logoFile, now = Date.now }) {
  const DEFAULTS = { name: DEFAULT_NAME, color: DEFAULT_COLOR, poweredBy: true, logoAt: null };
  function read() {
    const raw = readJson(file, {});
    const out = { ...DEFAULTS };
    try { Object.assign(out, parseBrand({ ...DEFAULTS, ...raw })); } catch { /* tệp sửa tay sai → mặc định */ }
    out.logoAt = Number.isFinite(raw?.logoAt) && existsSync(logoFile) ? raw.logoAt : null;
    return out;
  }
  const save = (data) => writeJsonAtomic(file, data);
  return {
    /** Phần công khai — đúng thứ trang đăng nhập cần, không hơn. */
    get() {
      const b = read();
      return { name: b.name, color: b.color, poweredBy: b.poweredBy, logoUrl: b.logoAt ? `/brand/logo.png?v=${b.logoAt}` : null };
    },
    set(body) {
      const b = parseBrand(body);
      save({ ...b, logoAt: read().logoAt });
      return this.get();
    },
    setLogo(dataUrl) {
      const buf = decodeLogo(dataUrl);
      writeFileAtomic(logoFile, buf);
      const { logoAt, ...rest } = read();
      save({ ...rest, logoAt: Math.max(now(), (logoAt || 0) + 1) });
      return this.get();
    },
    removeLogo() {
      rmSync(logoFile, { force: true });
      const { logoAt, ...rest } = read();
      save({ ...rest, logoAt: null });
      return this.get();
    },
    reset() {
      rmSync(logoFile, { force: true });
      rmSync(file, { force: true });
      return this.get();
    },
    /** Buffer logo hoặc null. */
    logo: () => (read().logoAt ? readFileSync(logoFile) : null),
    css: () => brandCss(read().color),
  };
}
```

Trong `dashboard/lib/json-store.js`, thay phần đầu của `writeJsonAtomic`:

```js
export function writeJsonAtomic(path, value, { rename = renameSync, platform = process.platform } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
```

bằng:

```js
export function writeJsonAtomic(path, value, opts) {
  writeFileAtomic(path, JSON.stringify(value, null, 2), opts);
}

/** Ghi tệp tạm quyền 600 cạnh tệp đích rồi đổi tên đè lên — `data` là chuỗi (UTF-8) hoặc Buffer. */
export function writeFileAtomic(path, data, { rename = renameSync, platform = process.platform } = {}) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
```

(vòng `for (let retry = 0; ; retry += 1) { … }` phía dưới giữ nguyên — giờ nó là thân của `writeFileAtomic`.)

Trong `dashboard/lib/paths.js`, ngay sau dòng `brandFile: join(dataDir, 'brand.json'),` thêm:

```js
    brandLogoFile: join(dataDir, 'brand', 'logo.png'),
    pendingRestartFile: join(dataDir, 'pending-restart.json'),
    sidecarEnvFile: join(resolve(sidecarRoot), '.env'),
```

Trong `dashboard/test-helpers.js`, thêm `import { deflateSync } from 'node:zlib';` sau dòng `import { join } from 'node:path';`, và ngay **trước** `export function fakeSidecar(` thêm:

```js
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** Ảnh PNG thật (RGBA, một màu) cỡ width × height — đủ để trình duyệt và bộ kiểm logo nhận. */
export function pngOf(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
```

(`zlib.crc32` chỉ có từ Node 22.2 — repo cho phép Node 22.0, nên tự tính CRC.)

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/brand.test.js dashboard/lib/json-store.test.js dashboard/lib/paths.test.js`
Expected: PASS, `# fail 0` (test quyền 600 bỏ qua trên Windows).

- [ ] **Step 5: Commit**

```bash
git add dashboard/public/brand-color.js dashboard/lib/brand.js dashboard/lib/brand.test.js dashboard/lib/json-store.js dashboard/lib/json-store.test.js dashboard/lib/paths.js dashboard/lib/paths.test.js dashboard/test-helpers.js
git commit -m "feat(dashboard): lõi thương hiệu — màu có kiểm tương phản, kiểm logo PNG, kho brand.json

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Thương hiệu — `/api/brand`, `/brand.css`, `/brand/logo.png`

**Files:**
- Create: `dashboard/routes/brand.js`
- Create: `dashboard/routes/brand.test.js`
- Modify: `dashboard/app.js`, `dashboard/server.js`, `dashboard/server.test.js`, `dashboard/test-helpers.js`, `dashboard/lib/audit-feed.js`, `dashboard/public/index.html`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `createBrandStore`, `InvalidBrand` (Task 1); `SUGGESTIONS` (`dashboard/public/brand-color.js`); `requireAuth` (`dashboard/lib/http-guards.js`); `pngOf` (Task 1).
- Produces:
  - `brandRoutes({ brand, activity }) → express.Router` gắn ở **gốc** (`app.use(brandRoutes(deps))`), các đường dẫn:
    - `GET /api/brand` (công khai) → `{ ok, name, color, poweredBy, logoUrl, suggestions }`
    - `PUT /api/brand` `{ name, color, poweredBy }` · `POST /api/brand/logo` `{ dataUrl }` · `DELETE /api/brand/logo` · `DELETE /api/brand` (khôi phục) — đều `requireAuth`, trả cùng dạng như GET; lỗi kiểm → 400 `{ ok:false, error }`.
    - `GET /brand.css` (công khai, `text/css`) · `GET /brand/logo.png` (công khai, `image/png`, 404 khi chưa có).
  - `deps.brand` (buildDeps + makeDeps).
  - Hành động Nhật ký: `brand_update`, `brand_logo`, `brand_logo_remove`, `brand_reset`.
  - `index.html`: `<link rel="stylesheet" href="brand.css" id="brand-css">` ngay sau `style.css` (Task 3 dùng `id`).

- [ ] **Step 1: Viết test**

Tạo `dashboard/routes/brand.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeps, startApp, loginAs, pngOf } from '../test-helpers.js';

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BODY = { name: 'Trường CNT', color: '#be123c', poweredBy: false };

test('GET /api/brand công khai, chỉ có tên, màu, logo, dòng vận hành và gợi ý màu', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const r = await call('/api/brand');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['color', 'logoUrl', 'name', 'ok', 'poweredBy', 'suggestions']);
  assert.equal(r.json.name, 'Dashboard Zalo');
  assert.equal(r.json.suggestions.length, 6);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('chưa đăng nhập thì không sửa được gì: 401', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  for (const [method, path, body] of [['PUT', '/api/brand', BODY], ['POST', '/api/brand/logo', { dataUrl: dataUrl(pngOf(8, 8)) }], ['DELETE', '/api/brand/logo'], ['DELETE', '/api/brand']]) {
    assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  }
  assert.equal(deps.brand.get().name, 'Dashboard Zalo');
});

test('Chủ bot đổi tên/màu/logo được; /brand.css và /brand/logo.png phục vụ cùng nguồn; Nhật ký ghi tên người sửa', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const put = await call('/api/brand', { method: 'PUT', cookie, body: BODY });
  assert.equal(put.status, 200);
  assert.equal(put.json.name, 'Trường CNT');
  assert.equal((await call('/api/brand')).json.color, '#be123c');

  const css = await fetch(`${base}/brand.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(await css.text(), /--brand: #be123c;/);
  assert.match(css.headers.get('content-security-policy'), /default-src 'self'/);

  const up = await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: dataUrl(pngOf(64, 32)) } });
  assert.equal(up.status, 200);
  const logo = await fetch(base + up.json.logoUrl);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.equal(logo.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), 'PNG');

  const actions = deps.activity.list().map((e) => `${e.actor}:${e.action}`);
  assert.ok(actions.includes('khach:brand_update') && actions.includes('khach:brand_logo'));
});

test('logo SVG / không phải PNG / quá cỡ bị 400 kèm bước tiếp theo, không ghi gì', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
  for (const body of [{ dataUrl: svg }, { dataUrl: dataUrl(pngOf(300, 300)) }, { dataUrl: 'x' }, {}]) {
    const r = await call('/api/brand/logo', { method: 'POST', cookie, body });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /—/);
  }
  assert.equal((await fetch(`${base}/brand/logo.png`)).status, 404);
  assert.equal(deps.brand.get().logoUrl, null);
});

test('màu không đủ tương phản bị 400; thân quá 2 MB bị 413', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const r = await call('/api/brand', { method: 'PUT', cookie, body: { ...BODY, color: '#fde68a' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /đậm hơn/);
  const big = await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}` } });
  assert.equal(big.status, 413);
});

test('gỡ logo và khôi phục mặc định', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  await call('/api/brand', { method: 'PUT', cookie, body: BODY });
  await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: dataUrl(pngOf(16, 16)) } });
  assert.equal((await call('/api/brand/logo', { method: 'DELETE', cookie })).json.logoUrl, null);
  const reset = await call('/api/brand', { method: 'DELETE', cookie });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.name, 'Dashboard Zalo');
  assert.doesNotMatch(await (await fetch(`${base}/brand.css`)).text(), /--brand/);
  assert.ok(deps.activity.list().some((e) => e.action === 'brand_reset'));
});
```

Trong `dashboard/server.test.js`, thêm `'brand'` vào `requiredKeys`:

```js
      'sidecar', 'linker', 'watchdog', 'restartAssistant', 'publicDir', 'paths', 'store', 'threadNames', 'permissions', 'brand'
```

Trong `dashboard/public/public.test.js`, thay test `'index.html không tải tài nguyên từ Internet'` bằng:

```js
test('index.html không tải tài nguyên từ Internet; nạp brand.css sau style.css để màu thương hiệu đè lên', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
  assert.ok(html.indexOf('href="brand.css"') > html.indexOf('href="style.css"'));
  assert.match(html, /id="brand-css"/);
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/routes/brand.test.js dashboard/server.test.js dashboard/public/public.test.js`
Expected: FAIL — `GET /api/brand` trả 404 (`Không có đường dẫn này`), thiếu khoá `brand` trong `buildDeps`, `index.html` chưa có `brand.css`.

- [ ] **Step 3: Viết mã**

Tạo `dashboard/routes/brand.js`:

```js
// Thương hiệu (spec §7.1): GET /api/brand công khai vì trang đăng nhập cần; mọi thao tác ghi cần đăng nhập
// (Quản trị và Chủ bot — spec §6). /brand.css và /brand/logo.png cũng công khai, phục vụ cùng nguồn (CSP).
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { SUGGESTIONS } from '../public/brand-color.js';

const SAVE_FAIL = 'Chưa lưu được thương hiệu — thử lại, nếu vẫn lỗi hãy báo người cài đặt.';

export function brandRoutes({ brand, activity }) {
  const r = express.Router();
  const fail = (res, err) => {
    if (err?.name === 'InvalidBrand') return res.status(400).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: SAVE_FAIL });
  };
  const log = (req, action, detail = '') => {
    try { activity.append({ actor: req.user.username, action, detail }); } catch (err) { console.error('[dashboard] không ghi được Nhật ký thương hiệu:', err); }
  };
  const noCache = (res) => res.set('Cache-Control', 'no-cache');

  r.get('/api/brand', (req, res) => {
    try { noCache(res).json({ ok: true, ...brand.get(), suggestions: SUGGESTIONS }); } catch (err) { fail(res, err); }
  });

  r.put('/api/brand', requireAuth, (req, res) => {
    try {
      const b = brand.set(req.body);
      log(req, 'brand_update', `${b.name} · ${b.color}${b.poweredBy ? '' : ' · ẩn "Vận hành bởi 2Anh AI"'}`);
      res.json({ ok: true, ...b, suggestions: SUGGESTIONS });
    } catch (err) { fail(res, err); }
  });

  r.post('/api/brand/logo', requireAuth, (req, res) => {
    try {
      const b = brand.setLogo(req.body?.dataUrl);
      log(req, 'brand_logo');
      res.json({ ok: true, ...b, suggestions: SUGGESTIONS });
    } catch (err) { fail(res, err); }
  });

  r.delete('/api/brand/logo', requireAuth, (req, res) => {
    try {
      const b = brand.removeLogo();
      log(req, 'brand_logo_remove');
      res.json({ ok: true, ...b, suggestions: SUGGESTIONS });
    } catch (err) { fail(res, err); }
  });

  r.delete('/api/brand', requireAuth, (req, res) => {
    try {
      const b = brand.reset();
      log(req, 'brand_reset');
      res.json({ ok: true, ...b, suggestions: SUGGESTIONS });
    } catch (err) { fail(res, err); }
  });

  r.get('/brand.css', (req, res) => {
    try { noCache(res).type('text/css; charset=utf-8').send(brand.css()); } catch (err) {
      console.error('[dashboard] /brand.css lỗi:', err);
      noCache(res).type('text/css; charset=utf-8').send('/* lỗi — dùng màu mặc định */\n');
    }
  });

  r.get('/brand/logo.png', (req, res) => {
    let buf = null;
    try { buf = brand.logo(); } catch (err) { console.error('[dashboard] đọc logo lỗi:', err); }
    if (!buf) return res.status(404).type('text/plain; charset=utf-8').send('Chưa có logo');
    noCache(res).type('image/png').set('Content-Disposition', 'inline; filename="logo.png"').send(buf);
  });

  return r;
}
```

`dashboard/app.js` — thêm import sau dòng `import { permissionRoutes } from './routes/permissions.js';`:

```js
import { brandRoutes } from './routes/brand.js';
```

và ngay sau dòng `app.use('/api', adminRoutes(deps));` thêm:

```js
  // Gắn ở gốc: router này có cả /api/brand lẫn /brand.css, /brand/logo.png (công khai, trước giao diện tĩnh).
  app.use(brandRoutes(deps));
```

(Phải đứng trước `express.static` và trước bộ bắt `/api` 404 ở dưới. `/api/brand` vẫn đi qua `checkOrigin` và `sessionMiddleware` vì hai middleware đó gắn ở `/api` phía trên.)

`dashboard/server.js` — thêm import sau dòng `import { makeRestartAssistant } from './lib/restart-assistant.js';`:

```js
import { createBrandStore } from './lib/brand.js';
```

và trong object trả về của `buildDeps`, ngay sau dòng `restartAssistant: makeRestartAssistant(…),` thêm:

```js
    brand: createBrandStore({ file: paths.brandFile, logoFile: paths.brandLogoFile }),
```

`dashboard/test-helpers.js` — thêm `import { createBrandStore } from './lib/brand.js';` sau dòng import `createPermissionsStore`, và trong `makeDeps`, ngay sau `restartAssistant: async () => {},` thêm:

```js
    brand: createBrandStore({ file: join(dir, 'brand.json'), logoFile: join(dir, 'brand', 'logo.png') }),
```

`dashboard/lib/audit-feed.js` — trong `ACTION_LABELS`, sau dòng `permissions_group: 'Đổi phân quyền nhóm',` thêm:

```js
  brand_update: 'Đổi thương hiệu',
  brand_logo: 'Đổi logo',
  brand_logo_remove: 'Gỡ logo',
  brand_reset: 'Khôi phục thương hiệu mặc định',
```

`dashboard/public/index.html` — ngay sau dòng `<link rel="stylesheet" href="style.css">` thêm:

```html
  <link rel="stylesheet" href="brand.css" id="brand-css">
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/routes/brand.test.js dashboard/server.test.js dashboard/public/public.test.js dashboard/lib/audit-feed.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/routes/brand.js dashboard/routes/brand.test.js dashboard/app.js dashboard/server.js dashboard/server.test.js dashboard/test-helpers.js dashboard/lib/audit-feed.js dashboard/public/index.html dashboard/public/public.test.js
git commit -m "feat(dashboard): /api/brand công khai cho trang đăng nhập, /brand.css và logo cùng nguồn

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Thương hiệu — màn hình, thanh bên và trang đăng nhập theo thương hiệu

**Files:**
- Create: `dashboard/public/views/brand.js`
- Modify: `dashboard/public/ui.js`, `dashboard/public/app.js`, `dashboard/public/views/login.js`, `dashboard/public/views/shell.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/brand`, `POST/DELETE /api/brand/logo` (Task 2); `brand-color.js` (Task 1).
- Produces:
  - `ui.js`: `BrandMark({ brand, size? })`, `PoweredBy({ brand })`, biểu tượng `image`, `crown` (Task 5 dùng `crown`).
  - `app.js`: prop `brand` truyền cho `Login`/`Setup`/`Shell` giờ là object `{ name, poweredBy, logoUrl }` (trước là chuỗi); sự kiện `window` `zd:brand` (detail = phản hồi `/api/brand`) cập nhật thương hiệu và nạp lại `brand.css`.
  - `views/brand.js`: `Brand()` và các hàm thuần để test: `fitSize(w, h, max=256)`, `checkLogoFile(file) → ''|câu lỗi`, `contrastInfo(value) → { hex, ok, text }`, hằng `LOGO_TYPES`, `LOGO_MAX_INPUT`, `LOGO_SIDE`.
  - Thanh bên: mục **Thương hiệu** (`#/brand`, cả hai vai trò) trong nhóm Hệ thống, sau Nhật ký.

- [ ] **Step 1: Viết test** — trong `dashboard/public/public.test.js`, thêm vào cuối tệp:

```js
test('thương hiệu: thu nhỏ logo giữ tỉ lệ, kiểm loại tệp, câu tương phản', async () => {
  const { fitSize, checkLogoFile, contrastInfo } = await import('./views/brand.js');
  assert.deepEqual(fitSize(1024, 512), { width: 256, height: 128 });
  assert.deepEqual(fitSize(100, 3000), { width: 9, height: 256 });
  assert.deepEqual(fitSize(64, 64), { width: 64, height: 64 }, 'ảnh nhỏ giữ nguyên');
  assert.deepEqual(fitSize(5000, 1), { width: 256, height: 1 });
  assert.equal(checkLogoFile({ type: 'image/png', size: 1000 }), '');
  assert.equal(checkLogoFile({ type: 'image/webp', size: 5 * 1024 * 1024 }), '');
  assert.match(checkLogoFile({ type: 'image/svg+xml', size: 100 }), /không nhận SVG/);
  assert.match(checkLogoFile({ type: 'image/gif', size: 100 }), /PNG, JPG hoặc WebP/);
  assert.match(checkLogoFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.match(checkLogoFile(undefined), /—/);
  assert.deepEqual(contrastInfo('#0F766E'), { hex: '#0f766e', ok: true, text: 'Chữ trắng trên màu này: 5,47 : 1 — dễ đọc.' });
  assert.equal(contrastInfo('#777777').ok, false);
  assert.match(contrastInfo('#777777').text, /4,48 : 1 — dưới 4,5 : 1/);
  assert.deepEqual(contrastInfo('xanh'), { hex: null, ok: false, text: 'Mã màu chưa đúng — nhập dạng #0f766e hoặc chọn một màu gợi ý.' });
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/public/public.test.js`
Expected: FAIL — `Cannot find module …/views/brand.js`.

- [ ] **Step 3: Viết mã**

Tạo `dashboard/public/views/brand.js`:

```js
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, BrandMark, Icon, Live, PageHead, PoweredBy, Spinner } from '../ui.js';
import { DEFAULT_COLOR, MIN_CONTRAST, SUGGESTIONS, brandVars, contrastWithWhite, normalizeHex } from '../brand-color.js';

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX_INPUT = 5 * 1024 * 1024;
export const LOGO_SIDE = 256;
const DEFAULT_NAME = 'Dashboard Zalo';

/** Cỡ mới giữ tỉ lệ, cạnh dài nhất ≤ max; ảnh nhỏ hơn thì giữ nguyên. */
export function fitSize(width, height, max = LOGO_SIDE) {
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Kiểm tệp người dùng chọn trước khi đọc; trả câu lỗi hoặc ''. SVG bị từ chối (có thể chứa mã chạy được). */
export function checkLogoFile(file) {
  if (!file || !LOGO_TYPES.includes(file.type)) return 'Chỉ nhận ảnh PNG, JPG hoặc WebP (không nhận SVG) — chọn ảnh khác.';
  if (file.size > LOGO_MAX_INPUT) return 'Ảnh lớn hơn 5 MB — chọn ảnh nhỏ hơn.';
  return '';
}

/** Câu tương phản hiện cạnh ô mã màu. */
export function contrastInfo(value) {
  const hex = normalizeHex(value);
  if (!hex) return { hex: null, ok: false, text: 'Mã màu chưa đúng — nhập dạng #0f766e hoặc chọn một màu gợi ý.' };
  const ratio = contrastWithWhite(hex);
  const shown = ratio.toFixed(2).replace('.', ',');
  return ratio >= MIN_CONTRAST
    ? { hex, ok: true, text: `Chữ trắng trên màu này: ${shown} : 1 — dễ đọc.` }
    : { hex, ok: false, text: `Chữ trắng trên màu này: ${shown} : 1 — dưới 4,5 : 1, khó đọc. Chọn màu đậm hơn.` };
}

/** Thu ảnh về ≤ 256 px rồi xuất PNG ngay trong trình duyệt — máy chủ chỉ nhận PNG đã thu nhỏ. */
async function logoDataUrl(file) {
  const problem = checkLogoFile(file);
  if (problem) throw new Error(problem);
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch {
    throw new Error('Không đọc được ảnh này — mở ảnh bằng trình xem ảnh, lưu lại dạng PNG rồi chọn lại.');
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL('image/png');
}

/** Gắn biến CSS lên phần tử qua CSSOM: CSP `style-src 'self'` chặn thuộc tính style viết trong HTML, không chặn CSSOM. */
function useCssVars(ref, vars) {
  const key = JSON.stringify(vars);
  useEffect(() => {
    const el = ref.current;
    if (el) for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  }, [key]);
}

function Swatch({ s, selected, onPick }) {
  const ref = useRef(null);
  useCssVars(ref, { '--swatch': s.color });
  return html`<button type="button" ref=${ref} class=${`swatch${selected ? ' selected' : ''}`} aria-pressed=${selected}
    onClick=${() => onPick(s.color)}><span class="swatch-dot" aria-hidden="true"></span>${s.label}</button>`;
}

/** Thanh bên và trang đăng nhập thu nhỏ, tô theo màu đang chọn (chưa lưu). */
function Preview({ brand, hex }) {
  const ref = useRef(null);
  useCssVars(ref, brandVars(hex || DEFAULT_COLOR));
  return html`<div class="brand-preview" ref=${ref} aria-hidden="true">
    <div class="pv-side">
      <div class="side-brand"><${BrandMark} brand=${brand} /><span>${brand.name}</span></div>
      <span class="nav-item active"><${Icon} name="home" /><span>Tổng quan</span></span>
      <span class="nav-item"><${Icon} name="chat" /><span>Phiên chat</span></span>
      <${PoweredBy} brand=${brand} />
    </div>
    <div class="pv-login">
      <div class="auth-brand"><${BrandMark} brand=${brand} size=${22} /><span>${brand.name}</span></div>
      <strong>Đăng nhập</strong>
      <span class="btn btn-primary btn-block">Tiếp tục</span>
      <${PoweredBy} brand=${brand} />
    </div>
  </div>`;
}

const formOf = (b) => ({ name: b.name, color: b.color, poweredBy: b.poweredBy });

export function Brand() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});

  useEffect(() => {
    api('/api/brand').then((r) => { setSaved(r); setForm(formOf(r)); }).catch((err) => setLoadError(err.message));
  }, []);

  const head = html`<${PageHead} title="Thương hiệu" sub="Logo, tên và màu hiện trên dashboard và trang đăng nhập." />`;
  if (loadError) return html`${head}<${Live} error=${loadError} />`;
  if (!form) return html`${head}<${Spinner} />`;

  const info = contrastInfo(form.color);
  const dirty = form.name.trim() !== saved.name || info.hex !== saved.color || form.poweredBy !== saved.poweredBy;
  const preview = { name: form.name.trim() || DEFAULT_NAME, poweredBy: form.poweredBy, logoUrl: saved.logoUrl };

  // keepForm: đổi logo không được xoá phần tên/màu đang sửa dở.
  async function run(key, fn, okText, { keepForm = false } = {}) {
    setBusy(key); setMsg({});
    try {
      const r = await fn();
      setSaved(r);
      if (!keepForm) setForm(formOf(r));
      window.dispatchEvent(new CustomEvent('zd:brand', { detail: r }));
      setMsg({ ok: okText });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(''); }
  }
  const save = (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setMsg({ error: 'Tên hiển thị đang trống — nhập tên rồi lưu lại.' }); return; }
    if (!info.ok) { setMsg({ error: info.text }); return; }
    run('save', () => api('/api/brand', { method: 'PUT', body: { name: form.name, color: info.hex, poweredBy: form.poweredBy } }),
      'Đã lưu — thanh bên và trang đăng nhập đã đổi theo.');
  };
  const upload = (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    run('logo', async () => api('/api/brand/logo', { method: 'POST', body: { dataUrl: await logoDataUrl(file) } }), 'Đã đổi logo.', { keepForm: true });
  };
  const removeLogo = () => run('logo', () => api('/api/brand/logo', { method: 'DELETE' }), 'Đã gỡ logo — dùng lại biểu tượng mặc định.', { keepForm: true });
  const reset = () => {
    if (!confirm('Khôi phục tên, màu và logo mặc định? Logo đã tải lên sẽ bị xoá.')) return;
    run('reset', () => api('/api/brand', { method: 'DELETE' }), 'Đã khôi phục mặc định.');
  };
  const set = (k) => (v) => setForm({ ...form, [k]: v });

  return html`${head}
    <div class="grid grid-2">
      <div class="brand-col">
        <section class="card">
          <h2>Logo</h2>
          <div class="logo-pick">
            <${BrandMark} brand=${saved} size=${22} />
            <div class="field">
              <label for="brand-logo">Chọn ảnh logo</label>
              <input id="brand-logo" type="file" accept=${LOGO_TYPES.join(',')} disabled=${busy !== ''}
                aria-describedby="brand-logo-help" onChange=${upload} />
              <small id="brand-logo-help">PNG, JPG hoặc WebP, tối đa 5 MB. Ảnh được thu về ${LOGO_SIDE}×${LOGO_SIDE} điểm ảnh — nên dùng ảnh vuông, nền trong suốt.</small>
            </div>
          </div>
          ${saved.logoUrl ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== ''} onClick=${removeLogo}>Gỡ logo</button>` : null}
          ${busy === 'logo' ? html`<${Spinner} label="Đang xử lý ảnh…" />` : null}
        </section>
        <form class="card" onSubmit=${save} novalidate>
          <h2>Tên và màu</h2>
          <div class="field">
            <label for="brand-name">Tên hiển thị</label>
            <input id="brand-name" maxlength="40" value=${form.name} aria-describedby="brand-name-help"
              onInput=${(e) => set('name')(e.currentTarget.value)} />
            <small id="brand-name-help">Hiện trên thanh bên, trang đăng nhập và tab trình duyệt. Tối đa 40 ký tự.</small>
          </div>
          <fieldset class="field brand-colors">
            <legend>Màu chủ đạo</legend>
            <div class="swatches">
              ${SUGGESTIONS.map((s) => html`<${Swatch} key=${s.color} s=${s} selected=${info.hex === s.color} onPick=${set('color')} />`)}
            </div>
            <div class="color-row">
              <input type="color" aria-label="Bảng chọn màu" value=${info.hex || DEFAULT_COLOR} onInput=${(e) => set('color')(e.currentTarget.value)} />
              <label class="sr-only" for="brand-hex">Mã màu</label>
              <input id="brand-hex" class="mono" spellcheck="false" autocomplete="off" maxlength="7" value=${form.color}
                aria-describedby="brand-contrast" onInput=${(e) => set('color')(e.currentTarget.value)} />
            </div>
            <p id="brand-contrast" class=${`contrast ${info.ok ? 'contrast-ok' : 'contrast-bad'}`} aria-live="polite">
              <${Icon} name=${info.ok ? 'check' : 'warn'} size=${16} /> ${info.text}</p>
          </fieldset>
          <label class="check" for="brand-powered">
            <input id="brand-powered" type="checkbox" checked=${form.poweredBy} onChange=${(e) => set('poweredBy')(e.currentTarget.checked)} />
            Hiện dòng "Vận hành bởi 2Anh AI"</label>
          <div class="row form-end">
            <button class="btn btn-primary" disabled=${busy !== '' || !dirty || !info.ok}>${busy === 'save' ? 'Đang lưu…' : 'Lưu'}</button>
            <button type="button" class="btn btn-secondary" disabled=${busy !== ''} onClick=${reset}>
              <${Icon} name="refresh" size=${16} /> Khôi phục mặc định</button>
          </div>
          <${Live} error=${msg.error} ok=${msg.ok} />
        </form>
      </div>
      <section class="card">
        <h2>Xem trước</h2>
        <p class="muted small">Thanh bên và trang đăng nhập theo lựa chọn hiện tại — bấm Lưu để áp dụng.</p>
        <${Preview} brand=${preview} hex=${info.hex} />
      </section>
    </div>`;
}
```

`dashboard/public/ui.js` — trong `PATHS`, sau dòng `shield: …,` thêm:

```js
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3.5 7a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  crown: 'M2 18h20M3 7l4.5 5L12 5l4.5 7L21 7l-2 11H5z',
```

và ngay **trước** `export function PageHead(` thêm:

```js
/** Logo thương hiệu: ảnh đã tải lên (cùng nguồn, hợp CSP), chưa có thì biểu tượng bot trên nền màu thương hiệu. */
export function BrandMark({ brand, size = 20 }) {
  return brand?.logoUrl
    ? html`<img class="logo logo-img" src=${brand.logoUrl} alt="" />`
    : html`<span class="logo" aria-hidden="true"><${Icon} name="bot" size=${size} /></span>`;
}

export function PoweredBy({ brand }) {
  return brand?.poweredBy ? html`<p class="powered">Vận hành bởi 2Anh AI</p>` : null;
}
```

`dashboard/public/app.js` — thay:

```js
const DEFAULT_BRAND = 'Dashboard Zalo';
const route = () => location.hash.replace(/^#/, '') || '/';
```

bằng:

```js
const DEFAULT_BRAND = { name: 'Dashboard Zalo', poweredBy: true, logoUrl: null };
const pickBrand = (r) => ({ name: String(r?.name || DEFAULT_BRAND.name), poweredBy: r?.poweredBy !== false, logoUrl: r?.logoUrl || null });
const route = () => location.hash.replace(/^#/, '') || '/';

/** Tải lại /brand.css sau khi đổi màu (đổi ?v= để trình duyệt không dùng bản cũ). */
function reloadBrandCss() {
  const link = document.getElementById('brand-css');
  if (link) link.href = `brand.css?v=${Date.now()}`;
}
```

và thay:

```js
    addEventListener('hashchange', onHash); addEventListener('zd:logout', onLogout);
    api('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
    // Trang Thương hiệu làm ở giai đoạn sau; chưa có thì giữ tên mặc định.
    api('/api/brand').then((r) => { if (r.name) setBrand(String(r.name)); }).catch(() => {});
    return () => { removeEventListener('hashchange', onHash); removeEventListener('zd:logout', onLogout); };
  }, []);
  useEffect(() => { document.title = brand; }, [brand]);
```

bằng:

```js
    // Trang Thương hiệu lưu xong thì báo qua sự kiện này để thanh bên, tab trình duyệt và màu đổi ngay.
    const onBrand = (e) => { setBrand(pickBrand(e.detail)); reloadBrandCss(); };
    addEventListener('hashchange', onHash); addEventListener('zd:logout', onLogout); addEventListener('zd:brand', onBrand);
    api('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
    api('/api/brand').then((r) => setBrand(pickBrand(r))).catch(() => {});
    return () => {
      removeEventListener('hashchange', onHash); removeEventListener('zd:logout', onLogout); removeEventListener('zd:brand', onBrand);
    };
  }, []);
  useEffect(() => { document.title = brand.name; }, [brand.name]);
```

`dashboard/public/views/login.js` — đổi import `ui.js` thành `import { html, BrandMark, Icon, Live, PoweredBy } from '../ui.js';` và thay thân `AuthCard`:

```js
      <div class="auth-brand"><span class="logo" aria-hidden="true"><${Icon} name="bot" size=${22} /></span><span>${brand}</span></div>
      <h1>${title}</h1>
      ${sub ? html`<p class="muted">${sub}</p>` : null}
      ${children}
    </div>
```

bằng:

```js
      <div class="auth-brand"><${BrandMark} brand=${brand} size=${22} /><span>${brand.name}</span></div>
      <h1>${title}</h1>
      ${sub ? html`<p class="muted">${sub}</p>` : null}
      ${children}
      <${PoweredBy} brand=${brand} />
    </div>
```

(`views/setup.js` chỉ chuyển tiếp `brand` cho `AuthCard` — không cần sửa.)

`dashboard/public/views/shell.js`:
- import `ui.js` thành `import { html, BrandMark, Icon, PoweredBy, roleLabel } from '../ui.js';` và thêm `import { Brand } from './brand.js';` sau dòng import `Permissions`;
- trong `ROUTES`, sau `'/audit': { view: Audit },` thêm `'/brand': { view: Brand },`;
- trong `GROUPS` nhóm `Hệ thống`, sau mục Nhật ký thêm `{ path: '/brand', text: 'Thương hiệu', icon: 'image' },`;
- trong `Sidebar`, thay `<div class="side-brand"><span class="logo" aria-hidden="true"><${Icon} name="bot" size=${20} /></span><span>${brand}</span></div>` bằng `<div class="side-brand"><${BrandMark} brand=${brand} /><span>${brand.name}</span></div>`, và ngay sau thẻ `</a>` của "Tài khoản của tôi" (trong `nav-foot`) thêm `<${PoweredBy} brand=${brand} />`.

`dashboard/public/style.css` — ngay **trước** dòng `/* ---------- Điện thoại ---------- */` thêm:

```css
/* ---------- Thương hiệu ---------- */
.logo-img { object-fit: contain; background: transparent; }
.powered { margin-top: 16px; font-size: 12px; color: var(--muted); text-align: center; }
.nav-foot .powered { margin-top: 8px; }
.logo-pick { display: flex; gap: 14px; align-items: flex-start; margin: 12px 0 4px; }
.logo-pick .field { margin-bottom: 8px; min-width: 0; }
.brand-colors { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
.brand-colors legend { padding: 0; margin-bottom: 6px; font-weight: 600; font-size: 14px; }
.swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.swatch {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border: 1px solid var(--border);
  border-radius: 999px; background: var(--card); color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.swatch:hover { background: #f1f5f9; }
.swatch.selected { border-color: var(--text); box-shadow: 0 0 0 1px var(--text); font-weight: 600; }
.swatch-dot { width: 18px; height: 18px; border-radius: 50%; background: var(--swatch); }
.color-row { display: flex; gap: 10px; align-items: center; }
.color-row input[type="color"] { width: 48px; height: 40px; padding: 2px; flex: none; cursor: pointer; }
.color-row input:not([type]) { max-width: 140px; }
.contrast { display: flex; gap: 6px; align-items: flex-start; margin-top: 8px; font-size: 14px; }
.contrast .icon { margin-top: 3px; flex: none; }
.contrast-ok { color: var(--ok); }
.contrast-bad { color: var(--danger); }
.form-end { margin-top: 18px; }
.brand-preview {
  display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 14px; margin-top: 14px; padding: 14px;
  border: 1px solid var(--border); border-radius: 12px; background: var(--bg); pointer-events: none;
}
.pv-side { display: flex; flex-direction: column; gap: 2px; padding: 12px 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.pv-side .side-brand { padding: 0 6px 10px; font-size: 14px; }
.pv-side .side-brand > span:last-child { display: inline; overflow-wrap: anywhere; }
.pv-login {
  display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--border); border-radius: 10px;
  background: radial-gradient(400px 200px at 50% -10%, var(--brand-soft), var(--card) 70%);
}
.pv-login .auth-brand { margin-bottom: 0; overflow-wrap: anywhere; }
.brand-col { min-width: 0; }
@media (max-width: 760px) {
  .brand-preview { grid-template-columns: minmax(0, 1fr); }
  .nav-foot .powered { display: none; }
}
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/public/public.test.js`
Expected: PASS — kể cả test sẵn có "không dùng innerHTML và không có style nội tuyến" (bình luận trong `views/brand.js` cố tình không viết chuỗi `style=`).

- [ ] **Step 5: Kiểm trên trình duyệt** (người thực hiện tự làm, ghi kết quả vào báo cáo task): `npm run dashboard` với `HERMES_HOME` trỏ thư mục thử, đăng nhập, vào **Thương hiệu**:
  - bấm "Đỏ son" → khung Xem trước đổi màu ngay, thanh bên thật chưa đổi; gõ `#fde68a` → câu tương phản đỏ, nút Lưu bị khoá;
  - Lưu → thanh bên, nút, tab trình duyệt đổi ngay không cần tải lại; đăng xuất → trang đăng nhập đúng tên/màu/logo, có "Vận hành bởi 2Anh AI";
  - chọn một ảnh JPEG ngang 800×400 → logo hiện ở thanh bên; mở `/brand/logo.png` thấy PNG 256×128; chọn tệp `.svg` → báo "không nhận SVG";
  - Console của DevTools **không có** dòng "Refused to apply … Content Security Policy"; ở bề rộng 390 px trang không cuộn ngang.

- [ ] **Step 6: Commit**

```bash
git add dashboard/public/views/brand.js dashboard/public/ui.js dashboard/public/app.js dashboard/public/views/login.js dashboard/public/views/shell.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): màn Thương hiệu — logo, tên, màu có xem trước; thanh bên và trang đăng nhập theo thương hiệu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Chủ nhân bot — sửa `ZALO_ALLOWED_USERS` an toàn, khởi động lại đúng hai tiến trình

**Files:**
- Create: `dashboard/lib/env-file.js`, `dashboard/lib/env-file.test.js`
- Create: `dashboard/lib/owners.js`, `dashboard/lib/owners.test.js`
- Create: `dashboard/routes/owners.test.js`
- Modify: `dashboard/lib/users.js` (xuất `ZALO_UID`), `dashboard/routes/admin.js`, `dashboard/server.js`, `dashboard/server.test.js`, `dashboard/test-helpers.js`, `dashboard/lib/audit-feed.js`

**Interfaces:**
- Consumes: `writeFileAtomic`, `readJson`, `writeJsonAtomic` (Task 1); `paths.hermesEnvFile`, `paths.sidecarEnvFile`, `paths.pendingRestartFile` (Task 1); `store.senderNames(uids) → Map<uid, name>` (`dashboard/lib/store-reader.js`, có từ GĐ2); `makeRestartSidecar` (`dashboard/lib/restart.js`, có từ GĐ1).
- Produces:
  - `env-file.js`: `EDITABLE_KEYS: Set(['ZALO_ALLOWED_USERS'])`, `readEnvKey(file, key) → string|null`, `writeEnvKey(file, key, value)` (value chỉ gồm chữ số và dấu phẩy).
  - `users.js`: `export const ZALO_UID`.
  - `owners.js`: `OWNER_KEY`, `MAX_OWNERS = 20`, `splitOwners(raw) → string[]`, `parseOwners(list) → string[]` (ném lỗi `statusCode 400`), `createOwnersStore({ envFile, sidecarEnvFile, pendingFile, now? }) → { list(), shadowed() → bool, set(uids, by) → bool (true = có thay đổi), pending() → {since, by}|null, clearPending() }`.
  - Route (chỉ Quản trị): `GET /api/admin/owners` và `PUT /api/admin/owners` `{ owners: string[] }` → `{ ok, owners: [{ uid, valid, name, dashboardUsers: string[] }], pendingRestart: bool, shadowed: bool }`.
  - `POST /api/admin/restart-assistant` → `{ ok, appliedOwners: bool }`.
  - `deps.owners`, `deps.restartSidecar` (buildDeps + makeDeps); hành động Nhật ký `owners_update`.

- [ ] **Step 1: Viết test**

Tạo `dashboard/lib/env-file.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvKey, writeEnvKey } from './env-file.js';

const K = 'ZALO_ALLOWED_USERS';
function tmp(t) { const d = mkdtempSync(join(tmpdir(), 'zd-env-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; }

test('chỉ đọc/ghi khoá được phép — khoá khác ném lỗi, không bao giờ trả giá trị', (t) => {
  const f = join(tmp(t), '.env');
  writeFileSync(f, 'OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=1234567890123456\n');
  assert.equal(readEnvKey(f, K), '1234567890123456');
  assert.throws(() => readEnvKey(f, 'OPENAI_API_KEY'), /không nằm trong danh sách/);
  assert.throws(() => writeEnvKey(f, 'OPENAI_API_KEY', '1'), /không nằm trong danh sách/);
});

test('đọc như Hermes: export, dấu nháy, khoảng trắng, dòng sau cùng thắng; dòng chú thích bỏ qua', (t) => {
  const d = tmp(t);
  const cases = [
    ['export ZALO_ALLOWED_USERS="1234567890123456,2234567890123456"\n', '1234567890123456,2234567890123456'],
    ['ZALO_ALLOWED_USERS = 1234567890123456\n', '1234567890123456'],
    ['ZALO_ALLOWED_USERS=1\nZALO_ALLOWED_USERS=2\n', '2'],
    ['# ZALO_ALLOWED_USERS=999\nZALO_ALLOWED_USERS_OLD=5\n', null],
    ['﻿ZALO_ALLOWED_USERS=3\r\n', '3'],
  ];
  for (const [text, want] of cases) {
    const f = join(d, 'a.env'); writeFileSync(f, text);
    assert.equal(readEnvKey(f, K), want, JSON.stringify(text));
  }
  assert.equal(readEnvKey(join(d, 'khong-co.env'), K), null);
});

test('ghi: chỉ đổi dòng của khoá, giữ nguyên mọi dòng khác, CRLF, export; có .env.bak', (t) => {
  const d = tmp(t); const f = join(d, '.env');
  const before = '# Hermes\r\nOPENAI_API_KEY=sk-bimat\r\nexport ZALO_ALLOWED_USERS="1234567890123456"\r\nZALO_DM_POLICY=owner-only\r\n';
  writeFileSync(f, before);
  writeEnvKey(f, K, '1234567890123456,2234567890123456');
  assert.equal(readFileSync(f, 'utf8'),
    '# Hermes\r\nOPENAI_API_KEY=sk-bimat\r\nexport ZALO_ALLOWED_USERS=1234567890123456,2234567890123456\r\nZALO_DM_POLICY=owner-only\r\n');
  assert.equal(readFileSync(`${f}.bak`, 'utf8'), before);
  assert.equal(readEnvKey(f, K), '1234567890123456,2234567890123456');
  if (process.platform !== 'win32') {
    assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.equal(statSync(`${f}.bak`).mode & 0o777, 0o600);
  }
});

test('ghi: chưa có khoá thì thêm cuối tệp; chưa có tệp thì tạo; giá trị lạ (xuống dòng, chữ) bị từ chối', (t) => {
  const d = tmp(t);
  const f = join(d, '.env');
  writeFileSync(f, 'A=1');
  writeEnvKey(f, K, '1234567890123456');
  assert.equal(readFileSync(f, 'utf8'), 'A=1\nZALO_ALLOWED_USERS=1234567890123456\n');
  const g = join(d, 'moi', '.env');
  writeEnvKey(g, K, '1234567890123456');
  assert.equal(readFileSync(g, 'utf8'), 'ZALO_ALLOWED_USERS=1234567890123456\n');
  assert.equal(existsSync(`${g}.bak`), false);
  for (const v of ['1\nOPENAI_API_KEY=x', '1 2', 'abc', '"1"']) assert.throws(() => writeEnvKey(f, K, v), /chữ số và dấu phẩy/, v);
  assert.equal(readEnvKey(f, K), '1234567890123456');
});
```

Tạo `dashboard/lib/owners.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnersStore, parseOwners } from './owners.js';

const A = '1234567890123456'; const B = '2234567890123456';

function setup(t, hermesEnv = `X=1\nZALO_ALLOWED_USERS=${A}\n`) {
  const d = mkdtempSync(join(tmpdir(), 'zd-owners-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const files = { envFile: join(d, 'hermes.env'), sidecarEnvFile: join(d, 'sidecar.env'), pendingFile: join(d, 'pending-restart.json') };
  writeFileSync(files.envFile, hermesEnv);
  return { files, s: createOwnersStore({ ...files, now: () => 42 }) };
}

test('parseOwners: bỏ khoảng trắng và trùng; không cho rỗng (không khoá mất chủ nhân cuối), UID sai, quá 20', () => {
  assert.deepEqual(parseOwners([` ${A} `, B, A]), [A, B]);
  assert.throws(() => parseOwners([]), /ít nhất một chủ nhân/);
  assert.throws(() => parseOwners(['0912345678']), /không phải UID Zalo/);
  assert.throws(() => parseOwners([Number(A)]), /không phải UID Zalo/);
  assert.throws(() => parseOwners('1234567890123456'), /không hợp lệ/);
  assert.throws(() => parseOwners(Array.from({ length: 21 }, (_, i) => `${1000000000000000 + i}`)), /Tối đa 20/);
  for (const fn of [() => parseOwners([]), () => parseOwners(['x'])]) assert.throws(fn, (e) => e.statusCode === 400);
});

test('đọc danh sách từ .env Hermes; lưu khác thì ghi .env và đánh dấu chờ khởi động lại; trùng thì không ghi', (t) => {
  const { files, s } = setup(t);
  assert.deepEqual(s.list(), [A]);
  assert.equal(s.pending(), null);
  assert.equal(s.set([A], 'anh'), false);
  assert.equal(s.pending(), null);
  assert.equal(s.set([A, B], 'anh'), true);
  assert.equal(readFileSync(files.envFile, 'utf8'), `X=1\nZALO_ALLOWED_USERS=${A},${B}\n`);
  assert.deepEqual(s.pending(), { since: 42, by: 'anh' });
  s.clearPending();
  assert.equal(s.pending(), null);
});

test('.env của thư mục bot đặt khoá khác → shadowed; trùng hoặc không đặt → không', (t) => {
  const { files, s } = setup(t);
  assert.equal(s.shadowed(), false);
  writeFileSync(files.sidecarEnvFile, `ZALO_ALLOWED_USERS=${A}\n`);
  assert.equal(s.shadowed(), false);
  writeFileSync(files.sidecarEnvFile, `ZALO_ALLOWED_USERS=${B}\n`);
  assert.equal(s.shadowed(), true);
});

test('.env Hermes chưa có khoá → danh sách rỗng; tệp chờ hỏng → coi như không chờ', (t) => {
  const { files, s } = setup(t, 'X=1\n');
  assert.deepEqual(s.list(), []);
  writeFileSync(files.pendingFile, '{hỏng');
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(s.pending(), null); } finally { console.warn = warn; }
});
```

Tạo `dashboard/routes/owners.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chatMsg, loginAs, makeDeps, seedHistory, startApp } from '../test-helpers.js';

const A = '1234567890123456'; const B = '2234567890123456'; const C = '3234567890123456';

async function ready(t, { env = `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`, ...over } = {}) {
  const deps = makeDeps(t, over);
  writeFileSync(join(deps.dir, 'hermes.env'), env);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call, { zaloUid: A });
  return { deps, call, admin };
}

test('Chủ bot không xem/sửa được chủ nhân: 403; chưa đăng nhập: 401', async (t) => {
  const { deps, call } = await ready(t);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/owners', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/owners', { method: 'PUT', cookie: owner, body: { owners: [B] } })).status, 403);
  assert.equal((await call('/api/admin/owners')).status, 401);
  assert.match(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), new RegExp(`ZALO_ALLOWED_USERS=${A}\\n`));
});

test('GET: UID kèm tên trong lịch sử và tài khoản dashboard trùng UID; không lộ khoá khác của .env', async (t) => {
  const { deps, call, admin } = await ready(t, { env: `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A},${B},0912345678\n` });
  seedHistory(deps, { messages: [chatMsg({ threadId: B, threadType: 0, senderUid: B, senderName: 'Cô Hà' })] });
  const r = await call('/api/admin/owners', { cookie: admin });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.owners, [
    { uid: A, valid: true, name: '', dashboardUsers: ['anh'] },
    { uid: B, valid: true, name: 'Cô Hà', dashboardUsers: [] },
    { uid: '0912345678', valid: false, name: '', dashboardUsers: [] },
  ]);
  assert.equal(r.json.pendingRestart, false);
  assert.equal(r.json.shadowed, false);
  assert.doesNotMatch(JSON.stringify(r.json), /sk-bimat|OPENAI/);
});

test('PUT: ghi .env Hermes đúng một dòng, trả pendingRestart, ghi Nhật ký; lưu y nguyên thì không đánh dấu', async (t) => {
  const { deps, call, admin } = await ready(t);
  const same = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A] } });
  assert.equal(same.status, 200);
  assert.equal(same.json.pendingRestart, false);
  const r = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A, B] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.pendingRestart, true);
  assert.deepEqual(r.json.owners.map((o) => o.uid), [A, B]);
  assert.equal(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A},${B}\n`);
  assert.equal(readFileSync(join(deps.dir, 'hermes.env.bak'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`);
  assert.equal((await call('/api/admin/owners', { cookie: admin })).json.pendingRestart, true, 'tải lại trang vẫn thấy banner');
  const log = deps.activity.list().filter((e) => e.action === 'owners_update');
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, 'anh');
});

test('PUT: không cho bỏ chủ nhân cuối cùng, UID sai, sai kiểu — 400, .env không đổi', async (t) => {
  const { deps, call, admin } = await ready(t);
  for (const body of [{ owners: [] }, { owners: ['0912345678'] }, { owners: A }, {}]) {
    const r = await call('/api/admin/owners', { method: 'PUT', cookie: admin, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, /—/);
  }
  assert.equal(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), `OPENAI_API_KEY=sk-bimat\nZALO_ALLOWED_USERS=${A}\n`);
  assert.equal(deps.owners.pending(), null);
});

test('.env của thư mục bot cũng đặt UID chủ nhân khác → shadowed để giao diện cảnh báo', async (t) => {
  const { deps, call, admin } = await ready(t);
  writeFileSync(join(deps.dir, 'sidecar.env'), `ZALO_ALLOWED_USERS=${C}\n`);
  assert.equal((await call('/api/admin/owners', { cookie: admin })).json.shadowed, true);
});

test('khởi động lại trợ lý khi đang chờ: khởi động lại kết nối Zalo trước, rồi trợ lý, rồi xoá cờ chờ', async (t) => {
  const order = [];
  const { deps, call, admin } = await ready(t, {
    restartSidecar: async () => { order.push('zalo'); }, restartAssistant: async () => { order.push('assistant'); },
  });
  await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [A, B] } });
  const r = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.appliedOwners, true);
  assert.deepEqual(order, ['zalo', 'assistant']);
  assert.equal(deps.owners.pending(), null);
  // Không còn chờ: chỉ khởi động lại trợ lý như trước.
  const again = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} });
  assert.equal(again.json.appliedOwners, false);
  assert.deepEqual(order, ['zalo', 'assistant', 'assistant']);
});

test('khởi động lại lỗi giữa chừng thì vẫn giữ cờ chờ (banner vàng còn), trả 500 không lộ chi tiết', async (t) => {
  const { deps, call, admin } = await ready(t, {
    restartSidecar: async () => {}, restartAssistant: async () => { throw new Error('spawn ENOENT /bi/mat'); },
  });
  await call('/api/admin/owners', { method: 'PUT', cookie: admin, body: { owners: [B] } });
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await call('/api/admin/restart-assistant', { method: 'POST', cookie: admin, body: {} }); } finally { console.error = orig; }
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.json.error, /ENOENT|bi\/mat/);
  assert.notEqual(deps.owners.pending(), null);
});
```

Trong `dashboard/server.test.js`, `requiredKeys` thêm `'owners', 'restartSidecar'`:

```js
      'sidecar', 'linker', 'watchdog', 'restartAssistant', 'publicDir', 'paths', 'store', 'threadNames', 'permissions', 'brand', 'owners', 'restartSidecar'
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/lib/env-file.test.js dashboard/lib/owners.test.js dashboard/routes/owners.test.js dashboard/server.test.js`
Expected: FAIL — `Cannot find module …/env-file.js`, `…/owners.js`; `/api/admin/owners` trả 404.

- [ ] **Step 3: Viết mã**

Tạo `dashboard/lib/env-file.js`:

```js
// Đọc/sửa .env của Hermes (spec §11.5): chỉ khoá trong danh sách cho phép, chỉ sửa dòng của khoá đó,
// giữ bản trước ở .env.bak, ghi tệp tạm rồi đổi tên. Không bao giờ trả về giá trị của khoá khác.
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { writeFileAtomic } from './json-store.js';

export const EDITABLE_KEYS = new Set(['ZALO_ALLOWED_USERS']);

function allowed(key) {
  if (!EDITABLE_KEYS.has(key)) throw new Error(`env-file: khoá ${key} không nằm trong danh sách được phép`);
}

const lineOf = (key) => new RegExp(`^(\\s*(?:export\\s+)?)${key}\\s*=.*$`);

/** Giá trị của `key` như Hermes/Node đọc (dòng sau cùng thắng), hoặc null khi tệp/khoá không có. */
export function readEnvKey(file, key) {
  allowed(key);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const mine = text.split(/\r?\n/).filter((l) => lineOf(key).test(l)).join('\n');
  if (!mine) return null;
  try { return parseEnv(mine)[key] ?? null; } catch { return null; }
}

/**
 * Đặt `key=value`: thay mọi dòng của khoá này (giữ "export " và kiểu xuống dòng của tệp), không có thì thêm cuối tệp.
 * `value` chỉ được chứa chữ số và dấu phẩy — không bao giờ chèn được dòng hay khoá khác.
 */
export function writeEnvKey(file, key, value) {
  allowed(key);
  if (!/^[0-9,]*$/.test(value)) throw new Error('env-file: giá trị chỉ được gồm chữ số và dấu phẩy');
  const exists = existsSync(file);
  const raw = exists ? readFileSync(file, 'utf8') : '';
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const text = raw.slice(bom.length);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  let found = false;
  const out = lines.map((l) => {
    const m = lineOf(key).exec(l);
    if (!m) return l;
    found = true;
    return `${m[1]}${key}=${value}`;
  });
  if (!found) {
    if (out.length && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${value}`, '');
  }
  if (exists) {
    copyFileSync(file, `${file}.bak`);
    try { chmodSync(`${file}.bak`, 0o600); } catch { /* Windows */ }
  }
  writeFileAtomic(file, bom + out.join(eol));
}
```

Tạo `dashboard/lib/owners.js`:

```js
// Chủ nhân bot (spec §4 #8, §7.1, §9): ZALO_ALLOWED_USERS trong .env của Hermes. Đổi xong phải khởi động lại —
// trợ lý (gateway) và kết nối Zalo (sidecar) đều chỉ đọc biến này lúc khởi động. Cờ "chờ khởi động lại" lưu ra
// tệp để tải lại trang vẫn thấy banner vàng.
import { rmSync } from 'node:fs';
import { readEnvKey, writeEnvKey } from './env-file.js';
import { readJson, writeJsonAtomic } from './json-store.js';
import { ZALO_UID } from './users.js';

export const OWNER_KEY = 'ZALO_ALLOWED_USERS';
export const MAX_OWNERS = 20;

const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });

export const splitOwners = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Kiểm danh sách UID gửi lên: mảng chuỗi UID hợp lệ, bỏ trùng, 1–20 người. */
export function parseOwners(list) {
  if (!Array.isArray(list)) throw bad('Danh sách chủ nhân không hợp lệ — tải lại trang rồi thử lại.');
  const uids = [];
  for (const item of list) {
    const uid = typeof item === 'string' ? item.trim() : '';
    if (!ZALO_UID.test(uid)) throw bad(`"${String(item).slice(0, 30)}" không phải UID Zalo (dãy 15–22 chữ số, không bắt đầu bằng 0) — sửa lại rồi lưu.`);
    if (!uids.includes(uid)) uids.push(uid);
  }
  if (!uids.length) throw bad('Bot phải còn ít nhất một chủ nhân — thêm UID khác trước khi bỏ người cuối cùng.');
  if (uids.length > MAX_OWNERS) throw bad(`Tối đa ${MAX_OWNERS} chủ nhân — bỏ bớt rồi lưu.`);
  return uids;
}

export function createOwnersStore({ envFile, sidecarEnvFile, pendingFile, now = Date.now }) {
  const list = () => splitOwners(readEnvKey(envFile, OWNER_KEY));
  return {
    list,
    /** .env của thư mục bot cũng đặt khoá này (nạp trước .env Hermes) và khác → kết nối Zalo sẽ không theo danh sách mới. */
    shadowed() {
      const local = sidecarEnvFile ? readEnvKey(sidecarEnvFile, OWNER_KEY) : null;
      return local !== null && splitOwners(local).join(',') !== list().join(',');
    },
    /** Ghi danh sách mới; trả true nếu có thay đổi (khi đó đánh dấu chờ khởi động lại). */
    set(uids, by) {
      if (uids.join(',') === list().join(',')) return false;
      writeEnvKey(envFile, OWNER_KEY, uids.join(','));
      writeJsonAtomic(pendingFile, { since: now(), by: String(by) });
      return true;
    },
    pending() {
      const p = readJson(pendingFile, null);
      return p && Number.isFinite(p.since) ? p : null;
    },
    clearPending() { rmSync(pendingFile, { force: true }); },
  };
}
```

`dashboard/lib/users.js` — đổi `const ZALO_UID = /^[1-9]\d{14,21}$/;` thành `export const ZALO_UID = /^[1-9]\d{14,21}$/;`.

`dashboard/routes/admin.js` — thay hai dòng import + chữ ký:

```js
import { validatePassword, validateZaloUid } from '../lib/users.js';

export function adminRoutes({ users, sessions, activity, restartAssistant }) {
```

bằng:

```js
import { ZALO_UID, validatePassword, validateZaloUid } from '../lib/users.js';
import { parseOwners } from '../lib/owners.js';

export function adminRoutes({ users, sessions, activity, restartAssistant, restartSidecar, owners, store }) {
```

và thay nguyên route `r.post('/admin/restart-assistant', …)` bằng:

```js
  // Chủ nhân bot (spec §7.1, §9): tên lấy từ lịch sử tin nhắn (tin riêng trước) và tài khoản dashboard có cùng UID.
  function ownersView() {
    const uids = owners.list();
    let names = new Map();
    try { if (uids.length && store?.available()) names = store.senderNames(uids); } catch (err) {
      console.error('[dashboard] đọc tên chủ nhân lỗi:', err?.message || err);
    }
    const accounts = users.list();
    return {
      ok: true,
      owners: uids.map((uid) => ({
        uid, valid: ZALO_UID.test(uid), name: names.get(uid) || '',
        dashboardUsers: accounts.filter((u) => u.zaloUid === uid).map((u) => u.username),
      })),
      pendingRestart: Boolean(owners.pending()),
      shadowed: owners.shadowed(),
    };
  }

  r.get('/admin/owners', ...guard, (req, res) => {
    try { res.json(ownersView()); } catch (err) { fail(res, err, 'Chưa đọc được danh sách chủ nhân — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.put('/admin/owners', ...guard, (req, res) => {
    try {
      const uids = parseOwners(req.body?.owners);
      if (owners.set(uids, req.user.username)) {
        activity.append({ actor: req.user.username, action: 'owners_update', detail: uids.join(', ') });
      }
      res.json(ownersView());
    } catch (err) { fail(res, err, 'Chưa lưu được danh sách chủ nhân — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  // Khởi động lại trợ lý. Có thay đổi chủ nhân đang chờ thì khởi động lại cả kết nối Zalo trước —
  // nó cũng chỉ đọc ZALO_ALLOWED_USERS lúc khởi động (quyền lệnh chủ nhân, ai được nhận tin báo lỗi).
  r.post('/admin/restart-assistant', ...guard, async (req, res) => {
    try {
      const applyOwners = Boolean(owners?.pending());
      if (applyOwners) await restartSidecar();
      await restartAssistant();
      if (applyOwners) owners.clearPending();
      activity.append({ actor: req.user.username, action: 'restart_assistant', detail: applyOwners ? 'áp dụng danh sách chủ nhân mới' : '' });
      res.json({ ok: true, appliedOwners: applyOwners });
    } catch (err) { fail(res, err, 'Chưa khởi động lại được trợ lý — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
```

`dashboard/server.js`:
- thêm `import { createOwnersStore } from './lib/owners.js';` sau dòng import `createBrandStore`;
- ngay **trước** `let botName = 'Bot Zalo';` thêm:

```js
  const restartSidecar = makeRestartSidecar({ cmd: config.restartCmd, sidecarRoot: paths.sidecarRoot, port: sidecarPort });
```

- trong `createWatchdog({ … })` thay `restartSidecar: makeRestartSidecar({ cmd: config.restartCmd, sidecarRoot: paths.sidecarRoot, port: sidecarPort }),` bằng `restartSidecar,`;
- ngay sau dòng `restartAssistant: makeRestartAssistant(…),` thêm:

```js
    restartSidecar,
    owners: createOwnersStore({ envFile: paths.hermesEnvFile, sidecarEnvFile: paths.sidecarEnvFile, pendingFile: paths.pendingRestartFile }),
```

`dashboard/test-helpers.js` — thêm `import { createOwnersStore } from './lib/owners.js';` sau dòng import `createBrandStore`, và trong `makeDeps` ngay sau `restartAssistant: async () => {},` thêm:

```js
    restartSidecar: async () => {},
    owners: createOwnersStore({ envFile: join(dir, 'hermes.env'), sidecarEnvFile: join(dir, 'sidecar.env'), pendingFile: join(dir, 'pending-restart.json') }),
```

`dashboard/lib/audit-feed.js` — trong `ACTION_LABELS`, sau `brand_reset: …,` thêm `owners_update: 'Đổi chủ nhân bot',`.

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/env-file.test.js dashboard/lib/owners.test.js dashboard/routes/owners.test.js dashboard/routes/admin.test.js dashboard/server.test.js dashboard/lib/watchdog.test.js`
Expected: PASS, `# fail 0` (test cũ của `restart-assistant` vẫn xanh vì không có cờ chờ thì hành vi y như trước).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/env-file.js dashboard/lib/env-file.test.js dashboard/lib/owners.js dashboard/lib/owners.test.js dashboard/routes/owners.test.js dashboard/lib/users.js dashboard/routes/admin.js dashboard/server.js dashboard/server.test.js dashboard/test-helpers.js dashboard/lib/audit-feed.js
git commit -m "feat(dashboard): sửa chủ nhân bot trong .env Hermes, không bao giờ để trống; khởi động lại áp dụng cả kết nối Zalo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Chủ nhân bot — màn hình

**Files:**
- Create: `dashboard/public/views/owners.js`
- Modify: `dashboard/public/views/shell.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `GET/PUT /api/admin/owners`, `POST /api/admin/restart-assistant` (Task 4); biểu tượng `crown` (Task 3); `Notice`, `Live`, `PageHead`, `Spinner` (`ui.js`).
- Produces: `Owners()`; hàm thuần `uidProblem(uid, current) → ''|câu lỗi`, `ownerLabel(o) → string`; mục **Chủ nhân bot** (`#/owners`, chỉ Quản trị) giữa Người dùng và Cảnh báo Telegram — đúng thứ tự spec §9.

- [ ] **Step 1: Viết test** — trong `dashboard/public/public.test.js`, thêm vào cuối tệp:

```js
test('chủ nhân: kiểm UID trước khi gửi, nhãn tên dễ hiểu', async () => {
  const { uidProblem, ownerLabel } = await import('./views/owners.js');
  const A = '1234567890123456';
  assert.equal(uidProblem('2234567890123456', [A]), '');
  assert.match(uidProblem('0912345678', [A]), /không phải số điện thoại/);
  assert.match(uidProblem(A, [A]), /đã là chủ nhân/);
  assert.match(uidProblem('2234567890123456', Array.from({ length: 20 }, (_, i) => String(i))), /Tối đa 20/);
  assert.equal(ownerLabel({ name: 'Cô Hà', dashboardUsers: ['ha'] }), 'Cô Hà · tài khoản dashboard: ha');
  assert.equal(ownerLabel({ name: '', dashboardUsers: ['anh'] }), 'Tài khoản dashboard: anh');
  assert.equal(ownerLabel({ name: '', dashboardUsers: [] }), 'Chưa rõ tên — người này chưa nhắn cho bot');
});

test('thanh bên: đủ mục spec §9 theo đúng nhóm, mục Quản trị chỉ hiện cho Quản trị', async () => {
  const src = readFileSync(join(root, 'views', 'shell.js'), 'utf8');
  const order = ['Tài khoản Zalo', 'Nhật ký', 'Thương hiệu', 'Người dùng', 'Chủ nhân bot', 'Cảnh báo Telegram'].map((t) => src.indexOf(`'${t}'`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), order.join(','));
  assert.match(src, /'\/owners': \{ view: Owners, admin: true \}/);
  assert.match(src, /'\/brand': \{ view: Brand \}/);
});
```

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/public/public.test.js`
Expected: FAIL — `Cannot find module …/views/owners.js`; thanh bên chưa có "Chủ nhân bot".

- [ ] **Step 3: Viết mã**

Tạo `dashboard/public/views/owners.js`:

```js
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';

const ZALO_UID = /^[1-9]\d{14,21}$/;

/** Kiểm UID vừa nhập trước khi gửi; trả câu lỗi hoặc ''. */
export function uidProblem(uid, current) {
  if (!ZALO_UID.test(uid)) return 'UID Zalo là dãy 15–22 chữ số, không bắt đầu bằng 0 (không phải số điện thoại) — kiểm tra lại.';
  if (current.includes(uid)) return 'UID này đã là chủ nhân.';
  if (current.length >= 20) return 'Tối đa 20 chủ nhân — bỏ bớt trước khi thêm.';
  return '';
}

/** Dòng chữ tên của một chủ nhân: tên Zalo trong lịch sử, tài khoản dashboard trùng UID. */
export function ownerLabel(o) {
  const parts = [];
  if (o.name) parts.push(o.name);
  if (o.dashboardUsers?.length) parts.push(`tài khoản dashboard: ${o.dashboardUsers.join(', ')}`);
  if (!parts.length) return 'Chưa rõ tên — người này chưa nhắn cho bot';
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Owners() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [uid, setUid] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});
  const [restartMsg, setRestartMsg] = useState({});

  const load = () => api('/api/admin/owners').then((r) => { setData(r); setLoadError(''); }).catch((err) => setLoadError(err.message));
  useEffect(() => { load(); }, []);

  const head = html`<${PageHead} title="Chủ nhân bot" sub="Người có toàn quyền sai bảo bot qua Zalo. Thành viên khác chỉ dùng được các tính năng trong Phân quyền Bot." />`;
  if (loadError) return html`${head}<${Live} error=${loadError} />`;
  if (!data) return html`${head}<${Spinner} />`;

  const current = data.owners.map((o) => o.uid);
  async function save(next, okText) {
    setBusy('save'); setMsg({});
    try { setData(await api('/api/admin/owners', { method: 'PUT', body: { owners: next } })); setMsg({ ok: okText }); return true; } catch (err) { setMsg({ error: err.message }); return false; } finally { setBusy(''); }
  }
  async function add(e) {
    e.preventDefault();
    const v = uid.trim();
    const problem = uidProblem(v, current);
    if (problem) { setMsg({ error: problem }); return; }
    if (await save([...current.filter((u) => ZALO_UID.test(u)), v], `Đã thêm ${v}. Khởi động lại trợ lý để áp dụng.`)) setUid('');
  }
  const remove = (o) => {
    if (!confirm(`Bỏ quyền chủ nhân của ${o.name || o.uid}? Người này sẽ chỉ còn quyền như thành viên sau khi khởi động lại trợ lý.`)) return;
    save(current.filter((u) => u !== o.uid && ZALO_UID.test(u)), `Đã bỏ ${o.name || o.uid}. Khởi động lại trợ lý để áp dụng.`);
  };
  async function restart() {
    if (!confirm('Khởi động lại trợ lý và kết nối Zalo? Bot sẽ ngừng trả lời khoảng một phút.')) return;
    setBusy('restart'); setRestartMsg({});
    try {
      await api('/api/admin/restart-assistant', { method: 'POST' });
      setRestartMsg({ ok: 'Đã khởi động lại — đợi khoảng một phút rồi nhắn thử bot từ tài khoản chủ nhân.' });
      await load();
    } catch (err) { setRestartMsg({ error: err.message }); } finally { setBusy(''); }
  }
  const validCount = data.owners.filter((o) => o.valid).length;

  return html`${head}
    ${data.pendingRestart ? html`<div class="notice notice-warn banner">
      <${Icon} name="warn" />
      <div><strong>Cần khởi động lại trợ lý.</strong> Danh sách chủ nhân đã lưu nhưng bot vẫn dùng danh sách cũ cho tới khi khởi động lại. Trong khoảng một phút khởi động lại, bot tạm ngừng trả lời.</div>
      <button class="btn btn-primary btn-sm" disabled=${busy !== ''} onClick=${restart}><${Icon} name="refresh" size=${16} />
        ${busy === 'restart' ? 'Đang khởi động lại…' : 'Khởi động lại trợ lý'}</button>
    </div>` : null}
    <${Live} error=${restartMsg.error} ok=${restartMsg.ok} />
    ${data.shadowed ? html`<${Notice} kind="danger">Tệp <code>.env</code> trong thư mục cài bot Zalo cũng ghi <code>ZALO_ALLOWED_USERS</code> với danh sách khác, và nó được ưu tiên — kết nối Zalo sẽ không theo danh sách ở đây. Xoá dòng đó trong tệp <code>.env</code> của thư mục bot rồi khởi động lại trợ lý.<//>` : null}
    <section class="card">
      <h2>Danh sách chủ nhân</h2>
      ${data.owners.length ? html`<ul class="owner-list">
        ${data.owners.map((o) => html`<li key=${o.uid}>
          <span class="avatar" aria-hidden="true"><${Icon} name="crown" size=${16} /></span>
          <span class="owner-main"><strong>${ownerLabel(o)}</strong><span class="mono muted">${o.uid}</span>
            ${o.valid ? null : html`<span class="badge badge-warn"><${Icon} name="warn" size=${14} /> Không phải UID Zalo — bỏ dòng này</span>`}</span>
          <button class="btn btn-secondary btn-sm" disabled=${busy !== '' || (o.valid && validCount <= 1)}
            title=${o.valid && validCount <= 1 ? 'Bot phải còn ít nhất một chủ nhân' : undefined}
            onClick=${() => remove(o)}>Bỏ</button>
        </li>`)}
      </ul>` : html`<${Notice} kind="warn">Bot chưa có chủ nhân nào — thêm UID của bạn bên dưới.<//>`}
      ${validCount === 1 ? html`<p class="muted small">Bot phải còn ít nhất một chủ nhân — thêm người khác trước khi bỏ người cuối cùng.</p>` : null}
    </section>
    <form class="card" onSubmit=${add} novalidate>
      <h2>Thêm chủ nhân</h2>
      <div class="field">
        <label for="owner-uid">UID Zalo</label>
        <input id="owner-uid" class="mono" inputmode="numeric" autocomplete="off" spellcheck="false" value=${uid}
          aria-describedby="owner-uid-help" onInput=${(e) => setUid(e.currentTarget.value.replace(/\D/g, ''))} />
        <small id="owner-uid-help">Dãy 15–22 chữ số, không phải số điện thoại. Người đó nhắn <code>/sethome</code> cho bot để biết UID của mình.</small>
      </div>
      <button class="btn btn-primary" disabled=${busy !== ''}><${Icon} name="plus" size=${16} /> ${busy === 'save' ? 'Đang lưu…' : 'Thêm chủ nhân'}</button>
      <${Live} error=${msg.error} ok=${msg.ok} />
    </form>`;
}
```

`dashboard/public/views/shell.js`:
- thêm `import { Owners } from './owners.js';` sau dòng `import { Brand } from './brand.js';`;
- trong `ROUTES`, sau `'/users': { view: Users, admin: true },` thêm `'/owners': { view: Owners, admin: true },`;
- trong `GROUPS` nhóm `Quản trị`, sau mục Người dùng thêm `{ path: '/owners', text: 'Chủ nhân bot', icon: 'crown' },`.

`dashboard/public/style.css` — ngay **trước** `/* ---------- Điện thoại ---------- */` (sau khối Thương hiệu của Task 3) thêm:

```css
/* ---------- Chủ nhân bot ---------- */
.banner { flex-wrap: wrap; align-items: center; margin: 0 0 16px; }
.banner > div { flex: 1 1 260px; }
.owner-list { list-style: none; margin: 8px 0 12px; padding: 0; }
.owner-list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.owner-list li:last-child { border-bottom: 0; }
.owner-list .avatar { width: 32px; height: 32px; }
.owner-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; overflow-wrap: anywhere; }
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/public/public.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Kiểm trên trình duyệt** (dùng thư mục `HERMES_HOME` thử có `.env` riêng — **không** dùng `.env` thật của bot): đăng nhập Quản trị → **Chủ nhân bot** hiện UID kèm tên; thêm một UID → banner vàng "Cần khởi động lại trợ lý" và vẫn còn sau khi tải lại trang; còn một chủ nhân thì nút "Bỏ" bị khoá; nhập số điện thoại → lỗi tiếng Việt; đăng nhập Chủ bot → không thấy mục này, gõ thẳng `#/owners` → "Không có quyền". Bề rộng 390 px không cuộn ngang. (Không bấm "Khởi động lại trợ lý" trên máy có bot thật đang chạy trong lúc thử.)

- [ ] **Step 6: Commit**

```bash
git add dashboard/public/views/owners.js dashboard/public/views/shell.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): màn Chủ nhân bot — tên theo UID, banner vàng chờ khởi động lại

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Người dùng — "Đăng nhập gần nhất"; Tổng quan — lỗi gần nhất dễ hiểu

**Files:**
- Modify: `dashboard/lib/users.js`, `dashboard/lib/users.test.js`, `dashboard/routes/auth.js`, `dashboard/routes/admin.test.js`, `dashboard/public/views/users.js`, `dashboard/public/views/overview.js`, `dashboard/public/style.css`, `dashboard/public/public.test.js`

**Interfaces:**
- Consumes: `createUserStore` (`dashboard/lib/users.js`); `/api/status` `lastError: { code, message, atMs } | null` (GĐ1).
- Produces: `users.recordLogin(username, at = Date.now())`; `users.list()[i].lastLoginAt: number|null`; `overview.js` xuất `errorText(lastError, role) → { text, next, code: string|null }`.

- [ ] **Step 1: Viết test**

`dashboard/lib/users.test.js` — trong test `'bản công khai không lộ mật khẩu băm'` đổi danh sách khoá thành:

```js
  assert.deepEqual(Object.keys(u).sort(), ['createdAt', 'disabled', 'hasPassword', 'lastLoginAt', 'role', 'username', 'zaloUid']);
```

và thêm vào cuối tệp:

```js
test('recordLogin: ghi lần đăng nhập gần nhất, list() trả lastLoginAt (chưa đăng nhập = null); người lạ bỏ qua', (t) => {
  const { s, file } = store(t);
  s.create({ username: 'anh', role: 'admin', password: 'matkhau-dai' });
  assert.equal(s.list()[0].lastLoginAt, null);
  s.recordLogin('anh', 1234);
  assert.equal(s.list()[0].lastLoginAt, 1234);
  s.recordLogin('khongco', 99);
  assert.equal(s.list().length, 1);
  assert.ok(!readFileSync(file, 'utf8').includes('khongco'));
});
```

`dashboard/routes/admin.test.js` — thêm vào cuối tệp:

```js
test('danh sách người dùng có "đăng nhập gần nhất": đăng nhập đúng mới ghi, sai thì không', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  deps.users.create({ username: 'khach', role: 'owner', password: 'matkhau-dai' });
  const admin = await loginAs(t, deps, call);
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'sai-mat-khau' } })).status, 401);
  let list = (await call('/api/admin/users', { cookie: admin })).json.users;
  assert.equal(list.find((u) => u.username === 'khach').lastLoginAt, null);
  assert.ok(list.find((u) => u.username === 'anh').lastLoginAt > 0);
  const before = Date.now();
  await call('/api/auth/verify', { method: 'POST', body: { username: 'khach', password: 'matkhau-dai' } });
  list = (await call('/api/admin/users', { cookie: admin })).json.users;
  assert.ok(list.find((u) => u.username === 'khach').lastLoginAt >= before);
});
```

`dashboard/public/public.test.js` — thêm vào cuối tệp:

```js
test('Tổng quan: lỗi gần nhất thành câu dễ hiểu có bước tiếp theo; mã kỹ thuật chỉ cho Quản trị', async () => {
  const { errorText } = await import('./views/overview.js');
  const e = { code: 'zalo_listener_closed', message: 'Đã ghi nhận lỗi nội bộ; xem log cục bộ để biết chi tiết.', atMs: 1 };
  assert.deepEqual(errorText(e, 'owner'), {
    text: 'Kết nối nhận tin Zalo bị ngắt.',
    next: 'Bot thường tự nối lại sau ít phút. Nếu thanh trên cùng báo mất kết nối, hãy quét mã đăng nhập lại.',
    code: null,
  });
  assert.equal(errorText(e, 'admin').code, 'zalo_listener_closed');
  const unknown = errorText({ code: 'something_new' }, 'owner');
  assert.equal(unknown.text, 'Bot ghi nhận một lỗi nội bộ.');
  assert.match(unknown.next, /báo người cài đặt/);
  for (const code of ['bridge_command_failed', 'system_notice_failed', 'bridge_server_error', 'history_retention_failed',
    'legacy_history_import_failed', 'automatic_backfill_failed', 'dashboard_server_error']) {
    const r = errorText({ code }, 'owner');
    assert.notEqual(r.text, unknown.text, code);
    assert.doesNotMatch(`${r.text} ${r.next}`, /log|sidecar|bridge|toolset/i, code);
  }
});
```

(Bảy mã trên là toàn bộ chỗ gọi `recordError(` trong `server.js`, `bot-handler.js`, `hermes-bridge.js` — kiểm lại bằng `git grep -n "recordError(" -- "*.js" ":!*.test.js"` trước khi viết mã.)

- [ ] **Step 2: Chạy test, thấy đỏ**

Run: `node --test dashboard/lib/users.test.js dashboard/routes/admin.test.js dashboard/public/public.test.js`
Expected: FAIL — `s.recordLogin is not a function`; `lastLoginAt` không có; `errorText` không được xuất.

- [ ] **Step 3: Viết mã**

`dashboard/lib/users.js` — thay dòng `const toPublic = (u) => ({ … createdAt: u.createdAt });` bằng:

```js
const toPublic = (u) => ({
  username: u.username, role: u.role, zaloUid: u.zaloUid, disabled: Boolean(u.disabled), hasPassword: Boolean(u.passwordHash),
  createdAt: u.createdAt, lastLoginAt: Number.isFinite(u.lastLoginAt) ? u.lastLoginAt : null,
});
```

và trong object trả về của `createUserStore`, ngay **trước** `verifyPassword(username, password) {` thêm:

```js
    /** Ghi thời điểm đăng nhập thành công gần nhất (hiện ở màn Người dùng). Không có người này thì bỏ qua. */
    recordLogin(username, at = Date.now()) {
      const data = load();
      const user = data.users.find((u) => u.username === username);
      if (!user) return;
      user.lastLoginAt = at;
      save(data);
    },
```

`dashboard/routes/auth.js`:
- trong `/auth/setup`, ngay sau `setSessionCookie(res, req, sessions.create(user.username));` thêm `users.recordLogin(user.username);`
- trong `/auth/verify`, ngay sau `setSessionCookie(res, req, sessions.create(username));` thêm:

```js
    try { users.recordLogin(username); } catch (err) { console.error('[dashboard] không ghi được lần đăng nhập gần nhất:', err?.message || err); }
```

`dashboard/public/views/users.js`:
- đổi cả hai `colspan="6"` thành `colspan="7"` (dòng phụ Đặt lại mật khẩu và Sửa UID/vai trò);
- thay dòng tiêu đề bảng `<th scope="col">Trạng thái</th><th scope="col">Tạo lúc</th><th scope="col"><span class="sr-only">Thao tác</span></th></tr></thead>` bằng:

```js
              <th scope="col">Trạng thái</th><th scope="col">Đăng nhập gần nhất</th><th scope="col">Tạo lúc</th>
              <th scope="col"><span class="sr-only">Thao tác</span></th></tr></thead>
```

- ngay **trước** `<td data-label="Tạo lúc">${fmtTime(u.createdAt)}</td>` thêm:

```js
                <td data-label="Đăng nhập gần nhất">${u.lastLoginAt ? fmtTime(u.lastLoginAt) : html`<span class="muted">Chưa đăng nhập</span>`}</td>
```

`dashboard/public/views/overview.js` — ngay **trước** `function TodayCard({ today }) {` thêm:

```js
// Mã lỗi runtime-health của bot → câu dễ hiểu + bước tiếp theo. Mã lạ dùng câu chung.
const ERRORS = {
  zalo_listener_closed: ['Kết nối nhận tin Zalo bị ngắt.', 'Bot thường tự nối lại sau ít phút. Nếu thanh trên cùng báo mất kết nối, hãy quét mã đăng nhập lại.'],
  bridge_command_failed: ['Bot chưa làm được một việc trên Zalo (gửi tin hoặc thao tác nhóm).', 'Thường do Zalo từ chối hoặc mạng chập chờn — xem Nhật ký, bật "Chỉ hiện lỗi" để biết việc nào.'],
  system_notice_failed: ['Bot chưa gửi được một tin thông báo.', 'Xem Nhật ký, bật "Chỉ hiện lỗi" để biết tin nào; nếu lặp lại hãy báo người cài đặt.'],
  bridge_server_error: ['Trợ lý gặp lỗi khi trao đổi với Zalo.', 'Nếu bot ngừng trả lời, nhờ Quản trị khởi động lại trợ lý.'],
  history_retention_failed: ['Bot chưa dọn được lịch sử tin nhắn cũ.', 'Bot vẫn trả lời bình thường; báo người cài đặt nếu lỗi lặp lại.'],
  legacy_history_import_failed: ['Bot chưa nhập được lịch sử tin nhắn cũ.', 'Bot vẫn trả lời bình thường; báo người cài đặt nếu Phiên chat thiếu tin cũ.'],
  automatic_backfill_failed: ['Bot chưa tải bù được tin nhắn lúc mất kết nối.', 'Bot vẫn trả lời bình thường; vài tin trong lúc mất kết nối có thể không hiện ở Phiên chat.'],
  dashboard_server_error: ['Bot không mở được cổng nội bộ của nó.', 'Báo người cài đặt kèm thời điểm trên.'],
};
const GENERIC = ['Bot ghi nhận một lỗi nội bộ.', 'Nếu lỗi lặp lại hoặc bot ngừng trả lời, hãy báo người cài đặt kèm thời điểm trên.'];

/** { text, next, code } cho thẻ "Lỗi gần nhất"; mã kỹ thuật chỉ dành cho Quản trị. */
export function errorText(lastError, role) {
  const [text, next] = ERRORS[lastError?.code] || GENERIC;
  return { text, next, code: role === 'admin' && lastError?.code ? String(lastError.code) : null };
}
```

trong `Overview`, ngay sau `const z = zaloCard(s);` thêm `const err = s.lastError ? errorText(s.lastError, me.role) : null;`, và thay khối thẻ "Lỗi gần nhất":

```js
        ${s.lastError ? html`
          <p class="badge badge-warn"><${Icon} name="warn" size=${16} /> ${fmtTime(s.lastError.atMs)}</p>
          <p class="error-text">${s.lastError.message || 'Không có mô tả'}</p>
          <p class="muted small">Nếu lỗi này lặp lại hoặc bot ngừng trả lời, hãy báo người cài đặt kèm thời điểm trên.</p>`
```

bằng:

```js
        ${err ? html`
          <p class="badge badge-warn"><${Icon} name="warn" size=${16} /> ${fmtTime(s.lastError.atMs)}</p>
          <p class="last-error">${err.text}</p>
          <p class="muted small">${err.next}</p>
          ${err.code ? html`<p class="muted small">Mã: <span class="mono">${err.code}</span></p>` : null}`
```

`dashboard/public/style.css` — `.error-text` không còn ai dùng (chỉ thẻ này dùng); thay dòng `.error-text { … }` bằng:

```css
.last-error { margin: 10px 0 6px; font-weight: 600; }
```

- [ ] **Step 4: Chạy test, thấy xanh**

Run: `node --test dashboard/lib/users.test.js dashboard/routes/admin.test.js dashboard/routes/auth.test.js dashboard/public/public.test.js`
Expected: PASS, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/users.js dashboard/lib/users.test.js dashboard/routes/auth.js dashboard/routes/admin.test.js dashboard/public/views/users.js dashboard/public/views/overview.js dashboard/public/style.css dashboard/public/public.test.js
git commit -m "feat(dashboard): Người dùng có lần đăng nhập gần nhất; Tổng quan nói lỗi gần nhất bằng câu dễ hiểu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tài liệu, phát hành v1.22.0 và danh sách tệp triển khai

**Files:**
- Modify: `README.vi.md` (mục "Dashboard quản trị" và bảng "Cấu hình nằm ở đâu"), `README.md` (mục "Admin dashboard"), `CHANGELOG.md`, `package.json`, `package-lock.json` (2 chỗ), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`

**Interfaces:**
- Consumes: mọi task trên.
- Produces: phiên bản `1.22.0` đồng bộ ở 5 chỗ; tài liệu người dùng + kiểm tay GĐ4; danh sách tệp triển khai.

- [ ] **Step 1: README.vi.md** — trong `## Dashboard quản trị`, ngay **trước** `### Kiểm tay sau khi cài (Giai đoạn 1)`, thêm:

```markdown
### Thương hiệu

Mục **Thương hiệu** (Quản trị và Chủ bot đều dùng được) đổi logo, tên và màu của dashboard. Logo nhận ảnh PNG, JPG hoặc WebP (không nhận SVG); trình duyệt tự thu về tối đa 256×256 điểm ảnh — nên dùng ảnh vuông, nền trong suốt. Màu chọn một trong 6 gợi ý hoặc nhập mã (vd. `#1d4ed8`); màu quá nhạt để chữ trắng đọc được (dưới 4,5 : 1) thì không lưu được. Khung **Xem trước** cho thấy thanh bên và trang đăng nhập trước khi bấm Lưu. Có thể ẩn dòng "Vận hành bởi 2Anh AI". **Khôi phục mặc định** đưa tên, màu, logo về như lúc cài.

Trang đăng nhập hiện tên, màu và logo này cả khi chưa đăng nhập. Dữ liệu nằm ở `<HERMES_HOME>/zalo/dashboard/brand.json` và `brand/logo.png`.

### Chủ nhân bot

Mục **Chủ nhân bot** (chỉ Quản trị) sửa danh sách UID Zalo có toàn quyền với bot — chính là `ZALO_ALLOWED_USERS` trong `.env` của Hermes (bản trước giữ ở `.env.bak`; dashboard không đọc hay đổi dòng nào khác). Mỗi UID hiện kèm tên Zalo nếu người đó từng nhắn cho bot. Muốn biết UID của ai, nhờ người đó nhắn `/sethome` cho bot. Bot luôn phải còn ít nhất một chủ nhân.

Lưu xong, dashboard hiện dải vàng **Cần khởi động lại trợ lý**: bấm nút trên dải để khởi động lại kết nối Zalo và trợ lý (bot ngừng trả lời khoảng một phút). Nếu thư mục cài bot có `.env` riêng cũng ghi `ZALO_ALLOWED_USERS`, dòng đó được ưu tiên — trang sẽ báo đỏ; xoá dòng đó rồi khởi động lại.
```

và **sau** danh sách kiểm tay GĐ3 (trước dòng "Gỡ cài đặt (`npm run uninstall:hermes`) …"), thêm:

```markdown
### Kiểm tay sau khi cài (Giai đoạn 4)

- [ ] Thương hiệu: đổi tên + chọn màu gợi ý + tải logo JPG, Lưu → thanh bên, tab trình duyệt đổi ngay; đăng xuất → trang đăng nhập đúng tên, màu, logo.
- [ ] Nhập mã màu nhạt (vd. `#fde68a`) → báo khó đọc, không lưu được. Chọn tệp `.svg` → báo không nhận SVG.
- [ ] Tắt "Vận hành bởi 2Anh AI" → dòng đó biến mất ở thanh bên và trang đăng nhập. Khôi phục mặc định → về như lúc cài.
- [ ] Chủ nhân bot: thêm UID một người thứ hai → dải vàng; bấm Khởi động lại trợ lý → khoảng một phút sau người đó dùng được công cụ chủ nhân; dải vàng biến mất.
- [ ] Còn một chủ nhân thì không bỏ được; nhập số điện thoại → báo lỗi.
- [ ] Người dùng: cột "Đăng nhập gần nhất" đúng giờ vừa đăng nhập.
- [ ] Nhật ký có các dòng "Đổi thương hiệu", "Đổi logo", "Đổi chủ nhân bot" kèm tên mình.
- [ ] Tài khoản Chủ bot vào được Thương hiệu, không thấy Chủ nhân bot.
```

Trong bảng ở `### Cấu hình nằm ở đâu`, dòng `| Ai là chủ nhân | \`ZALO_ALLOWED_USERS\` trong \`.env\` của Hermes |` đổi thành:

```markdown
| Ai là chủ nhân | `ZALO_ALLOWED_USERS` trong `.env` của Hermes (sửa được ở mục **Chủ nhân bot** của dashboard) |
```

- [ ] **Step 2: README.md** — trong `## Admin dashboard`, sau đoạn "Phase 3 adds …", thêm:

```markdown
Phase 4 adds **Branding** and **Bot owners**. Branding (admins and bot owners) sets the dashboard name, a logo (PNG/JPEG/WebP, resized to ≤ 256 px in the browser and stored as PNG; SVG is refused) and a colour that must give white text a contrast of at least 4.5:1; the login page shows it before sign-in through the public, read-only `GET /api/brand` and a generated `/brand.css`. Bot owners (admins only) edits `ZALO_ALLOWED_USERS` in the Hermes `.env` — only that line, with a `.env.bak` — never allowing an empty list, then asks for a restart that restarts the Zalo bridge and the Hermes gateway, since both read the variable at start-up. The Users page now shows each account's last sign-in.
```

- [ ] **Step 3: CHANGELOG.md** — chèn ngay dưới dòng "Theo chuẩn [Keep a Changelog]…":

```markdown
## [1.22.0] — <ngày phát hành>

### Thêm

- **Dashboard: Thương hiệu.** Đổi tên, logo và màu; 6 màu gợi ý hoặc nhập mã, kiểm chữ trắng đọc được (≥ 4,5 : 1); xem trước thanh bên và trang đăng nhập trước khi lưu; bật/tắt dòng "Vận hành bởi 2Anh AI"; khôi phục mặc định. Trang đăng nhập hiện thương hiệu ngay khi chưa đăng nhập. Quản trị và Chủ bot đều chỉnh được; mọi lần đổi ghi vào Nhật ký.
- **Dashboard: Chủ nhân bot** (chỉ Quản trị). Thêm/bỏ UID chủ nhân ngay trên dashboard, kèm tên Zalo của từng người; không bao giờ để bot mất chủ nhân cuối cùng. Lưu xong có dải vàng nhắc khởi động lại trợ lý — nút khởi động lại áp dụng cho cả kết nối Zalo lẫn trợ lý.
- **Người dùng** có cột "Đăng nhập gần nhất".

### Sửa

- Thẻ "Lỗi gần nhất" ở Tổng quan nói rõ chuyện gì xảy ra và nên làm gì, thay cho câu chung "xem log cục bộ"; Quản trị thấy thêm mã lỗi.

### An toàn

- Logo chỉ lưu dạng PNG ≤ 256 px đã kiểm từng byte, không nhận SVG; logo và màu phục vụ cùng nguồn, giữ nguyên chính sách bảo mật nội dung (CSP).
- Dashboard chỉ đọc và sửa đúng dòng `ZALO_ALLOWED_USERS` trong `.env` của Hermes, giữ bản trước ở `.env.bak`.
```

(`<ngày phát hành>` thay bằng ngày thật lúc phát hành, dạng `2026-10-0X`.)

- [ ] **Step 4: Bump phiên bản** `1.21.0` → `1.22.0` ở: `package.json` (`"version"`), `package-lock.json` (trường `"version"` ở gốc và ở `packages[""]`), `hermes-plugin/zalo/plugin.yaml`, `hermes-plugin/zalo_tools/plugin.yaml`. Kiểm:

```bash
grep -n '"version": "1.22.0"' package.json package-lock.json
grep -n "^version: 1.22.0" hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
```

Expected: 1 dòng ở `package.json`, 2 dòng ở `package-lock.json`, 1 dòng ở mỗi `plugin.yaml`.

- [ ] **Step 5: Chạy toàn bộ** — `HERMES_HOME=E:/Hermes npm test` → JS `# fail 0` (khoảng 504 test, 2 bỏ qua trên Windows); Python không đổi, kết thúc bằng `Tất cả test Python đều xanh.`

- [ ] **Step 6: Commit**

```bash
git add README.vi.md README.md CHANGELOG.md package.json package-lock.json hermes-plugin/zalo/plugin.yaml hermes-plugin/zalo_tools/plugin.yaml
git commit -m "docs(dashboard): Thương hiệu, Chủ nhân bot, kiểm tay giai đoạn 4 (v1.22.0)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Triển khai (người điều phối làm sau review cuối, như GĐ1–3)** — chỉ **dashboard** đổi; sidecar và plugin Hermes chỉ đổi số phiên bản.

  **Dashboard** — cập nhật thư mục sidecar (Lăng Tiêu: `E:/Hermes/zca-test`; Uyển Nhi: checkout tag `v1.22.0`) rồi **khởi động lại dịch vụ dashboard** (Linux `systemctl restart zalo-dashboard`; Windows: dừng tiến trình đang nghe cổng 3880 rồi chạy lại `.vbs` trong Startup). Tệp đổi:
  - mới: `dashboard/public/brand-color.js`, `dashboard/lib/brand.js`, `dashboard/lib/env-file.js`, `dashboard/lib/owners.js`, `dashboard/routes/brand.js`, `dashboard/public/views/brand.js`, `dashboard/public/views/owners.js`;
  - sửa: `dashboard/app.js`, `dashboard/server.js`, `dashboard/lib/json-store.js`, `dashboard/lib/paths.js`, `dashboard/lib/users.js`, `dashboard/lib/audit-feed.js`, `dashboard/routes/admin.js`, `dashboard/routes/auth.js`, `dashboard/public/index.html`, `dashboard/public/app.js`, `dashboard/public/ui.js`, `dashboard/public/style.css`, `dashboard/public/views/login.js`, `dashboard/public/views/shell.js`, `dashboard/public/views/users.js`, `dashboard/public/views/overview.js`;
  - cùng `package.json`/`package-lock.json` (chỉ số phiên bản).

  **Plugin Hermes** — chỉ `plugin.yaml` đổi số phiên bản: chép `hermes-plugin/zalo/plugin.yaml` → `<hermes-agent>/plugins/platforms/zalo/plugin.yaml` và `hermes-plugin/zalo_tools/plugin.yaml` → `<hermes-agent>/plugins/zalo_tools/plugin.yaml` (Lăng Tiêu: `<hermes-agent>` = `E:/Hermes/hermes-agent`). Không cần khởi động lại gateway chỉ vì việc này.

  **Sidecar** (`server.js`, `control-api.js`, `bot-handler.js`, `hermes-bridge.js`) **không đổi**.

  Sau triển khai: trên VPS kiểm `.env` của thư mục bot **không** có dòng `ZALO_ALLOWED_USERS` (nếu có, trang Chủ nhân sẽ báo đỏ); chạy danh sách kiểm tay GĐ4 trên cả hai bot — riêng bước thêm chủ nhân thứ hai rồi khởi động lại làm vào giờ vắng; kiểm quyền 600 của `brand.json`, `brand/logo.png`, `.env.bak` trên VPS (`stat -c %a`); gắn tag `v1.22.0`, GitHub Release, gộp vào `main`.

---

## Self-Review

**1. Phủ spec:**
- §9 Thương hiệu: logo → Task 1 (`decodeLogo`), 2 (`POST/DELETE /api/brand/logo`), 3 (chọn ảnh, thu nhỏ); tên → Task 1 (`parseBrand`), 3; màu 6 gợi ý + mã + tương phản ≥ 4,5 : 1 → Task 1 (`SUGGESTIONS`, `contrastWithWhite`, từ chối ở máy chủ), 3 (`contrastInfo`, khoá nút Lưu); "Vận hành bởi 2Anh AI" → Task 1 (`poweredBy`), 3 (`PoweredBy`); xem trước thanh bên + trang đăng nhập → Task 3 (`Preview`); khôi phục mặc định → Task 2 (`DELETE /api/brand`), 3.
- §7.1 `GET /api/brand` công khai, `PUT /api/brand`, `POST/DELETE /api/brand/logo` → Task 2. `GET/PUT /api/admin/owners` trả `pendingRestart` → Task 4. `POST /api/admin/restart-assistant` → Task 4 (mở rộng).
- §6 ma trận: Thương hiệu ✅ cả hai → Task 2 (`requireAuth`, test Chủ bot sửa được); Chủ nhân bot chỉ Quản trị → Task 4 (test 403), Task 5 (`admin: true`).
- §4 #8 "đổi chủ nhân vẫn ghi `.env` + khởi động lại" → Task 4; §9 "banner vàng cần khởi động lại trợ lý + nút" → Task 5.
- §5.1 `dashboard/lib/env-file.js` (đọc chỉ khoá cho phép, sửa đúng một dòng, giữ `.bak`) → Task 4; `dashboard/lib/brand.js` → Task 1; tệp `brand.json`, `brand/logo.png`, mọi tệp quyền 600 → Task 1.
- §11.5 → Task 4 (`EDITABLE_KEYS`, test không lộ khoá khác); §11.7 CSP không nới → Task 2 (test header), 3 (test không `style=`, kiểm trình duyệt); §11.8 magic bytes, lưu PNG, từ chối SVG → Task 1, 3 (thu nhỏ: xem Quyết định 1).
- §6/§9 Người dùng "tạo/sửa/khoá, đặt lại mật khẩu" đã có từ GĐ1; GĐ4 thêm lần đăng nhập gần nhất → Task 6.
- §9 "mọi lỗi kèm bước tiếp theo", "không thuật ngữ hạ tầng" → Task 6 (`errorText`), các thông báo lỗi Task 1–5 đều có "— <bước tiếp theo>" (test `match(/—/)`).
- §14 GĐ4 → Task 1–7. §12 `uninstall` giữ `<HERMES_HOME>/zalo/dashboard/` → đúng sẵn (tệp mới nằm trong thư mục đó).

**2. Placeholder:** chỉ còn `<ngày phát hành>` (CHANGELOG) và `<hermes-agent>`/`<HERMES_HOME>` trong bước triển khai — giá trị biết lúc phát hành, có chỉ dẫn.

**3. Nhất quán kiểu:** `createBrandStore` trả `{ name, color, poweredBy, logoUrl }` ở mọi hàm; route thêm `ok` + `suggestions`; `views/brand.js` đọc đúng các khoá đó, `app.js` `pickBrand` chỉ lấy `name/poweredBy/logoUrl`. `writeFileAtomic(path, data, opts)` (Task 1) dùng ở `brand.js` (Task 1) và `env-file.js` (Task 4). `paths.pendingRestartFile`/`sidecarEnvFile` (Task 1) dùng ở Task 4. `ZALO_UID` xuất từ `users.js` (Task 4) dùng ở `owners.js` và `admin.js`. Phản hồi owners `{ owners: [{ uid, valid, name, dashboardUsers }], pendingRestart, shadowed }` (Task 4) khớp `views/owners.js` (Task 5). Biểu tượng `crown` thêm ở Task 3, dùng ở Task 5. `deps.brand` (Task 2), `deps.owners`/`deps.restartSidecar` (Task 4) có trong cả `buildDeps` lẫn `makeDeps`.

**4. Review Focus:** năm mục ở đầu đều có test trong task sở hữu mã (đã ghi tên test ở từng dòng). Đã chạy thử toàn bộ mã của kế hoạch trên một bản sao: `HERMES_HOME=E:/Hermes npm test` → JS 504 test (502 pass, 2 bỏ qua trên Windows, 0 fail; +33 so với v1.21.0), Python xanh. Đã kiểm bằng Edge (Playwright) trên bản sao: bấm màu gợi ý đổi khung xem trước, `#fde68a` khoá nút Lưu, Lưu đổi màu toàn trang, JPEG 800×400 → logo PNG 256×128 (1,8 KB), SVG bị từ chối, 390 px không cuộn ngang ở Thương hiệu/Chủ nhân/Tổng quan, **không** có cảnh báo CSP.
