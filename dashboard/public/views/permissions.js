// Phân quyền Bot (spec §9): trái là "Mặc định" + danh sách nhóm có ô tìm; phải là Hoạt động,
// Chỉ trả lời khi được tag và 9 nút tính năng. Lưu là có hiệu lực ngay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, SaveBar, Spinner, Toggle, onText } from '../ui.js';
import { fold } from '../fold.js';
import { DmEditor, dmBadge } from './dm-permissions.js';

export const DEFAULTS_KEY = 'defaults';
// Mục "Nhắn riêng" ở đầu danh sách; mã nhóm Zalo luôn là số nên không trùng.
export const DM_KEY = 'dm';
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
    // Mục trong tệp có thể trùng hẳn mặc định (tệp của bản cũ từng ghi cờ tag vào từng nhóm) — khi đó không coi là chỉnh riêng.
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

/** Số thay đổi của một nhóm/mặc định: Hoạt động, Chỉ trả lời khi được tag, từng tính năng. */
export function changeCount(a, b) {
  let n = (a.active !== b.active) + (a.replyOnlyTagged !== b.replyOnlyTagged);
  for (const k of Object.keys({ ...a.features, ...b.features })) if (a.features[k] !== b.features[k]) n += 1;
  return n;
}

/** Nhãn ngắn cạnh tên nhóm trong danh sách; null khi nhóm đang đúng mặc định. */
export function groupBadge(g) {
  if (!g.active) return { kind: 'danger', text: 'Đang tắt' };
  const off = Object.values(g.features).filter((v) => !v).length;
  if (off) return { kind: 'warn', text: `Tắt ${off} tính năng` };
  return g.custom ? { kind: 'idle', text: 'Chỉnh riêng' } : null;
}

export const LEAVE_MSG = 'Bạn có thay đổi chưa lưu ở nhóm này. Bỏ thay đổi và chuyển nhóm?';
export const SAVED_DEFAULT_MSG = 'Đã lưu — nhóm này đang dùng mặc định. Bot hiện không thấy nhóm này nên nhóm được ẩn khỏi danh sách.';

/** Được rời mục đang sửa không: không có thay đổi chưa lưu, hoặc người dùng đồng ý bỏ. */
export function mayLeave(dirty, ask) {
  return !dirty || Boolean(ask(LEAVE_MSG));
}

/** Sau khi lưu, nhóm còn trong danh sách không — nhóm chỉ có trong tệp, đưa về mặc định thì mất mục trong tệp. */
export function staysListed(id, perms, groups) {
  return id === DEFAULTS_KEY || id === DM_KEY || Boolean(perms.groups[id]) || (groups || []).some((g) => g.id === id);
}

function Editor({ target, value, defaults, features, onSaved, onBack, onDirty }) {
  const isGroup = target.id !== DEFAULTS_KEY;
  const [draft, setDraft] = useState(() => pick(value));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const dirty = !sameSettings(draft, value);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => () => onDirty(false), []);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setFeature = (k, v) => { setDraft((d) => ({ ...d, features: { ...d.features, [k]: v } })); setMsg({}); };

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true); setMsg({});
    try {
      const path = isGroup ? `/api/permissions/groups/${encodeURIComponent(target.id)}` : '/api/permissions/defaults';
      const r = await api(path, { method: 'PUT', body: draft });
      if (onSaved(r, target.id)) setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const p = `perm-${target.id}`;
  return html`<form class="perm-form" onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${target.name}</h2>
      ${isGroup && target.members ? html`<span class="tag">${target.members} thành viên</span>` : null}
    </header>
    <div class="perm-note-row">
      <p class="muted small perm-note">${isGroup
        ? 'Chỉ áp cho thành viên trong nhóm này. Chủ nhân bot luôn dùng được mọi tính năng.'
        : 'Áp cho mọi nhóm. Nhóm chỉnh riêng chỉ giữ những mục khác mặc định; mục còn lại đi theo Mặc định. Chủ nhân bot luôn dùng được mọi tính năng; tin nhắn riêng chỉnh ở mục Nhắn riêng.'}</p>
      ${isGroup ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy || sameSettings(draft, defaults)}
        onClick=${() => set(pick(defaults))}>Dùng mặc định</button>` : null}
    </div>
    <fieldset class="perm-box">
      <legend>Cách bot trả lời</legend>
      <div class="perm-grid">
        <${Toggle} id=${`${p}-active`} checked=${draft.active} onChange=${(v) => set({ active: v })} label="Hoạt động"
          hint="Tắt thì bot không trả lời thành viên trong nhóm."
          more="Bot vẫn đọc tin để hiểu ngữ cảnh khi chủ nhân hỏi. Việc hẹn giờ do thành viên tạo không còn gửi tin chữ vào nhóm đang tắt; muốn dừng hẳn, nhờ chủ nhân xoá việc đó. Việc chủ nhân hẹn vẫn gửi." />
        <${Toggle} id=${`${p}-tag`} checked=${draft.replyOnlyTagged} onChange=${(v) => set({ replyOnlyTagged: v })} label="Chỉ trả lời khi được tag"
          hint="Tắt thì bot trả lời mọi tin trong nhóm." />
      </div>
    </fieldset>
    ${draft.active ? null : html`<${Notice} kind="info">Nhóm đang tắt nên các tính năng dưới đây chưa dùng tới. Bật "Hoạt động" ở trên để chỉnh.<//>`}
    <details class="perm-box" open>
      <summary><span>Tính năng cho thành viên</span><span class="muted perm-box-sum">· ${onText(draft.features, features)}</span></summary>
      <fieldset class="perm-grid" disabled=${!draft.active}>
        <legend class="sr-only">Tính năng cho thành viên</legend>
        ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${p}-${f.key}`} checked=${draft.features[f.key]}
          onChange=${(v) => setFeature(f.key, v)} label=${f.label} hint=${f.hint} />`)}
      </fieldset>
    </details>
    <${SaveBar} count=${changeCount(draft, value)} busy=${busy} canSave=${dirty} msg=${msg}
      onUndo=${() => { setDraft(pick(value)); setMsg({}); }} />
  </form>`;
}

export function Permissions({ me }) {
  const [perms, setPerms] = useState(null);
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useState('');

  // Đang có thay đổi chưa lưu: hỏi trước khi đóng/tải lại trang, hoặc đổi trang qua thanh bên / nút Lùi.
  useEffect(() => {
    if (!dirty) return undefined;
    const here = location.hash;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    // popstate đến trước hashchange (bấm link thanh bên, nút Lùi/Tiến, sửa địa chỉ). Huỷ → trả lại địa chỉ cũ ngay,
    // để khi hashchange tới thì bộ định tuyến của app.js vẫn thấy trang này và không chuyển.
    const onPop = () => {
      if (location.hash === here || mayLeave(true, (m) => window.confirm(m))) return;
      history.replaceState(history.state, '', here);
    };
    addEventListener('beforeunload', onUnload);
    addEventListener('popstate', onPop);
    return () => { removeEventListener('beforeunload', onUnload); removeEventListener('popstate', onPop); };
  }, [dirty]);

  function choose(id) {
    if (id === selected || !mayLeave(dirty, (m) => window.confirm(m))) return;
    setFlash(''); setSelected(id);
  }

  function onSaved(r, id) {
    setPerms(r);
    if (staysListed(id, r, groups)) return true;
    setFlash(SAVED_DEFAULT_MSG); setSelected(null);
    return false;
  }

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
    <${PageHead} title="Phân quyền Bot" sub="Chọn ai được nhắn riêng với bot và bot được làm gì trong từng nhóm. Lưu là có hiệu lực ngay." />
    ${perms.corrupt ? html`<${Notice} kind="warn">Tệp phân quyền bị hỏng nên bot đang dùng mặc định (mọi tính năng bật). Lưu lại một mục bất kỳ để ghi tệp mới.<//>` : null}
    ${groupsError ? html`<${Notice} kind="warn">Chưa lấy được danh sách nhóm: ${groupsError} Danh sách dưới đây chỉ có nhóm đã chỉnh trước đó hoặc đã có trong Phiên chat.<//>` : null}
    <${Live} ok=${flash} />
    <div class=${`perm${target || selected === DM_KEY ? ' has-sel' : ''}`}>
      <section class="card perm-list" aria-label="Nhóm">
        <div class="chat-search">
          <label for="perm-q" class="sr-only">Lọc nhóm theo tên</label>
          <input id="perm-q" type="search" maxlength="100" placeholder="Lọc nhóm theo tên" value=${query}
            onInput=${(e) => setQuery(e.currentTarget.value)} />
        </div>
        <ul class="conv-list">
          <li><button type="button" class=${`conv${selected === DM_KEY ? ' active' : ''}`}
            aria-current=${selected === DM_KEY ? 'true' : undefined} onClick=${() => choose(DM_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="user" size=${16} /> Nhắn riêng</span>
              <span class=${`badge badge-${dmBadge(perms.dm).kind}`}>${dmBadge(perms.dm).text}</span></span>
            <span class="conv-preview">Ai được nhắn riêng với bot và bot được làm gì trong tin nhắn riêng.</span>
          </button></li>
          <li><button type="button" class=${`conv${selected === DEFAULTS_KEY ? ' active' : ''}`}
            aria-current=${selected === DEFAULTS_KEY ? 'true' : undefined} onClick=${() => choose(DEFAULTS_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="shield" size=${16} /> Mặc định cho nhóm mới</span></span>
            <span class="conv-preview">Nhóm chỉnh riêng chỉ giữ những mục khác mặc định; mục còn lại đi theo Mặc định.</span>
          </button></li>
          ${shown.map((g) => {
            const badge = groupBadge(g);
            return html`<li key=${g.id}><button type="button" class=${`conv${selected === g.id ? ' active' : ''}`}
              aria-current=${selected === g.id ? 'true' : undefined} onClick=${() => choose(g.id)}>
              <span class="conv-top"><span class="conv-name">${g.name}</span>
                ${badge ? html`<span class=${`badge badge-${badge.kind}`}>${badge.text}</span>` : null}</span>
              <span class="conv-preview">${sub(g)}</span>
            </button></li>`;
          })}
        </ul>
        ${list.length && !shown.length ? html`<p class="muted small">Không có nhóm nào trùng tên — xoá bớt chữ trong ô lọc.</p>` : null}
        ${!list.length && !groupsError ? html`<p class="muted small">Bot chưa ở nhóm nào — thêm bot vào nhóm Zalo rồi tải lại trang.</p>` : null}
      </section>
      <section class="card perm-edit" aria-label=${selected === DM_KEY ? 'Quyền nhắn riêng' : 'Quyền của nhóm'}>
        ${selected === DM_KEY
          ? html`<${DmEditor} key=${DM_KEY} dm=${perms.dm} features=${perms.dmFeatures} admin=${me?.role === 'admin'}
              onSaved=${(r) => setPerms(r)} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
              defaults=${pick(perms.defaults)} features=${perms.features} onSaved=${onSaved} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : html`<p class="muted chat-empty">Chọn "Nhắn riêng", "Mặc định" hoặc một nhóm bên trái để chỉnh.</p>`}
      </section>
    </div>`;
}
