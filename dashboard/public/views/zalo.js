import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';

const QR_SECONDS = 60;
const POLL_MS = 1000;
const MAX_AUTO_RESTART = 3;

function QrFlow({ refresh }) {
  // Chỉ một yêu cầu qr/start chạy cùng lúc (đếm ngược và nhánh "idle" của poll có thể cùng gọi).
  const starting = useRef(null);
  const startQr = () => starting.current
    || (starting.current = api('/api/zalo/qr/start', { method: 'POST' }).finally(() => { starting.current = null; }));
  const [qr, setQr] = useState(null);
  const [left, setLeft] = useState(QR_SECONDS);
  const [error, setError] = useState('');
  const [stopped, setStopped] = useState(false);
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0); // tăng để chạy lại vòng poll sau khi dừng

  // Poll /api/zalo/qr mỗi giây; không chồng yêu cầu; dừng khi rời trang.
  useEffect(() => {
    let alive = true; let timer = null; let restarts = 0;
    setStopped(false); setError('');
    const poll = async () => {
      try {
        const q = await api('/api/zalo/qr');
        if (!alive) return;
        setQr(q); setError('');
        if (q.status === 'logged-in') {
          setDone(true); refresh();
          timer = setTimeout(() => { location.hash = '#/'; }, 2000);
          return;
        }
        if (q.status === 'scanned' || q.image) restarts = 0;
        if (q.status === 'idle') { // mã hết hạn hoặc bị từ chối → xin mã mới
          if (++restarts > MAX_AUTO_RESTART) {
            setStopped(true);
            setError('Chưa tạo được mã QR — bấm "Tạo mã mới" để thử lại, nếu vẫn lỗi hãy báo người cài đặt.');
            return;
          }
          await startQr();
        }
      } catch (err) {
        if (alive) setError(err.message);
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    startQr().catch((err) => { if (alive) setError(err.message); }).finally(() => { if (alive) poll(); });
    return () => { alive = false; clearTimeout(timer); };
  }, [round]);

  // Đếm ngược 60 s cho mỗi mã; hết thì xin mã mới.
  useEffect(() => { setLeft(QR_SECONDS); }, [qr?.image]);
  useEffect(() => {
    if (done || stopped || !qr?.image) return undefined;
    const t = setTimeout(() => {
      if (left <= 1) { setLeft(QR_SECONDS); startQr().catch((err) => setError(err.message)); } else setLeft(left - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [left, qr?.image, done, stopped]);

  if (done) {
    return html`<section class="card qr-card">
      <${Live} ok=${`Đăng nhập Zalo thành công${qr?.user?.display_name ? ` — ${qr.user.display_name}` : ''}. Đang chuyển về Tổng quan…`} />
    </section>`;
  }
  const scanned = qr?.status === 'scanned';
  return html`<section class="card qr-card">
    <div class="qr-box">
      ${scanned ? html`<div class="qr-placeholder ok"><${Icon} name="check" size=${40} /><span>Đã quét</span></div>`
        : qr?.image ? html`<img class="qr-img" src=${qr.image} alt="Mã QR đăng nhập Zalo" width="280" height="280" />`
          : html`<div class="qr-placeholder"><span class="spinner" aria-hidden="true"></span><span>Đang tạo mã…</span></div>`}
    </div>
    <div aria-live="polite">
      ${scanned ? html`<p class="qr-state"><strong>Đã quét.</strong> Bấm "Đăng nhập" trên điện thoại để xác nhận.</p>`
        : qr?.image && !stopped ? html`
          <p class="qr-state">Mã còn hiệu lực <strong>${left}</strong> giây</p>
          <progress class="qr-progress" max=${QR_SECONDS} value=${left} aria-hidden="true"></progress>` : null}
    </div>
    <${Live} error=${error} />
    <button class=${stopped ? 'btn btn-primary' : 'btn btn-secondary btn-sm'} onClick=${() => { setQr(null); setRound(round + 1); }}>
      <${Icon} name="refresh" size=${16} /> Tạo mã mới</button>
  </section>`;
}

export function Zalo({ status: s, refresh }) {
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsQr = Boolean(s) && s.sidecar !== 'down' && (s.zalo.status !== 'logged-in' || s.zalo.needsRelogin);
  // Chưa đăng nhập → tự hiện QR ngay; giữ luồng QR sau khi đăng nhập xong để báo thành công rồi chuyển trang.
  useEffect(() => { if (needsQr) setShowQr(true); }, [needsQr]);
  if (!s) return html`<${PageHead} title="Tài khoản Zalo" /><${Spinner} />`;

  async function logout() {
    if (!confirm('Bot sẽ ngừng trả lời tới khi quét QR lại. Tiếp tục?')) return;
    setBusy(true); setError('');
    try { await api('/api/zalo/logout', { method: 'POST' }); refresh(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const head = html`<${PageHead} title="Tài khoản Zalo" sub="Tài khoản Zalo mà bot dùng để nhận và trả lời tin nhắn." />`;
  if (s.sidecar === 'down' && !showQr) {
    return html`${head}<section class="card">
      <${Notice} kind="danger">Kết nối Zalo đang tắt — hệ thống sẽ tự bật lại trong ít phút. Trang này tự cập nhật; nếu quá 5 phút vẫn vậy, hãy báo người cài đặt.<//>
    </section>`;
  }
  const loggedIn = s.zalo.status === 'logged-in' && !s.zalo.needsRelogin;
  if (loggedIn && !showQr) {
    const name = s.zalo.displayName || 'Bot Zalo';
    return html`${head}<section class="card account">
      <span class="avatar avatar-lg" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>
      <div class="account-info">
        <h2>${name}</h2>
        <p class="badge badge-ok"><${Icon} name="check" size=${16} /> Đang hoạt động</p>
      </div>
      <button class="btn btn-danger-outline" disabled=${busy} onClick=${logout}><${Icon} name="logout" size=${16} />
        ${busy ? 'Đang đăng xuất…' : 'Đăng xuất Zalo'}</button>
      <${Live} error=${error} />
    </section>`;
  }
  return html`${head}
    <div class="grid grid-qr">
      <section class="card">
        <h2>Đăng nhập lại bằng mã QR</h2>
        ${s.zalo.needsRelogin ? html`<${Notice} kind="danger">Zalo đã đăng xuất bot — cần quét mã để bot trả lời tin nhắn trở lại.<//>` : null}
        <ol class="steps">
          <li>Mở ứng dụng Zalo trên <strong>điện thoại đang đăng nhập tài khoản Zalo của bot</strong>.</li>
          <li>Bấm biểu tượng quét mã QR (góc trên bên phải).</li>
          <li>Quét mã hiện bên cạnh, rồi bấm <strong>Đăng nhập</strong> trên điện thoại.</li>
        </ol>
        <${Notice} kind="warn">Không mở trang này trên chính điện thoại đó — điện thoại không quét được mã trên màn hình của nó.<//>
      </section>
      <${QrFlow} refresh=${refresh} />
    </div>`;
}
