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

const ALERT_TEXT = { disk: 'Ổ đĩa đang trên 90 %', ram: 'RAM đang trên 90 %', cpu: 'CPU đang bận trên 90 %' };

function Chart({ title, points, col, to, limit, now }) {
  const segs = chartSegments(points, col, { to });
  const y = (v) => H - (v / 100) * H;
  const top = peak(points, col);
  return html`<figure class="chart-box">
    <figcaption><strong>${title}</strong> <span class="muted small">${now != null ? `hiện ${fmtPct(now)}` : ''}${top != null ? ` · cao nhất ${fmtPct(top)}` : ''}</span></figcaption>
    <svg class="chart" viewBox=${`0 0 ${W} ${H + 18}`} role="img"
      aria-label=${`${title} 24 giờ qua${now != null ? `: hiện ${fmtPct(now)}` : ''}${top != null ? `, cao nhất ${fmtPct(top)}` : ''}`}>
      <line class="chart-grid" x1="0" x2=${W} y1=${y(100)} y2=${y(100)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${y(50)} y2=${y(50)} />
      <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
      <line class="chart-limit" x1="0" x2=${W} y1=${y(limit)} y2=${y(limit)} />
      ${segs.map((s, i) => html`<polyline key=${i} class="chart-line" points=${s} />`)}
      <text class="chart-axis" x="0" y=${H + 14}>24 giờ trước</text>
      <text class="chart-axis" x=${W / 2} y=${H + 14} text-anchor="middle">12 giờ trước</text>
      <text class="chart-axis" x=${W} y=${H + 14} text-anchor="end">Bây giờ</text>
    </svg>
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
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H + 18}`} role="img" aria-label="Số lượt gọi AI mỗi ngày">
    <line class="chart-grid" x1="0" x2=${W} y1=${H} y2=${H} />
    ${days.map((d, i) => {
      const h = (d.calls / max) * (H - 4);
      return html`<rect key=${d.date} class="chart-bar" x=${(i * bw + bw * 0.15).toFixed(1)} y=${(H - h).toFixed(1)}
        width=${(bw * 0.7).toFixed(1)} height=${h.toFixed(1)}><title>${d.date}: ${fmtNum(d.calls)} lượt</title></rect>`;
    })}
    ${days.length ? html`<text class="chart-axis" x="0" y=${H + 14}>${days[0].date.slice(5).split('-').reverse().join('/')}</text>
      <text class="chart-axis" x=${W} y=${H + 14} text-anchor="end">${days.at(-1).date.slice(5).split('-').reverse().join('/')}</text>` : null}
  </svg>`;
}

function Usage({ usage }) {
  const rows = usageRows(usage);
  const note = usage?.error === 'missing'
    ? 'Chưa tìm thấy dữ liệu của trợ lý trên máy này — số liệu sẽ hiện khi trợ lý đã chạy.'
    : usage?.error === 'unreadable' ? 'Tạm thời chưa đọc được dữ liệu của trợ lý — dashboard sẽ thử lại sau ít phút.' : null;
  return html`<section class="card">
    <h2>Dùng AI theo ngày</h2>
    <p class="muted small">Toàn bộ trợ lý (Zalo, việc hẹn giờ và các kênh khác), theo giờ Việt Nam${usage?.since ? `, tính từ ${fmtTime(usage.since)}` : ''}. Chưa có chi phí bằng tiền: cổng AI không báo giá đáng tin cho riêng bot này.</p>
    ${note ? html`<${Notice} kind="warn">${note}<//>` : null}
    ${rows.length ? html`
      <${UsageBars} rows=${rows} />
      <div class="table-wrap"><table class="table table-cards">
        <thead><tr><th>Ngày</th><th>Lượt gọi AI</th><th>Token gửi đi</th><th>Token nhận về</th><th class="th-wrap">Token dùng lại từ bộ nhớ đệm</th></tr></thead>
        <tbody>${rows.map((d) => html`<tr key=${d.date}>
          <td data-label="Ngày">${d.date.split('-').reverse().join('/')}</td>
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
    ${(data.alerts || []).map((a) => html`<${Notice} key=${a.kind} kind="danger">${ALERT_TEXT[a.kind]} từ ${fmtTime(a.since)}${a.alerted ? ' — đã báo Telegram.' : '.'} ${me.role === 'admin' ? 'Kiểm tra máy chủ hoặc dọn bớt tệp.' : 'Báo người cài đặt nếu kéo dài.'}<//>`)}
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
