// Mục "Nhắn riêng" trong Phân quyền Bot (spec §16): ai được nhắn riêng với bot, 8 nút tính năng,
// danh sách người kèm tính năng riêng từng người. Lưu là có hiệu lực ngay. Chủ nhân luôn được miễn.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Live, Notice, Toggle } from '../ui.js';

const UID = /^[1-9]\d{14,21}$/;
export const MAX_PEOPLE = 200;

export const WHO_OPTIONS = [
  { value: 'owners', label: 'Chỉ chủ nhân', hint: 'Người khác nhắn riêng thì bot không trả lời (trừ lệnh /sethome để biết UID của chính họ).' },
  { value: 'list', label: 'Chủ nhân và những người trong danh sách', hint: 'Thêm người ở phần Danh sách bên dưới.' },
  { value: 'everyone', label: 'Mọi người', hint: 'Ai nhắn riêng bot cũng trả lời, với các tính năng bật bên dưới. Danh sách dùng để chỉnh tính năng riêng cho từng người.' },
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

function Person({ p, known, base, features, onChange, onRemove }) {
  const id = `dm-p-${p.uid}`;
  return html`<li class="dm-person">
    <div class="dm-person-head">
      <span class="owner-main"><strong>${p.name || known || 'Chưa rõ tên'}</strong><small class="mono muted">${p.uid}</small></span>
      <button type="button" class="btn btn-danger-outline btn-sm" onClick=${onRemove}>Bỏ</button>
    </div>
    <${Toggle} id=${`${id}-custom`} checked=${p.custom} label="Tính năng riêng cho người này"
      hint=${p.custom ? 'Các nút dưới đây chỉ áp cho người này.' : 'Đang theo các nút chung ở trên.'}
      onChange=${(v) => onChange({ custom: v, features: { ...(v ? base : p.features) } })} />
    ${p.custom ? html`<div class="dm-person-features">
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${p.features[f.key]} label=${f.label}
        onChange=${(v) => onChange({ features: { ...p.features, [f.key]: v } })} />`)}
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
  const setPerson = (i, patch) => update({ people: draft.people.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const add = (id, nm) => {
    const r = addPerson(draft, id, String(nm || '').trim() || names.get(String(id || '').trim()));
    if (r.error) { setAddError(r.error); return; }
    setAddError(''); setDraft(r.draft); setMsg({}); setPick(''); setUid(''); setName('');
  };
  const options = suggestions(known, draft, users);

  async function save(e) {
    e.preventDefault();
    if (busy || !canSave) return;
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/permissions/dm', { method: 'PUT', body: dmPayload(draft) });
      onSaved(r);
      setDraft(dmDraft(r.dm));
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const ownersOnly = draft.who === 'owners';
  return html`<form onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>Nhắn riêng</h2>
    </header>
    <p class="muted small perm-note">Ai được nhắn riêng với bot và bot được làm gì trong tin nhắn riêng. Chủ nhân bot luôn nhắn riêng được và dùng được mọi tính năng.</p>
    ${dm.explicit ? null : html`<${Notice} kind="info">Đang theo cài đặt lúc cài bot (${WHO_OPTIONS.find((o) => o.value === dm.who)?.label}). Bấm Lưu để quản lý từ đây.<//>`}
    ${!ownersOnly && !dm.gatewayOpen ? html`<${Notice} kind="warn">Trợ lý đang chỉ nhận tin của chủ nhân, nên lựa chọn này chưa có tác dụng. Nhờ người cài đặt đặt <code>ZALO_ALLOW_ALL_USERS=true</code> trong .env của Hermes rồi khởi động lại trợ lý.<//>` : null}
    <fieldset class="perm-set">
      <legend>Ai được nhắn riêng với bot</legend>
      ${WHO_OPTIONS.map((o) => html`<div class="perm-row" key=${o.value}>
        <label class="check" for=${`dm-who-${o.value}`}><input id=${`dm-who-${o.value}`} type="radio" name="dm-who" value=${o.value}
          checked=${draft.who === o.value} aria-describedby=${`dm-who-${o.value}-hint`} onChange=${() => update({ who: o.value })} />${o.label}</label>
        <small id=${`dm-who-${o.value}-hint`} class="muted">${o.hint}</small>
      </div>`)}
    </fieldset>
    <fieldset class="perm-set" disabled=${ownersOnly}>
      <legend>Tính năng khi nhắn riêng</legend>
      ${ownersOnly ? html`<p class="muted small">Chỉ chủ nhân nhắn riêng được, nên các nút này chưa dùng tới.</p>` : null}
      ${features.map((f) => html`<${Toggle} key=${f.key} id=${`dm-${f.key}`} checked=${draft.features[f.key]}
        onChange=${(v) => update({ features: { ...draft.features, [f.key]: v } })} label=${f.label} hint=${f.hint} />`)}
    </fieldset>
    <fieldset class="perm-set" disabled=${ownersOnly}>
      <legend>Danh sách (${draft.people.length})</legend>
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
      ${draft.people.length ? html`<ul class="dm-people">
        ${draft.people.map((p, i) => html`<${Person} key=${p.uid} p=${p} known=${names.get(p.uid)} base=${draft.features} features=${features}
          onChange=${(patch) => setPerson(i, patch)} onRemove=${() => update({ people: draft.people.filter((_, k) => k !== i) })} />`)}
      </ul>` : html`<p class="muted small">Chưa có ai. ${draft.who === 'list' ? 'Thêm ít nhất một người — nếu không, chỉ chủ nhân nhắn riêng được.' : ''}</p>`}
    </fieldset>
    <div class="row">
      <button class="btn btn-primary" disabled=${busy || !canSave}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      ${dirty ? html`<small class="muted">Có thay đổi chưa lưu.</small>` : null}
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}
