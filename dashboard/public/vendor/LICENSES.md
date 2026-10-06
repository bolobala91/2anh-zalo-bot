# Thư viện nhúng sẵn

Các tệp dưới đây được lấy nguyên từ gói npm bằng `npm pack` (không khai báo trong
`package.json`) để dashboard chạy không cần Internet và không cần bước build.

| Tệp | Gói npm | Phiên bản | Tệp gốc trong gói | Giấy phép |
|---|---|---|---|---|
| `preact.mjs` | `preact` | 10.29.8 | `dist/preact.module.js` | MIT — xem `LICENSE-preact` |
| `hooks.mjs` | `preact` | 10.29.8 | `hooks/dist/hooks.module.js` | MIT — xem `LICENSE-preact` |
| `htm.mjs` | `htm` | 3.1.1 | `dist/htm.module.js` | Apache-2.0 — xem `LICENSE-htm` |

Thay đổi duy nhất: trong `hooks.mjs`, `from "preact"` được đổi thành
`from "./preact.mjs"` để trình duyệt nạp được mà không cần importmap.

Nguồn: https://github.com/preactjs/preact · https://github.com/developit/htm
