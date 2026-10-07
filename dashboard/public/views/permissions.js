// Phân quyền Bot (spec §9): trái là "Mặc định" + danh sách nhóm có ô tìm; phải là Hoạt động,
// Chỉ trả lời khi được tag và 9 nút tính năng. Lưu là có hiệu lực ngay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner } from '../ui.js';
import { fold } from '../fold.js';

export const DEFAULTS_KEY = 'defaults';
const pick = (s) => ({ active: s.active, replyOnlyTagged: s.replyOnlyTagged, features: { ...s.features } });

/**
 * Gộp danh sách nhóm của bot với permissions.json: nhóm bot đang ở (theo thứ tự bot trả) trước,
 * rồi nhóm chỉ còn trong tệp (bot đã rời hoặc Zalo đang tắt). Mỗi nhóm mang quyền đang hiệu lực.
 */
export function mergeGroups(groups, perms) {
  const seen = new Set();
  const out = [];
  const add = (id, name, members) => {
    if (seen.has(id)) return;
    seen.add(id);
    const own = perms.groups[id];
    // Mục trong tệp có thể trùng hẳn mặc định (máy chủ ghi rõ cờ tag khi mặc định chưa có) — khi đó không coi là chỉnh riêng.
    const custom = Boolean(own) && !sameSettings(own, perms.defaults);
    out.push({ id, name: name || `Nhóm …${id.slice(-4)}`, members, custom, ...pick(own || perms.defaults) });
  };
  for (const g of groups || []) add(g.id, g.name, g.members);
  for (const [id, g] of Object.entries(perms.groups)) add(id, g.name, null);
  return out;
}

export function sameSettings(a, b) {
  return a.active === b.active && a.replyOnlyTagged === b.replyOnlyTagged
    && Object.keys({ ...a.features, ...b.features }).every((k) => a.features[k] === b.features[k]);
}

/** Nhãn ngắn cạnh tên nhóm trong danh sách; null khi nhóm đang đúng mặc định. */
export function groupBadge(g) {
  if (!g.active) return { kind: 'danger', text: 'Đang tắt' };
  const off = Object.values(g.features).filter((v) => !v).length;
  if (off) return { kind: 'warn', text: `Tắt ${off} tính năng` };
  return g.custom ? { kind: 'idle', text: 'Chỉnh riêng' } : null;
}

function Toggle({ id, checked, onChange, label, hint }) {
  return html`<div class="perm-row">
    <label class="check" for=${id}><input id=${id} type="checkbox" checked=${checked}
      aria-describedby=${hint ? `${id}-hint` : undefined} onChange=${(e) => onChange(e.currentTarget.checked)} />${label}</label>
    ${hint ? html`<small id=${`${id}-hint`} class="muted">${hint}</small>` : null}
  </div>`;
}

function Editor({ target, value, defaults, features, onSaved, onBack }) {
  const isGroup = target.id !== DEFAULTS_KEY;
  const [draft, setDraft] = useState(() => pick(value));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const dirty = !sameSettings(draft, value);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setFeature = (k, v) => { setDraft((d) => ({ ...d, features: { ...d.features, [k]: v } })); setMsg({}); };

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true); setMsg({});
    try {
      const path = isGroup ? `/api/permissions/groups/${encodeURIComponent(target.id)}` : '/api/permissions/defaults';
      const r = await api(path, { method: 'PUT', body: draft });
      onSaved(r);
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const p = `perm-${target.id}`;
  return html`<form onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${target.name}</h2>
      ${isGroup && target.members ? html`<span class="tag">${target.members} thành viên</span>` : null}
    </header>
    <p class="muted small perm-note">${isGroup
      ? 'Chỉ áp cho thành viên trong nhóm này. Chủ nhân bot luôn dùng được mọi tính năng.'
      : 'Áp cho nhóm mới và mọi nhóm chưa chỉnh riêng. Chủ nhân bot luôn dùng được mọi tính năng; tin nhắn riêng không theo bảng này.'}</p>
    <fieldset class="perm-set">
      <legend>Cách bot trả lời</legend>
      <${Toggle} id=${`${p}-active`} checked=${draft.active} onChange=${(v) => set({ active: v })} label="Hoạt động"
        hint="Tắt thì bot không trả lời thành viên trong nhóm (vẫn đọc tin để hiểu ngữ cảnh khi chủ nhân hỏi)." />
      <${Toggle} id=${`${p}-tag`} checked=${draft.replyOnlyTagged} onChange=${(v) => set({ replyOnlyTagged: v })} label="Chỉ trả lời khi được tag"
        hint="Tắt thì bot trả lời mọi tin trong nhóm." />
    </fieldset>
    <fieldset class="perm-set" disabled=${!draft.active}>
      <legend>Tính năng cho thành viên</legend>
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${p}-${f.key}`} checked=${draft.features[f.key]}
        onChange=${(v) => setFeature(f.key, v)} label=${f.label} hint=${f.hint} />`)}
    </fieldset>
    <div class="row">
      <button class="btn btn-primary" disabled=${busy || !dirty}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      ${isGroup ? html`<button type="button" class="btn btn-secondary" disabled=${busy || sameSettings(draft, defaults)}
        onClick=${() => set(pick(defaults))}>Dùng mặc định</button>` : null}
      ${dirty ? html`<small class="muted">Có thay đổi chưa lưu.</small>` : null}
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

export function Permissions() {
  const [perms, setPerms] = useState(null);
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    api('/api/permissions').then((r) => { if (alive) setPerms(r); }, (err) => { if (alive) setError(err.message); });
    // Kết nối Zalo tắt (503) → vẫn liệt kê nhóm đã có trong lịch sử trò chuyện để chỉnh được (quyết định 10).
    api('/api/groups').then((r) => { if (alive) setGroups(r.groups); }, async (err) => {
      if (!alive) return;
      setGroupsError(err.message);
      let known = [];
      try {
        const r = await api('/api/chats');
        known = r.conversations.filter((c) => c.threadType === 1).map((c) => ({ id: String(c.threadId), name: c.name, members: null }));
      } catch { /* chỉ còn nhóm trong tệp */ }
      if (alive) setGroups(known);
    });
    return () => { alive = false; };
  }, []);

  if (error) return html`<${PageHead} title="Phân quyền Bot" /><${Notice} kind="danger">${error}<//>`;
  if (!perms || groups === null) return html`<${PageHead} title="Phân quyền Bot" /><${Spinner} />`;

  const list = mergeGroups(groups, perms);
  const needle = fold(query.trim());
  const shown = list.filter((g) => !needle || fold(g.name).includes(needle));
  const defaultsTarget = { id: DEFAULTS_KEY, name: 'Mặc định cho nhóm mới', members: null, ...pick(perms.defaults) };
  const target = selected === DEFAULTS_KEY ? defaultsTarget : list.find((g) => g.id === selected) || null;
  const sub = (g) => {
    if (g.members) return `${g.members} thành viên`;
    return groupsError ? 'Chưa rõ số thành viên' : 'Bot không còn thấy nhóm này';
  };

  return html`
    <${PageHead} title="Phân quyền Bot" sub="Chọn bot được làm gì trong từng nhóm. Lưu là có hiệu lực ngay." />
    ${perms.corrupt ? html`<${Notice} kind="warn">Tệp phân quyền bị hỏng nên bot đang dùng mặc định (mọi tính năng bật). Lưu lại một mục bất kỳ để ghi tệp mới.<//>` : null}
    ${groupsError ? html`<${Notice} kind="warn">Chưa lấy được danh sách nhóm: ${groupsError} Danh sách dưới đây chỉ có nhóm đã chỉnh trước đó hoặc đã có trong Phiên chat.<//>` : null}
    <div class=${`perm${target ? ' has-sel' : ''}`}>
      <section class="card perm-list" aria-label="Nhóm">
        <div class="chat-search">
          <label for="perm-q" class="sr-only">Lọc nhóm theo tên</label>
          <input id="perm-q" type="search" maxlength="100" placeholder="Lọc nhóm theo tên" value=${query}
            onInput=${(e) => setQuery(e.currentTarget.value)} />
        </div>
        <ul class="conv-list">
          <li><button type="button" class=${`conv${selected === DEFAULTS_KEY ? ' active' : ''}`}
            aria-current=${selected === DEFAULTS_KEY ? 'true' : undefined} onClick=${() => setSelected(DEFAULTS_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="shield" size=${16} /> Mặc định cho nhóm mới</span></span>
            <span class="conv-preview">Nhóm chưa chỉnh riêng dùng mục này</span>
          </button></li>
          ${shown.map((g) => {
            const badge = groupBadge(g);
            return html`<li key=${g.id}><button type="button" class=${`conv${selected === g.id ? ' active' : ''}`}
              aria-current=${selected === g.id ? 'true' : undefined} onClick=${() => setSelected(g.id)}>
              <span class="conv-top"><span class="conv-name">${g.name}</span>
                ${badge ? html`<span class=${`badge badge-${badge.kind}`}>${badge.text}</span>` : null}</span>
              <span class="conv-preview">${sub(g)}</span>
            </button></li>`;
          })}
        </ul>
        ${list.length && !shown.length ? html`<p class="muted small">Không có nhóm nào trùng tên — xoá bớt chữ trong ô lọc.</p>` : null}
        ${!list.length && !groupsError ? html`<p class="muted small">Bot chưa ở nhóm nào — thêm bot vào nhóm Zalo rồi tải lại trang.</p>` : null}
      </section>
      <section class="card perm-edit" aria-label="Quyền của nhóm">
        ${target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
              defaults=${pick(perms.defaults)} features=${perms.features} onSaved=${setPerms} onBack=${() => setSelected(null)} />`
          : html`<p class="muted chat-empty">Chọn "Mặc định" hoặc một nhóm bên trái để chỉnh.</p>`}
      </section>
    </div>`;
}
