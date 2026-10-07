import { render } from './vendor/preact.mjs';
import { useEffect, useState } from './vendor/hooks.mjs';
import { api } from './api.js';
import { html } from './ui.js';
import { Login } from './views/login.js';
import { Setup } from './views/setup.js';
import { Shell } from './views/shell.js';

const DEFAULT_BRAND = { name: 'Dashboard Zalo', poweredBy: true, logoUrl: null };
const pickBrand = (r) => ({ name: String(r?.name || DEFAULT_BRAND.name), poweredBy: r?.poweredBy !== false, logoUrl: r?.logoUrl || null });
const route = () => location.hash.replace(/^#/, '') || '/';

/** Tải lại /brand.css sau khi đổi màu (đổi ?v= để trình duyệt không dùng bản cũ). */
function reloadBrandCss() {
  const link = document.getElementById('brand-css');
  if (link) link.href = `brand.css?v=${Date.now()}`;
}

function App() {
  const [path, setPath] = useState(route());
  const [me, setMe] = useState(undefined); // undefined = đang tải, null = chưa đăng nhập
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  useEffect(() => {
    const onHash = () => setPath(route());
    const onLogout = () => setMe(null);
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

  if (path.startsWith('/setup/')) {
    return html`<${Setup} brand=${brand} token=${path.slice(7)}
      onDone=${(u) => { setMe(u); location.replace('#/'); }} />`;
  }
  if (me === undefined) return html`<div class="center muted"><span class="spinner" aria-hidden="true"></span> Đang tải…</div>`;
  if (!me) {
    // Giữ trang người dùng mở lúc đầu (vd. #/zalo từ link cảnh báo Telegram); chỉ #/login mới về Tổng quan.
    return html`<${Login} brand=${brand} onDone=${() => api('/api/me').then((r) => {
      setMe(r.user);
      if (route() === '/login') location.hash = '#/';
    })} />`;
  }
  return html`<${Shell} me=${me} brand=${brand} path=${path === '/login' ? '/' : path} />`;
}

render(html`<${App} />`, document.getElementById('app'));
