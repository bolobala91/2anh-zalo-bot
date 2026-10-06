import { render } from './vendor/preact.mjs';
import { useEffect, useState } from './vendor/hooks.mjs';
import { api } from './api.js';
import { html } from './ui.js';
import { Login } from './views/login.js';
import { Setup } from './views/setup.js';
import { Shell } from './views/shell.js';

const DEFAULT_BRAND = 'Dashboard Zalo';
const route = () => location.hash.replace(/^#/, '') || '/';

function App() {
  const [path, setPath] = useState(route());
  const [me, setMe] = useState(undefined); // undefined = đang tải, null = chưa đăng nhập
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  useEffect(() => {
    const onHash = () => setPath(route());
    const onLogout = () => setMe(null);
    addEventListener('hashchange', onHash); addEventListener('zd:logout', onLogout);
    api('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
    // Trang Thương hiệu làm ở giai đoạn sau; chưa có thì giữ tên mặc định.
    api('/api/brand').then((r) => { if (r.name) setBrand(String(r.name)); }).catch(() => {});
    return () => { removeEventListener('hashchange', onHash); removeEventListener('zd:logout', onLogout); };
  }, []);
  useEffect(() => { document.title = brand; }, [brand]);

  if (path.startsWith('/setup/')) {
    return html`<${Setup} brand=${brand} token=${path.slice(7)}
      onDone=${(u) => { setMe(u); location.replace('#/'); }} />`;
  }
  if (me === undefined) return html`<div class="center muted"><span class="spinner" aria-hidden="true"></span> Đang tải…</div>`;
  if (!me) {
    return html`<${Login} brand=${brand} onDone=${() => api('/api/me').then((r) => { setMe(r.user); location.hash = '#/'; })} />`;
  }
  return html`<${Shell} me=${me} brand=${brand} path=${path === '/login' ? '/' : path} />`;
}

render(html`<${App} />`, document.getElementById('app'));
