// Tạo ảnh & video (Khoá API & Model, chỉ Quản trị): một khoá Stali cho ảnh + video; nguồn vẽ ảnh Stali / 9router /
// ChatGPT xếp ưu tiên (bật/tắt, đổi model, Thử, Vẽ thử) — lỗi thì bot tự sang nguồn bật kế; video Stali (model, độ dài).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Spinner } from '../ui.js';
import { KeyDialog, resultText } from './ai.js';

const LABELS = { stali: 'Stali', '9router': '9router', codex: 'ChatGPT (Codex)' };
const NOTES = {
  stali: 'GPT Image 2 — 1.000đ/ảnh, sửa ảnh theo ảnh mẫu.',
  '9router': 'Model ảnh qua cổng AI của bot (9router).',
  codex: 'Ảnh qua tài khoản ChatGPT đã đăng nhập trên máy chủ.',
};
const vnd = (n) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;

/** Nguồn hiện trên trang: ChatGPT chỉ hiện ở máy đã đăng nhập Codex (hoặc đang bật sẵn). */
export function visibleEngines(engines, ready) {
  return engines.filter((e) => e.id !== 'codex' || ready.codex);
}

/** Đổi chỗ nguồn `id` với nguồn hiện kế trên/dưới (bỏ qua nguồn ẩn). Trả danh sách mới. */
export function moveEngine(engines, ready, id, dir) {
  const shown = visibleEngines(engines, ready).map((e) => e.id);
  const i = shown.indexOf(id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= shown.length) return engines;
  const a = engines.findIndex((e) => e.id === shown[i]);
  const b = engines.findIndex((e) => e.id === shown[j]);
  const next = [...engines];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Nhãn vai trò: nguồn bật + sẵn sàng đầu tiên là "Đang dùng", các nguồn bật sau là "Dự phòng N". */
export function engineRoles(engines, ready) {
  let n = 0;
  return Object.fromEntries(visibleEngines(engines, ready).map((e) => {
    if (!e.enabled) return [e.id, { kind: 'idle', text: 'Đang tắt' }];
    if (!ready[e.id]) return [e.id, { kind: 'warn', text: e.id === 'stali' ? 'Chưa có khoá' : 'Chưa sẵn sàng' }];
    n += 1;
    return [e.id, n === 1 ? { kind: 'ok', text: 'Đang dùng' } : { kind: 'idle', text: `Dự phòng ${n - 1}` }];
  }));
}

export function Media({ onRestart }) {
  const [data, setData] = useState(null);
  const [keyRow, setKeyRow] = useState(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState({});
  const [edit, setEdit] = useState(null);      // { id, value, options }
  const [msg, setMsg] = useState({});
  const loadKey = () => api('/api/admin/ai/keys').then((r) => setKeyRow(r.keys.find((k) => k.key === 'STALI_API_KEY') || null)).catch(() => {});
  useEffect(() => { api('/api/admin/ai/media').then(setData).catch((e) => setMsg({ error: e.message })); loadKey(); }, []);

  async function save(settings, okText) {
    setBusy('save'); setMsg({});
    try { const r = await api('/api/admin/ai/media', { method: 'PUT', body: { settings } }); setData(r); setMsg({ ok: okText }); onRestart(); } catch (e) { setMsg({ error: e.message }); } finally { setBusy(''); }
  }
  async function run(id, path, body) {
    setBusy(id); setResults((r) => ({ ...r, [id]: null }));
    try { const r = await api(path, { method: 'POST', body }); setResults((x) => ({ ...x, [id]: r.result })); } catch (e) { setResults((x) => ({ ...x, [id]: { ok: false, detail: e.message } })); } finally { setBusy(''); }
  }
  async function openEdit(e) {
    setEdit({ id: e.id, value: e.model, options: [] });
    try { const r = await api(`/api/admin/ai/media/models/${encodeURIComponent(e.id)}`); setEdit((cur) => (cur?.id === e.id ? { ...cur, options: r.models } : cur)); } catch { /* gõ tay vẫn được */ }
  }
  if (!data) return html`<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const { settings, ready, refLink, videoModels } = data;
  const engines = settings.image.engines;
  const shown = visibleEngines(engines, ready);
  const roles = engineRoles(engines, ready);
  const setEngines = (next, text) => save({ ...settings, image: { engines: next } }, text);
  const patch = (id, change) => engines.map((e) => (e.id === id ? { ...e, ...change } : e));
  const video = settings.video;
  const vm = videoModels[video.model];
  const setVideo = (change, text) => save({ ...settings, video: { ...video, ...change } }, text);
  const disabled = busy !== '';

  return html`<${Live} error=${msg.error} ok=${msg.ok} />
    <section class="media-key">
      <h3>Khoá Stali — một khoá cho cả ảnh và video</h3>
      <p class="small">Chỉ cần dán khoá Stali là bot <strong>tạo ảnh, sửa ảnh theo ảnh mẫu và tạo video</strong> được ngay. Ảnh 1.000đ/ảnh, video từ 2.200đ.</p>
      <div class="media-key-row">
        <span class=${`badge ${keyRow?.set ? 'badge-ok' : 'badge-idle'}`}>${keyRow?.set ? `Đã đặt ${keyRow.hint}` : 'Chưa có khoá'}</span>
        ${keyRow ? html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => setDialog(true)}>${keyRow.set ? 'Quản lý khoá' : 'Dán khoá Stali'}</button>` : null}
        ${keyRow?.set ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${disabled} onClick=${() => run('key', '/api/admin/ai/media/test', { kind: 'image', engine: 'stali' })}>${busy === 'key' ? 'Đang kiểm…' : 'Kiểm tra'}</button>` : null}
      </div>
      ${results.key ? html`<p class=${`ai-result ${results.key.ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(results.key)}</p>` : null}
      ${keyRow?.set ? null : html`<p class="small">Chưa có khoá? <a href=${refLink} target="_blank" rel="noopener">Đăng ký Stali</a> → nạp tiền → vào <em>Dashboard › Keys</em> tạo khoá (dạng <span class="mono">sk-stali-…</span>) → bấm "Dán khoá Stali" ở trên.</p>`}
    </section>

    <h3>Nguồn vẽ ảnh</h3>
    <p class="muted small">Bot vẽ bằng nguồn <strong>Đang dùng</strong>; nguồn đó lỗi (khoá sai, hết tiền, quá tải…) thì tự chuyển sang nguồn dự phòng kế tiếp. Áp dụng cho ảnh khi nhờ bot vẽ trên Zalo và ảnh minh hoạ slide/tài liệu của 2Anh Studio. "Thử" chỉ kiểm khoá và model (không tốn tiền); "Vẽ thử" vẽ thật một ảnh.</p>
    <ol class="key-pool media-engines">${shown.map((e, i) => html`<li key=${e.id} class="key-entry">
      <span class="key-main">
        <strong>${LABELS[e.id]}</strong>
        <span class=${`badge badge-${roles[e.id].kind}`}>${roles[e.id].text}</span>
        <small class="muted media-note">${NOTES[e.id]} Model: <span class="mono">${e.model}</span></small>
      </span>
      <span class="key-actions">
        <label class="media-switch"><input type="checkbox" checked=${e.enabled} disabled=${disabled}
          onChange=${(ev) => setEngines(patch(e.id, { enabled: ev.currentTarget.checked }), ev.currentTarget.checked ? `Đã bật ${LABELS[e.id]}.` : `Đã tắt ${LABELS[e.id]}.`)} /> Bật</label>
        <button type="button" class="btn btn-ghost btn-sm" aria-label=${`Ưu tiên ${LABELS[e.id]} hơn`} disabled=${disabled || i === 0} onClick=${() => setEngines(moveEngine(engines, ready, e.id, -1), 'Đã đổi thứ tự ưu tiên.')}>↑</button>
        <button type="button" class="btn btn-ghost btn-sm" aria-label=${`Hạ ưu tiên ${LABELS[e.id]}`} disabled=${disabled || i === shown.length - 1} onClick=${() => setEngines(moveEngine(engines, ready, e.id, 1), 'Đã đổi thứ tự ưu tiên.')}>↓</button>
        ${e.id === 'codex' ? null : html`<button type="button" class="btn btn-secondary btn-sm" disabled=${disabled} onClick=${() => openEdit(e)}>Đổi model</button>`}
        <button type="button" class="btn btn-secondary btn-sm" disabled=${disabled} onClick=${() => run(e.id, '/api/admin/ai/media/test', { kind: 'image', engine: e.id })}>${busy === e.id ? 'Đang thử…' : 'Thử'}</button>
        ${e.id === 'codex' ? null : html`<button type="button" class="btn btn-secondary btn-sm" disabled=${disabled || !ready[e.id]}
          onClick=${() => confirm(e.id === 'stali' ? 'Vẽ thử một ảnh bằng Stali (trừ 1.000đ)?' : 'Vẽ thử một ảnh bằng 9router?') && run(`draw-${e.id}`, '/api/admin/ai/media/draw', { engine: e.id })}>${busy === `draw-${e.id}` ? 'Đang vẽ…' : 'Vẽ thử'}</button>`}
      </span>
      ${edit?.id === e.id ? html`<form class="media-edit row-full" onSubmit=${(ev) => { ev.preventDefault(); const v = edit.value.trim(); setEdit(null); if (v && v !== e.model) setEngines(patch(e.id, { model: v }), `Đã đổi model ${LABELS[e.id]} sang ${v}.`); }}>
        <label class="sr-only" for=${`m-${e.id}`}>Model ${LABELS[e.id]}</label>
        <input id=${`m-${e.id}`} class="mono" list=${`ml-${e.id}`} value=${edit.value} maxlength="120" onInput=${(ev) => setEdit({ ...edit, value: ev.currentTarget.value })} />
        <datalist id=${`ml-${e.id}`}>${edit.options.map((m) => html`<option key=${m} value=${m} />`)}</datalist>
        <button class="btn btn-primary btn-sm">Lưu</button>
        <button type="button" class="btn btn-ghost btn-sm" onClick=${() => setEdit(null)}>Huỷ</button>
        <small class="muted row-full">${edit.options.length ? `${edit.options.length} model lấy từ ${LABELS[e.id]} — gõ để lọc, hoặc gõ tên khác.` : 'Gõ tên model.'}</small>
      </form>` : null}
      ${results[e.id] ? html`<p class=${`ai-result row-full ${results[e.id].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(results[e.id])}</p>` : null}
      ${results[`draw-${e.id}`] ? html`<div class="row-full"><p class=${`ai-result ${results[`draw-${e.id}`].ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(results[`draw-${e.id}`])}</p>
        ${results[`draw-${e.id}`].image ? html`<img class="media-preview" src=${results[`draw-${e.id}`].image} alt="Ảnh vẽ thử" />` : null}</div>` : null}
    </li>`)}</ol>

    <h3>Tạo video (Stali)</h3>
    <div class="gen-video">
      <label class="rs-toggle"><input type="checkbox" checked=${video.enabled} disabled=${disabled} onChange=${(ev) => setVideo({ enabled: ev.currentTarget.checked }, ev.currentTarget.checked ? 'Đã bật tạo video.' : 'Đã tắt tạo video.')} />
        <span>Cho bot tạo video khi chủ nhân nhờ <small class="muted">— từ mô tả, hoặc lấy ảnh gửi kèm làm khung hình đầu. Mỗi video mất khoảng 1–5 phút.</small></span></label>
      <div class="gen-video-row">
        <label class="field"><span>Model</span>
          <select value=${video.model} disabled=${disabled || !video.enabled} onChange=${(ev) => setVideo({ model: ev.currentTarget.value }, 'Đã đổi model video.')}>
            ${Object.entries(videoModels).map(([id, m]) => html`<option key=${id} value=${id}>${m.label} — từ ${vnd(m.price[m.seconds[0]])}</option>`)}
          </select></label>
        <label class="field"><span>Độ dài mặc định</span>
          <select value=${String(video.seconds)} disabled=${disabled || !video.enabled} onChange=${(ev) => setVideo({ seconds: Number(ev.currentTarget.value) }, 'Đã đổi độ dài video.')}>
            ${vm.seconds.map((s) => html`<option key=${s} value=${String(s)}>${s} giây — ${vnd(vm.price[s])}</option>`)}
          </select></label>
        <button type="button" class="btn btn-secondary btn-sm" disabled=${disabled || !ready.stali} onClick=${() => run('video', '/api/admin/ai/media/test', { kind: 'video' })}>${busy === 'video' ? 'Đang thử…' : 'Thử'}</button>
      </div>
      ${ready.stali ? null : html`<p class="muted small">Cần khoá Stali ở trên để tạo video.</p>`}
      ${results.video ? html`<p class=${`ai-result ${results.video.ok ? 'is-ok' : 'is-bad'}`} role="status">${resultText(results.video)}</p>` : null}
    </div>
    <p class="muted small"><${Icon} name="info" size=${14} /> Chỉ chủ nhân (và người được cấp quyền) nhờ được vẽ ảnh, tạo video — vì tốn tiền. Đổi nguồn hay model có hiệu lực ngay; lần đầu bật cần khởi động lại trợ lý.</p>
    ${dialog && keyRow ? html`<${KeyDialog} row=${keyRow} available=${[]} onClose=${() => setDialog(false)}
      onSaved=${(r, text, keepOpen) => { setKeyRow(r.keys?.find((k) => k.key === 'STALI_API_KEY') || keyRow); if (!keepOpen) setDialog(false); setMsg({ ok: text }); onRestart();
        api('/api/admin/ai/media').then(setData).catch(() => {}); }} />` : null}`;
}
