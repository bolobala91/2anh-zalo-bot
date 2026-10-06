# Dashboard quản trị Zalo v2 — dịch vụ riêng cho chủ bot và người cài đặt

**Ngày:** 2026-10-07
**Trạng thái:** Thiết kế đã duyệt qua hội thoại, chờ duyệt bản viết
**Dự án:** 2anh-zalo-bot (từ v1.18.0)
**Thay thế:** `2026-09-09-zalo-dashboard-plugin-design.md` (plugin trong Hermes Dashboard — đã bỏ)

## 1. Vì sao làm lại

Spec 09/09 đặt dashboard thành một tab trong Hermes Dashboard, rồi bị hoãn vì
điều khiển bot qua chat Zalo là đủ cho một người. Hai điều đã đổi:

1. **Bot được cài cho khách.** Khách không đọc `.env`, không SSH, nhưng phải tự
   biết bot còn sống không và tự quét lại QR.
2. **Sự cố 01/10/2026:** Zalo đá phiên của Uyển Nhi (`KICKOUT_BY_WORKER`), bot
   điếc 24 giờ mà không ai biết, sidecar thử nối lại 17.414 lần. Vừa thiếu cảnh
   báo, vừa thiếu chỗ cho người không rành kỹ thuật quét lại QR.

Mẫu tham khảo giao diện: dashboard "Zalo Agent" (thanh bên chia nhóm, trang
Thương hiệu có xem trước trực tiếp, phân quyền bot theo tính năng).

## 2. Mục tiêu và thước đo

Người dùng: **người cài đặt (Quản trị)** và **khách (Chủ bot)**. Mỗi bản cài có
dashboard riêng; không có trang tổng hợp nhiều bot (để sau, nếu cần).

Thành công khi:

1. Zalo mất phiên → trong vòng ~2 phút Quản trị và Chủ bot nhận Telegram có link
   thẳng tới trang quét QR, và **Chủ bot tự quét lại được** không cần gọi ai.
2. Mở dashboard là biết ngay bot còn sống không, hỏng ở đâu, làm gì tiếp.
3. Đổi bot được làm gì trong từng nhóm **không phải mở tệp nào**.
4. Gắn được thương hiệu của khách (logo, tên, màu).

## 3. Phi mục tiêu

- Không có trang tổng hợp nhiều bot.
- Không có mục Agent (model, tính cách) — vẫn dùng `/model` trong Zalo.
- Không có Insight nhóm, Second brain, Theo dõi agent, Kết nối MCP, Lịch hẹn.
- Không WebSocket: poll là đủ.
- Không bundler, không bước build: giao diện Preact + htm nhúng sẵn trong repo.
- Không test tự động cho lớp giao diện — có danh sách kiểm tay trong README.

## 4. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Dashboard là **tiến trình Node riêng** trong repo, nghe `127.0.0.1:3880` | Phải sống khi sidecar/Hermes chết — đúng lúc cần nó nhất |
| 2 | Local: `http://localhost:3880`. VPS: `https://dashboard.<tên-miền>` qua Caddy | Không bao giờ mở cổng 3880 ra Internet |
| 3 | Hai vai trò: **Quản trị**, **Chủ bot** | Khách không được chạm vào thứ làm hỏng bot |
| 4 | Đăng nhập bằng **mã 6 số bot gửi qua Zalo**, mật khẩu dự phòng | Không có mật khẩu để quên/lộ; mật khẩu dùng khi chính Zalo đang hỏng |
| 5 | Phân quyền thành viên **riêng từng nhóm** | Mỗi nhóm có văn hoá và nhu cầu khác nhau |
| 6 | Cảnh báo qua **Telegram**, mỗi bản cài một bot Telegram riêng | Zalo hỏng thì không báo bằng Zalo được; một bot cho mỗi bản cài thì không ai tranh `getUpdates` |
| 7 | Phiên chat: **xem + nhắn tay dưới tên bot**, có nhật ký | Trả lời thay bot hoặc sửa câu bot trả lời sai |
| 8 | Bảng quyền theo nhóm có hiệu lực **ngay**; đổi **chủ nhân** vẫn ghi `.env` + khởi động lại | Bảng nhóm chỉ *bớt* quyền trong bộ công cụ công khai, không bao giờ cấp quyền chủ nhân — xem §8 |

## 5. Kiến trúc

```
Trình duyệt (Quản trị / Chủ bot)
   │  localhost:3880   hoặc   https://dashboard.<tên-miền>  ← Caddy (chỉ VPS)
   ▼
┌──────────── dashboard (tiến trình mới, 127.0.0.1:3880) ─────────────┐
│ auth │ API giao diện │ giao diện tĩnh (Preact) │ canh gác + Telegram │
└──┬────────────────────┬─────────────────────────┬─────────────────────┘
   │ đọc, mode=ro        │ hành động + token        │ đọc/ghi cấu hình
   ▼                    ▼                          ▼
data/zalo.sqlite   sidecar :3872 /control/*   <HERMES_HOME>/zalo/
(messages, audit)  (QR, gửi, mã, nhóm)          permissions.json ──► plugin đọc nóng
                                                dashboard/ (users, sessions, brand, telegram)
```

### 5.1 Thành phần

| Tệp / thư mục | Một việc duy nhất |
|---|---|
| `dashboard/server.js` | Dựng Express, nạp các router, phục vụ `public/`. Không chứa logic nghiệp vụ |
| `dashboard/lib/paths.js` | Dò `HERMES_HOME`, thư mục sidecar, thư mục dữ liệu dashboard (dùng lại `paths.js`/`scripts/setup-env.js` sẵn có) |
| `dashboard/lib/store-reader.js` | Đọc `zalo.sqlite` chế độ chỉ đọc: hội thoại, tin nhắn (phân trang), tìm kiếm, nhật ký |
| `dashboard/lib/sidecar-client.js` | Gọi `/api/health` và `/control/*` của sidecar kèm `ZALO_BRIDGE_TOKEN` |
| `dashboard/lib/auth.js` | Người dùng, băm mật khẩu (scrypt), mã đăng nhập, phiên, chống dò, middleware vai trò |
| `dashboard/lib/permissions.js` | Đọc/ghi/kiểm `permissions.json` (ghi nguyên tử + `.bak`) |
| `dashboard/lib/env-file.js` | Đọc **chỉ** khoá được phép từ `.env` Hermes, sửa đúng một dòng, giữ `.bak` |
| `dashboard/lib/brand.js` | Thương hiệu + logo (kiểm định dạng, thu về 256 px) |
| `dashboard/lib/watchdog.js` | Canh gác 30 giây/lần, sự kiện sự cố → `telegram.js` |
| `dashboard/lib/telegram.js` | Gửi tin, `getUpdates` (long-poll) để nối người dùng bằng mã `/start` |
| `dashboard/routes/*.js` | Mỗi nhóm route một tệp: `auth`, `status`, `zalo`, `chats`, `permissions`, `audit`, `brand`, `admin` |
| `dashboard/public/` | `index.html`, `app.js` + `views/*.js` (Preact + htm), `style.css`, `vendor/` (preact, htm — nhúng sẵn) |
| `control-api.js` (sidecar) | Route `/control/*` — §7.2 |
| `hermes-plugin/zalo_tools/group_permissions.py` | Đọc nóng `permissions.json`, trả quyền của một nhóm — §8 |

Dữ liệu dashboard: `<HERMES_HOME>/zalo/dashboard/` gồm `users.json`,
`sessions.json`, `brand.json`, `brand/logo.png`, `telegram.json`, `watchdog.json`
(trạng thái sự cố). Mọi tệp quyền 600.

### 5.2 Biến môi trường (đọc từ `.env` của Hermes, như sidecar)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ZALO_DASHBOARD_PORT` | `3880` | Cổng nghe trên `127.0.0.1` |
| `ZALO_DASHBOARD_URL` | `http://localhost:3880` | Địa chỉ người dùng mở — dùng trong link Telegram |
| `ZALO_SIDECAR_RESTART_CMD` | Linux: `systemctl restart zalo-bridge`; Windows: chạy lại `node server.js` ẩn trong thư mục sidecar | Lệnh tự khởi động lại sidecar |

## 6. Đăng nhập và vai trò

**Tài khoản** (`users.json`): `username`, `role` (`admin` | `owner`), `zaloUid`,
`passwordHash` (scrypt, muối riêng), `disabled`, `createdAt`.

- **Lần đầu:** bộ cài in **link thiết lập dùng một lần** (mã ngẫu nhiên, sống 24 giờ,
  lưu băm) để tạo tài khoản Quản trị; `zaloUid` điền sẵn từ `ZALO_ALLOWED_USERS`.
- Quản trị tạo/sửa/khoá tài khoản Chủ bot, đặt lại mật khẩu.
- Quản trị quên mật khẩu: `npm run dashboard:reset-admin` trên chính máy đó.

**Đăng nhập:**

1. Nhập tên đăng nhập.
2. Sidecar đang đăng nhập Zalo → dashboard sinh mã 6 số (CSPRNG), lưu băm, gọi
   `POST /control/login-code` để bot nhắn riêng tới `zaloUid`. Mã sống 5 phút, sai
   tối đa 5 lần.
3. Zalo hỏng hoặc người dùng chọn → mật khẩu.
4. Sai 5 lần trong 15 phút → khoá theo tên **và** theo IP 15 phút. Mọi lần đăng nhập
   (thành công/thất bại) và mọi thay đổi chỉ dashboard làm (người dùng, thương hiệu,
   Telegram, phân quyền) ghi vào `<dashboard>/activity.jsonl` (tự xoay vòng 5 MB).
   Dashboard không ghi được `zalo.sqlite` (chỉ đọc), nên màn Nhật ký gộp hai nguồn:
   `audit_log` của sidecar + `activity.jsonl`.
5. Không tiết lộ tên đăng nhập có tồn tại hay không (cùng một thông báo).

**Phiên:** cookie `HttpOnly`, `SameSite=Strict`, `Secure` khi đi qua HTTPS; ID phiên
32 byte ngẫu nhiên, lưu **băm** trong `sessions.json`; hết hạn 7 ngày hoặc 12 giờ
không hoạt động; "Đăng xuất mọi nơi". Mọi request thay đổi dữ liệu kiểm `Origin`
khớp `ZALO_DASHBOARD_URL` hoặc `localhost`.

**Ma trận quyền** (kiểm ở **mọi route phía máy chủ**):

| Mục | Quản trị | Chủ bot |
|---|---|---|
| Tổng quan, Tài khoản Zalo (QR, đăng xuất Zalo) | ✅ | ✅ |
| Phân quyền Bot theo nhóm | ✅ | ✅ |
| Phiên chat (xem, tìm, nhắn tay) | ✅ | ✅ |
| Nhật ký | ✅ (kèm mã kỹ thuật) | ✅ (chữ dễ hiểu) |
| Thương hiệu | ✅ | ✅ |
| Tự nối Telegram của mình | ✅ | ✅ |
| Chủ nhân bot (`ZALO_ALLOWED_USERS`) | ✅ | ❌ |
| Người dùng dashboard | ✅ | ❌ |
| Cài đặt Telegram (token bot) | ✅ | ❌ |

## 7. Hợp đồng API

### 7.1 Dashboard — `/api/*` (JSON, sau đăng nhập trừ khi ghi chú)

| Route | Vai trò | Việc |
|---|---|---|
| `POST /api/auth/start` | công khai | `{username}` → `{methods: ["zalo"?, "password"]}`; nếu có `zalo` thì gửi mã |
| `POST /api/auth/verify` | công khai | `{username, code}` hoặc `{username, password}` → đặt cookie |
| `POST /api/auth/setup` | công khai, cần mã thiết lập | Tạo Quản trị đầu tiên |
| `POST /api/auth/logout` · `POST /api/auth/logout-all` | đăng nhập | |
| `GET /api/me` | đăng nhập | Người dùng hiện tại + vai trò + trạng thái nối Telegram |
| `GET /api/status` | đăng nhập | Hợp nhất: Zalo, listener, trợ lý, tin hôm nay, lần cuối nhận/gửi, lỗi gần nhất, `needsRelogin` |
| `POST /api/zalo/qr/start` · `GET /api/zalo/qr` · `POST /api/zalo/logout` | đăng nhập | Chuyển tiếp sidecar |
| `GET /api/chats` · `GET /api/chats/:threadId/messages?before=` · `GET /api/chats/search?q=` | đăng nhập | Từ SQLite |
| `POST /api/chats/:threadId/send` | đăng nhập | `{text, threadType}` → sidecar `/control/send` kèm tên người gửi |
| `GET /api/permissions` · `PUT /api/permissions/groups/:groupId` · `PUT /api/permissions/defaults` | đăng nhập | §8 |
| `GET /api/groups` | đăng nhập | Danh sách nhóm (sidecar, có tên) |
| `GET /api/audit?status=&before=` | đăng nhập | Lọc theo vai trò: Chủ bot thấy nhãn dễ hiểu |
| `GET /api/brand` (công khai — trang đăng nhập cần) · `PUT /api/brand` · `POST /api/brand/logo` · `DELETE /api/brand/logo` | đăng nhập | |
| `POST /api/telegram/link` | đăng nhập | Trả link `t.me/<bot>?start=<mã>` |
| `POST /api/telegram/test` | đăng nhập | Gửi tin thử tới người đang đăng nhập |
| `GET/POST/PATCH /api/admin/users` | admin | |
| `GET /api/admin/owners` · `PUT /api/admin/owners` | admin | Sửa `ZALO_ALLOWED_USERS`, trả `pendingRestart: true` |
| `POST /api/admin/restart-assistant` | admin | Khởi động lại gateway Hermes (systemd / Windows) |
| `GET/PUT /api/admin/telegram` | admin | Token chỉ ghi, đọc ra dạng che |

### 7.2 Sidecar — `/control/*` (mới, `control-api.js`)

Luôn đòi `Authorization: Bearer <ZALO_BRIDGE_TOKEN>`, so bằng `timingSafeEqual`;
thiếu/sai → 401. Chỉ nghe như sidecar hiện tại (`127.0.0.1`).

| Route | Việc |
|---|---|
| `GET /control/health` | Ảnh chụp `runtime-health.js` + `needsRelogin` |
| `POST /control/qr/start` · `GET /control/qr` · `POST /control/logout` | Như trang QR hiện có, nhưng QR đọc được qua HTTP (hiện chỉ đẩy qua WebSocket) |
| `POST /control/send` | `{threadId, threadType, text, actor}` → gửi qua `sendSystemNotice`, ghi `audit_log` `actor_role="dashboard"`, `actor_uid=<username>` |
| `POST /control/login-code` | `{zaloUid, code}` → nhắn riêng "Mã đăng nhập dashboard: 123456 (5 phút)". `code` phải đúng 6 chữ số; nội dung tin do sidecar dựng theo mẫu cố định, nên route này không thể dùng để gửi chữ tuỳ ý. Ghi `audit_log` (không ghi mã) |
| `GET /control/groups` | `getAllGroups` + tên nhóm, đệm 10 phút |

### 7.3 Sửa sidecar: giãn nhịp nối lại

`bot-handler.js`: đếm số lần "nối được rồi rớt trong < 10 giây". Từ lần thứ 3, hoặc
khi mã đóng là `3003`/`KICKOUT`, giãn nhịp 5 s → 15 s → 30 s → 60 s → 5 phút và
đặt `runtime-health` `needsRelogin=true` khi phiên bị đá hoặc cookie không còn
dùng được. Đặt lại bộ đếm chỉ khi kết nối giữ được > 2 phút.

## 8. Phân quyền theo nhóm

### 8.1 Tệp `<HERMES_HOME>/zalo/permissions.json`

```json
{
  "version": 1,
  "defaults": { "active": true, "replyOnlyTagged": true,
                "features": { "web": true, "files": true, "voice": true, "reminders": true,
                              "groupCron": true, "kb": true, "people": true,
                              "academic": true, "video": true } },
  "groups": { "<groupId>": { "name": "Tổ Hoá", "active": true, "replyOnlyTagged": true,
                             "features": { "groupCron": false } } }
}
```

Nhóm không có mục riêng → dùng `defaults`; mục riêng chỉ cần ghi khoá khác mặc định.
**Không có tệp → hành vi y như hôm nay** (mọi công cụ công khai, cờ toàn cục).

### 8.2 Tính năng → công cụ

| Nút | Công cụ thành viên |
|---|---|
| `web` | `zalo_web_search`, `zalo_web_read` |
| `files` | `zalo_send_file`, `zalo_make_file`, `zalo_pdf` |
| `voice` | `zalo_send_voice` |
| `reminders` | `zalo_create_reminder`, `zalo_list_reminders`, `zalo_remove_reminder` |
| `groupCron` | `zalo_group_cron` |
| `kb` | `zalo_kb_list`, `zalo_kb_read` |
| `people` | `zalo_remember_person`, `zalo_recall_person` |
| `academic` | `zalo_academic_search` |
| `video` | `zalo_video_info`, `zalo_video_download` |
| *(luôn bật)* | `zalo_send_sticker`, `zalo_send_link`, `zalo_group_members` |

Công cụ công khai mới thêm sau này phải được xếp vào một nút (test ghim danh sách).

### 8.3 Thực thi trong plugin

- `group_permissions.py` đọc tệp theo `mtime` (đọc lại khi tệp đổi) → hiệu lực ngay.
- **`active=false`**: adapter bỏ qua tin của **thành viên** trong nhóm đó (không gọi
  agent). Tin của chủ nhân vẫn được xử lý.
- **`replyOnlyTagged`**: ghi đè cờ toàn cục `ZALO_GROUP_REPLY_ONLY_TAGGED` cho nhóm đó.
- **Tính năng tắt**: hook `guard_member_tool_call` sẵn có (chặn người ngoài gọi công cụ
  chủ nhân) mở rộng thêm: lượt của thành viên trong nhóm X gọi công cụ thuộc nút tắt
  → từ chối với câu dễ hiểu ("Nhóm này chưa bật tính năng …").
- **Không hứa suông**: khi lượt là của thành viên, thêm một dòng vào ngữ cảnh lượt
  liệt kê tính năng đang tắt ở nhóm này.
- **Chủ nhân không bao giờ bị chặn** bởi tệp này. Tệp hỏng → ghi cảnh báo và dùng
  `defaults` mặc định, không làm bot im.
- Cron nhóm (`zalo_cron_member`) đã tạo trước khi tắt `groupCron` vẫn chạy; tắt chỉ
  chặn tạo mới. Ghi rõ trên giao diện.

## 9. Giao diện

**Bố cục** theo mẫu tham khảo; dùng được trên điện thoại; chỉ hiện mục đã làm.

```
TỔNG QUAN   Tổng quan
HỘI THOẠI   Phiên chat · Phân quyền Bot
HỆ THỐNG    Tài khoản Zalo · Nhật ký · Thương hiệu
QUẢN TRỊ    Người dùng · Chủ nhân bot · Cảnh báo Telegram   (chỉ Quản trị)
```

**Dải dính trên cùng:** khi `needsRelogin` hoặc Zalo không đăng nhập → nền đỏ,
"Bot đang mất kết nối Zalo — Quét mã đăng nhập lại", nút thẳng tới trang QR.

| Màn | Nội dung |
|---|---|
| Tổng quan | Thẻ: Zalo, Trợ lý, Cảnh báo Telegram; lần cuối nhận/gửi; tin hôm nay; 5 nhóm sôi nổi nhất; lỗi gần nhất + bước xử lý |
| Tài khoản Zalo | Đã đăng nhập: tên, ảnh, Đăng xuất. Chưa: QR lớn, poll 1 s, tự làm mới khi hết hạn, đếm ngược, tự chuyển khi xong; lời nhắc "quét bằng điện thoại đang đăng nhập tài khoản Zalo của bot — không mở trang này trên chính điện thoại đó" |
| Phân quyền Bot | Trái: nhóm + ô tìm. Phải: Hoạt động, Chỉ trả lời khi được tag, 9 nút tính năng; mẫu "Mặc định cho nhóm mới"; Lưu = hiệu lực ngay |
| Phiên chat | Trái: hội thoại + tìm toàn văn. Phải: tin nhắn, bot canh phải khác màu, cuộn lên tải thêm; ô soạn gửi dưới tên bot |
| Nhật ký | lúc nào · ai · làm gì · ở đâu · kết quả; lọc "chỉ lỗi" |
| Thương hiệu | Logo, tên, màu (6 gợi ý + mã màu, kiểm tương phản chữ trắng ≥ 4,5 : 1), "Vận hành bởi 2Anh AI", xem trước thanh bên + trang đăng nhập, khôi phục mặc định |
| Người dùng *(QT)* | Tạo/sửa/khoá, đặt lại mật khẩu |
| Chủ nhân bot *(QT)* | Sửa UID chủ nhân, banner vàng "cần khởi động lại trợ lý" + nút |
| Cảnh báo Telegram *(QT)* | Token bot (che), trạng thái `getUpdates`, ai đã nối, gửi thử |

**Ngôn ngữ:** tiếng Việt thường, không thuật ngữ hạ tầng ("sidecar", "bridge",
"toolset"). Mọi lỗi kèm bước tiếp theo.

## 10. Cảnh báo Telegram

- Một bot Telegram **riêng cho mỗi bản cài**, **khác** bot Telegram của Hermes (một bot
  chỉ có một nơi đọc `getUpdates`).
- Nối người dùng: mã `/start` dùng một lần (10 phút) → lưu `chat_id` vào tài khoản đó.
- Canh gác 30 giây/lần, trạng thái lưu `watchdog.json` (khởi động lại không báo trùng):

| Sự cố | Ngưỡng | Hành động |
|---|---|---|
| `needsRelogin` / Zalo không đăng nhập | 2 phút | Báo kèm link `<ZALO_DASHBOARD_URL>/#/zalo` |
| Sidecar không trả lời | 2 phút | Chạy `ZALO_SIDECAR_RESTART_CMD` một lần; vẫn hỏng → báo |
| Trợ lý không nối | 5 phút | Báo |
| Hồi phục | ngay | "✅ đã hoạt động lại" |

- Mỗi sự cố báo một lần, nhắc lại sau 6 giờ nếu chưa hết. Gửi tới mọi người dùng đã
  nối Telegram của bản cài.

## 11. Bảo mật

1. Chỉ nghe `127.0.0.1`. Tin `X-Forwarded-For`/`-Proto` **chỉ** khi kết nối đến từ
   `127.0.0.1` (Caddy).
2. Vai trò kiểm ở mọi route phía máy chủ.
3. Token sidecar cho `/control/*`, `timingSafeEqual`.
4. SQLite `mode=ro`; chặn path traversal ở mọi tham số.
5. `.env`: chỉ đọc/ghi `ZALO_ALLOWED_USERS` (và khoá dashboard ở §5.2); sửa đúng dòng,
   ghi tệp tạm rồi đổi tên, giữ `.env.bak`; không bao giờ trả khoá khác.
6. Không hiển thị số điện thoại, cookie, IMEI Zalo; token Telegram chỉ hiện dạng che.
7. CSP chặt (`default-src 'self'`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`.
8. Logo: kiểm magic bytes, thu nhỏ phía máy chủ, lưu PNG; từ chối SVG.
9. Mọi hành động có hậu quả để lại dấu vết kèm tên người dùng dashboard: hành động đi
   qua sidecar (gửi tin, QR, đăng xuất Zalo, mã đăng nhập) ghi `audit_log`; hành động
   chỉ trong dashboard ghi `activity.jsonl` (§6).

## 12. Triển khai

- `npm run install:hermes` thêm: dịch vụ `zalo-dashboard` (systemd trên Linux; `.vbs`
  chạy ẩn trong Startup trên Windows), in link thiết lập Quản trị, in khối Caddy:
  ```
  dashboard.<tên-miền> {
      reverse_proxy 127.0.0.1:3880
  }
  ```
- `doctor`: dashboard đang chạy; đã có Quản trị; đã nối Telegram (cảnh báo, không lỗi).
- `uninstall`: gỡ dịch vụ, **giữ** `<HERMES_HOME>/zalo/dashboard/` và `permissions.json`.
- Dashboard là phần thêm: không chạy thì bot vẫn chạy như cũ.

## 13. Kiểm thử

Node (`node --test`) và Python (đăng ký trong `scripts/run-python-tests.js`):

| Phần | Test |
|---|---|
| auth | Băm/kiểm mật khẩu; mã hết hạn 5 phút, quá 5 lần; khoá 15 phút theo tên và IP; hết hạn phiên; kiểm Origin; không lộ tên đăng nhập tồn tại; link thiết lập dùng một lần |
| vai trò | Bảng route × vai trò: Chủ bot gọi route Quản trị → 403; chưa đăng nhập → 401 |
| store-reader | Đọc `mode=ro`, phân trang, tìm kiếm, chặn traversal, sidecar tắt vẫn đọc |
| env-file | Chỉ trả khoá cho phép; ghi giữ dòng khác, có `.bak` |
| control-api | 401 khi thiếu/sai token; `/control/send` ghi đúng một dòng audit có tên người gửi; `/control/login-code` từ chối UID không được dashboard chuyển xuống |
| giãn nhịp | KICKOUT / rớt liên tục → giãn tới 5 phút, `needsRelogin=true`; ổn định > 2 phút mới đặt lại |
| watchdog | Báo một lần, nhắc 6 giờ, báo hồi phục, không báo trùng sau khởi động lại; thử khởi động lại sidecar đúng một lần |
| telegram | Nối bằng mã dùng một lần, mã hết hạn bị từ chối |
| permissions (Python) | Nhóm A tắt `web` → thành viên A bị từ chối, nhóm B vẫn dùng; chủ nhân không bị chặn; `active=false` bỏ qua thành viên; sửa tệp có hiệu lực không cần khởi động lại; tệp hỏng → mặc định; mọi công cụ công khai thuộc đúng một nút |

Kiểm tay: danh sách ngắn mỗi màn trong README, chạy trên Uyển Nhi (VPS qua Caddy)
và Lăng Tiêu (local).

## 14. Giai đoạn

Mỗi giai đoạn là một bản phát hành dùng được, có kế hoạch thi công riêng.

| GĐ | Nội dung |
|---|---|
| 1 | Khung dashboard, auth + vai trò, Tổng quan, Tài khoản Zalo, `control-api.js`, giãn nhịp nối lại, canh gác + Telegram, Người dùng (tối thiểu), bộ cài + Caddy |
| 2 | Phiên chat (xem, tìm, nhắn tay) + Nhật ký |
| 3 | Phân quyền Bot theo nhóm (giao diện + thực thi trong plugin) |
| 4 | Thương hiệu, Chủ nhân bot, hoàn thiện Người dùng |

## 15. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Khách mở dashboard trên chính điện thoại của bot nên không quét được QR | Lời nhắc rõ trên trang QR; link Telegram nên mở trên máy khác |
| Bot Telegram cảnh báo trùng với bot Telegram của Hermes | `doctor` và trang Cảnh báo so token với cấu hình Telegram của Hermes, từ chối nếu trùng |
| Sidecar đổi định dạng `runtime-health` | `sidecar-client.js` là nơi duy nhất đọc, có test hợp đồng |
| Lịch sử lớn | Đã có chỉ mục `idx_messages_thread_time`; mọi route phân trang |
| Plugin đọc `permissions.json` ở mỗi lượt | Đọc theo `mtime`, giữ bản đã phân tích trong bộ nhớ |
