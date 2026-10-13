// Mục "Hạn mức xưởng" trong Phân quyền Bot (spec §17): số lượt mặc định mỗi người mỗi ngày và hạn mức
// riêng từng người (áp ở mọi nhóm và khi nhắn riêng, thắng hạn mức của nhóm). Chủ nhân không giới hạn.
// Mỗi người hiện số lượt đã dùng hôm nay và số còn, đọc từ sổ lượt xưởng (Sức khoẻ máy chủ dùng chung sổ này).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { BulkBar, MultiPick, flip, stillPicked } from './multi-pick.js';
import { html, Notice, SaveBar } from '../ui.js';
import { PAGE, knownNames, suggestions } from './dm-permissions.js';
import { MAX_QUOTA, parseQuota, vnToday } from './studio-box.js';

const UID = /^[1-9]\d{14,21}$/;
export const MAX_QUOTA_PEOPLE = 500;

export const quotaBadge = (studio) => `${studio?.quota ?? 3} lượt/ngày`;

/** Bản nháp: số lượt giữ dạng chữ để gõ dở không bị nhảy; lỗi kiểm lúc lưu. */
export function quotaDraft(studio) {
  const opt = (v) => (v === null || v === undefined ? '' : String(v));
  return { quota: String(studio?.quota ?? 3), image: String(studio?.image ?? 5), video: String(studio?.video ?? 1),
    people: (studio?.people || []).map((p) => ({ uid: p.uid, name: p.name || '', quota: String(p.quota), image: opt(p.image), video: opt(p.video) })) };
}

/** `{ body }` để gửi PUT /api/permissions/studio, hoặc `{ error }` kèm cách sửa. */
export function quotaPayload(d) {
  const q = parseQuota(d.quota, { allowEmpty: false });
  if (q.error) return { error: `Số lượt mặc định: ${q.error}` };
  const img = parseQuota(d.image ?? '5', { allowEmpty: false });
  if (img.error) return { error: `Số ảnh AI mặc định: ${img.error}` };
  const vid = parseQuota(d.video ?? '1', { allowEmpty: false });
  if (vid.error) return { error: `Số video AI mặc định: ${vid.error}` };
  const people = [];
  for (const p of d.people) {
    const v = parseQuota(p.quota, { allowEmpty: false });
    if (v.error) return { error: `${p.name || p.uid}: ${v.error}` };
    const pi = parseQuota(p.image ?? '');
    const pv = parseQuota(p.video ?? '');
    if (pi.error || pv.error) return { error: `${p.name || p.uid} (ảnh/video AI): ${pi.error || pv.error}` };
    people.push({ uid: p.uid, name: p.name, quota: v.value, image: pi.value, video: pv.value });
  }
  return { body: { quota: q.value, image: img.value, video: vid.value, people } };
}

export const sameQuota = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Số thay đổi: số lượt mặc định + từng người thêm/bỏ/sửa. */
export function quotaChangeCount(d, saved) {
  let n = ['quota', 'image', 'video'].filter((k) => d[k] !== saved[k]).length;
  const before = new Map(saved.people.map((p) => [p.uid, JSON.stringify(p)]));
  const after = new Map(d.people.map((p) => [p.uid, JSON.stringify(p)]));
  for (const [uid, s] of after) if (before.get(uid) !== s) n += 1;
  for (const uid of before.keys()) if (!after.has(uid)) n += 1;
  return n || (sameQuota(d, saved) ? 0 : 1);
}

export function addQuotaPerson(d, uid, name = '', quota = '') {
  const id = String(uid || '').trim();
  if (!UID.test(id)) return { error: 'UID Zalo là dãy 15–22 chữ số, không phải số điện thoại — nhờ người đó nhắn /sethome cho bot để biết.' };
  if (d.people.some((p) => p.uid === id)) return { error: 'Người này đã có hạn mức riêng — sửa số ở hàng của họ bên dưới.' };
  if (d.people.length >= MAX_QUOTA_PEOPLE) return { error: `Tối đa ${MAX_QUOTA_PEOPLE} người — bỏ bớt rồi thêm.` };
  const q = parseQuota(quota || d.quota, { allowEmpty: false });
  if (q.error) return { error: `${q.error} Sửa số lượt mặc định ở trên rồi thêm lại.` };
  return { draft: { ...d, people: [...d.people, { uid: id, name: String(name || '').trim().slice(0, 80), quota: String(q.value), image: '', video: '' }] } };
}

/**
 * Đặt cùng số lượt cho nhiều người: `{ draft }` hoặc `{ error }`. Ô ảnh/video AI để trống thì giữ số riêng của từng người.
 */
export function setQuotas(d, uids, { quota, image = '', video = '' }) {
  const q = parseQuota(quota, { allowEmpty: false });
  if (q.error) return { error: `Số lượt: ${q.error}` };
  const i = parseQuota(image);
  const v = parseQuota(video);
  if (i.error || v.error) return { error: `Ảnh/video AI: ${i.error || v.error}` };
  const pick = new Set(uids);
  return { draft: { ...d, people: d.people.map((p) => (pick.has(p.uid) ? { ...p, quota: String(q.value),
    ...(i.value === null ? {} : { image: String(i.value) }), ...(v.value === null ? {} : { video: String(v.value) }) } : p)) } };
}

/** Bỏ hạn mức riêng của nhiều người (họ quay về số mặc định / số của nhóm). */
export const removeQuotaPeople = (d, uids) => ({ ...d, people: d.people.filter((p) => !uids.includes(p.uid)) });

/** Lượt đã tính hôm nay của một người (việc được trả lượt không tính); null khi chưa đọc được sổ. */
export function usedToday(usage, uid, today = vnToday()) {
  if (!usage || usage.error) return null;
  const day = (usage.days || []).find((d) => d.date === today);
  const p = day?.people?.find((x) => x.uid === uid);
  return p ? Math.max(0, p.jobs - p.refunded) : 0;
}

/** "Hôm nay đã dùng 2 · còn 3" theo số lượt đang nhập; số chưa hợp lệ thì chỉ nói đã dùng. */
export function remainText(used, quotaText) {
  if (used == null) return '';
  const q = parseQuota(quotaText, { allowEmpty: false });
  if (q.error) return `Hôm nay đã dùng ${used}`;
  const left = q.value - used;
  return `Hôm nay đã dùng ${used} · ${left > 0 ? `còn ${left}` : 'hết lượt'}`;
}

export function QuotaEditor({ studio, admin, onSaved, onBack, onDirty }) {
  const saved = quotaDraft(studio);
  const [draft, setDraft] = useState(() => quotaDraft(studio));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const [known, setKnown] = useState([]);
  const [users, setUsers] = useState([]);
  const [usage, setUsage] = useState(null);
  const [uid, setUid] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // Chọn nhiều người: Set UID đã tích; `bulkSet` = các ô số đang soạn cho "Đặt số lượt" (null = đóng).
  const [picked, setPicked] = useState(() => new Set());
  const [bulkSet, setBulkSet] = useState(null);
  const [bulkError, setBulkError] = useState('');
  const dirty = !sameQuota(draft, saved);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => () => onDirty(false), []);
  useEffect(() => {
    let alive = true;
    api('/api/chats').then((r) => { if (alive) setKnown(r.conversations || []); }, () => {});
    if (admin) api('/api/admin/users').then((r) => { if (alive) setUsers(r.users || []); }, () => {});
    // Sổ lượt: không đọc được thì chỉ không hiện số đã dùng.
    api('/api/studio-usage').then((r) => { if (alive) setUsage(r); }, () => {});
    return () => { alive = false; };
  }, []);
  const names = knownNames(known, users);
  const options = suggestions(known, draft, users);
  const today = vnToday();
  const todayRow = usage && !usage.error ? (usage.days || []).find((d) => d.date === today) : null;
  const update = (patch) => { setDraft((d) => ({ ...d, ...patch })); setMsg({}); };
  const add = (id, nm) => {
    const r = addQuotaPerson(draft, id, String(nm || '').trim() || names.get(String(id || '').trim()));
    if (r.error) { setAddError(r.error); return; }
    setAddError(''); setDraft(r.draft); setMsg({}); setUid(''); setName('');
    setLimit(Math.max(limit, r.draft.people.length));
  };

  // Thêm nhiều người một lượt, cùng số lượt mặc định của addQuotaPerson.
  const addMany = (list) => {
    let next = draft;
    for (const o of list) { const r = addQuotaPerson(next, o.uid, o.name || names.get(o.uid)); if (!r.error) next = r.draft; }
    if (next === draft) return;
    setAddError(''); setDraft(next); setMsg({}); setLimit(Math.max(limit, next.people.length));
  };

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    const p = quotaPayload(draft);
    if (p.error) { setMsg({ error: `${p.error} Sửa rồi lưu lại.` }); return; }
    setBusy(true); setMsg({});
    try {
      const r = await api('/api/permissions/studio', { method: 'PUT', body: p.body });
      onSaved(r);
      setDraft(quotaDraft(r.studio));
      setMsg({ ok: 'Đã lưu — bot áp dụng ngay, không cần khởi động lại.' });
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }

  const defaultError = parseQuota(draft.quota, { allowEmpty: false }).error;
  const visible = draft.people.slice(0, limit);
  const sel = stillPicked(picked, draft.people);
  const applyBulk = () => {
    const r = setQuotas(draft, sel, bulkSet);
    if (r.error) { setBulkError(`${r.error} Sửa rồi bấm lại.`); return; }
    update(r.draft); setBulkSet(null); setBulkError(''); setPicked(new Set());
  };
  return html`<form class="perm-form" onSubmit=${save} novalidate>
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>Hạn mức xưởng</h2>
    </header>
    <p class="muted small perm-note">Mỗi sản phẩm xưởng làm (slide, văn bản, đề, video…) tốn một lượt và dùng tài nguyên AI của chủ bot. Đếm theo người, theo ngày giờ Việt Nam; việc hỏng vì máy chủ trước khi tốn gì được trả lượt. Chủ nhân bot không giới hạn. Bật/tắt từng loại sản phẩm ở Mặc định, từng nhóm và Nhắn riêng.</p>
    <fieldset class="perm-box">
      <legend>Số lượt mặc định</legend>
      <div class="studio-quota">
        <label for="sq-default">Mỗi người mỗi ngày</label>
        <input id="sq-default" inputmode="numeric" maxlength="2" value=${draft.quota} aria-describedby="sq-default-hint"
          aria-invalid=${defaultError ? 'true' : undefined} onInput=${(e) => update({ quota: e.currentTarget.value })} />
        <small id="sq-default-hint" class=${defaultError ? 'studio-quota-error' : 'muted'}>${defaultError
          ? `${defaultError} Sửa ô này rồi lưu.`
          : `Từ 0 đến ${MAX_QUOTA}; 0 = không ai được nhờ, trừ người có hạn mức riêng. Nhóm đặt số khác trong hộp Xưởng tạo sản phẩm của nhóm đó; hạn mức riêng từng người thắng cả số của nhóm lẫn số mặc định.`}</small>
      </div>
      ${[['image', 'Số ảnh AI mỗi người mỗi ngày', 'Khi nút "Vẽ ảnh AI" đang bật. Mỗi ảnh tốn tiền theo nguồn vẽ (Stali 1.000đ/ảnh).'],
        ['video', 'Số video AI mỗi người mỗi ngày', 'Khi nút "Tạo video AI" đang bật. Mỗi video Stali từ 2.200đ.']].map(([key, label, hint]) => {
        const err = parseQuota(draft[key], { allowEmpty: false }).error;
        return html`<div class="studio-quota" key=${key}>
          <label for=${`sq-${key}`}>${label}</label>
          <input id=${`sq-${key}`} inputmode="numeric" maxlength="2" value=${draft[key]} aria-invalid=${err ? 'true' : undefined}
            aria-describedby=${`sq-${key}-hint`} onInput=${(e) => update({ [key]: e.currentTarget.value })} />
          <small id=${`sq-${key}-hint`} class=${err ? 'studio-quota-error' : 'muted'}>${err ? `${err} Sửa ô này rồi lưu.` : `${hint} Nhóm/thư mục đặt số khác trong hộp Xưởng; số riêng từng người thắng tất cả.`}</small>
        </div>`;
      })}
      ${todayRow ? html`<p class="small studio-today">Hôm nay: ${todayRow.people.length} người đã nhờ xưởng ${todayRow.jobs} việc (${todayRow.refunded} việc được trả lượt).</p>`
        : usage && !usage.error ? html`<p class="muted small studio-today">Hôm nay chưa ai nhờ xưởng.</p>` : null}
    </fieldset>
    <fieldset class="perm-box">
      <legend>Hạn mức riêng từng người (${draft.people.length})</legend>
      <p class="muted small">Thắng số của nhóm và số mặc định, áp cả trong nhóm lẫn khi nhắn riêng. Đặt 0 để chặn riêng người đó.</p>
      <details class="dm-add-box">
        <summary>+ Thêm người</summary>
        <${MultiPick} id="sq-pick" options=${options} label="Chọn người đã biết" onAdd=${addMany} />
        <div class="dm-add">
          <label for="sq-uid" class="sr-only">UID Zalo</label>
          <input id="sq-uid" inputmode="numeric" maxlength="22" placeholder="UID Zalo (15–22 chữ số)" value=${uid}
            aria-describedby="sq-add-error" onInput=${(e) => { setUid(e.currentTarget.value); setAddError(''); }} />
          <label for="sq-name" class="sr-only">Tên gợi nhớ</label>
          <input id="sq-name" maxlength="80" placeholder="Tên gợi nhớ (tuỳ chọn)" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
          <button type="button" class="btn btn-secondary btn-sm" disabled=${!uid.trim()} onClick=${() => add(uid, name)}>Thêm</button>
        </div>
        <p id="sq-add-error" class="small dm-add-error" aria-live="polite">${addError}</p>
      </details>
      ${draft.people.length > 1 ? html`<${BulkBar} shown=${draft.people} picked=${new Set(sel)} onPick=${setPicked}>
        <button type="button" class="btn btn-secondary btn-sm" onClick=${() => { setBulkSet({ quota: draft.quota, image: '', video: '' }); setBulkError(''); }}>Đặt số lượt</button>
        <button type="button" class="btn btn-danger-outline btn-sm" onClick=${() => { update(removeQuotaPeople(draft, sel)); setPicked(new Set()); setBulkSet(null); }}>Bỏ hạn mức riêng (${sel.length})</button>
      <//>` : null}
      ${bulkSet && sel.length ? html`<div class="bulk-panel">
        <p class="small"><strong>Số mỗi ngày cho ${sel.length} người đã chọn</strong></p>
        <div class="row">
          ${[['quota', 'lượt'], ['image', 'ảnh AI'], ['video', 'video AI']].map(([k, unit]) => html`<label key=${k} class="quota-edit">
            <input class="quota-input" inputmode="numeric" maxlength="2" value=${bulkSet[k]} placeholder=${k === 'quota' ? '' : 'giữ'}
              onInput=${(e) => { setBulkSet({ ...bulkSet, [k]: e.currentTarget.value }); setBulkError(''); }} /> <span class="muted small">${unit}</span></label>`)}
        </div>
        <p class="muted small">Ô ảnh/video AI để trống thì giữ số riêng đang có của từng người.</p>
        <p class="small dm-add-error" aria-live="polite">${bulkError}</p>
        <div class="row">
          <button type="button" class="btn btn-primary btn-sm" onClick=${applyBulk}>Áp cho ${sel.length} người</button>
          <button type="button" class="btn btn-ghost btn-sm" onClick=${() => { setBulkSet(null); setBulkError(''); }}>Huỷ</button>
        </div>
      </div>` : null}
      ${draft.people.length ? html`<ul class="dm-people">${visible.map((p, i) => {
        const shown = p.name || names.get(p.uid) || 'Chưa rõ tên';
        const bad = parseQuota(p.quota, { allowEmpty: false }).error;
        const left = remainText(usedToday(usage, p.uid, today), p.quota);
        return html`<li class="dm-person" key=${p.uid}>
          <div class="dm-row quota-row">
            ${draft.people.length > 1 ? html`<input type="checkbox" class="bulk-check" checked=${picked.has(p.uid)} aria-label=${`Chọn ${shown}`}
              onChange=${() => setPicked(flip(picked, p.uid))} />` : null}
            <span class="dm-who"><strong class="dm-name">${shown}</strong></span>
            <span class="quota-edit">
              <label for=${`sq-p-${p.uid}`} class="sr-only">Số lượt mỗi ngày của ${shown}</label>
              <input id=${`sq-p-${p.uid}`} class="quota-input" inputmode="numeric" maxlength="2" value=${p.quota}
                aria-invalid=${bad ? 'true' : undefined} aria-describedby=${`sq-p-${p.uid}-hint`}
                onInput=${(e) => update({ people: draft.people.map((x, j) => (j === i ? { ...x, quota: e.currentTarget.value } : x)) })} />
              <span class="muted small">lượt/ngày</span>
              ${['image', 'video'].map((k) => html`<label for=${`sq-p-${p.uid}-${k}`} class="sr-only">Số ${k === 'image' ? 'ảnh' : 'video'} AI mỗi ngày của ${shown}</label>
                <input id=${`sq-p-${p.uid}-${k}`} class="quota-input" inputmode="numeric" maxlength="2" value=${p[k] ?? ''}
                  placeholder=${k === 'image' ? draft.image : draft.video}
                  onInput=${(e) => update({ people: draft.people.map((x, j) => (j === i ? { ...x, [k]: e.currentTarget.value } : x)) })} />
                <span class="muted small">${k === 'image' ? 'ảnh' : 'video'}</span>`)}
            </span>
            <button type="button" class="btn btn-danger-outline btn-sm" aria-label=${`Bỏ hạn mức riêng: ${shown}`}
              onClick=${() => update({ people: draft.people.filter((x) => x.uid !== p.uid) })}>Bỏ</button>
            <small id=${`sq-p-${p.uid}-hint`} class=${`quota-use ${bad ? 'studio-quota-error' : 'muted'}`}>${bad ? `${bad} Sửa ô này rồi lưu.` : left}</small>
          </div>
        </li>`;
      })}</ul>
      ${draft.people.length > visible.length ? html`<button type="button" class="btn btn-ghost btn-sm dm-more" onClick=${() => setLimit(limit + PAGE)}>
        Xem thêm (còn ${draft.people.length - visible.length} người)</button>` : null}`
      : html`<p class="muted small dm-empty">Chưa ai có hạn mức riêng — mọi người theo số mặc định hoặc số của nhóm.</p>`}
    </fieldset>
    ${draft.people.some((p) => p.quota.trim() === '0') ? html`<${Notice} kind="info">Người có 0 lượt không nhờ xưởng được nữa, kể cả khi nhóm đã bật.<//>` : null}
    <${SaveBar} count=${quotaChangeCount(draft, saved)} busy=${busy} canSave=${dirty} msg=${msg}
      onUndo=${() => { setDraft(quotaDraft(studio)); setMsg({}); setAddError(''); setPicked(new Set()); setBulkSet(null); }} />
  </form>`;
}
