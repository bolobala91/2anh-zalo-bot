// Cách gọi bot (Phân quyền Bot): từ khoá CHỦ NHÂN dùng để gọi bot trong nhóm mà không cần tag. Có hiệu lực ngay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, SaveBar, Spinner } from '../ui.js';

const norm = (t) => String(t ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const keyOf = (w) => `${w.at}\u0000${w.text}`;
export const AT_LABEL = { start: 'Ở đầu tin', any: 'Ở bất kỳ đâu trong tin' };

/** Câu có gọi bot theo danh sách không (giống plugin call_words.matches). Trả từ khoá khớp hoặc null. */
export function matchWord(text, words) {
  const low = norm(text);
  return words.find((w) => (w.at === 'start' ? low === w.text || low.startsWith(`${w.text} `) : low.includes(w.text))) || null;
}

/** Số khác biệt giữa bản nháp và bản đã lưu (thêm + bớt). */
export const wordsDiff = (a, b) => {
  const A = new Set(a.map(keyOf)); const B = new Set(b.map(keyOf));
  return [...A].filter((k) => !B.has(k)).length + [...B].filter((k) => !A.has(k)).length;
};

export function CallWordsEditor({ onBack, onDirty }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState([]);
  const [text, setText] = useState('');
  const [at, setAt] = useState('any');
  const [trial, setTrial] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const take = (r) => { setData(r); setDraft(r.words); };
  useEffect(() => { api('/api/call-words').then(take).catch((e) => setMsg({ error: e.message })); }, []);
  const count = data ? wordsDiff(draft, data.words) : 0;
  useEffect(() => { onDirty?.(count > 0); }, [count]);

  function add(e) {
    e.preventDefault();
    const t = norm(text);
    if (!t) return;
    if (t.length > 40) { setMsg({ error: 'Từ khoá tối đa 40 ký tự.' }); return; }
    if (draft.some((w) => w.text === t && w.at === at)) { setMsg({ error: 'Đã có từ khoá này.' }); return; }
    setDraft([...draft, { text: t, at }]); setText(''); setMsg({});
  }
  const remove = (w) => setDraft(draft.filter((x) => keyOf(x) !== keyOf(w)));
  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({});
    try { take(await api('/api/call-words', { method: 'PUT', body: { words: draft } })); setMsg({ ok: 'Đã lưu — có hiệu lực ngay từ tin tiếp theo.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  async function reset() {
    if (!confirm('Dùng lại cách gọi mặc định theo tên bot? Các từ khoá đã thêm sẽ mất.')) return;
    setBusy(true); setMsg({});
    try { take(await api('/api/call-words', { method: 'DELETE' })); setMsg({ ok: 'Đã quay về mặc định theo tên bot.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const head = html`<header class="thread-head">
    <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
    <h2>Cách gọi bot</h2>
  </header>`;
  if (!data) return html`${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}`;
  const hit = trial.trim() ? matchWord(trial, draft) : undefined;
  const bot = data.botName || 'bot';
  return html`<form class="perm-form" onSubmit=${save} novalidate>
    ${head}
    <p class="muted small perm-note">Trong nhóm, <strong>chủ nhân</strong> gọi bot bằng các từ khoá dưới đây là bot trả lời, không cần tag. Người khác vẫn phải tag (@${bot}, @bot hoặc bắt đầu bằng “bot …”). Viết hoa hay thường đều được; muốn nhận cả kiểu gõ không dấu thì thêm cả bản không dấu.</p>
    <p class="small">${data.custom ? html`<span class="badge badge-ok">Đã tuỳ chỉnh</span>` : html`<span class="badge badge-idle">Mặc định theo tên bot “${data.botName || '…'}”</span>`}
      ${data.custom ? html` <button type="button" class="btn btn-ghost btn-sm" disabled=${busy} onClick=${reset}>Khôi phục mặc định</button>` : null}</p>
    ${['start', 'any'].map((kind) => {
      const list = draft.filter((w) => w.at === kind);
      return html`<fieldset key=${kind} class="perm-box">
        <legend>${AT_LABEL[kind]} <small class="muted">${list.length}</small></legend>
        <p class="muted small">${kind === 'start' ? 'Tin bắt đầu bằng từ khoá (vd. “Tiêu tra giá vàng”) hoặc chỉ gồm từ khoá.' : 'Từ khoá nằm ở bất kỳ chỗ nào trong tin (vd. “… Tiêu ơi giúp anh”).'}</p>
        ${list.length ? html`<ul class="word-chips">${list.map((w) => html`<li key=${keyOf(w)} class="word-chip"><span>${w.text}</span>
          <button type="button" class="word-x" aria-label=${`Xoá từ khoá ${w.text}`} onClick=${() => remove(w)}><${Icon} name="close" size=${14} /></button></li>`)}</ul>`
          : html`<p class="muted small">Chưa có từ khoá nào.</p>`}
      </fieldset>`;
    })}
    <fieldset class="perm-box">
      <legend>Thêm từ khoá</legend>
      <div class="word-add">
        <label class="sr-only" for="cw-text">Từ khoá</label>
        <input id="cw-text" value=${text} maxlength="40" placeholder="vd. sếp gọi, em ơi, trợ lý ơi" onInput=${(e) => setText(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') add(e); }} />
        <label class="sr-only" for="cw-at">Vị trí</label>
        <select id="cw-at" value=${at} onChange=${(e) => setAt(e.currentTarget.value)}>
          <option value="any">Ở bất kỳ đâu</option><option value="start">Ở đầu tin</option></select>
        <button type="button" class="btn btn-secondary" onClick=${add} disabled=${!text.trim()}><${Icon} name="plus" size=${16} /> Thêm</button>
      </div>
    </fieldset>
    <fieldset class="perm-box">
      <legend>Thử một câu</legend>
      <input value=${trial} placeholder="Gõ thử câu chủ nhân hay nhắn trong nhóm…" aria-label="Câu thử" onInput=${(e) => setTrial(e.currentTarget.value)} />
      ${hit === undefined ? null : hit
        ? html`<p class="ai-result is-ok">Bot sẽ trả lời — khớp từ khoá “${hit.text}” (${AT_LABEL[hit.at].toLowerCase()}).</p>`
        : html`<p class="ai-result is-bad">Bot sẽ không trả lời (trừ khi chủ nhân tag bot).</p>`}
    </fieldset>
    <${SaveBar} count=${count} busy=${busy} canSave=${count > 0} onUndo=${() => setDraft(data.words)} idle="Chưa có thay đổi." msg=${msg} />
  </form>`;
}
