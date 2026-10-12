// Mục "Hạn mức xưởng" trong Phân quyền Bot (spec §17): số lượt mặc định mỗi người mỗi ngày và hạn mức
// riêng từng người (áp ở mọi nhóm và khi nhắn riêng, thắng hạn mức của nhóm). Chủ nhân không giới hạn.
// Mỗi người hiện số lượt đã dùng hôm nay và số còn, đọc từ sổ lượt xưởng (Sức khoẻ máy chủ dùng chung sổ này).
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Notice, SaveBar } from '../ui.js';
import { PAGE, knownNames, suggestions } from './dm-permissions.js';
import { MAX_QUOTA, parseQuota, vnToday } from './studio-box.js';

const UID = /^[1-9]\d{14,21}$/;
export const MAX_QUOTA_PEOPLE = 500;

export const quotaBadge = (studio) => `${studio?.quota ?? 3} lượt/ngày`;

/** Bản nháp: số lượt giữ dạng chữ để gõ dở không bị nhảy; lỗi kiểm lúc lưu. */
export function quotaDraft(studio) {
  return { quota: String(studio?.quota ?? 3), people: (studio?.people || []).map((p) => ({ uid: p.uid, name: p.name || '', quota: String(p.quota) })) };
}

/** `{ body }` để gửi PUT /api/permissions/studio, hoặc `{ error }` kèm cách sửa. */
export function quotaPayload(d) {
  const q = parseQuota(d.quota, { allowEmpty: false });
  if (q.error) return { error: `Số lượt mặc định: ${q.error}` };
  const people = [];
  for (const p of d.people) {
    const v = parseQuota(p.quota, { allowEmpty: false });
    if (v.error) return { error: `${p.name || p.uid}: ${v.error}` };
    people.push({ uid: p.uid, name: p.name, quota: v.value });
  }
  return { body: { quota: q.value, people } };
}

export const sameQuota = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Số thay đổi: số lượt mặc định + từng người thêm/bỏ/sửa. */
export function quotaChangeCount(d, saved) {
  let n = d.quota === saved.quota ? 0 : 1;
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
  return { draft: { ...d, people: [...d.people, { uid: id, name: String(name || '').trim().slice(0, 80), quota: String(q.value) }] } };
}

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
  const [pick, setPick] = useState('');
  const [uid, setUid] = useState('');
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [limit, setLimit] = useState(PAGE);
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
    setAddError(''); setDraft(r.draft); setMsg({}); setPick(''); setUid(''); setName('');
    setLimit(Math.max(limit, r.draft.people.length));
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
      ${todayRow ? html`<p class="small studio-today">Hôm nay: ${todayRow.people.length} người đã nhờ xưởng ${todayRow.jobs} việc (${todayRow.refunded} việc được trả lượt).</p>`
        : usage && !usage.error ? html`<p class="muted small studio-today">Hôm nay chưa ai nhờ xưởng.</p>` : null}
    </fieldset>
    <fieldset class="perm-box">
      <legend>Hạn mức riêng từng người (${draft.people.length})</legend>
      <p class="muted small">Thắng số của nhóm và số mặc định, áp cả trong nhóm lẫn khi nhắn riêng. Đặt 0 để chặn riêng người đó.</p>
      <details class="dm-add-box">
        <summary>+ Thêm người</summary>
        ${options.length ? html`<div class="dm-add">
          <label for="sq-pick" class="sr-only">Chọn người đã nhắn riêng cho bot hoặc người dùng dashboard</label>
          <select id="sq-pick" value=${pick} onChange=${(e) => setPick(e.currentTarget.value)}>
            <option value="">Chọn nhanh người đã biết…</option>
            ${options.map((o) => html`<option key=${o.uid} value=${o.uid}>${o.name || 'Chưa rõ tên'} · ${o.uid}</option>`)}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" disabled=${!pick}
            onClick=${() => add(pick, options.find((o) => o.uid === pick)?.name)}>Thêm</button>
        </div>` : null}
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
      ${draft.people.length ? html`<ul class="dm-people">${visible.map((p, i) => {
        const shown = p.name || names.get(p.uid) || 'Chưa rõ tên';
        const bad = parseQuota(p.quota, { allowEmpty: false }).error;
        const left = remainText(usedToday(usage, p.uid, today), p.quota);
        return html`<li class="dm-person" key=${p.uid}>
          <div class="dm-row quota-row">
            <span class="dm-who"><strong class="dm-name">${shown}</strong></span>
            <span class="quota-edit">
              <label for=${`sq-p-${p.uid}`} class="sr-only">Số lượt mỗi ngày của ${shown}</label>
              <input id=${`sq-p-${p.uid}`} class="quota-input" inputmode="numeric" maxlength="2" value=${p.quota}
                aria-invalid=${bad ? 'true' : undefined} aria-describedby=${`sq-p-${p.uid}-hint`}
                onInput=${(e) => update({ people: draft.people.map((x, j) => (j === i ? { ...x, quota: e.currentTarget.value } : x)) })} />
              <span class="muted small">lượt/ngày</span>
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
      onUndo=${() => { setDraft(quotaDraft(studio)); setMsg({}); setAddError(''); }} />
  </form>`;
}
