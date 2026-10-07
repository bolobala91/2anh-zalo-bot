# Dashboard v2 — §16 Giai đoạn 5: Nhắn riêng và Sức khoẻ máy chủ

**Ngày:** 2026-10-07
**Trạng thái:** Quyết định của người dùng đã chốt (A, B); lựa chọn thiết kế bên dưới chờ duyệt bản viết
**Dự án:** 2anh-zalo-bot (từ v1.22.0 → v1.23.0)
**Bổ sung cho:** `2026-10-07-zalo-dashboard-v2-design.md` (§1–§15 giữ nguyên; tệp này là §16)

Giai đoạn 1–4 đã phát hành (v1.19–v1.22). Người dùng yêu cầu thêm hai phần.

## 16.1 Quyết định của người dùng (bắt buộc)

**A. Quyền nhắn riêng trên dashboard.** Trang Phân quyền Bot có mục **"Nhắn riêng"**:
1. Ai được nhắn riêng với bot: **chỉ chủ nhân / một danh sách người / mọi người** — thay hoặc mở rộng `ZALO_DM_POLICY` (`owner-only|open`).
2. Các nút tính năng cho người nhắn riêng, như nhóm.
3. Ghi đè tính năng theo từng người trong danh sách.
4. Chủ nhân luôn được miễn. Một tin nhắn riêng phải qua **cả hai lớp**: kết nối Zalo (sidecar) và plugin.

**B. Sức khoẻ máy chủ.** Chạy trên cả VPS Linux và bản cài Windows:
1. CPU, RAM, ổ đĩa, thời gian chạy; biểu đồ 24 giờ; lấy mẫu mỗi phút vào kho cuộn nhỏ; không thêm gói npm; biểu đồ SVG dựng bằng htm (CSP: không style nội tuyến, không innerHTML).
2. Trạng thái dịch vụ: kết nối Zalo, dashboard, trợ lý Hermes, Caddy, 9router và dịch vụ khác dò được. Linux dùng `systemctl`; Windows dò tiến trình/cổng. Chỉ lệnh đọc, `windowsHide`, có timeout.
3. Cảnh báo Telegram khi quá tải: ổ đĩa > 90 %, RAM > 90 % kéo dài, CPU cao suốt 10 phút — dùng lại canh gác + bot Telegram hiện có, cùng cách báo/hồi phục/nhắc lại.
4. Lượt gọi AI và token theo ngày, từ nguồn đáng tin nhất có trên cả hai bản cài. Không có chi phí bằng tiền đáng tin thì chỉ hiện lượt gọi + token và nói rõ.

## 16.2 Hiện trạng đã kiểm (đọc mã + máy thật, chỉ đọc)

| Điểm | Thấy gì |
|---|---|
| Plugin, tin riêng | `adapter.py` đọc `dm_policy` (config.yaml `platforms.zalo.extra.dm_policy` thắng `ZALO_DM_POLICY`, mặc định `owner-only`) **một lần lúc khởi động**. `owner-only`: tin riêng của người không phải chủ nhân bị bỏ (trừ `/sethome`, trả UID). `open`: ai cũng được, với bộ công cụ công khai `zalo_public`, **không** có nút tính năng nào (bảng nhóm chỉ áp trong nhóm — `_group_feature_block` trả `None` khi `is_group` sai). |
| Cổng Hermes | Gateway Hermes còn chặn người ngoài `ZALO_ALLOWED_USERS` trừ khi `ZALO_ALLOW_ALL_USERS` (hoặc `GATEWAY_ALLOW_ALL_USERS`) bật. Cả hai bản cài đang `ZALO_ALLOW_ALL_USERS=true`, `ZALO_DM_POLICY=owner-only`. |
| Kết nối Zalo, tin riêng | `bot-handler.js` chuyển **mọi** tin (nhóm và riêng) cho Hermes, không lọc. `zalo-policy.js` chỉ kiểm **lệnh đi ra** của Hermes: vai trò `public` chỉ thao tác trong đúng hội thoại nguồn; không có khái niệm "người này có được nhắn riêng không". |
| CSDL Hermes | `<HERMES_HOME>/state.db` (Lăng Tiêu: `E:/Hermes/state.db`, schema 28; Uyển Nhi: `/root/.hermes/state.db`, schema 30) có bảng `session_model_usage` (`api_call_count`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `estimated_cost_usd`, `cost_status`, `first_seen`, `last_seen`) — cộng dồn **theo phiên**; một phiên kéo dài tới 30 ngày. `estimated_cost_usd` = 0, `cost_status` = `unknown`/NULL, `billing_provider` = `custom` trên cả hai máy. |
| 9router | `:20128` trên cả hai máy. `/api/health` công khai; `/api/usage*` đòi đăng nhập (401). CSDL riêng (`%APPDATA%/9router/db/data.sqlite`, `/root/.9router/db/data.sqlite`) có `usageDaily` kèm `cost` — nhưng là giá niêm yết ước tính và **dùng chung cho mọi ứng dụng trên máy** (07/10 tại máy local: 9router 469 lượt, Hermes 6 lượt). |
| Log Hermes | `gateway.log` có `response ready … api_calls=N` nhưng không có token, bị xoay vòng. |
| Dịch vụ VPS | `systemctl list-units --type=service --all --plain zalo-* hermes-* caddy.service 9router.service` trả 9 đơn vị: `zalo-bridge`, `zalo-dashboard`, `hermes-gateway`, `hermes-dashboard`, `hermes-mgmt`, `hermes-openviking`, `hermes-rag`, `caddy`, `9router` — tất cả chạy bằng root. |
| Dịch vụ Windows | Không systemd, không Caddy. Kết nối Zalo nghe `127.0.0.1:3872`, dashboard `:3880`, 9router `:20128`. Hermes ghi `<HERMES_HOME>/gateway.pid` (JSON `{pid,…}`); `process.kill(pid, 0)` trả sống/`ESRCH`/`EPERM` không cần lệnh. `config.yaml` Hermes trỏ `base_url: http://127.0.0.1:20128/v1`. |
| Số đo hệ thống | Node 22.23 trên cả hai máy: `os.freemem()` trên Linux = MemAvailable (khớp `free -m`), `fs.statfsSync` chạy được cả Linux lẫn Windows — CPU/RAM/đĩa/uptime **không cần chạy lệnh nào**. |

## 16.3 Thiết kế A — Nhắn riêng

### 16.3.1 Lược đồ: mục `dm` trong `permissions.json` (vẫn `version: 1`)

```json
{
  "version": 1,
  "defaults": { … }, "groups": { … },
  "dm": {
    "who": "list",
    "features": { "web": true, "files": true, "voice": true, "reminders": true,
                  "kb": true, "people": true, "academic": true, "video": false },
    "people": { "<uid>": { "name": "Cô Lan", "features": { "voice": false, "video": true } } }
  }
}
```

- `who`: `owners` | `list` | `everyone`. Thiếu/lạ → theo `ZALO_DM_POLICY` như trước.
- `features`: **8 nút** — 9 nút của nhóm trừ `groupCron` (`zalo_group_cron` tự từ chối ngoài nhóm, nên nút này vô nghĩa trong tin riêng). Thiếu khoá → bật.
- `people[uid]`: có mặt = có tên trong danh sách. `features` chỉ ghi khoá **khác** nút chung (như nhóm so với mặc định). `name` chỉ để hiển thị; plugin bỏ qua.
- Gộp: bật hết ← `dm.features` ← `dm.people[uid].features`.
- Ghi đè theo người áp ở **cả** chế độ `list` lẫn `everyone` (ở `everyone`, danh sách là danh sách ngoại lệ tính năng). Ở `owners`, danh sách được giữ nhưng không dùng.

**Tương thích ngược, không tăng phiên bản.** Python `_parse` (v1.21+) và JS `normalize` chỉ đọc khoá biết → bỏ qua `dm`. Tăng lên `version: 2` thì plugin v1.21–1.22 coi cả tệp là hỏng và **mất luôn bảng nhóm** (quay về "mọi tính năng bật") — tệ hơn nhiều. Rủi ro còn lại: dashboard v1.22 (cũ) **ghi** tệp thì `normalize` cũ làm rơi mục `dm` → bot quay về `ZALO_DM_POLICY` (an toàn: mặc định `owner-only`). Vì vậy dashboard, plugin và kết nối Zalo phải lên v1.23.0 cùng lúc (§16.6). Dashboard v1.23 giữ `dm` qua mọi lần lưu nhóm/mặc định.

### 16.3.2 Thực thi — hai lớp

**Plugin (lớp chính, nóng theo mtime như bảng nhóm):**
1. `group_permissions.py`: `DM_FEATURES`, `_dm()` (giống `normalizeDm`), `dm_settings(uid) → {who, listed, features}`, `dm_allows(uid) → True|False|None`, `dm_disabled_features(uid)`.
2. `adapter.py` `_dm_allowed(uid)`: chủ nhân → luôn được; `dm_allows` khác `None` → theo tệp (thắng cả `ZALO_DM_POLICY=open`); `None`, bản cài dở (`_group_permissions` thiếu), hay lỗi bất ngờ → `ZALO_DM_POLICY` như trước. **"Fail open" ở đây nghĩa là không bao giờ làm sập gateway hay làm bot im với chủ nhân; quyền vào không bao giờ rộng hơn trước giai đoạn 5 chỉ vì lỗi đọc tệp.**
3. `/sethome` của người lạ vẫn được trả lời (để lấy UID); lượt đó gắn dấu `sethome` → `current_authorization()` thêm `"notice": "sethome"`.
4. `tools.py` `_feature_block` (đổi tên từ `_group_feature_block`): lượt tin riêng không phải chủ nhân gọi công cụ thuộc nút đang tắt → chặn với câu "Chủ bot chưa bật tính năng … khi nhắn riêng". Gợi ý công cụ trong câu từ chối bỏ những nút đang tắt với người đó.
5. "Không hứa suông": thêm dòng `[Tin nhắn riêng này đang tắt: …]` vào ngữ cảnh lượt; nút "Sổ người quen" tắt → không chèn hồ sơ người nhắn.

**Kết nối Zalo (lớp thứ hai):** `dm-rules.js` (mới, gốc repo, dùng chung với dashboard) đọc nóng `permissions.json` (`ZALO_PERMISSIONS_FILE` hoặc `<HERMES_HOME>/zalo/permissions.json`). `zalo-policy.js` `authorizeBridgeCommand(cmd, { ownerUids, dmRules })`: lượt vai trò `public`, nguồn là tin riêng (`sourceThreadType = 0`), UID **không** thuộc chủ nhân:
- `who` cho biết người này không được → từ chối **mọi** lệnh (`dm_not_allowed`), trừ lệnh `send` có `auth.notice === 'sethome'`.
- Nút **Nhắc hẹn** tắt → từ chối `createReminder`/`removeReminder`/`getListReminder` (`feature_disabled`). Các nút khác không ánh xạ được ở lớp này (adapter cũng dùng `uploadAttachment`/`sendVoice` để gửi tệp kèm câu trả lời), nên chỉ plugin chặn.
- Không có mục `dm`, chưa chọn `who`, đọc lỗi → không chặn thêm (giữ hành vi cũ).
- Chủ nhân miễn trừ **theo UID**, kể cả khi adapter hạ lượt của chủ xuống `public`.

Lớp kết nối Zalo không chặn tin **đi vào** (vẫn chuyển hết cho Hermes): plugin cần thấy `/sethome`, và lọc tin vào ở hai nơi dễ lệch nhau. Lớp này bảo đảm: nếu plugin lỗi/cũ mà vẫn trả lời người không được phép, câu trả lời đó không đi ra được.

### 16.3.3 Dashboard

- `GET /api/permissions` thêm `dm: { who, explicit, gatewayOpen, features, people: [{uid, name, custom, features}] }` và `dmFeatures` (8 nút, lời gợi ý viết cho một người). `explicit=false` khi tệp chưa có `who` — `who` hiển thị là giá trị suy từ `ZALO_DM_POLICY` (đọc như adapter: config.yaml thắng `.env` Hermes thắng môi trường dịch vụ).
- `gatewayOpen` = `ZALO_ALLOW_ALL_USERS` hoặc `GATEWAY_ALLOW_ALL_USERS` bật. Tắt mà chọn danh sách/mọi người → thông báo vàng: lựa chọn chưa có tác dụng, nhờ người cài đặt bật biến đó rồi khởi động lại trợ lý. Dashboard **không** tự sửa biến này (ngoài phạm vi §11.5).
- `PUT /api/permissions/dm` (`requireAuth`, cả hai vai trò — như Phân quyền nhóm ở §6): `{ who, features: 8 nút, people: [{ uid, name?, features: 8 nút | null }] }`. UID theo `ZALO_UID` (`^[1-9]\d{14,21}$`), tối đa 200 người, trùng giữ mục đầu, tên ≤ 80 ký tự. Lỗi 400 kèm bước tiếp theo. Ghi Nhật ký `permissions_dm` ("Đổi quyền nhắn riêng").
- Giao diện: mục "Nhắn riêng" đứng đầu danh sách bên trái (nhãn: Chỉ chủ nhân / N người / Mọi người). Bên phải: 3 lựa chọn (radio), 8 nút, danh sách người (chọn nhanh từ người đã nhắn riêng cho bot trong Phiên chat, hoặc nhập UID + tên), mỗi người có "Tính năng riêng cho người này". `Toggle` chuyển sang `ui.js` dùng chung.
- Câu "tin nhắn riêng không theo bảng này" ở mục Mặc định đổi thành "tin nhắn riêng chỉnh ở mục Nhắn riêng".

## 16.4 Thiết kế B — Sức khoẻ máy chủ

### 16.4.1 Số đo
- `dashboard/lib/host-metrics.js`: CPU % = phần bận giữa hai lần đo (`os.cpus()`), RAM % = (tổng − khả dụng)/tổng, ổ đĩa = `statfsSync(HERMES_HOME)` (đúng ổ chứa dữ liệu bot), uptime, số nhân. Không lệnh nào.
- `dashboard/lib/health-history.js`: 1 điểm/phút `[t, cpu, ram, disk]`, giữ 24 giờ (~1440 điểm), ghi `<dashboard>/health-history.json` (600) mỗi 5 điểm. Khoảng dashboard tắt hiện thành chỗ trống trên biểu đồ.
- Nhịp: `server.js` tick 5 giây sau khởi động rồi mỗi 60 giây.

### 16.4.2 Dịch vụ (`dashboard/lib/services.js`, đệm 10 giây)
- **Linux:** đúng một lệnh `systemctl list-units --type=service --all --no-legend --plain --no-pager zalo-* hermes-* caddy.service 9router.service` (`windowsHide`, timeout 5 s). Ba dịch vụ lõi (`zalo-bridge`, `zalo-dashboard`, `hermes-gateway`) thiếu thì hiện "Không có trên máy này". Không có `systemctl` (ENOENT) → cách dò của Windows.
- **Windows:** không lệnh nào. Kết nối Zalo = cổng `ZCA_PORT` mở; dashboard = chính nó; trợ lý = `gateway.pid` + `process.kill(pid, 0)`; thêm mọi `http(s)://127.0.0.1|localhost:<cổng>` trong `config.yaml` của Hermes (trừ cổng Zalo/dashboard) — nhận ra 9router (:20128) và bộ nhớ dài hạn (:1933), cổng khác hiện "Dịch vụ cục bộ cổng N".
- Nhãn tiếng Việt cho mọi người; **tên đơn vị systemd, cổng, PID chỉ Quản trị thấy** (`detail`).

### 16.4.3 Cảnh báo (mở rộng `watchdog.js`)
- `checkHost(sample)` gọi sau mỗi lần đo; dùng chung `update()` → cùng `watchdog.json`, báo một lần, nhắc sau 6 giờ, báo hồi phục, không báo trùng khi khởi động lại.
- Ngưỡng vào > 90 %, ra < 85 % (trễ 5 điểm để không báo/hết liên tục). Ổ đĩa: báo ở lần đo thứ hai liên tiếp; RAM: kéo dài 5 phút; CPU: kéo dài 10 phút. Tin kèm số % và link `#/health`.

### 16.4.4 Lượt gọi AI — nguồn đã chọn
**`<HERMES_HOME>/state.db` → `session_model_usage`, đọc chỉ đọc bằng `node:sqlite`** (đã có trên cả hai máy, gắn đúng bản cài, không cần khoá API). Vì số cộng dồn theo phiên (không chia ngày được bằng `last_seen`), dashboard lấy mẫu **tổng** mỗi 5 phút, cộng phần tăng vào ngày hiện tại (giờ VN), giữ 30 ngày trong `<dashboard>/ai-usage.json` (600). Tổng giảm (Hermes dọn phiên) → coi như 0 và lấy mốc mới. Bản Hermes cũ chưa có bảng này → đọc tổng trên `sessions`. Số liệu bắt đầu từ lúc cài v1.23.0 — không đoán ngược.
- Không dùng log: thiếu token, bị xoay vòng. Không dùng 9router: API cần đăng nhập, số liệu chung mọi ứng dụng trên máy.
- **Không hiện tiền**: Hermes ghi 0/unknown; giá của 9router là ước tính chung. Trang ghi rõ câu này.
- Phạm vi số: toàn bộ trợ lý (Zalo, việc hẹn giờ, kênh khác), nói rõ trên trang.

### 16.4.5 API và giao diện
- `GET /api/server-health` (`requireAuth`, **cả hai vai trò**): `{ host, history: { stepMs, points }, services, servicesError, usage: { since, error, days }, alerts: [{kind, since, alerted}], threshold: {on, off} }`. Chủ bot nhận `services` chỉ gồm `{id, label, state}`.
- Mục **"Sức khoẻ máy chủ"** trong nhóm Hệ thống (sau Thương hiệu). 4 ô (CPU, RAM, Ổ đĩa, Đã chạy liên tục), 3 biểu đồ đường 24 giờ có vạch ngưỡng đứt đỏ, danh sách dịch vụ, cột + bảng lượt gọi AI 14 ngày. Tự làm mới 30 giây. SVG dựng bằng htm, chỉ dùng class (không `style=`).

## 16.5 Thay đổi so với spec gốc
- §6 ma trận thêm: Nhắn riêng ✅/✅; Sức khoẻ máy chủ ✅/✅ (chi tiết dịch vụ chỉ Quản trị).
- §8.3 "tin nhắn riêng không theo bảng nhóm" vẫn đúng; tin riêng nay theo mục `dm`.
- §9 thanh bên: HỆ THỐNG = Tài khoản Zalo · Nhật ký · Thương hiệu · Sức khoẻ máy chủ.
- §10 bảng sự cố thêm ổ đĩa/RAM/CPU (§16.4.3).
- §5.1 dữ liệu dashboard thêm `health-history.json`, `ai-usage.json`.

## 16.6 Triển khai
- **Plugin Hermes** (chép vào `<hermes-agent>/plugins/…`, khởi động lại gateway): `zalo/adapter.py`, `zalo_tools/group_permissions.py`, `zalo_tools/tools.py`, hai `plugin.yaml`.
- **Kết nối Zalo** (thư mục bot, khởi động lại `zalo-bridge`/tiến trình Windows): `dm-rules.js` (mới), `zalo-policy.js`, `hermes-bridge.js`, `server.js`.
- **Dashboard** (khởi động lại `zalo-dashboard`): xem danh sách ở Task 11 của kế hoạch.
- Thứ tự: cập nhật cả ba phần **trước** khi ai bấm Lưu ở mục Nhắn riêng.

## 16.7 Rủi ro
| Rủi ro | Xử lý |
|---|---|
| Dashboard cũ ghi đè làm rơi mục `dm` | Cập nhật cùng lúc; rơi thì quay về `ZALO_DM_POLICY` (an toàn) |
| Chọn "Mọi người" mà Hermes còn chặn người ngoài | Thông báo vàng `gatewayOpen=false` |
| Mở tin riêng cho người lạ làm tốn lượt AI | Chống nhắn dồn sẵn có vẫn áp; trang Sức khoẻ hiện lượt gọi AI theo ngày |
| `state.db` bị khoá/đổi lược đồ khi nâng Hermes | Đọc lỗi → `error: 'unreadable'`, không ném; có đường lùi bảng `sessions` |
| Thiếu số liệu AI trước ngày cài | Ghi rõ "tính từ …" |
| VPS RAM 3,9 GB, khả dụng ~1,7 GB | Ngưỡng RAM 90 % có thể báo thật; nhắc lại 6 giờ một lần |
