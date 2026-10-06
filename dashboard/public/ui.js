// Phần dùng chung cho mọi màn: htm gắn preact, biểu tượng SVG, định dạng giờ, hộp thông báo.
import { h } from './vendor/preact.mjs';
import htm from './vendor/htm.mjs';

export const html = htm.bind(h);

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm4 17h2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  warn: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4m0 4h.01',
  error: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm3-13-6 6m0-6 6 6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-6v-4m0-4h.01',
  bot: 'M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm-4 6h2m16 0h2m-7-1v2m-6-2v2',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-14v4l3 2',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2m3.45-6.89L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  qr: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h3v3h-3zm4 4h3v3h-3z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  refresh: 'M23 4v6h-6M1 20v-6h6m14.49-5A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15',
  plus: 'M12 5v14m-7-7h14',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zm2 0V7a5 5 0 0 1 10 0v4',
  unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zm2 0V7a5 5 0 0 1 9.9-1',
  key: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};

export function Icon({ name, size = 18 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${PATHS[name] || PATHS.info} /></svg>`;
}

const KIND_ICON = { ok: 'check', warn: 'warn', danger: 'error', info: 'info' };

/** Hộp thông báo có biểu tượng + chữ (không chỉ dựa vào màu). Không tự đọc to — muốn đọc thì đặt trong <Live>. */
export function Notice({ kind = 'info', children }) {
  if (!children) return null;
  return html`<div class=${`notice notice-${kind}`}>
    <${Icon} name=${KIND_ICON[kind]} /><div>${children}</div></div>`;
}

/** Vùng thông báo luôn có mặt trong DOM để trình đọc màn hình bắt được nội dung mới. */
export function Live({ error, ok }) {
  return html`<div aria-live="polite" class="live">
    ${error ? html`<${Notice} kind="danger">${error}<//>` : null}
    ${ok ? html`<${Notice} kind="ok">${ok}<//>` : null}
  </div>`;
}

const fmt = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
export const fmtTime = (ms) => (ms ? fmt.format(new Date(ms)) : 'Chưa có');

export const roleLabel = (role) => (role === 'admin' ? 'Quản trị' : 'Chủ bot');

export function Spinner({ label = 'Đang tải…' }) {
  return html`<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${label}</div>`;
}

export function PageHead({ title, sub }) {
  return html`<header class="page-head"><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : null}</header>`;
}
