import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, roleLabel } from '../ui.js';
import { Overview } from './overview.js';
import { Zalo } from './zalo.js';
import { Users } from './users.js';
import { Alerts } from './alerts.js';
import { Profile } from './profile.js';
import { Chats } from './chats.js';
import { Audit } from './audit.js';
import { Permissions } from './permissions.js';

const STATUS_MS = 3000;

const ROUTES = {
  '/': { view: Overview },
  '/chats': { view: Chats },
  '/permissions': { view: Permissions },
  '/zalo': { view: Zalo },
  '/audit': { view: Audit },
  '/users': { view: Users, admin: true },
  '/alerts': { view: Alerts, admin: true },
  '/profile': { view: Profile },
};

const GROUPS = [
  { label: 'Tổng quan', items: [{ path: '/', text: 'Tổng quan', icon: 'home' }] },
  { label: 'Hội thoại', items: [
    { path: '/chats', text: 'Phiên chat', icon: 'chat' },
    { path: '/permissions', text: 'Phân quyền Bot', icon: 'shield' },
  ] },
  { label: 'Hệ thống', items: [
    { path: '/zalo', text: 'Tài khoản Zalo', icon: 'phone' },
    { path: '/audit', text: 'Nhật ký', icon: 'list' },
  ] },
  { label: 'Quản trị', admin: true, items: [
    { path: '/users', text: 'Người dùng', icon: 'users' },
    { path: '/alerts', text: 'Cảnh báo Telegram', icon: 'bell' },
  ] },
];

/** Poll /api/status mỗi 3 s, không chồng yêu cầu; trả kèm hàm làm mới ngay. */
function useStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const kick = useRef(() => {});
  useEffect(() => {
    let alive = true; let timer = null; let inflight = false; let again = false;
    const tick = async () => {
      if (inflight) { again = true; return; }
      clearTimeout(timer); inflight = true;
      try {
        const s = await api('/api/status');
        if (alive) { setStatus(s); setError(''); }
      } catch (err) {
        if (alive && err.status !== 401) setError(err.message);
      } finally {
        inflight = false;
        const next = again ? 0 : STATUS_MS; again = false;
        if (alive) timer = setTimeout(tick, next);
      }
    };
    kick.current = tick;
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return [status, error, () => kick.current()];
}

export function statusLevel(s) {
  if (s.sidecar === 'down') return { kind: 'danger', icon: 'error', text: 'Kết nối Zalo đang tắt — hệ thống sẽ tự bật lại trong ít phút.', qr: true };
  if (s.zalo.needsRelogin || s.zalo.status !== 'logged-in') return { kind: 'danger', icon: 'error', text: 'Bot đang mất kết nối Zalo — cần quét mã đăng nhập lại.', qr: true };
  if (s.zalo.listener != null && s.zalo.listener !== 'connected') {
    return { kind: 'warn', icon: 'warn', text: 'Đang nối lại Zalo… — bot tạm thời chưa nhận được tin nhắn. Nếu quá 10 phút vẫn vậy, hãy quét mã đăng nhập lại.' };
  }
  if (s.assistant !== 'connected') return { kind: 'warn', icon: 'warn', text: 'Trợ lý chưa phản hồi — bot nhận tin nhưng chưa trả lời được. Báo người cài đặt nếu kéo dài.' };
  return { kind: 'ok', icon: 'check', text: `Bot đang hoạt động bình thường${s.zalo.displayName ? ` — ${s.zalo.displayName}` : ''}.` };
}

function StatusStrip({ status, error, path }) {
  let lv;
  if (error) lv = { kind: 'warn', icon: 'warn', text: `Không cập nhật được trạng thái. ${error}` };
  else if (status) lv = statusLevel(status);
  else lv = { kind: 'idle', icon: 'clock', text: 'Đang kiểm tra trạng thái bot…' };
  return html`<div class=${`strip strip-${lv.kind}`} role="status" aria-live="polite">
    <span class="strip-text"><${Icon} name=${lv.icon} /> ${lv.text}</span>
    ${lv.qr && path !== '/zalo' ? html`<a class="btn btn-light btn-sm" href="#/zalo"><${Icon} name="qr" size=${16} /> Quét mã đăng nhập lại</a>` : null}
  </div>`;
}

function Sidebar({ me, brand, path }) {
  const link = (it) => html`<a class=${`nav-item${path === it.path ? ' active' : ''}`} href=${`#${it.path}`}
    aria-current=${path === it.path ? 'page' : undefined}><${Icon} name=${it.icon} /><span>${it.text}</span></a>`;
  return html`<aside class="sidebar">
    <div class="side-brand"><span class="logo" aria-hidden="true"><${Icon} name="bot" size=${20} /></span><span>${brand}</span></div>
    <nav class="nav" aria-label="Điều hướng chính">
      ${GROUPS.filter((g) => !g.admin || me.role === 'admin').map((g) => html`
        <div class="nav-group" role="group" aria-label=${g.label}>
          <div class="nav-label" aria-hidden="true">${g.label}</div>
          ${g.items.map(link)}
        </div>`)}
      <div class="nav-group nav-foot">
        <a class=${`nav-item${path === '/profile' ? ' active' : ''}`} href="#/profile" aria-current=${path === '/profile' ? 'page' : undefined}>
          <span class="avatar avatar-sm" aria-hidden="true">${me.username.slice(0, 1).toUpperCase()}</span>
          <span class="me"><span>Tài khoản của tôi</span><small>${me.username} · ${roleLabel(me.role)}</small></span>
        </a>
      </div>
    </nav>
  </aside>`;
}

function Message({ icon, title, children }) {
  return html`<section class="card empty"><${Icon} name=${icon} size=${32} /><h1>${title}</h1><p class="muted">${children}</p>
    <a class="btn btn-primary" href="#/">Về Tổng quan</a></section>`;
}

export function Shell({ me, brand, path }) {
  const [status, error, refresh] = useStatus();
  const r = ROUTES[path];
  const mainRef = useRef(null);
  useEffect(() => { mainRef.current?.focus(); }, [path]);
  let body;
  if (!r) body = html`<${Message} icon="info" title="Không tìm thấy trang">Đường dẫn này không có trong dashboard.<//>`;
  else if (r.admin && me.role !== 'admin') body = html`<${Message} icon="shield" title="Không có quyền">Trang này chỉ dành cho Quản trị. Nếu cần, hãy nhờ Quản trị làm giúp.<//>`;
  else body = html`<${r.view} me=${me} status=${status} refresh=${refresh} />`;
  return html`<div class="layout">
    <${Sidebar} me=${me} brand=${brand} path=${path} />
    <div class="main-col">
      <${StatusStrip} status=${status} error=${error} path=${path} />
      <main class="content" ref=${mainRef} tabindex="-1">${body}</main>
    </div>
  </div>`;
}
