// Mục "Nhắn riêng" trong Phân quyền Bot (spec §16): ai được nhắn riêng với bot, 8 nút tính năng,
// danh sách người kèm tính năng riêng từng người. Lưu là có hiệu lực ngay. Chủ nhân luôn được miễn.
// Bố cục: ba hộp (Ai được nhắn · Tính năng chung · Danh sách người); mỗi người là một hàng gập,
// chỉ mở một người một lúc; thanh Lưu dính đáy.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Notice, SaveBar, Toggle, onText } from '../ui.js';
import { fold } from '../fold.js';

const UID = /^[1-9]\d{14,21}$/;
export const MAX_PEOPLE = 200;
/** Số người hiện mỗi lần; bấm "Xem thêm" để hiện tiếp. */
export const PAGE = 20;
/** Từ chừng này người trở lên mới có ô lọc. */
export const FILTER_FROM = 8;

export const WHO_OPTIONS = [
  { value: 'owners', label: 'Chỉ chủ nhân', hint: 'Người khác nhắn riêng thì bot không trả lời (trừ lệnh /sethome để biết UID của chính họ).' },
  { value: 'list', label: 'Chủ nhân và những người trong danh sách', hint: 'Thêm người ở hộp Danh sách người bên dưới.' },
  { value: 'everyone', label: 'Mọi người', hint: 'Ai nhắn riêng bot cũng trả lời, với các tính năng chung bên dưới. Danh sách dùng để chỉnh tính năng riêng cho từng người.' },
];

/** Bản nháp sửa được, tách khỏi dữ liệu máy chủ. */
export function dmDraft(dm) {
  return {
    who: dm.who,
    features: { ...dm.features },
    people: dm.people.map((p) => ({ uid: p.uid, name: p.name, custom: p.custom, features: { ...p.features } })),
  };
}

/** Thân PUT /api/permissions/dm: người không bật "tính năng riêng" gửi `features: null` (theo nút chung). */
export function dmPayload(d) {
  return {
    who: d.who,
    features: { ...d.features },
    people: d.people.map((p) => ({ uid: p.uid, name: p.name, features: p.custom ? { ...p.features } : null })),
  };
}

export const sameDm = (a, b) => JSON.stringify(dmPayload(a)) === JSON.stringify(dmPayload(b));

/** Số thay đổi so với bản đã lưu: lựa chọn "ai", từng nút chung, từng người thêm/bỏ/sửa. */
export function dmChangeCount(d, dm) {
  const a = dmPayload(d);
  const b = dmPayload(dm);
  let n = a.who === b.who ? 0 : 1;
  for (const k of Object.keys({ ...a.features, ...b.features })) if (a.features[k] !== b.features[k]) n += 1;
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
  const person = { uid: id, name: String(name || '').trim().slice(0, 80), custom: false, features: { ...d.features } };
  return { draft: { ...d, people: [...d.people, person] } };
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

/** Tóm tắt một người trên hàng gập: theo chung / riêng bật hết / riêng tắt N (detail = các tính năng tắt). */
export function personSummary(p, features) {
  if (!p.custom) return { kind: 'idle', text: 'Theo cài đặt chung', detail: '' };
  const off = features.filter((f) => !p.features[f.key]).map((f) => f.label);
  if (!off.length) return { kind: 'ok', text: 'Riêng · bật tất cả', detail: '' };
  return { kind: 'warn', text: `Riêng · ${off.length} tính năng tắt`, detail: `Đang tắt: ${off.join(', ')}` };
}

/** Lọc danh sách người theo tên (không phân biệt dấu) hoặc UID, và "chỉ người có chỉnh riêng". */
export function filterPeople(people, { q = '', customOnly = false, names = new Map() } = {}) {
  const needle = fold(String(q).trim());
  return people.filter((p) => (!customOnly || p.custom)
    && (!needle || p.uid.includes(needle) || fold(p.name || names.get(p.uid) || '').includes(needle)));
}

/** "…" + 7 số cuối của UID cho hàng gập (UID đầy đủ ở title). */
export const shortUid = (uid) => (uid.length > 7 ? `…${uid.slice(-7)}` : uid);

function Person({ p, known, base, features, open, onToggle, onChange, onRemove }) {
  const id = `dm-p-${p.uid}`;
  const s = personSummary(p, features);
  const name = p.name || known || 'Chưa rõ tên';
  return html`<li class=${`dm-person${open ? ' open' : ''}`}>
    <div class="dm-row">
      <span class="dm-who"><strong class="dm-name">${name}</strong><small class="mono muted" title=${p.uid}>${shortUid(p.uid)}</small></span>
      <span class=${`badge badge-${s.kind}`} title=${s.detail || undefined}>${s.text}</span>
      <button type="button" class="btn btn-secondary btn-sm dm-edit-btn" aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${open ? `${id}-panel` : undefined} aria-label=${`${open ? 'Xong' : 'Chỉnh'}: ${name}`} onClick=${onToggle}>${open ? 'Xong' : 'Chỉnh'}</button>
    </div>
    ${open ? html`<div class="dm-panel" id=${`${id}-panel`}>
      ${s.detail ? html`<p class="muted small">${s.detail}.</p>` : null}
      <${Toggle} id=${`${id}-custom`} checked=${p.custom} label="Dùng tính năng riêng"
        hint=${p.custom ? 'Các nút dưới đây chỉ áp cho người này.' : 'Đang theo Tính năng chung ở trên.'}
        onChange=${(v) => onChange({ custom: v, features: { ...(v ? base : p.features) } })} />
      ${p.custom ? html`<div class="perm-grid">
        ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${p.features[f.key]} label=${f.label}
          onChange=${(v) => onChange({ features: { ...p.features, [f.key]: v } })} />`)}
      </div>` : null}
      <div class="row dm-panel-actions">
        <button type="button" class="btn btn-secondary btn-sm" disabled=${!p.custom}
          onClick=${() => onChange({ custom: false, features: { ...base } })}>Đặt lại theo chung</button>
        <button type="button" class="btn btn-danger-outline btn-sm" onClick=${onRemove}>Bỏ khỏi danh sách</button>
      </div>
    </div>` : null}
  </li>`;
}

/** Lưu được khi có thay đổi, hoặc khi chưa từng lưu (đang theo cài đặt lúc cài bot — thông báo bảo bấm Lưu). */
export const canSaveDm = (dm, dirty) => dirty || !dm.explicit;

export function DmEditor({ dm, features, admin, onSaved, onBack, onDirty }) {
  const [draft, setDraft] = useState(() => dmDraft(dm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const [known, setKnown] = useState([]);
  const [users, setUsers] = useState([]);
  const [pick, setPick] = useState('');
  const [uid, setUid] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [openUid, setOpenUid] = useState(null);
  const [q, setQ] = useState('');
  const [customOnly, setCustomOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [removed, setRemoved] = useState(null);
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
    setAddError(''); setDraft(r.draft); setMsg({}); setPick(''); setUid(''); setName('');
    // Người vừa thêm tự mở, bỏ lọc để thấy ngay.
    setOpenUid(r.draft.people.at(-1).uid); setQ(''); setCustomOnly(false); setRemoved(null);
  };
  const remove = (p) => {
    const index = draft.people.findIndex((x) => x.uid === p.uid);
    update({ people: draft.people.filter((x) => x.uid !== p.uid) });
    setRemoved({ person: p, index, name: p.name || names.get(p.uid) || 'Người này' });
    setOpenUid(null);
  };
  const undoRemove = () => {
    if (!removed) return;
    setDraft((d) => {
      if (d.people.some((x) => x.uid === removed.person.uid)) return d;
      const people = [...d.people];
      people.splice(Math.min(removed.index, people.length), 0, removed.person);
      return { ...d, people };
    });
    setRemoved(null); setMsg({});
  };
  const reset = () => { setDraft(dmDraft(dm)); setOpenUid(null); setRemoved(null); setMsg({}); setAddError(''); };
  const options = suggestions(known, draft, users);

  async function save(e) {
    e.preventDefault();
    if (busy || !canSave) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/permissions/dm', { method: 'PUT', body: dmPayload(draft) });
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
  const count = dmChangeCount(draft, dm);
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

    ${ownersOnly ? html`<${Notice} kind="info">Chỉ chủ nhân nhắn riêng được, nên Tính năng chung và Danh sách người chưa dùng tới. Chọn lựa chọn khác ở trên để chỉnh.<//>` : null}
    <details class="perm-box" open=${!ownersOnly}>
      <summary><span>Tính năng chung</span><span class="muted perm-box-sum">· ${onText(draft.features, features)}</span></summary>
      <fieldset class="perm-grid" disabled=${ownersOnly}>
        <legend class="sr-only">Tính năng chung khi nhắn riêng</legend>
        ${features.map((f) => html`<${Toggle} key=${f.key} id=${`dm-${f.key}`} checked=${draft.features[f.key]}
          onChange=${(v) => update({ features: { ...draft.features, [f.key]: v } })} label=${f.label} hint=${f.hint} />`)}
      </fieldset>
    </details>

    <fieldset class="perm-box" disabled=${ownersOnly}>
      <legend>Danh sách người (${draft.people.length})</legend>
      <details class="dm-add-box">
        <summary>+ Thêm người</summary>
        ${options.length ? html`<div class="dm-add">
          <label for="dm-pick" class="sr-only">Chọn người đã nhắn riêng cho bot hoặc người dùng dashboard</label>
          <select id="dm-pick" value=${pick} onChange=${(e) => setPick(e.currentTarget.value)}>
            <option value="">Chọn nhanh người đã biết…</option>
            ${options.map((o) => html`<option key=${o.uid} value=${o.uid}>${o.name || 'Chưa rõ tên'} · ${o.uid}</option>`)}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" disabled=${!pick}
            onClick=${() => add(pick, options.find((o) => o.uid === pick)?.name)}>Thêm</button>
        </div>` : null}
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
      ${draft.people.length ? html`<ul class="dm-people">
        ${visible.map((p) => html`<${Person} key=${p.uid} p=${p} known=${names.get(p.uid)} base=${draft.features} features=${features}
          open=${openUid === p.uid} onToggle=${() => setOpenUid(openUid === p.uid ? null : p.uid)}
          onChange=${(patch) => setPerson(p.uid, patch)} onRemove=${() => remove(p)} />`)}
      </ul>
      ${shown.length > visible.length ? html`<button type="button" class="btn btn-ghost btn-sm dm-more" onClick=${() => setLimit(limit + PAGE)}>
        Xem thêm (còn ${shown.length - visible.length} người)</button>` : null}
      ${!shown.length ? html`<p class="muted small dm-empty">Không có ai khớp bộ lọc — xoá bớt chữ trong ô lọc hoặc bỏ chọn "Có chỉnh riêng".</p>` : null}`
      : html`<p class="muted small dm-empty">Chưa có ai. ${draft.who === 'list' ? 'Bấm "+ Thêm người" — nếu danh sách trống, chỉ chủ nhân nhắn riêng được.' : ''}</p>`}
    </fieldset>
    <${SaveBar} count=${dirty ? count : 0} busy=${busy} canSave=${canSave} onUndo=${reset} msg=${msg}
      idle=${dm.explicit ? 'Chưa có thay đổi.' : 'Chưa từng lưu — bấm Lưu để quản lý từ đây.'} />
  </form>`;
}
