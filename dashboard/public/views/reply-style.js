// Cấu hình › Phong cách trả lời: xưng hô, giọng, độ dài, emoji, màu chữ, tên tệp — cài đặt chứ không phải trí nhớ.
// Plugin đọc lại tệp mỗi lượt nên lưu là có hiệu lực ngay. Giới hạn khớp dashboard/lib/reply-style.js.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, SaveBar, Spinner } from '../ui.js';

export const STYLE_OPTIONS = {
  tone: [['friendly', 'Thân thiện, tự nhiên'], ['playful', 'Vui vẻ, dí dỏm'], ['formal', 'Trang trọng, lịch sự']],
  length: [['short', 'Ngắn gọn'], ['medium', 'Vừa phải'], ['detailed', 'Chi tiết']],
  emoji: [['none', 'Không dùng'], ['few', 'Ít, vừa đủ'], ['many', 'Thoải mái']],
  color_level: [['none', 'Không tô màu'], ['few', 'Ít (1–2 chỗ mỗi tin)'], ['normal', 'Vừa (2–5 chỗ mỗi tin)']],
  file_name: [['name_time', 'Tên_20261012-153000.docx'], ['name_date', 'Tên_20261012.docx'], ['name', 'Chỉ tên: Tên.docx']],
};
export const COLOR_LABELS = { red: 'Đỏ', green: 'Xanh', orange: 'Cam', yellow: 'Vàng' };
const TEXTS = [
  ['self_name', 'Bot tự xưng', 20, 'vd. em, mình, tớ'],
  ['owner_name', 'Gọi chủ nhân', 30, 'vd. sếp, anh, cô'],
  ['others_name', 'Gọi người khác', 30, 'vd. anh/chị, thầy cô, bạn'],
];

/** Mục đã đổi so với bản đã lưu. */
export function styleChanges(saved, draft) {
  return Object.fromEntries(Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k])).map((k) => [k, draft[k]]));
}

function Select({ id, label, value, options, onChange }) {
  return html`<div class="field"><label for=${id}>${label}</label>
    <select id=${id} value=${value} onChange=${(e) => onChange(e.currentTarget.value)}>
      ${options.map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
    </select></div>`;
}

export function ReplyStyle() {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const take = (style) => { setSaved(style); setDraft(style); };
  useEffect(() => { api('/api/admin/reply-style').then((r) => take(r.style)).catch((e) => setMsg({ error: e.message })); }, []);
  const set = (key) => (value) => setDraft({ ...draft, [key]: value });
  const head = html`<h2>Phong cách trả lời</h2>
    <p class="muted small">Cách bot nói chuyện — là <strong>cài đặt</strong>, không chiếm chỗ trí nhớ. Lưu là có hiệu lực ngay từ tin kế tiếp, ở mọi cuộc trò chuyện. Chủ nhân dặn bot qua Zalo ("trả lời ngắn thôi", "gọi anh là sếp") thì bot cũng tự đổi ở đây.</p>`;
  if (!draft) return html`<section class="card">${head}<${Live} error=${msg.error} />${msg.error ? null : html`<${Spinner} />`}</section>`;
  const changes = styleChanges(saved, draft);
  const count = Object.keys(changes).length;
  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg({});
    try { take((await api('/api/admin/reply-style', { method: 'PUT', body: { values: changes } })).style); setMsg({ ok: 'Đã lưu — bot dùng ngay từ tin kế tiếp.' }); } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  const toggleColor = (c) => set('colors')(draft.colors.includes(c) ? draft.colors.filter((x) => x !== c) : [...draft.colors, c]);
  return html`<form class="card" onSubmit=${save} novalidate>${head}
    <fieldset class="mem-block"><legend><h3>Xưng hô và giọng điệu</h3></legend>
      <div class="grid grid-3">${TEXTS.map(([k, label, max, ph]) => html`<div class="field" key=${k}><label for=${`rs-${k}`}>${label}</label>
        <input id=${`rs-${k}`} maxlength=${max} placeholder=${ph} value=${draft[k]} onInput=${(e) => set(k)(e.currentTarget.value)} /></div>`)}</div>
      <div class="grid grid-3">
        <${Select} id="rs-tone" label="Giọng điệu" value=${draft.tone} options=${STYLE_OPTIONS.tone} onChange=${set('tone')} />
        <${Select} id="rs-length" label="Độ dài trả lời" value=${draft.length} options=${STYLE_OPTIONS.length} onChange=${set('length')} />
        <${Select} id="rs-emoji" label="Emoji" value=${draft.emoji} options=${STYLE_OPTIONS.emoji} onChange=${set('emoji')} />
      </div>
    </fieldset>
    <fieldset class="mem-block"><legend><h3>Màu chữ</h3></legend>
      <${Select} id="rs-color-level" label="Mức tô màu" value=${draft.color_level} options=${STYLE_OPTIONS.color_level} onChange=${set('color_level')} />
      <div class="field" role="group" aria-label="Màu được dùng"><span class="rs-label">Màu được dùng</span>
        <div class="rs-colors">${Object.entries(COLOR_LABELS).map(([c, label]) => html`<label key=${c} class=${`rs-color rs-${c}`}>
          <input type="checkbox" checked=${draft.colors.includes(c)} disabled=${draft.color_level === 'none'} onChange=${() => toggleColor(c)} /> ${label}</label>`)}</div>
      </div>
    </fieldset>
    <fieldset class="mem-block"><legend><h3>Tệp gửi đi</h3></legend>
      <${Select} id="rs-file" label="Mẫu tên tệp bot tạo" value=${draft.file_name} options=${STYLE_OPTIONS.file_name} onChange=${set('file_name')} />
    </fieldset>
    <fieldset class="mem-block"><legend><h3>Dặn thêm</h3></legend>
      <div class="field"><label for="rs-extra">Lưu ý riêng về cách trả lời (không bắt buộc)</label>
        <textarea id="rs-extra" rows="3" maxlength="500" placeholder="vd. Trả lời phụ huynh thì lễ phép, không đùa." value=${draft.extra} onInput=${(e) => set('extra')(e.currentTarget.value)}></textarea>
        <small class="muted">${draft.extra.length}/500 ký tự. Chỉ ghi cách trả lời — thông tin (link, giá…) để ở trang Trí nhớ.</small></div>
    </fieldset>
    <${SaveBar} count=${count} busy=${busy} canSave=${count > 0} onUndo=${() => setDraft(saved)} msg=${msg} />
  </form>`;
}
