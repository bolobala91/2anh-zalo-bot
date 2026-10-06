import { useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner, fmtTime } from '../ui.js';

function StatCard({ icon, title, kind, state, children }) {
  const badge = { ok: 'check', warn: 'warn', danger: 'error', idle: 'info' }[kind];
  return html`<section class="card stat">
    <div class="stat-head"><span class="stat-icon" aria-hidden="true"><${Icon} name=${icon} /></span><h2>${title}</h2></div>
    <p class=${`badge badge-${kind}`}><${Icon} name=${badge} size=${16} /> ${state}</p>
    ${children}
  </section>`;
}

export function zaloCard(s) {
  if (s.sidecar === 'down') return { kind: 'danger', state: 'Kết nối Zalo đang tắt — hệ thống sẽ tự bật lại trong ít phút' };
  if (s.zalo.needsRelogin) return { kind: 'danger', state: 'Bị đăng xuất — cần quét QR lại', qr: true };
  if (s.zalo.status === 'logged-in' && s.zalo.listener != null && s.zalo.listener !== 'connected') {
    return { kind: 'warn', state: 'Đang nối lại… — tạm thời chưa nhận được tin nhắn' };
  }
  if (s.zalo.status === 'logged-in') return { kind: 'ok', state: `Đang hoạt động — ${s.zalo.displayName || 'bot Zalo'}` };
  return { kind: 'danger', state: 'Chưa đăng nhập — cần quét QR', qr: true };
}

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

export function Overview({ me, status: s }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  if (!s) return html`<${PageHead} title="Tổng quan" /><${Spinner} />`;

  async function restart() {
    if (!confirm('Khởi động lại trợ lý? Bot sẽ tạm ngừng trả lời trong khoảng một phút.')) return;
    setBusy(true); setMsg({});
    try {
      await api('/api/admin/restart-assistant', { method: 'POST' });
      setMsg({ ok: 'Đã gửi lệnh khởi động lại — đợi khoảng một phút rồi xem lại thẻ Trợ lý.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const z = zaloCard(s);
  const down = s.sidecar === 'down';
  const assistant = down ? { kind: 'idle', state: 'Chưa rõ — đang chờ kết nối Zalo bật lại' }
    : s.assistant === 'connected' ? { kind: 'ok', state: 'Đang kết nối — sẵn sàng trả lời' }
      : { kind: 'warn', state: 'Trợ lý chưa phản hồi — báo người cài đặt' };

  return html`
    <${PageHead} title="Tổng quan" sub="Tình trạng bot Zalo, cập nhật mỗi 3 giây." />
    <div class="grid grid-3">
      <${StatCard} icon="phone" title="Zalo" kind=${z.kind} state=${z.state}>
        ${z.qr ? html`<a class="btn btn-primary btn-sm" href="#/zalo"><${Icon} name="qr" size=${16} /> Quét mã đăng nhập lại</a>` : null}
      <//>
      <${StatCard} icon="bot" title="Trợ lý" kind=${assistant.kind} state=${assistant.state}>
        ${me.role === 'admin' && !down && s.assistant !== 'connected' ? html`
          <button class="btn btn-secondary btn-sm" disabled=${busy} onClick=${restart}><${Icon} name="refresh" size=${16} />
            ${busy ? 'Đang gửi lệnh…' : 'Khởi động lại trợ lý'}</button>` : null}
        <${Live} error=${msg.error} ok=${msg.ok} />
      <//>
      <${StatCard} icon="bell" title="Cảnh báo Telegram" kind=${s.telegramLinked ? 'ok' : 'warn'}
        state=${s.telegramLinked ? 'Đã nối — bạn sẽ nhận tin khi bot gặp sự cố' : 'Chưa nối — bạn chưa nhận được cảnh báo'}>
        ${s.telegramLinked ? null : html`<a class="btn btn-secondary btn-sm" href="#/profile">Nối Telegram của tôi</a>`}
      <//>
    </div>
    <div class="grid grid-2">
      <section class="card">
        <h2>Hoạt động gần đây</h2>
        <dl class="facts">
          <div><dt><${Icon} name="inbox" size=${16} /> Nhận tin lần cuối</dt><dd>${fmtTime(s.traffic.lastInboundAtMs)}</dd></div>
          <div><dt><${Icon} name="send" size=${16} /> Gửi lần cuối</dt><dd>${fmtTime(s.traffic.lastOutboundAtMs)}</dd></div>
        </dl>
      </section>
      <section class="card">
        <h2>Lỗi gần nhất</h2>
        ${s.lastError ? html`
          <p class="badge badge-warn"><${Icon} name="warn" size=${16} /> ${fmtTime(s.lastError.atMs)}</p>
          <p class="error-text">${s.lastError.message || 'Không có mô tả'}</p>
          <p class="muted small">Nếu lỗi này lặp lại hoặc bot ngừng trả lời, hãy báo người cài đặt kèm thời điểm trên.</p>`
        : html`<p class="badge badge-ok"><${Icon} name="check" size=${16} /> Không có lỗi nào gần đây</p>`}
      </section>
      <${TodayCard} today=${s.today} />
    </div>`;
}
