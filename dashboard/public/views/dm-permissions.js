// Mục "Nhắn riêng" trong Phân quyền Bot (spec §16): ai được nhắn riêng với bot, 8 nút tính năng,
// danh sách người kèm tính năng riêng từng người. Lưu là có hiệu lực ngay. Chủ nhân luôn được miễn.
// Bố cục: bốn hộp (Ai được nhắn · Tính năng chung · Xưởng tạo sản phẩm · Danh sách người); mỗi người là một
// hàng gập (tóm tắt cả nút xưởng), chỉ mở một người một lúc; thanh Lưu dính đáy.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { BulkBar, MultiPick, flip, stillPicked } from './multi-pick.js';
import { html, Notice, SaveBar, Toggle, onText } from '../ui.js';
import { fold } from '../fold.js';
import { StudioBox, applyPolicy, effectiveStudio, lockedByPolicy } from './studio-box.js';

const STUDIO_KEYS = ['studioSlides', 'studioDocs', 'studioExams', 'studioVideo'];
/** Đủ 4 nút xưởng (dữ liệu từ máy chủ mới) thì gửi kèm; thiếu thì bỏ — máy chủ giữ nút xưởng như cũ. */
const fullStudio = (st, policy) => (st && STUDIO_KEYS.every((k) => typeof st[k] === 'boolean') ? { studio: applyPolicy(st, policy) } : {});

const UID = /^[1-9]\d{14,21}$/;
export const MAX_PEOPLE = 200;
/** Số người hiện mỗi lần; bấm "Xem thêm" để hiện tiếp. */
export const PAGE = 20;
/** Từ chừng này người trở lên mới có ô lọc. */
export const FILTER_FROM = 8;

export const WHO_OPTIONS = [
  { value: 'owners', label: 'Chỉ chủ nhân', hint: 'Người khác nhắn riêng thì bot không trả lời (trừ lệnh /sethome để biết UID của chính họ).' },
  { value: 'list', label: 'Chủ nhân và những người trong danh sách', hint: 'Thêm người ở hộp Danh sách người bên dưới, hoặc đưa họ vào một thư mục (Phân quyền Bot › Thư mục).' },
  { value: 'everyone', label: 'Mọi người', hint: 'Ai nhắn riêng bot cũng trả lời, với các tính năng chung bên dưới. Danh sách dùng để chỉnh tính năng riêng cho từng người.' },
];

/** Bản nháp sửa được, tách khỏi dữ liệu máy chủ. */
export function dmDraft(dm) {
  return {
    who: dm.who,
    features: { ...dm.features },
    ...(dm.studio ? { studio: { ...dm.studio } } : {}),
    people: dm.people.map((p) => ({ uid: p.uid, name: p.name, custom: p.custom, features: { ...p.features },
      ...(p.studio ? { studio: { ...p.studio } } : {}) })),
  };
}

/** Thân PUT /api/permissions/dm: người không bật "tính năng riêng" gửi `features: null` (theo nút chung). */
export function dmPayload(d, policy) {
  return {
    who: d.who,
    features: { ...d.features },
    ...fullStudio(d.studio, policy),
    people: d.people.map((p) => ({ uid: p.uid, name: p.name, features: p.custom ? { ...p.features } : null,
      ...(p.custom ? fullStudio(p.studio, policy) : {}) })),
  };
}

export const sameDm = (a, b) => JSON.stringify(dmPayload(a)) === JSON.stringify(dmPayload(b));

/** Số thay đổi so với bản đã lưu: lựa chọn "ai", từng nút chung, từng người thêm/bỏ/sửa. */
export function dmChangeCount(d, dm) {
  const a = dmPayload(d);
  const b = dmPayload(dm);
  let n = a.who === b.who ? 0 : 1;
  for (const k of Object.keys({ ...a.features, ...b.features })) if (a.features[k] !== b.features[k]) n += 1;
  for (const k of Object.keys({ ...a.studio, ...b.studio })) if (a.studio?.[k] !== b.studio?.[k]) n += 1;
  const before = new Map(b.people.map((p) => [p.uid, JSON.stringify(p)]));
  const after = new Map(a.people.map((p) => [p.uid, JSON.stringify(p)]));
  for (const [uid, s] of after) if (before.get(uid) !== s) n += 1;
  for (const uid of before.keys()) if (!after.has(uid)) n += 1;
  // Chỉ đổi thứ tự (không có ở giao diện) vẫn tính là một thay đổi để nút Lưu khớp với sameDm.
  return n || (sameDm(d, dm) ? 0 : 1);
}

/** Thêm một người: `{ draft }` khi được, `{ error }` kèm cách sửa khi không. Tính năng riêng bắt đầu bằng nút chung. */
export function addPerson(d, uid, name = '') {
  const id = String(uid || '').trim();
  if (!UID.test(id)) return { error: 'UID Zalo là dãy 15–22 chữ số, không phải số điện thoại — nhờ người đó nhắn /sethome cho bot để biết.' };
  if (d.people.some((p) => p.uid === id)) return { error: 'Người này đã có trong danh sách.' };
  if (d.people.length >= MAX_PEOPLE) return { error: `Danh sách tối đa ${MAX_PEOPLE} người — bỏ bớt rồi thêm.` };
  const person = { uid: id, name: String(name || '').trim().slice(0, 80), custom: false, features: { ...d.features },
    ...(d.studio ? { studio: { ...d.studio } } : {}) };
  return { draft: { ...d, people: [...d.people, person] } };
}

/** Bỏ nhiều người khỏi bản nháp: `{ draft, removed: [{ person, index }] }` (vị trí cũ để hoàn tác). */
export function removePeople(d, uids) {
  const drop = new Set(uids);
  const removed = d.people.map((person, index) => ({ person, index })).filter((x) => drop.has(x.person.uid));
  return { draft: { ...d, people: d.people.filter((p) => !drop.has(p.uid)) }, removed };
}

/** Hoàn tác removePeople: chèn lại đúng chỗ cũ, bỏ qua người đã có lại trong danh sách. */
export function restorePeople(d, removed) {
  const people = [...d.people];
  for (const { person, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!people.some((x) => x.uid === person.uid)) people.splice(Math.min(index, people.length), 0, person);
  }
  return { ...d, people };
}

/** Đặt cùng một bộ tính năng riêng (và nút xưởng, nếu có) cho nhiều người. */
export function setPeopleFeatures(d, uids, features, studio) {
  const pick = new Set(uids);
  return { ...d, people: d.people.map((p) => (pick.has(p.uid)
    ? { ...p, custom: true, features: { ...features }, ...(studio && p.studio ? { studio: { ...studio } } : {}) } : p)) };
}

/** Đưa nhiều người về theo Tính năng chung khi nhắn riêng (bỏ tính năng riêng). */
export function resetPeople(d, uids) {
  const pick = new Set(uids);
  return { ...d, people: d.people.map((p) => (pick.has(p.uid)
    ? { ...p, custom: false, features: { ...d.features }, ...(d.studio && p.studio ? { studio: { ...d.studio } } : {}) } : p)) };
}

/**
 * Tên đã biết theo UID: người từng nhắn riêng cho bot (Phiên chat) trước, rồi tên đăng nhập của
 * người dùng dashboard có ghi UID Zalo (chỉ Quản trị xem được danh sách này).
 */
export function knownNames(conversations, users = []) {
  const names = new Map();
  for (const c of conversations || []) {
    const id = String(c.threadId);
    if (c.threadType === 0 && UID.test(id) && c.name && !names.has(id)) names.set(id, String(c.name));
  }
  for (const u of users || []) {
    const id = String(u.zaloUid || '');
    if (UID.test(id) && !names.has(id)) names.set(id, String(u.username || ''));
  }
  return names;
}

/** Người đã từng nhắn riêng cho bot (Phiên chat) hoặc người dùng dashboard có UID Zalo, chưa có trong danh sách — để chọn nhanh. */
export function suggestions(conversations, d, users = []) {
  const have = new Set(d.people.map((p) => p.uid));
  const out = (conversations || [])
    .filter((c) => c.threadType === 0 && UID.test(String(c.threadId)) && !have.has(String(c.threadId)))
    .map((c) => ({ uid: String(c.threadId), name: String(c.name || '') }));
  for (const o of out) have.add(o.uid);
  for (const u of users || []) {
    const id = String(u.zaloUid || '');
    if (UID.test(id) && !have.has(id)) { have.add(id); out.push({ uid: id, name: String(u.username || '') }); }
  }
  return out;
}

/** Nhãn cạnh mục "Nhắn riêng" ở danh sách bên trái. */
export function dmBadge(dm) {
  if (dm.who === 'owners') return { kind: 'idle', text: 'Chỉ chủ nhân' };
  if (dm.who === 'everyone') return { kind: 'warn', text: 'Mọi người' };
  return { kind: 'ok', text: `${dm.people.length} người` };
}

/**
 * Tóm tắt một người trên hàng gập: theo chung / riêng bật hết / riêng tắt N (detail = các tính năng tắt),
 * thêm "xưởng a/b" khi có nút xưởng (nút máy chủ khoá tính là tắt).
 */
export function personSummary(p, features, studioFeatures = [], policy, base = null, baseStudio = null) {
  if (!p.custom) {
    // Theo "Tính năng chung khi nhắn riêng" (không phải cài đặt của nhóm) — kèm luôn đang bật bao nhiêu.
    if (!base) return { kind: 'idle', text: 'Theo chung nhắn riêng', detail: '' };
    const on = features.filter((f) => base[f.key]).length;
    const st = studioFeatures.length && baseStudio
      ? ` · xưởng ${studioFeatures.filter((f) => effectiveStudio(baseStudio, studioFeatures, policy)[f.key]).length}/${studioFeatures.length}` : '';
    return { kind: 'idle', text: `Theo chung nhắn riêng · ${on}/${features.length}${st}`, detail: 'Đang theo Tính năng chung khi nhắn riêng và Xưởng tạo sản phẩm ở trên' };
  }
  const off = features.filter((f) => !p.features[f.key]).map((f) => f.label);
  let studioText = '';
  let studioDetail = '';
  if (studioFeatures.length && p.studio) {
    const eff = effectiveStudio(p.studio, studioFeatures, policy);
    const on = studioFeatures.filter((f) => eff[f.key]).map((f) => f.label);
    studioText = ` · xưởng ${on.length}/${studioFeatures.length}`;
    studioDetail = on.length ? `Xưởng bật: ${on.join(', ')}` : 'Xưởng tắt hết';
  }
  if (!off.length) return { kind: 'ok', text: `Riêng · bật tất cả${studioText}`, detail: studioDetail };
  return { kind: 'warn', text: `Riêng · ${off.length} tính năng tắt${studioText}`,
    detail: [`Đang tắt: ${off.join(', ')}`, studioDetail].filter(Boolean).join('. ') };
}

/** uid → thư mục chứa người đó (thư mục đứng trước giữ người, như máy chủ). */
export function folderOfPeople(folders) {
  const out = new Map();
  for (const f of folders || []) for (const p of f.people || []) if (!out.has(p.uid)) out.set(p.uid, f);
  return out;
}

/** "Theo thư mục "X" · 9/9" — người nằm trong thư mục và không chỉnh riêng. */
export function folderSummary(folder, features) {
  const on = features.filter((f) => folder.features?.[f.key] !== false).length;
  return { kind: 'idle', text: `Theo thư mục "${folder.name}" · ${on}/${features.length}`, detail: `Đang dùng cài đặt của thư mục "${folder.name}" (Phân quyền Bot › Thư mục)` };
}

/** Lọc danh sách người theo tên (không phân biệt dấu) hoặc UID, và "chỉ người có chỉnh riêng". */
export function filterPeople(people, { q = '', customOnly = false, names = new Map() } = {}) {
  const needle = fold(String(q).trim());
  return people.filter((p) => (!customOnly || p.custom)
    && (!needle || p.uid.includes(needle) || fold(p.name || names.get(p.uid) || '').includes(needle)));
}

/** "…" + 7 số cuối của UID cho hàng gập (UID đầy đủ ở title). */

function Person({ p, known, base, baseStudio, features, studioFeatures, policy, folder, open, onToggle, onChange, onRemove, picked, onPick }) {
  const id = `dm-p-${p.uid}`;
  const s = !p.custom && folder ? folderSummary(folder, features) : personSummary(p, features, studioFeatures, policy, base, baseStudio);
  // Bật/tắt "tính năng riêng" hoặc đặt lại: nút xưởng đi cùng nút tính năng.
  const withStudio = (st) => (baseStudio && st ? { studio: { ...st } } : {});
  const name = p.name || known || 'Chưa rõ tên';
  return html`<li class=${`dm-person${open ? ' open' : ''}`}>
    <div class="dm-row">
      ${onPick ? html`<input type="checkbox" class="bulk-check" checked=${picked} aria-label=${`Chọn ${name}`} onChange=${onPick} />` : null}
      <span class="dm-who"><strong class="dm-name">${name}</strong></span>
      <span class=${`badge badge-${s.kind}`} title=${s.detail || undefined}>${s.text}</span>
      <button type="button" class="btn btn-secondary btn-sm dm-edit-btn" aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${open ? `${id}-panel` : undefined} aria-label=${`${open ? 'Xong' : 'Chỉnh'}: ${name}`} onClick=${onToggle}>${open ? 'Xong' : 'Chỉnh'}</button>
    </div>
    ${open ? html`<div class="dm-panel" id=${`${id}-panel`}>
      ${s.detail ? html`<p class="muted small">${s.detail}.</p>` : null}
      <${Toggle} id=${`${id}-custom`} checked=${p.custom} label="Dùng tính năng riêng"
        hint=${p.custom ? 'Các nút dưới đây chỉ áp cho người này.' : folder ? `Đang theo thư mục "${folder.name}".` : 'Đang theo Tính năng chung khi nhắn riêng ở trên.'}
        onChange=${(v) => onChange({ custom: v, features: { ...(v ? base : p.features) }, ...withStudio(v ? baseStudio : p.studio) })} />
      ${p.custom ? html`<div class="perm-grid">
        ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${p.features[f.key]} label=${f.label}
          onChange=${(v) => onChange({ features: { ...p.features, [f.key]: v } })} />`)}
      </div>
      ${p.studio && studioFeatures.length ? html`<p class="small dm-studio-head">Xưởng tạo sản phẩm</p><div class="perm-grid">
        ${studioFeatures.map((f) => (lockedByPolicy(f.key, policy)
          ? html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} label=${f.label} checked=${false} disabled=${true}
              hint=${policy.note || 'Máy chủ này chưa chạy được video — video tắt'} onChange=${() => {}} />`
          : html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} label=${f.label} checked=${p.studio[f.key]}
              onChange=${(v) => onChange({ studio: { ...p.studio, [f.key]: v } })} />`))}
      </div>` : null}` : null}
      <div class="row dm-panel-actions">
        <button type="button" class="btn btn-secondary btn-sm" disabled=${!p.custom}
          onClick=${() => onChange({ custom: false, features: { ...base }, ...withStudio(baseStudio) })}>Đặt lại theo chung</button>
        <button type="button" class="btn btn-danger-outline btn-sm" onClick=${onRemove}>Bỏ khỏi danh sách</button>
      </div>
    </div>` : null}
  </li>`;
}

/** Một bộ nút tính năng (và xưởng) để áp cho nhiều người đã chọn. */
function BulkFeatures({ value, features, studioFeatures, policy, count, onChange, onApply, onCancel }) {
  return html`<div class="bulk-panel">
    <p class="small"><strong>Tính năng riêng cho ${count} người đã chọn</strong></p>
    <div class="perm-grid">
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`dm-bulk-${f.key}`} checked=${value.features[f.key]} label=${f.label}
        onChange=${(v) => onChange({ ...value, features: { ...value.features, [f.key]: v } })} />`)}
    </div>
    ${value.studio && studioFeatures.length ? html`<p class="small dm-studio-head">Xưởng tạo sản phẩm</p><div class="perm-grid">
      ${studioFeatures.map((f) => html`<${Toggle} key=${f.key} id=${`dm-bulk-${f.key}`} label=${f.label}
        checked=${lockedByPolicy(f.key, policy) ? false : value.studio[f.key]} disabled=${lockedByPolicy(f.key, policy)}
        onChange=${(v) => onChange({ ...value, studio: { ...value.studio, [f.key]: v } })} />`)}
    </div>` : null}
    <div class="row">
      <button type="button" class="btn btn-primary btn-sm" onClick=${onApply}>Áp cho ${count} người</button>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onCancel}>Huỷ</button>
    </div>
  </div>`;
}

/** Lưu được khi có thay đổi, hoặc khi chưa từng lưu (đang theo cài đặt lúc cài bot — thông báo bảo bấm Lưu). */
export const canSaveDm = (dm, dirty) => dirty || !dm.explicit;

export function DmEditor({ dm, folders = [], features, studioFeatures = [], studioPolicy, admin, onSaved, onBack, onDirty }) {
  const [draft, setDraft] = useState(() => dmDraft(dm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const [known, setKnown] = useState([]);
  const [users, setUsers] = useState([]);
  const [uid, setUid] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [openUid, setOpenUid] = useState(null);
  const [q, setQ] = useState('');
  const [customOnly, setCustomOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [removed, setRemoved] = useState(null);
  // Chọn nhiều người: Set UID đã tích; `bulkFeat` = bộ nút đang soạn để áp cho người đã chọn.
  const [picked, setPicked] = useState(() => new Set());
  const [bulkFeat, setBulkFeat] = useState(null);
  const dirty = !sameDm(draft, dm);
  const canSave = canSaveDm(dm, dirty);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => () => onDirty(false), []);
  useEffect(() => {
    let alive = true;
    // Gợi ý người đã nhắn riêng cho bot; lịch sử chưa có thì chỉ còn ô nhập UID.
    api('/api/chats').then((r) => { if (alive) setKnown(r.conversations || []); }, () => {});
    // Người dùng dashboard có UID Zalo — chỉ Quản trị xem được danh sách người dùng.
    if (admin) api('/api/admin/users').then((r) => { if (alive) setUsers(r.users || []); }, () => {});
    return () => { alive = false; };
  }, []);

  const names = knownNames(known, users);
  const update = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const setPerson = (id, patch) => update({ people: draft.people.map((p) => (p.uid === id ? { ...p, ...patch } : p)) });
  const add = (id, nm) => {
    const r = addPerson(draft, id, String(nm || '').trim() || names.get(String(id || '').trim()));
    if (r.error) { setAddError(r.error); return; }
    setAddError(''); setDraft(r.draft); setMsg({}); setUid(''); setName('');
    // Người vừa thêm tự mở, bỏ lọc để thấy ngay.
    setOpenUid(r.draft.people.at(-1).uid); setQ(''); setCustomOnly(false); setRemoved(null);
  };
  // Thêm nhiều người đã tích chọn một lượt (bỏ qua người đã có).
  const addMany = (list) => {
    let next = draft;
    for (const o of list) { const r = addPerson(next, o.uid, o.name || names.get(o.uid)); if (!r.error) next = r.draft; }
    if (next === draft) return;
    setAddError(''); setDraft(next); setMsg({}); setQ(''); setCustomOnly(false); setRemoved(null);
  };
  const removeMany = (uids, label) => {
    const r = removePeople(draft, uids);
    if (!r.removed.length) return;
    setDraft(r.draft); setMsg({});
    setRemoved({ items: r.removed, name: label });
    setOpenUid(null); setPicked(new Set()); setBulkFeat(null);
  };
  const remove = (p) => removeMany([p.uid], p.name || names.get(p.uid) || 'Người này');
  const undoRemove = () => {
    if (!removed) return;
    setDraft((d) => restorePeople(d, removed.items));
    setRemoved(null); setMsg({});
  };
  const reset = () => { setDraft(dmDraft(dm)); setOpenUid(null); setRemoved(null); setMsg({}); setAddError(''); setPicked(new Set()); setBulkFeat(null); };
  const options = suggestions(known, draft, users);

  async function save(e) {
    e.preventDefault();
    if (busy || !canSave) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/permissions/dm', { method: 'PUT', body: dmPayload(draft, studioPolicy) });
      onSaved(r);
      setDraft(dmDraft(r.dm)); setRemoved(null);
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const ownersOnly = draft.who === 'owners';
  const who = WHO_OPTIONS.find((o) => o.value === draft.who);
  const shown = filterPeople(draft.people, { q, customOnly, names });
  const visible = shown.slice(0, limit);
  // Người đang mở luôn hiện, kể cả khi nằm sau trang đang xem.
  const opened = shown.find((p) => p.uid === openUid);
  if (opened && !visible.includes(opened)) visible.push(opened);
  const customCount = draft.people.filter((p) => p.custom).length;
  const folderOf = folderOfPeople(folders);
  // Người chỉ được nhắn riêng nhờ nằm trong thư mục (chưa có trong danh sách) — hiện để nhìn một chỗ thấy hết.
  const inDraft = new Set(draft.people.map((p) => p.uid));
  const viaFolder = [...folderOf].filter(([uid]) => !inDraft.has(uid));
  const count = dmChangeCount(draft, dm);
  const sel = stillPicked(picked, draft.people);
  return html`<form class="perm-form" onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>Nhắn riêng</h2>
    </header>
    <p class="muted small perm-note">Ai được nhắn riêng với bot và bot được làm gì trong tin nhắn riêng. Chủ nhân bot luôn nhắn riêng được và dùng được mọi tính năng.</p>
    ${dm.explicit ? null : html`<${Notice} kind="info">Đang theo cài đặt lúc cài bot (${WHO_OPTIONS.find((o) => o.value === dm.who)?.label}). Bấm Lưu để quản lý từ đây.<//>`}
    ${!ownersOnly && !dm.gatewayOpen ? html`<${Notice} kind="warn">Trợ lý đang chỉ nhận tin của chủ nhân, nên lựa chọn này chưa có tác dụng. Nhờ người cài đặt đặt <code>ZALO_ALLOW_ALL_USERS=true</code> trong .env của Hermes rồi khởi động lại trợ lý.<//>` : null}

    <fieldset class="perm-box">
      <legend>Ai được nhắn riêng với bot</legend>
      <div class="radio-cards">
        ${WHO_OPTIONS.map((o) => html`<label key=${o.value} class=${`radio-card${draft.who === o.value ? ' selected' : ''}`} for=${`dm-who-${o.value}`}>
          <input id=${`dm-who-${o.value}`} type="radio" name="dm-who" value=${o.value} checked=${draft.who === o.value}
            aria-describedby="dm-who-hint" onChange=${() => update({ who: o.value })} /><span>${o.label}</span></label>`)}
      </div>
      <p id="dm-who-hint" class="muted small">${who?.hint}</p>
    </fieldset>

    ${ownersOnly ? html`<${Notice} kind="info">Chỉ chủ nhân nhắn riêng được, nên Tính năng chung khi nhắn riêng, Xưởng tạo sản phẩm và Danh sách người chưa dùng tới. Chọn lựa chọn khác ở trên để chỉnh.<//>` : null}
    <details class="perm-box" open=${!ownersOnly}>
      <summary><span>Tính năng chung khi nhắn riêng</span><span class="muted perm-box-sum">· ${onText(draft.features, features)}</span></summary>
      <fieldset class="perm-grid" disabled=${ownersOnly}>
        <legend class="sr-only">Tính năng chung khi nhắn riêng</legend>
        ${features.map((f) => html`<${Toggle} key=${f.key} id=${`dm-${f.key}`} checked=${draft.features[f.key]}
          onChange=${(v) => update({ features: { ...draft.features, [f.key]: v } })} label=${f.label} hint=${f.hint} />`)}
      </fieldset>
    </details>

    <${StudioBox} id="dm-studio" studio=${draft.studio} features=${studioFeatures} disabled=${ownersOnly} policy=${studioPolicy}
      onChange=${(studio) => update({ studio })} />

    <fieldset class="perm-box" disabled=${ownersOnly}>
      <legend>Danh sách người (${draft.people.length})</legend>
      <details class="dm-add-box">
        <summary>+ Thêm người</summary>
        <${MultiPick} id="dm-pick" options=${options} label="Chọn người đã biết" onAdd=${addMany} />
        <div class="dm-add">
          <label for="dm-uid" class="sr-only">UID Zalo</label>
          <input id="dm-uid" inputmode="numeric" maxlength="22" placeholder="UID Zalo (15–22 chữ số)" value=${uid}
            aria-describedby="dm-add-error" onInput=${(e) => { setUid(e.currentTarget.value); setAddError(''); }} />
          <label for="dm-name" class="sr-only">Tên gợi nhớ</label>
          <input id="dm-name" maxlength="80" placeholder="Tên gợi nhớ (tuỳ chọn)" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
          <button type="button" class="btn btn-secondary btn-sm" disabled=${!uid.trim()} onClick=${() => add(uid, name)}>Thêm</button>
        </div>
        <p id="dm-add-error" class="small dm-add-error" aria-live="polite">${addError}</p>
      </details>
      <div aria-live="polite">${removed ? html`<${Notice} kind="info">Đã bỏ ${removed.name} khỏi danh sách — bấm Lưu để áp dụng.
        <button type="button" class="link" onClick=${undoRemove}>Hoàn tác</button><//>` : null}</div>
      ${draft.people.length >= FILTER_FROM ? html`<div class="dm-filter">
        <label for="dm-q" class="sr-only">Lọc theo tên hoặc UID</label>
        <input id="dm-q" type="search" maxlength="80" placeholder="Lọc theo tên hoặc UID" value=${q}
          onInput=${(e) => { setQ(e.currentTarget.value); setLimit(PAGE); }} />
        <button type="button" class="btn btn-secondary btn-sm chip" aria-pressed=${customOnly ? 'true' : 'false'}
          onClick=${() => { setCustomOnly(!customOnly); setLimit(PAGE); }}>Có chỉnh riêng (${customCount})</button>
      </div>` : null}
      ${draft.people.length > 1 ? html`<${BulkBar} shown=${shown} picked=${new Set(sel)} onPick=${setPicked} filtered=${Boolean(q.trim()) || customOnly}>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => setBulkFeat({ features: { ...draft.features }, ...(draft.studio ? { studio: { ...draft.studio } } : {}) })}>Đặt tính năng giống nhau</button>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => { update(resetPeople(draft, sel)); setPicked(new Set()); setBulkFeat(null); }}>Về theo cài đặt chung</button>
        <button type="button" class="btn btn-danger-outline btn-sm" onClick=${() => removeMany(sel, `${sel.length} người`)}>Bỏ khỏi danh sách (${sel.length})</button>
      <//>` : null}
      ${bulkFeat && sel.length ? html`<${BulkFeatures} value=${bulkFeat} features=${features} studioFeatures=${studioFeatures} policy=${studioPolicy} count=${sel.length}
        onChange=${setBulkFeat} onCancel=${() => setBulkFeat(null)}
        onApply=${() => { update(setPeopleFeatures(draft, sel, bulkFeat.features, bulkFeat.studio)); setBulkFeat(null); setPicked(new Set()); }} />` : null}
      ${draft.people.length ? html`<ul class="dm-people">
        ${visible.map((p) => html`<${Person} key=${p.uid} p=${p} known=${names.get(p.uid)} base=${draft.features} features=${features}
          baseStudio=${draft.studio} studioFeatures=${studioFeatures} policy=${studioPolicy} folder=${folderOf.get(p.uid)}
          open=${openUid === p.uid} onToggle=${() => setOpenUid(openUid === p.uid ? null : p.uid)}
          onChange=${(patch) => setPerson(p.uid, patch)} onRemove=${() => remove(p)}
          picked=${picked.has(p.uid)} onPick=${draft.people.length > 1 ? () => setPicked(flip(picked, p.uid)) : null} />`)}
      </ul>
      ${shown.length > visible.length ? html`<button type="button" class="btn btn-ghost btn-sm dm-more" onClick=${() => setLimit(limit + PAGE)}>
        Xem thêm (còn ${shown.length - visible.length} người)</button>` : null}
      ${!shown.length ? html`<p class="muted small dm-empty">Không có ai khớp bộ lọc — xoá bớt chữ trong ô lọc hoặc bỏ chọn "Có chỉnh riêng".</p>` : null}`
      : html`<p class="muted small dm-empty">Chưa có ai. ${draft.who === 'list' ? 'Bấm "+ Thêm người" — nếu danh sách trống, chỉ chủ nhân nhắn riêng được.' : ''}</p>`}
    </fieldset>
    ${viaFolder.length ? html`<fieldset class="perm-box" disabled=${ownersOnly}>
      <legend>Được nhắn riêng qua thư mục (${viaFolder.length})</legend>
      <p class="muted small">Những người này nằm trong thư mục nên được nhắn riêng và dùng cài đặt của thư mục. Bỏ họ khỏi thư mục ở Phân quyền Bot › Thư mục; muốn chỉnh riêng một người thì "+ Thêm người" ở trên.</p>
      <ul class="dm-people">${viaFolder.map(([uid, f]) => { const s = folderSummary(f, features); const p = f.people.find((x) => x.uid === uid); return html`<li key=${uid} class="dm-person"><div class="dm-row">
        <span class="dm-who"><strong class="dm-name">${p?.name || names.get(uid) || 'Chưa rõ tên'}</strong></span>
        <span class="badge badge-idle" title=${s.detail}>${s.text}</span></div></li>`; })}</ul>
    </fieldset>` : null}
    <${SaveBar} count=${dirty ? count : 0} busy=${busy} canSave=${canSave} onUndo=${reset} msg=${msg}
      idle=${dm.explicit ? 'Chưa có thay đổi.' : 'Chưa từng lưu — bấm Lưu để quản lý từ đây.'} />
  </form>`;
}
