// Nhật ký (spec §9): mỗi mục là một câu dễ hiểu (ai · làm gì · ở đâu), nhóm theo ngày; nhãn đỏ chỉ khi lỗi;
// chip lọc theo loại. Quản trị mở "Chi tiết kỹ thuật" để xem mã. Câu dựng ở trình duyệt từ what/who/where/result.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner } from '../ui.js';

export function codeText(code) {
  if (!code) return '';
  return Object.entries(code).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(' · ');
}

const lcFirst = (s) => (s ? s[0].toLocaleLowerCase('vi') + s.slice(1) : s);

/** Câu tự nhiên cho một mục nhật ký, chỉ từ các trường /api/audit đã trả (what, who, where, source). */
export function auditSentence(it) {
  const what = String(it.what || 'Thao tác khác');
  // Quản trị thấy mã hành động lạ (vd. "foo_bar") thay cho nhãn — giữ nguyên, không hạ chữ.
  const raw = /^[\w.-]+$/.test(what);
  if (it.source === 'dashboard') {
    const who = String(it.who || 'Ai đó').replace(/ \(dashboard\)$/, '');
    const act = raw ? `làm thao tác ${what}` : lcFirst(what);
    return `${who} ${act}${/dashboard/i.test(what) ? '' : ' trên dashboard'}.`;
  }
  const who = String(it.who || '');
  // Nơi trùng tên người yêu cầu → tin nhắn riêng với chính người đó.
  const own = it.where && it.where !== '—' && who.endsWith(` ${it.where}`);
  const where = own ? ' (nhắn riêng)' : it.where && it.where !== '—' ? ` ở ${it.where}` : '';
  let by = '';
  if (who === 'Bot (tự động)') by = ' (bot tự làm)';
  else if (/ \(dashboard\)$/.test(who)) by = `, do ${who.replace(/ \(dashboard\)$/, '')} gửi từ dashboard`;
  else if (who) by = `, theo yêu cầu của ${who}`;
  return `${raw ? `Thao tác ${what}` : what}${where}${by}.`;
}

export const AUDIT_NEXT = 'Nếu lỗi lặp lại, hãy báo người cài đặt kèm thời điểm này.';

const dayKeyFmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabelFmt = (tz) => new Intl.DateTimeFormat('vi-VN', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Nhóm mục theo ngày (mới trước, giữ thứ tự): nhãn "Hôm nay", "Hôm qua" hoặc thứ + ngày. */
export function groupByDay(items, { now = Date.now(), tz } = {}) {
  const key = dayKeyFmt(tz);
  const today = key.format(new Date(now));
  const yesterday = key.format(new Date(now - 86_400_000));
  const out = [];
  for (const it of items) {
    const k = key.format(new Date(it.at));
    let g = out.at(-1);
    if (!g || g.key !== k) {
      const label = k === today ? 'Hôm nay' : k === yesterday ? 'Hôm qua' : dayLabelFmt(tz).format(new Date(it.at));
      g = { key: k, label: label[0].toLocaleUpperCase('vi') + label.slice(1), items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

export const AUDIT_KINDS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'zalo', label: 'Việc của bot' },
  { value: 'dashboard', label: 'Thao tác dashboard' },
  { value: 'failed', label: 'Chỉ lỗi' },
];

/** Lọc theo loại ở trình duyệt; "Chỉ lỗi" lọc ở máy chủ nên ở đây giữ nguyên. */
export const filterKind = (items, kind) => (kind === 'zalo' || kind === 'dashboard' ? items.filter((it) => it.source === kind) : items);

const hhmm = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function Entry({ it, admin }) {
  return html`<li class="audit-item">
    <time class="audit-time" datetime=${new Date(it.at).toISOString()}>${hhmm.format(new Date(it.at))}</time>
    <div class="audit-body">
      <p>${auditSentence(it)}</p>
      ${it.ok ? null : html`<p class="audit-fail"><span class="badge badge-danger"><${Icon} name="error" size=${14} /> ${it.result}</span>
        <span class="muted small">${AUDIT_NEXT}</span></p>`}
      ${admin && it.code ? html`<details class="audit-tech"><summary>Chi tiết kỹ thuật</summary>
        <p class="mono muted small">${codeText(it.code)}</p></details>` : null}
    </div>
  </li>`;
}

export function Audit({ me }) {
  const [kind, setKind] = useState('all');
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const gen = useRef(0); // đổi bộ lọc/làm mới → bỏ trang "Xem cũ hơn" còn đang về của danh sách cũ
  const failedOnly = kind === 'failed';
  const url = (before) => {
    const p = new URLSearchParams();
    if (failedOnly) p.set('status', 'failed');
    if (before) p.set('before', String(before));
    const qs = p.toString(); // không dùng p.size — trình duyệt cũ chưa có
    return `/api/audit${qs ? `?${qs}` : ''}`;
  };

  useEffect(() => {
    let alive = true;
    gen.current += 1;
    setItems(null); setError(''); setBusy(false);
    api(url(null))
      .then((r) => { if (alive) { setItems(r.items); setNext(r.nextBefore); } })
      .catch((err) => { if (alive) { setItems([]); setNext(null); setError(err.message); } });
    return () => { alive = false; };
  }, [failedOnly, round]);

  async function more() {
    if (busy || !next) return;
    const my = gen.current;
    setBusy(true); setError('');
    try {
      const r = await api(url(next));
      if (my !== gen.current) return;
      setItems((cur) => [...(cur || []), ...r.items]); setNext(r.nextBefore);
    } catch (err) {
      if (my === gen.current) setError(err.message);
    } finally {
      if (my === gen.current) setBusy(false);
    }
  }

  const admin = me.role === 'admin';
  let body;
  if (items === null) body = html`<${Spinner} />`;
  else {
    const shown = filterKind(items, kind);
    body = html`
      ${shown.length ? groupByDay(shown).map((g) => html`<section class="audit-day" key=${g.key}>
        <h2 class="audit-day-head">${g.label}</h2>
        <ol class="audit-list">${g.items.map((it, i) => html`<${Entry} key=${`${it.at}-${i}`} it=${it} admin=${admin} />`)}</ol>
      </section>`) : error ? null : html`<p class="muted">${failedOnly ? 'Không có lỗi nào.'
        : next ? 'Trang này chưa có mục nào thuộc loại đã chọn — bấm "Xem cũ hơn" để tìm tiếp.' : 'Chưa có hoạt động nào được ghi lại.'}</p>`}
      ${next ? html`<button type="button" class="btn btn-secondary btn-sm load-more" disabled=${busy} onClick=${more}>${busy ? 'Đang tải…' : 'Xem cũ hơn'}</button>` : null}`;
  }

  return html`
    <${PageHead} title="Nhật ký" sub="Ai đã làm gì với bot: tin bot gửi, thao tác trên dashboard, và kết quả." />
    <section class="card">
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Lọc theo loại">
          ${AUDIT_KINDS.map((k) => html`<button type="button" key=${k.value} class="btn btn-secondary btn-sm chip"
            aria-pressed=${kind === k.value ? 'true' : 'false'} onClick=${() => setKind(k.value)}>${k.label}</button>`)}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setRound(round + 1)}><${Icon} name="refresh" size=${16} /> Làm mới</button>
      </div>
      <${Live} error=${error} />
      ${body}
    </section>`;
}
