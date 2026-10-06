// Nhật ký (spec §9): lúc nào · ai · làm gì · ở đâu · kết quả; lọc "chỉ lỗi". Quản trị thấy thêm mã kỹ thuật.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, PageHead, Spinner, fmtTime } from '../ui.js';

export function codeText(code) {
  if (!code) return '';
  return Object.entries(code).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(' · ');
}

export function Audit({ me }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const gen = useRef(0); // đổi bộ lọc/làm mới → bỏ trang "Xem cũ hơn" còn đang về của danh sách cũ
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
  else if (!items.length) body = error ? null : html`<p class="muted">${failedOnly ? 'Không có lỗi nào.' : 'Chưa có hoạt động nào được ghi lại.'}</p>`;
  else {
    body = html`
      <div class="table-wrap"><table class="table audit-table">
        <thead><tr><th scope="col">Lúc nào</th><th scope="col">Ai</th><th scope="col">Làm gì</th><th scope="col">Ở đâu</th><th scope="col">Kết quả</th></tr></thead>
        <tbody>${items.map((it, i) => html`<tr key=${`${it.at}-${i}`}>
          <td>${fmtTime(it.at)}</td>
          <td>${it.who}</td>
          <td>${it.what}${admin && it.code ? html`<div class="mono muted small">${codeText(it.code)}</div>` : null}</td>
          <td>${it.where}</td>
          <td><span class=${`badge ${it.ok ? 'badge-ok' : 'badge-danger'}`}><${Icon} name=${it.ok ? 'check' : 'error'} size=${14} /> ${it.result}</span></td>
        </tr>`)}</tbody>
      </table></div>
      ${next ? html`<button type="button" class="btn btn-secondary btn-sm load-more" disabled=${busy} onClick=${more}>${busy ? 'Đang tải…' : 'Xem cũ hơn'}</button>` : null}`;
  }

  return html`
    <${PageHead} title="Nhật ký" sub="Ai đã làm gì với bot: tin bot gửi, thao tác trên dashboard, và kết quả." />
    <section class="card">
      <div class="toolbar">
        <label class="check"><input type="checkbox" checked=${failedOnly} onChange=${(e) => setFailedOnly(e.currentTarget.checked)} /> Chỉ hiện lỗi</label>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setRound(round + 1)}><${Icon} name="refresh" size=${16} /> Làm mới</button>
      </div>
      <${Live} error=${error} />
      ${body}
    </section>`;
}
