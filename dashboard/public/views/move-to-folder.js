// "Chuyển vào thư mục" dùng chung (Phân quyền › Chọn nhiều nhóm, Người trong thư mục, Liên hệ): chọn thư mục có sẵn
// hoặc "＋ Thư mục mới…" (gõ tên, tạo rồi chuyển luôn). Ai/nhóm nào đang ở thư mục khác thì máy chủ tự chuyển sang.
import { useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live } from '../ui.js';

export const NEW_FOLDER = '__new';

/** Tạo thư mục mới khi chọn "＋ Thư mục mới…" — trả `{ id, state }` (`state`: trạng thái phân quyền sau khi tạo). */
export async function resolveFolder(choice, newName) {
  if (choice !== NEW_FOLDER) return { id: choice, state: null };
  const r = await api('/api/permissions/folders', { method: 'POST', body: { name: newName } });
  return { id: r.created, state: r };
}

/** Thêm nhóm vào thư mục (giữ nhóm đang có). `folders`: danh sách thư mục mới nhất. */
export function addGroupsToFolder(folders, fid, ids) {
  const target = (folders || []).find((f) => f.id === fid);
  const groups = [...new Set([...(target?.groups || []), ...ids])];
  return api(`/api/permissions/folders/${encodeURIComponent(fid)}/members`, { method: 'PUT', body: { groups } });
}

/** Thêm người vào thư mục (người đang ở thư mục khác được chuyển sang). */
export const addPeopleToFolder = (fid, people) => api(`/api/permissions/folders/${encodeURIComponent(fid)}/people/add`, {
  method: 'POST', body: { people: people.map((p) => (p.name ? { uid: p.uid, name: p.name } : { uid: p.uid })) },
});

/**
 * Ô chọn thư mục + nút chuyển. `onMove(fid, created)` thực hiện việc chuyển (created: trạng thái sau khi tạo thư mục
 * mới, hoặc null) và trả thông báo thành công; lỗi ném ra được hiện tại chỗ.
 */
export function MoveToFolder({ id, folders, exclude = null, count, unit = 'người', disabled = false, initial = '', onMove, onDone }) {
  const [choice, setChoice] = useState(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const options = (folders || []).filter((f) => f.id !== exclude);
  const ready = count > 0 && (choice === NEW_FOLDER ? name.trim().length > 0 : options.some((f) => f.id === choice));
  async function go() {
    if (!ready || busy) return;
    setBusy(true); setMsg({});
    try {
      const { id: fid, state } = await resolveFolder(choice, name.trim());
      const ok = await onMove(fid, state);
      setMsg({ ok }); setName('');
      if (choice === NEW_FOLDER) setChoice(fid);
      onDone?.(fid);
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  return html`<div class="move-folder">
    <label class="folder-select" for=${id}><span class="small muted">Chuyển vào</span>
      <select id=${id} value=${choice} disabled=${disabled || busy} onChange=${(e) => { setChoice(e.currentTarget.value); setMsg({}); }}>
        <option value="">Chọn thư mục…</option>
        ${options.map((f) => html`<option key=${f.id} value=${f.id}>${f.name}</option>`)}
        <option value=${NEW_FOLDER}>＋ Thư mục mới…</option>
      </select></label>
    ${choice === NEW_FOLDER ? html`<label for=${`${id}-name`} class="sr-only">Tên thư mục mới</label>
      <input id=${`${id}-name`} maxlength="60" placeholder="Tên thư mục mới, vd. KHKT" value=${name} disabled=${busy}
        onInput=${(e) => { setName(e.currentTarget.value); setMsg({}); }} />` : null}
    <button type="button" class="btn btn-primary btn-sm" disabled=${disabled || busy || !ready} onClick=${go}>
      ${busy ? 'Đang chuyển…' : count ? `Chuyển ${count} ${unit}` : `Tích chọn ${unit} để chuyển`}</button>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </div>`;
}
