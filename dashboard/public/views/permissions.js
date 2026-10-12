// Phân quyền Bot (spec §9): trái là "Nhắn riêng", "Hạn mức xưởng", "Mặc định" + danh sách nhóm có ô tìm; phải là
// Hoạt động, Chỉ trả lời khi được tag, 9 nút tính năng và hộp Xưởng tạo sản phẩm (spec §17). Lưu là có hiệu lực ngay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, SaveBar, Spinner, Toggle, onText } from '../ui.js';
import { fold } from '../fold.js';
import { DmEditor, dmBadge } from './dm-permissions.js';
import { FolderPeople } from './folder-people.js';
import { FolderChip, FolderColorPicker, FolderFilter, colorOf, inFolderFilter } from './folder-ui.js';
import { StudioBox, applyPolicy, parseQuota, studioComplete } from './studio-box.js';
import { QuotaEditor, quotaBadge } from './studio-quota.js';
import { CallWordsEditor } from './call-words.js';

export const DEFAULTS_KEY = 'defaults';
// Mục "Nhắn riêng" và "Hạn mức xưởng" ở đầu danh sách; mã nhóm Zalo luôn là số nên không trùng.
export const DM_KEY = 'dm';
export const QUOTA_KEY = 'studio';
export const CALL_KEY = 'call';
// Thư mục nhóm: khoá chọn `f:<mã>` (mã nhóm Zalo luôn là số nên không trùng).
export const FOLDER_PREFIX = 'f:';
const pick = (s) => ({ active: s.active, replyOnlyTagged: s.replyOnlyTagged, features: { ...s.features },
  studio: { ...(s.studio || {}) }, studioQuota: s.studioQuota ?? null });
const sameBools = (a = {}, b = {}) => Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
const quotaText = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Gộp danh sách nhóm của bot với permissions.json: nhóm bot đang ở (theo thứ tự bot trả) trước,
 * rồi nhóm chỉ còn trong tệp (bot đã rời hoặc Zalo đang tắt). Mỗi nhóm mang quyền đang hiệu lực.
 */
export function folderOfGroup(perms, id) {
  return (perms.folders || []).find((f) => f.groups.includes(id)) || null;
}

/** Cài đặt nền của nhóm: thư mục chứa nó (nếu có), không thì mặc định. */
export function baseOfGroup(perms, id) {
  return folderOfGroup(perms, id) || perms.defaults;
}

export function mergeGroups(groups, perms) {
  const seen = new Set();
  const out = [];
  const add = (id, name, members) => {
    if (seen.has(id)) return;
    seen.add(id);
    const own = perms.groups[id];
    const folder = folderOfGroup(perms, id);
    const base = folder || perms.defaults;
    // Mục trong tệp có thể trùng hẳn nền (tệp của bản cũ từng ghi cờ tag vào từng nhóm) — khi đó không coi là chỉnh riêng.
    const custom = Boolean(own) && !sameSettings(own, base);
    // Danh sách cũ ở Cấu hình chỉ còn tác dụng với nhóm chưa có mục riêng trong tệp và không thuộc thư mục nào.
    const ownerOnly = !own && !folder && (perms.legacyOwnerOnly || []).includes(id);
    out.push({ id, name: name || 'Nhóm chưa rõ tên', members, custom, ownerOnly,
      folder: folder ? { id: folder.id, name: folder.name } : null, ...pick(own || base) });
  };
  for (const g of groups || []) add(g.id, g.name, g.members);
  for (const [id, g] of Object.entries(perms.groups)) add(id, g.name, null);
  return out;
}

export function sameSettings(a, b) {
  return a.active === b.active && a.replyOnlyTagged === b.replyOnlyTagged && sameBools(a.features, b.features)
    && sameBools(a.studio, b.studio) && (a.studioQuota ?? null) === (b.studioQuota ?? null);
}

/** Số thay đổi của một nhóm/mặc định: Hoạt động, Chỉ trả lời khi được tag, từng tính năng, từng nút xưởng, số lượt. */
export function changeCount(a, b) {
  let n = (a.active !== b.active) + (a.replyOnlyTagged !== b.replyOnlyTagged) + ((a.studioQuota ?? null) !== (b.studioQuota ?? null));
  for (const k of Object.keys({ ...a.features, ...b.features })) if (a.features[k] !== b.features[k]) n += 1;
  for (const k of Object.keys({ ...a.studio, ...b.studio })) if (a.studio?.[k] !== b.studio?.[k]) n += 1;
  return n;
}

/** Thân PUT của nhóm/mặc định: nút xưởng chỉ gửi khi đủ khoá; số lượt chỉ có ở nhóm. */
export function settingsPayload(d, { isGroup, studioFeatures = [], policy }) {
  const body = { active: d.active, replyOnlyTagged: d.replyOnlyTagged, features: { ...d.features } };
  if (studioComplete(d.studio, studioFeatures)) body.studio = applyPolicy(d.studio, policy);
  if (isGroup) body.studioQuota = d.studioQuota ?? null;
  return body;
}

/** Nhãn ngắn cạnh tên nhóm trong danh sách; null khi nhóm đang đúng mặc định. */
export function groupBadge(g) {
  if (g.ownerOnly) return { kind: 'danger', text: 'Chỉ chủ nhân (Cấu hình)' };
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
  return id === DEFAULTS_KEY || id === DM_KEY || id === QUOTA_KEY || String(id).startsWith(FOLDER_PREFIX)
    || Boolean(perms.groups[id]) || Boolean(folderOfGroup(perms, id)) || (groups || []).some((g) => g.id === id);
}

/** Sửa quyền một nhóm/mặc định. `head=false` khi nhúng vào bảng Quyền của Phiên chat (bảng đã có tiêu đề). */
export function Editor({ target, value, defaults, features, studioFeatures, studioPolicy, defaultQuota, onSaved, onBack, onDirty, head = true,
  path: savePath = null, baseLabel = 'Dùng mặc định', note = null }) {
  const isGroup = target.id !== DEFAULTS_KEY;
  const [draft, setDraft] = useState(() => pick(value));
  const [qText, setQText] = useState(() => quotaText(value.studioQuota));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const quota = parseQuota(qText);
  const dirty = !sameSettings(draft, value) || quotaText(draft.studioQuota) !== qText.trim();
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => () => onDirty(false), []);
  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setFeature = (k, v) => { setDraft((d) => ({ ...d, features: { ...d.features, [k]: v } })); setMsg({}); };

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    if (quota.error) { setMsg({ error: `Số lượt xưởng: ${quota.error} Sửa ô đó rồi lưu lại, hoặc để trống để theo mặc định.` }); return; }
    setBusy(true); setMsg({});
    try {
      const path = savePath || (isGroup ? `/api/permissions/groups/${encodeURIComponent(target.id)}` : '/api/permissions/defaults');
      const r = await api(path, { method: 'PUT', body: settingsPayload(draft, { isGroup, studioFeatures, policy: studioPolicy }) });
      if (onSaved(r, target.id)) setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const p = `perm-${target.id}`;
  return html`<form class="perm-form" onSubmit=${save} novalidate>
    ${head ? html`<header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${target.name}</h2>
      ${isGroup && target.members ? html`<span class="tag">${target.members} thành viên</span>` : null}
    </header>` : null}
    ${isGroup && target.ownerOnly ? html`<${Notice} kind="warn">Nhóm này đang nằm trong danh sách cũ <strong>Nhóm chỉ chủ nhân gọi được bot</strong> (trang Cấu hình): thành viên tag bot thì bot im. Lưu phân quyền riêng cho nhóm ở đây thì phân quyền này thắng danh sách đó.<//>` : null}
    <div class="perm-note-row">
      <p class="muted small perm-note">${note || (isGroup
        ? 'Chỉ áp cho thành viên trong nhóm này. Chủ nhân bot luôn dùng được mọi tính năng.'
        : 'Áp cho mọi nhóm. Nhóm chỉnh riêng chỉ giữ những mục khác mặc định; mục còn lại đi theo Mặc định. Chủ nhân bot luôn dùng được mọi tính năng; tin nhắn riêng chỉnh ở mục Nhắn riêng.')}</p>
      ${isGroup ? html`<button type="button" class="btn btn-secondary btn-sm" disabled=${busy || sameSettings(draft, defaults)}
        onClick=${() => { set(pick(defaults)); setQText(quotaText(defaults.studioQuota)); }}>${baseLabel}</button>` : null}
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
    <${StudioBox} id=${`${p}-studio`} studio=${draft.studio} features=${studioFeatures} disabled=${!draft.active}
      onChange=${(studio) => set({ studio })} policy=${studioPolicy} quota=${qText} defaultQuota=${defaultQuota} quotaError=${quota.error}
      quotaHint=${isGroup ? `Để trống để theo mặc định (${defaultQuota}); 0 = không ai trong nhóm được nhờ, trừ người có hạn mức riêng (đặt ở mục Hạn mức xưởng, thắng số của nhóm).` : ''}
      onQuota=${isGroup ? (text) => { setQText(text); setMsg({}); const q = parseQuota(text); if (!q.error) set({ studioQuota: q.value }); } : null}
      note=${isGroup ? '' : `Số lượt mỗi người mỗi ngày chỉnh ở mục Hạn mức xưởng (đang là ${defaultQuota}).`} />
    <${SaveBar} count=${changeCount(draft, value) || (dirty ? 1 : 0)} busy=${busy} canSave=${dirty && !quota.error} msg=${msg}
      onUndo=${() => { setDraft(pick(value)); setQText(quotaText(value.studioQuota)); setMsg({}); }} />
  </form>`;
}

/** Nhãn của thư mục ở danh sách bên trái. */
export function folderBadge(f) {
  const n = (f.people || []).length;
  const count = `${f.groups.length} nhóm${n ? ` · ${n} người` : ''}`;
  if (!f.active) return { kind: 'danger', text: `Đang tắt · ${count}` };
  return { kind: 'idle', text: count };
}

function FolderEditor({ folder, perms, list, admin, onSaved, onBack, onDirty, onDeleted }) {
  const [name, setName] = useState(folder.name);
  const [picked, setPicked] = useState(() => new Set(folder.groups));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});
  const membersDirty = picked.size !== folder.groups.length || folder.groups.some((id) => !picked.has(id));
  const base = `/api/permissions/folders/${encodeURIComponent(folder.id)}`;
  async function run(key, path, method, body, ok) {
    setBusy(key); setMsg({});
    try { const r = await api(path, { method, body }); onSaved(r); setMsg({ ok: typeof ok === 'function' ? ok(r) : ok }); return r; }
    catch (err) { setMsg({ error: err.message }); return null; } finally { setBusy(''); }
  }
  const needle = fold(q.trim());
  const shown = list.filter((g) => !needle || fold(g.name).includes(needle));
  const toggle = (id) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return html`<div class="perm-form folder-edit">
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2><span class=${`fdot fdot-${colorOf(folder)}`} aria-hidden="true"></span> ${folder.name}</h2>
      <span class=${`badge badge-${folderBadge(folder).kind}`}>${folderBadge(folder).text}</span>
    </header>
    <${Live} error=${msg.error} ok=${msg.ok} />
    <fieldset class="perm-box">
      <legend>Bật / tắt nhanh</legend>
      <p class="muted small">Áp cho mọi nhóm trong thư mục ngay lập tức, bỏ cả phần "Hoạt động" từng nhóm chỉnh riêng.</p>
      <div class="row">
        <button type="button" class="btn btn-primary btn-sm" disabled=${busy !== '' || !folder.groups.length}
          onClick=${() => run('on', `${base}/active`, 'PUT', { active: true }, (r) => `Đã bật bot ở ${folder.groups.length} nhóm${r.cleared ? ` (bỏ chỉnh riêng ở ${r.cleared} nhóm)` : ''}.`)}>Bật bot cả thư mục</button>
        <button type="button" class="btn btn-danger-outline btn-sm" disabled=${busy !== '' || !folder.groups.length}
          onClick=${() => run('off', `${base}/active`, 'PUT', { active: false }, (r) => `Đã tắt bot ở ${folder.groups.length} nhóm${r.cleared ? ` (bỏ chỉnh riêng ở ${r.cleared} nhóm)` : ''}.`)}>Tắt bot cả thư mục</button>
      </div>
    </fieldset>
    <details class="perm-box" open=${!folder.groups.length}>
      <summary><span>Nhóm trong thư mục</span><span class="muted perm-box-sum">· ${picked.size} nhóm${membersDirty ? ' (chưa lưu)' : ''}</span></summary>
      <p class="muted small">Mỗi nhóm thuộc một thư mục — chọn nhóm đang ở thư mục khác sẽ chuyển nó sang đây.</p>
      <label for="folder-q" class="sr-only">Lọc nhóm theo tên</label>
      <input id="folder-q" type="search" maxlength="100" placeholder="Lọc nhóm theo tên" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      <ul class="folder-members">${shown.map((g) => html`<li key=${g.id}><label>
        <input type="checkbox" checked=${picked.has(g.id)} onChange=${() => toggle(g.id)} />
        <span>${g.name}</span>${g.folder && g.folder.id !== folder.id ? html`<small class="muted"> · đang ở "${g.folder.name}"</small>` : null}
      </label></li>`)}</ul>
      ${!shown.length ? html`<p class="muted small">Không có nhóm nào khớp.</p>` : null}
      <div class="row">
        <button type="button" class="btn btn-primary btn-sm" disabled=${busy !== '' || !membersDirty}
          onClick=${() => run('members', `${base}/members`, 'PUT', { groups: [...picked] }, `Đã lưu ${picked.size} nhóm vào thư mục.`)}>Lưu danh sách nhóm</button>
        <button type="button" class="btn btn-ghost btn-sm" disabled=${busy !== '' || !membersDirty} onClick=${() => setPicked(new Set(folder.groups))}>Hoàn tác</button>
      </div>
    </details>
    <${FolderPeople} folder=${folder} folders=${perms.folders} admin=${admin} busy=${busy} run=${run} base=${base} />
    <details class="perm-box">
      <summary><span>Tên, màu và xoá thư mục</span></summary>
      <p class="small">Màu thư mục — để phân biệt ở Phân quyền và Phiên chat:</p>
      <${FolderColorPicker} value=${colorOf(folder)} disabled=${busy !== ''}
        onChange=${(c) => { if (c !== colorOf(folder)) run('color', `${base}/color`, 'PUT', { color: c }, 'Đã đổi màu thư mục.'); }} />
      <div class="row">
        <label for="folder-name" class="sr-only">Tên thư mục</label>
        <input id="folder-name" maxlength="60" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        <button type="button" class="btn btn-secondary btn-sm" disabled=${busy !== '' || !name.trim() || name.trim() === folder.name}
          onClick=${() => run('name', base, 'PUT', { name }, 'Đã đổi tên thư mục.')}>Đổi tên</button>
      </div>
      <button type="button" class="btn btn-danger-outline btn-sm" disabled=${busy !== ''}
        onClick=${async () => { if (!window.confirm(`Xoá thư mục "${folder.name}"? ${folder.groups.length} nhóm bên trong sẽ quay về theo Mặc định (phần chỉnh riêng của từng nhóm giữ nguyên).`)) return; if (await run('del', base, 'DELETE', undefined, 'Đã xoá thư mục.')) onDeleted(); }}>Xoá thư mục</button>
    </details>
    <h3 class="folder-settings-head">Cài đặt chung của thư mục</h3>
    <${Editor} key=${`fs-${folder.id}`} head=${false} target=${{ id: `${FOLDER_PREFIX}${folder.id}`, name: folder.name, members: null }}
      value=${pick(folder)} defaults=${pick(perms.defaults)} features=${perms.features} studioFeatures=${perms.studioFeatures || []}
      studioPolicy=${perms.studioPolicy} defaultQuota=${perms.studio?.quota ?? 3} path=${`${base}/settings`}
      note=${`Mọi nhóm trong thư mục thừa hưởng các cài đặt này ngay khi lưu, kể cả nhóm thêm vào sau; người trong thư mục dùng các tính năng này khi nhắn riêng (bật bot, chỉ trả lời khi tag chỉ áp cho nhóm). Nhóm/người chỉnh riêng mục nào thì mục đó của họ thắng. Chủ nhân bot luôn dùng được mọi tính năng.`}
      onSaved=${(r) => { onSaved(r); return true; }} onDirty=${onDirty} onBack=${onBack} />
  </div>`;
}

export function Permissions({ me }) {
  const [perms, setPerms] = useState(null);
  const [groups, setGroups] = useState(null);
  const [groupsError, setGroupsError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
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
  const folders = perms.folders || [];
  const selectedFolder = String(selected || '').startsWith(FOLDER_PREFIX) ? folders.find((f) => `${FOLDER_PREFIX}${f.id}` === selected) || null : null;
  async function newFolder() {
    const name = window.prompt('Tên thư mục mới (vd. "Lớp học", "Đoàn trường"):', '');
    if (!name || !name.trim()) return;
    try { const r = await api('/api/permissions/folders', { method: 'POST', body: { name } }); setPerms(r); choose(`${FOLDER_PREFIX}${r.created}`); }
    catch (err) { setFlash(''); window.alert(err.message); }
  }
  const needle = fold(query.trim());
  const groupFolder = (g) => (g.folder ? folders.find((f) => f.id === g.folder.id) || null : null);
  const shown = list.filter((g) => (!needle || fold(g.name).includes(needle)) && inFolderFilter(folderFilter, groupFolder(g)));
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
    <div class=${`perm${target || selectedFolder || selected === DM_KEY || selected === QUOTA_KEY || selected === CALL_KEY ? ' has-sel' : ''}`}>
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
          <li><button type="button" class=${`conv${selected === CALL_KEY ? ' active' : ''}`}
            aria-current=${selected === CALL_KEY ? 'true' : undefined} onClick=${() => choose(CALL_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="chat" size=${16} /> Cách gọi bot</span>
              <span class="badge badge-idle">Chủ nhân</span></span>
            <span class="conv-preview">Từ khoá chủ nhân dùng để gọi bot trong nhóm mà không cần tag (vd. “Tiêu ơi”).</span>
          </button></li>
          ${perms.studioFeatures ? html`<li><button type="button" class=${`conv${selected === QUOTA_KEY ? ' active' : ''}`}
            aria-current=${selected === QUOTA_KEY ? 'true' : undefined} onClick=${() => choose(QUOTA_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="list" size=${16} /> Hạn mức xưởng</span>
              <span class="badge badge-idle">${quotaBadge(perms.studio)}</span></span>
            <span class="conv-preview">Mỗi người được nhờ xưởng làm bao nhiêu sản phẩm mỗi ngày.</span>
          </button></li>` : null}
          <li><button type="button" class=${`conv${selected === DEFAULTS_KEY ? ' active' : ''}`}
            aria-current=${selected === DEFAULTS_KEY ? 'true' : undefined} onClick=${() => choose(DEFAULTS_KEY)}>
            <span class="conv-top"><span class="conv-name"><${Icon} name="shield" size=${16} /> Mặc định cho nhóm mới</span></span>
            <span class="conv-preview">Nhóm chỉnh riêng chỉ giữ những mục khác mặc định; mục còn lại đi theo Mặc định.</span>
          </button></li>
          <li class="folder-head"><span>Thư mục</span>
            <button type="button" class="btn btn-ghost btn-sm" onClick=${newFolder}><${Icon} name="plus" size=${14} /> Thư mục mới</button></li>
          ${folders.length ? folders.map((f) => {
            const key = `${FOLDER_PREFIX}${f.id}`;
            const badge = folderBadge(f);
            return html`<li key=${key}><button type="button" class=${`conv conv-folder${selected === key ? ' active' : ''}`}
              aria-current=${selected === key ? 'true' : undefined} onClick=${() => choose(key)}>
              <span class="conv-top"><span class="conv-name"><span class=${`fdot fdot-${colorOf(f)}`} aria-hidden="true"></span> ${f.name}</span>
                <span class=${`badge badge-${badge.kind}`}>${badge.text}</span></span>
              <span class="conv-preview">Cài đặt chung cho nhóm và người bên trong · bật/tắt hàng loạt</span>
            </button></li>`;
          }) : html`<li class="muted small folder-empty">Gom các nhóm cùng chủ đề vào thư mục để chỉnh và bật/tắt hàng loạt.</li>`}
          <li class="folder-head"><span>Nhóm</span></li>
          ${folders.length ? html`<li><${FolderFilter} folders=${folders} items=${list} of=${groupFolder} value=${folderFilter} onChange=${setFolderFilter} label="Lọc nhóm theo thư mục" /></li>` : null}
          ${shown.map((g) => {
            const badge = groupBadge(g);
            return html`<li key=${g.id}><button type="button" class=${`conv${selected === g.id ? ' active' : ''}`}
              aria-current=${selected === g.id ? 'true' : undefined} onClick=${() => choose(g.id)}>
              <span class="conv-top"><span class="conv-name">${g.name}</span>
                ${badge ? html`<span class=${`badge badge-${badge.kind}`}>${badge.text}</span>` : null}</span>
              <span class="conv-preview">${groupFolder(g) ? html`<${FolderChip} folder=${groupFolder(g)} /> ` : null}${sub(g)}</span>
            </button></li>`;
          })}
        </ul>
        ${list.length && !shown.length ? html`<p class="muted small">Không có nhóm nào trùng tên — xoá bớt chữ trong ô lọc.</p>` : null}
        ${!list.length && !groupsError ? html`<p class="muted small">Bot chưa ở nhóm nào — thêm bot vào nhóm Zalo rồi tải lại trang.</p>` : null}
      </section>
      <section class="card perm-edit" aria-label=${selected === DM_KEY ? 'Quyền nhắn riêng' : selected === QUOTA_KEY ? 'Hạn mức xưởng' : selected === CALL_KEY ? 'Cách gọi bot' : selectedFolder ? 'Thư mục nhóm' : 'Quyền của nhóm'}>
        ${selectedFolder
          ? html`<${FolderEditor} key=${selected} folder=${selectedFolder} perms=${perms} list=${list} admin=${me?.role === 'admin'}
              onSaved=${(r) => setPerms(r)} onDirty=${setDirty} onBack=${() => choose(null)} onDeleted=${() => { setDirty(false); setSelected(null); }} />`
          : selected === DM_KEY
          ? html`<${DmEditor} key=${DM_KEY} dm=${perms.dm} folders=${perms.folders || []} features=${perms.dmFeatures} studioFeatures=${perms.studioFeatures || []}
              studioPolicy=${perms.studioPolicy} admin=${me?.role === 'admin'} onSaved=${(r) => setPerms(r)} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : selected === CALL_KEY
          ? html`<${CallWordsEditor} key=${CALL_KEY} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : selected === QUOTA_KEY
          ? html`<${QuotaEditor} key=${QUOTA_KEY} studio=${perms.studio} admin=${me?.role === 'admin'}
              onSaved=${(r) => setPerms(r)} onDirty=${setDirty} onBack=${() => choose(null)} />`
          : target
          ? html`<${Editor} key=${target.id} target=${target} value=${pick(target)}
              defaults=${pick(target.folder ? baseOfGroup(perms, target.id) : perms.defaults)} features=${perms.features} studioFeatures=${perms.studioFeatures || []} studioPolicy=${perms.studioPolicy}
              defaultQuota=${perms.studio?.quota ?? 3} onSaved=${onSaved} onDirty=${setDirty} onBack=${() => choose(null)}
              baseLabel=${target.folder ? 'Theo thư mục' : 'Dùng mặc định'}
              note=${target.folder ? `Nhóm thuộc thư mục "${target.folder.name}": mục nào chưa chỉnh riêng thì theo thư mục. Chủ nhân bot luôn dùng được mọi tính năng.` : null} />`
          : html`<p class="muted chat-empty">Chọn "Nhắn riêng", "Hạn mức xưởng", "Mặc định" hoặc một nhóm bên trái để chỉnh.</p>`}
      </section>
    </div>`;
}
