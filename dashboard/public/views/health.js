// Sức khoẻ máy chủ (spec §16.B): CPU/RAM/ổ đĩa/thời gian chạy, biểu đồ 24 giờ (SVG dựng bằng htm,
// hợp CSP), trạng thái dịch vụ, lượt gọi AI theo ngày. Tự làm mới mỗi 30 giây.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Notice, PageHead, Spinner, fmtTime } from '../ui.js';

const REFRESH_MS = 30_000;
const W = 600;
const H = 120;
const DAY_MS = 24 * 3600_000;
const nf = new Intl.NumberFormat('vi-VN');
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
export const fmtNum = (n) => (n == null ? '—' : nf.format(n));
export const fmtPct = (n) => (n == null ? 'Chưa đo được' : `${nf1.format(n)}%`);

/** "3 tuần 2 ngày", "5 giờ 12 phút", "45 phút". */
export function fmtUptime(sec) {
  const m = Math.floor((Number(sec) || 0) / 60);
  const d = Math.floor(m / 1440);
  if (d >= 7) return `${Math.floor(d / 7)} tuần${d % 7 ? ` ${d % 7} ngày` : ''}`;
  if (d >= 1) return `${d} ngày${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)} giờ` : ''}`;
  if (m >= 60) return `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
  return `${m} phút`;
}

/** Mức màu của một số đo: dưới 75 % ổn, 75–90 % chú ý, trên 90 % nguy. */
export function level(v) {
  if (v == null) return 'idle';
  if (v > 90) return 'danger';
  return v >= 75 ? 'warn' : 'ok';
}

/**
 * Các đoạn đường `points="x,y …"` cho một cột số đo (1 = CPU, 2 = RAM, 3 = ổ đĩa) trong khung 24 giờ đến `to`.
 * Ngắt đoạn khi thiếu số đo hoặc hai điểm cách nhau hơn 2 bước (dashboard tắt) — không vẽ đường giả.
 */
export function chartSegments(points, col, { to, stepMs = 60_000 } = {}) {
  const from = to - DAY_MS;
  const segs = [];
  let cur = [];
  let prevT = null;
  for (const p of points || []) {
    const t = p[0];
    const v = p[col];
    if (t < from || t > to) continue;
    if (v == null || (prevT != null && t - prevT > 2 * stepMs)) { if (cur.length) segs.push(cur); cur = []; }
    if (v != null) {
      const x = ((t - from) / DAY_MS) * W;
      const y = H - (Math.min(100, Math.max(0, v)) / 100) * H;
      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    prevT = t;
  }
  if (cur.length) segs.push(cur);
  // Một điểm lẻ không vẽ được đường — nhân đôi để thành một chấm ngắn.
  return segs.map((s) => (s.length === 1 ? [s[0], s[0]] : s).join(' '));
}

/** Cao nhất trong 24 giờ của một cột, bỏ số đo thiếu. */
export function peak(points, col) {
  const vals = (points || []).map((p) => p[col]).filter((v) => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

export function serviceBadge(state) {
  return {
    up: { kind: 'ok', text: 'Đang chạy' },
    down: { kind: 'danger', text: 'Đã dừng' },
    starting: { kind: 'warn', text: 'Đang khởi động' },
    missing: { kind: 'idle', text: 'Không có trên máy này' },
  }[state] || { kind: 'idle', text: 'Không rõ' };
}

/** 14 ngày gần nhất, mới trước. */
export const usageRows = (usage) => [...(usage?.days || [])].reverse().slice(0, 14);

/** Dưới chừng này ngày số liệu AI thì chỉ hiện thẻ số, chưa vẽ biểu đồ + bảng. */
export const USAGE_CHART_MIN = 4;

/** Số giờ đã có số đo trong 24 giờ đến `to` (null khi chưa có điểm nào). */
export function historyHours(points, to) {
  const ts = (points || []).map((p) => p[0]).filter((t) => t >= to - DAY_MS && t <= to);
  return ts.length ? Math.floor((to - Math.min(...ts)) / 3600_000) : null;
}

/** Ghi chú "Mới có dữ liệu N giờ" khi lịch sử chưa đủ 24 giờ; đủ rồi → null. */
export function historyNote(points, to) {
  const h = historyHours(points, to);
  if (h == null || h >= 23) return null;
  return h < 1 ? 'Mới có dữ liệu chưa tới 1 giờ — biểu đồ đầy dần trong 24 giờ.' : `Mới có dữ liệu ${h} giờ — biểu đồ đầy dần trong 24 giờ.`;
}

const ALERT_NAME = { disk: 'Ổ đĩa', ram: 'RAM', cpu: 'CPU' };
const ADMIN_HINT = {
  disk: 'Dọn bớt tệp (bản sao lưu, nhật ký cũ) hoặc tăng dung lượng ổ.',
  ram: 'Khởi động lại dịch vụ ngốn bộ nhớ hoặc nâng RAM.',
  cpu: 'Kiểm tra tiến trình đang chạy nặng.',
};

/** Bước tiếp theo trên dải cảnh báo: Quản trị theo từng loại; Chủ bot báo người cài đặt. */
export const alertHint = (kind, role) => (role === 'admin' ? ADMIN_HINT[kind] || 'Kiểm tra máy chủ.' : 'Báo người cài đặt nếu kéo dài.');

/**
 * Dải cảnh báo của một sự cố đang mở. Chưa báo Telegram (đang đếm thời gian) → vàng "Đang theo dõi";
 * đã báo → đỏ. Cả hai nói rõ lúc nào hết cảnh báo (xuống dưới ngưỡng tắt).
 */
export function alertBanner(a, role, { on = 90, off = 85, at = fmtTime } = {}) {
  const name = ALERT_NAME[a.kind] || a.kind;
  const tail = `hết cảnh báo khi xuống dưới ${off} %.`;
  if (!a.alerted) return { kind: 'warn', text: `Đang theo dõi: ${name} cao (≥ ${on} %) từ ${at(a.since)}. Chưa báo Telegram; ${tail}` };
  return { kind: 'danger', text: `${name} cao (≥ ${on} %) từ ${at(a.since)} — đã báo Telegram; ${tail} ${alertHint(a.kind, role)}` };
}

const hhmm = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * Ghi chú của thẻ Dùng AI. Chưa có số nào → cảnh báo vàng (thiếu/không đọc được dữ liệu trợ lý);
 * đã có số lưu mà lần đọc mới lỗi → một dòng xám, vẫn hiện số đã lưu.
 */
export function usageNote(usage, rows) {
  if (!usage?.error) return null;
  if (!rows.length) {
    return {
      kind: 'warn',
      text: usage.error === 'missing'
        ? 'Chưa tìm thấy dữ liệu của trợ lý trên máy này — số liệu sẽ hiện khi trợ lý đã chạy.'
        : 'Tạm thời chưa đọc được dữ liệu của trợ lý — dashboard sẽ thử lại sau ít phút.',
    };
  }
  const at = usage.errorAt ? ` lúc ${hhmm.format(new Date(usage.errorAt))}` : '';
  return { kind: 'muted', text: `Không đọc được số mới${at} — đang hiện số đã lưu. Dashboard sẽ thử lại sau ít phút.` };
}

/** Nhãn trục bằng chữ HTML (không co giãn theo SVG). */
const Axis = ({ labels }) => html`<div class="chart-axis" aria-hidden="true">${labels.map((l, i) => html`<span key=${i}>${l}</span>`)}</div>`;
const YAxis = () => html`<div class="chart-y" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>`;

function Chart({ title, points, col, to, limit, now }) {
  const segs = chartSegments(points, col, { to });
  const y = (v) => H - (v / 100) * H;
  const top = peak(points, col);
  return html`<figure class="chart-box">
    <figcaption><strong>${title}</strong> <span class="muted small">${now != null ? `hiện ${fmtPct(now)}` : ''}${top != null ? ` · cao nhất ${fmtPct(top)}` : ''}</span></figcaption>
    <div class="chart-plot"><${YAxis} /><div class="chart-main">
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label=${`${title} 24 giờ qua${now != null ? `: hiện ${fmtPct(now)}` : ''}${top != null ? `, cao nhất ${fmtPct(top)}` : ''}`}>
      <line class="chart-grid" x1="0" x2=${W} y1=${y(100)} y2=${y(100)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${y(50)} y2=${y(50)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
      <line class="chart-limit" x1="0" x2=${W} y1=${y(limit)} y2=${y(limit)} />
      ${segs.map((s, i) => html`<polyline key=${i} class="chart-line" points=${s} />`)}
    </svg>
    <${Axis} labels=${['24 giờ trước', '12 giờ trước', 'Bây giờ']} />
    </div></div>
    ${segs.length ? null : html`<p class="muted small">Chưa có số đo — biểu đồ hiện sau vài phút.</p>`}
  </figure>`;
}

function Tile({ icon, title, value, sub, kind }) {
  return html`<section class="card stat">
    <div class="stat-head"><span class="stat-icon" aria-hidden="true"><${Icon} name=${icon} /></span><h2>${title}</h2></div>
    <p class=${`stat-value stat-${kind}`}>${value}</p>
    ${sub ? html`<p class="muted small">${sub}</p>` : null}
  </section>`;
}

function UsageBars({ rows }) {
  const days = [...rows].reverse();
  const max = Math.max(1, ...days.map((d) => d.calls));
  const bw = W / Math.max(days.length, 1);
  const dm = (d) => d.date.slice(5).split('-').reverse().join('/');
  const top = days.reduce((a, d) => (d.calls > a.calls ? d : a), days[0]);
  return html`<div class="chart-box chart-bars">
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label=${`Số lượt gọi AI mỗi ngày, ${days.length} ngày gần nhất${top ? `; nhiều nhất ${fmtNum(top.calls)} lượt ngày ${dm(top)}` : ''}`}>
      <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
      ${days.map((d, i) => {
        const h = (d.calls / max) * (H - 4);
        return html`<rect key=${d.date} class="chart-bar" x=${(i * bw + bw * 0.15).toFixed(1)} y=${(H - h).toFixed(1)}
          width=${(bw * 0.7).toFixed(1)} height=${h.toFixed(1)}><title>${d.date}: ${fmtNum(d.calls)} lượt</title></rect>`;
      })}
    </svg>
    ${days.length ? html`<${Axis} labels=${days.length > 1 ? [dm(days[0]), dm(days.at(-1))] : [dm(days[0])]} />` : null}
  </div>`;
}

function Usage({ usage }) {
  const rows = usageRows(usage);
  const note = usageNote(usage, rows);
  return html`<section class="card">
    <h2>Dùng AI theo ngày</h2>
    <p class="muted small">Chỉ đếm lượt gọi và token, chưa tính tiền — cổng AI không báo giá đáng tin cho riêng bot này. Tính cho toàn bộ trợ lý (Zalo, việc hẹn giờ và các kênh khác), theo giờ Việt Nam${usage?.since ? `, từ ${fmtTime(usage.since)}` : ''}.</p>
    ${note?.kind === 'warn' ? html`<${Notice} kind="warn">${note.text}<//>` : null}
    ${note?.kind === 'muted' ? html`<p class="muted small">${note.text}</p>` : null}
    ${rows.length && rows.length < USAGE_CHART_MIN ? html`
      <p class="muted small">Mới có dữ liệu ${rows.length} ngày — biểu đồ và bảng hiện khi đủ ${USAGE_CHART_MIN} ngày.</p>
      <div class="usage-days">${rows.map((d) => html`<div class="usage-day" key=${d.date}>
        <p class="muted small">${d.date.split('-').reverse().join('/')}${d.includesGap ? ' (gồm cả khoảng dashboard tắt)' : ''}</p>
        <p class="stat-value">${fmtNum(d.calls)}</p><p class="muted small">lượt gọi AI</p>
        <p class="small">Token gửi đi ${fmtNum(d.input)} · nhận về ${fmtNum(d.output)} · dùng lại ${fmtNum(d.cached)}</p>
      </div>`)}</div>`
    : rows.length ? html`
      <${UsageBars} rows=${rows} />
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>Ngày</th><th>Lượt gọi AI</th><th>Token gửi đi</th><th>Token nhận về</th><th class="th-wrap">Token dùng lại từ bộ nhớ đệm</th></tr></thead>
        <tbody>${rows.map((d) => html`<tr key=${d.date}>
          <td data-label="Ngày">${d.date.split('-').reverse().join('/')}${d.includesGap ? html`<small class="muted"> (gồm cả khoảng dashboard tắt)</small>` : null}</td>
          <td data-label="Lượt gọi AI">${fmtNum(d.calls)}</td>
          <td data-label="Token gửi đi">${fmtNum(d.input)}</td>
          <td data-label="Token nhận về">${fmtNum(d.output)}</td>
          <td data-label="Token dùng lại từ bộ nhớ đệm">${fmtNum(d.cached)}</td>
        </tr>`)}</tbody>
      </table></div>`
    : note ? null : html`<p class="muted">Chưa có số liệu — số đầu tiên hiện sau khoảng 5–10 phút.</p>`}
  </section>`;
}

export function Health({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let timer = null;
    const load = async () => {
      try { const r = await api('/api/server-health'); if (alive) { setData(r); setError(''); } } catch (err) {
        if (alive && err.status !== 401) setError(err.message);
      } finally { if (alive) timer = setTimeout(load, REFRESH_MS); }
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const head = html`<${PageHead} title="Sức khoẻ máy chủ"
    sub="Cập nhật mỗi phút. Cảnh báo Telegram khi ổ đĩa đầy trên 90 %, RAM trên 90 % suốt 5 phút, hoặc CPU bận trên 90 % suốt 10 phút." />`;
  if (!data) return html`${head}${error ? html`<${Notice} kind="danger">${error}<//>` : html`<${Spinner} />`}`;

  const h = data.host;
  const to = h?.at || Date.now();
  const points = data.history?.points || [];
  return html`${head}
    ${error ? html`<${Notice} kind="warn">Không cập nhật được: ${error} Đang hiện số đo lần trước.<//>` : null}
    ${(data.alerts || []).map((a) => { const b = alertBanner(a, me.role, { on: data.threshold?.on, off: data.threshold?.off }); return html`<${Notice} key=${a.kind} kind=${b.kind}>${b.text}<//>`; })}
    ${h ? html`<div class="grid grid-4">
      <${Tile} icon="activity" title="CPU" value=${fmtPct(h.cpuPct)} kind=${level(h.cpuPct)} sub=${`${h.cores} nhân`} />
      <${Tile} icon="server" title="RAM" value=${fmtPct(h.ramPct)} kind=${level(h.ramPct)}
        sub=${`${nf1.format(h.ramUsedMb / 1024)} / ${nf1.format(h.ramTotalMb / 1024)} GB`} />
      <${Tile} icon="disk" title="Ổ đĩa" value=${fmtPct(h.diskPct)} kind=${level(h.diskPct)}
        sub=${h.diskTotalGb != null ? `${nf1.format(h.diskUsedGb)} / ${nf1.format(h.diskTotalGb)} GB` : 'Không đọc được ổ đĩa chứa dữ liệu bot'} />
      <${Tile} icon="clock" title="Đã chạy liên tục" value=${fmtUptime(h.uptimeSec)} kind="ok" sub="Kể từ lần khởi động máy gần nhất" />
    </div>` : html`<${Notice} kind="info">Đang đo lần đầu — số liệu hiện sau ít giây.<//>`}
    <section class="card">
      <h2>24 giờ qua</h2>
      <p class="muted small">Đường đứt đỏ là ngưỡng cảnh báo ${data.threshold?.on ?? 90} %. Khoảng trống là lúc dashboard không chạy.</p>
      ${historyNote(points, to) ? html`<p class="muted small">${historyNote(points, to)}</p>` : null}
      <div class="charts">
        <${Chart} title="CPU" points=${points} col=${1} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.cpuPct} />
        <${Chart} title="RAM" points=${points} col=${2} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.ramPct} />
        <${Chart} title="Ổ đĩa" points=${points} col=${3} to=${to} limit=${data.threshold?.on ?? 90} now=${h?.diskPct} />
      </div>
    </section>
    <section class="card">
      <h2>Dịch vụ</h2>
      ${data.servicesError ? html`<${Notice} kind="warn">Chưa đọc được trạng thái dịch vụ — thử tải lại trang sau ít phút.<//>` : null}
      <ul class="list svc-list">${(data.services || []).map((s) => {
        const b = serviceBadge(s.state);
        return html`<li key=${s.id}><span class="svc-main"><span>${s.label}</span>
          ${s.detail ? html`<small class="mono muted">${s.detail}</small>` : null}</span>
          <span class=${`badge badge-${b.kind} push`}>${b.text}</span></li>`;
      })}</ul>
    </section>
    <${Usage} usage=${data.usage} />`;
}
