// Tổng quan (kiểu macOS): mỗi thẻ một màu — ô biểu tượng + tiêu đề màu, nhãn nhỏ, số lớn, 3 chỉ số phụ, biểu đồ chấm.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner, fmtTime } from '../ui.js';
import { fmtUptime } from './health.js';

export function zaloCard(s) {
  if (s.sidecar === 'down') return { kind: 'danger', state: 'Kết nối Zalo đang tắt — hệ thống sẽ tự bật lại trong ít phút' };
  if (s.zalo.needsRelogin) return { kind: 'danger', state: 'Bị đăng xuất — cần quét QR lại', qr: true };
  if (s.zalo.status === 'logged-in' && s.zalo.listener != null && s.zalo.listener !== 'connected') {
    return { kind: 'warn', state: 'Đang nối lại… — tạm thời chưa nhận được tin nhắn' };
  }
  if (s.zalo.status === 'logged-in') return { kind: 'ok', state: `Đang hoạt động — ${s.zalo.displayName || 'bot Zalo'}` };
  return { kind: 'danger', state: 'Chưa đăng nhập — cần quét QR', qr: true };
}

// Mã lỗi runtime-health của bot → câu dễ hiểu + bước tiếp theo. Mã lạ dùng câu chung.
const ERRORS = {
  zalo_listener_closed: ['Kết nối nhận tin Zalo bị ngắt.', 'Bot thường tự nối lại sau ít phút. Nếu thanh trên cùng báo mất kết nối, hãy quét mã đăng nhập lại.'],
  bridge_command_failed: ['Bot chưa làm được một việc trên Zalo (gửi tin hoặc thao tác nhóm).', 'Thường do Zalo từ chối hoặc mạng chập chờn — xem Nhật ký, chọn "Chỉ lỗi" để biết việc nào.'],
  system_notice_failed: ['Bot chưa gửi được một tin thông báo.', 'Xem Nhật ký, chọn "Chỉ lỗi" để biết tin nào; nếu lặp lại hãy báo người cài đặt.'],
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

const ROWS = 4;
/**
 * Biểu đồ chấm: mỗi cột một giá trị, số chấm sáng (từ dưới lên, 0–4) tỉ lệ với giá trị/max. Giá trị > 0 luôn sáng ít nhất 1 chấm.
 * Trả mảng cột, mỗi cột ROWS cờ từ trên xuống.
 */
export function dotColumns(values, max = Math.max(1, ...values)) {
  return values.map((v) => {
    const lit = v > 0 ? Math.max(1, Math.min(ROWS, Math.round((v / max) * ROWS))) : 0;
    return Array.from({ length: ROWS }, (_, i) => ROWS - i <= lit);
  });
}

/** Gộp chuỗi số đo thành `n` cột (trung bình mỗi nhóm) — biểu đồ chấm không quá dày trên điện thoại. */
export function bucket(values, n) {
  if (values.length <= n) return values;
  const size = values.length / n;
  return Array.from({ length: n }, (_, i) => {
    const part = values.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    return part.length ? part.reduce((a, b) => a + b, 0) / part.length : 0;
  });
}

function Dots({ values, max, label }) {
  return html`<div class="dots" role="img" aria-label=${label}>
    ${dotColumns(values, max).flatMap((col, c) => col.map((on, r) => html`<span key=${`${c}-${r}`} class=${on ? 'dot on' : 'dot'}></span>`))}
  </div>`;
}

const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const hhmm = (ms) => (ms ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(ms)) : '—');
const todayVN = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

function Metric({ tint, icon, title, href, label, big, unit, text = false, pill, facts = [], children }) {
  const body = html`
    <div class="metric-head"><span class=${`nav-ico tint-${tint}`} aria-hidden="true"><${Icon} name=${icon} size=${18} /></span>
      <h2 class="metric-title">${title}</h2>${href ? html`<span class="metric-go" aria-hidden="true"><${Icon} name="next" size=${18} /></span>` : null}</div>
    ${label ? html`<p class="metric-label">${label}</p>` : null}
    <div class=${`metric-big${text ? ' is-text' : ''}`}><span>${big}</span>${unit ? html`<small>${unit}</small>` : null}
      ${pill ? html`<span class=${`metric-pill is-${pill.kind}`}>${pill.kind === 'ok' ? '' : '! '}${pill.text}</span>` : null}</div>
    ${facts.length ? html`<dl class="metric-facts">${facts.map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd title=${String(v)}>${v}</dd></div>`)}</dl>` : null}
    ${children}`;
  return href
    ? html`<a class=${`card metric tint-${tint}`} href=${href}>${body}</a>`
    : html`<section class=${`card metric tint-${tint}`}>${body}</section>`;
}

/** Số đo máy chủ (CPU 60 phút, RAM, ổ đĩa) và lượt gọi AI theo ngày — hỏi lại mỗi phút. */
function useServer() {
  const [h, setH] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/api/server-health').then((r) => alive && setH(r)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return h;
}

export function Overview({ me, status: s }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const server = useServer();
  if (!s) return html`<${PageHead} title="Tổng quan" /><${Spinner} />`;

  async function restart() {
    if (!confirm('Khởi động lại trợ lý? Bot sẽ tạm ngừng trả lời trong khoảng một phút.')) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/admin/restart-assistant', { method: 'POST' });
      if (r.sidecarFailed) setMsg({ error: r.warning });
      else setMsg({ ok: 'Đã gửi lệnh khởi động lại — đợi khoảng một phút rồi xem lại thẻ Trợ lý.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const admin = me.role === 'admin';
  const z = zaloCard(s);
  const down = s.sidecar === 'down';
  const err = s.lastError ? errorText(s.lastError, me.role) : null;
  const today = s.today;
  const host = server?.host || null;
  const cpu = (server?.history?.points || []).slice(-60).map((p) => Number(p[1]) || 0);
  const hot = host && Math.max(host.cpuPct, host.ramPct, host.diskPct) >= 85;
  const days = server?.usage?.days || [];
  const aiToday = days.find((d) => d.date === todayVN());
  const assistantOk = !down && s.assistant === 'connected';
  const groups = today?.topGroups || [];
  const topMax = Math.max(1, ...groups.map((g) => g.count));

  return html`
    <${PageHead} title="Tổng quan" sub="Tình trạng bot Zalo, cập nhật mỗi 3 giây." />
    <div class="grid grid-3">
      <${Metric} tint="cyan" icon="phone" title="Zalo" href="#/zalo" label="Tài khoản bot" text
        big=${s.zalo.displayName || (z.kind === 'ok' ? 'Bot Zalo' : 'Chưa đăng nhập')}
        pill=${{ kind: z.kind, text: z.kind === 'ok' ? 'Đang chạy' : z.kind === 'warn' ? 'Đang nối lại' : 'Mất kết nối' }}
        facts=${[['Nhận lần cuối', hhmm(s.traffic.lastInboundAtMs)], ['Gửi lần cuối', hhmm(s.traffic.lastOutboundAtMs)], ['Cảnh báo', s.telegramLinked ? 'Đã nối' : 'Chưa nối']]}>
        ${z.kind !== 'ok' ? html`<p class="muted small">${z.state}</p>` : null}
      <//>
      <${Metric} tint="blue" icon="chat" title="Tin nhắn hôm nay" href="#/chats" label="Bot nhận và gửi"
        big=${today ? (today.received + today.sent).toLocaleString('vi-VN') : '—'} unit="tin"
        facts=${[['Bot nhận', today?.received ?? '—'], ['Bot gửi', today?.sent ?? '—'], ['Nhóm sôi nổi', groups[0]?.name || '—']]}>
        ${today?.hourly ? html`<${Dots} values=${today.hourly} label="Số tin theo từng giờ hôm nay" />` : null}
      <//>
      <${Metric} tint="red" icon="activity" title="Máy chủ" href="#/health" label="CPU lúc này"
        big=${host ? Math.round(host.cpuPct) : '—'} unit=${host ? '%' : ''}
        pill=${hot ? { kind: 'warn', text: 'Cao' } : null}
        facts=${[['RAM', host ? `${Math.round(host.ramPct)}%` : '—'], ['Ổ đĩa', host ? `${Math.round(host.diskPct)}%` : '—'], ['Đã chạy', host ? fmtUptime(host.uptimeSec) : '—']]}>
        ${cpu.length ? html`<${Dots} values=${bucket(cpu, 30)} max=${100} label="CPU 60 phút gần nhất" />` : null}
      <//>
      <${Metric} tint="purple" icon="bot" title="Trợ lý AI" href="#/health" label="Lượt gọi AI hôm nay"
        big=${aiToday ? aiToday.calls.toLocaleString('vi-VN') : '0'} unit="lượt"
        pill=${assistantOk ? null : { kind: down ? 'warn' : 'danger', text: down ? 'Chưa rõ' : 'Chưa phản hồi' }}
        facts=${[['Trạng thái', assistantOk ? 'Sẵn sàng' : down ? 'Chưa rõ' : 'Chưa phản hồi'], ['Chữ vào', aiToday ? compact.format(aiToday.input) : '0'], ['Chữ ra', aiToday ? compact.format(aiToday.output) : '0']]}>
        ${days.length ? html`<${Dots} values=${days.map((d) => d.calls)} label="Lượt gọi AI theo ngày" />` : null}
        ${admin && !down && s.assistant !== 'connected' ? html`
          <button class="btn btn-secondary btn-sm" disabled=${busy} onClick=${(e) => { e.preventDefault(); restart(); }}><${Icon} name="refresh" size=${16} />
            ${busy ? 'Đang gửi lệnh…' : 'Khởi động lại trợ lý'}</button>` : null}
        <${Live} error=${msg.error} ok=${msg.ok} />
      <//>
      <${Metric} tint="orange" icon="warn" title="Lỗi gần nhất" href="#/audit" label=${err ? fmtTime(s.lastError.atMs) : 'Gần đây'} text
        big=${err ? err.text : 'Không có lỗi'} pill=${err ? null : { kind: 'ok', text: 'Ổn định' }}>
        ${err ? html`<p class="muted small">${err.next}</p>${err.code ? html`<p class="muted small">Mã: <span class="mono">${err.code}</span></p>` : null}` : null}
      <//>
      <section class="card metric tint-green">
        <div class="metric-head"><span class="nav-ico tint-green" aria-hidden="true"><${Icon} name="users" size=${18} /></span>
          <h2 class="metric-title">Nhóm sôi nổi hôm nay</h2></div>
        ${groups.length ? html`<ul class="bars">${groups.map((g) => html`<li key=${g.threadId}>
            <div class="bar-top"><span>${g.name}</span><span>${g.count} tin</span></div>
            <div class="bar-track"><div class=${`bar-fill bar-w-${Math.max(1, Math.round((g.count / topMax) * 10))}`}></div></div></li>`)}</ul>`
          : html`<p class="muted small">Hôm nay chưa có nhóm nào nhắn tin.</p>`}
      </section>
    </div>`;
}
