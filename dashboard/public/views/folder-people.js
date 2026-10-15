// Phân quyền Bot › Thư mục › Người trong thư mục: người nhắn riêng với bot thì dùng cài đặt của thư mục (và được tính
// là có trong danh sách nhắn riêng). Giao diện chỉ hiện tên; UID chỉ ở ô nhập khi phải gõ tay.
import { useEffect, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html } from '../ui.js';
import { knownNames } from './dm-permissions.js';
import { BulkList, MultiPick } from './multi-pick.js';
import { MoveToFolder, addPeopleToFolder } from './move-to-folder.js';

const UID = /^[1-9]\d{14,21}$/;

/** Người thư mục khác đang giữ: uid → tên thư mục. */
export function peopleElsewhere(folders, fid) {
  const out = new Map();
  for (const f of folders || []) if (f.id !== fid) for (const p of f.people || []) out.set(p.uid, f.name);
  return out;
}

export function FolderPeople({ folder, folders, admin, busy, run, base, onSaved }) {
  const [people, setPeople] = useState(folder.people || []);
  const [known, setKnown] = useState([]);
  const [users, setUsers] = useState([]);
  const [uid, setUid] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setPeople(folder.people || []); }, [folder.id, JSON.stringify(folder.people || [])]);
  useEffect(() => {
    let alive = true;
    api('/api/chats').then((r) => { if (alive) setKnown(r.conversations || []); }, () => {});
    if (admin) api('/api/admin/users').then((r) => { if (alive) setUsers(r.users || []); }, () => {});
    return () => { alive = false; };
  }, []);
  const names = knownNames(known, users);
  const elsewhere = peopleElsewhere(folders, folder.id);
  const have = new Set(people.map((p) => p.uid));
  const options = [...names].filter(([id]) => !have.has(id))
    .map(([id, name]) => ({ uid: id, name, note: elsewhere.has(id) ? `đang ở "${elsewhere.get(id)}"` : '' }));
  const saved = folder.people || [];
  const dirty = people.length !== saved.length || people.some((p, i) => p.uid !== saved[i]?.uid);
  const nameOf = (p) => p.name || names.get(p.uid) || 'Chưa rõ tên';
  function add(id, name) {
    const clean = String(id || '').trim();
    if (!UID.test(clean)) { setError('UID Zalo là dãy 15–22 chữ số, không bắt đầu bằng 0.'); return; }
    if (have.has(clean)) { setError('Người này đã có trong thư mục.'); return; }
    setPeople([...people, { uid: clean, name: name || names.get(clean) || '' }]);
    setUid(''); setError('');
  }
  return html`<details class="perm-box" open=${!saved.length && !folder.groups.length}>
    <summary><span>Người trong thư mục</span><span class="muted perm-box-sum">· ${people.length} người${dirty ? ' (chưa lưu)' : ''}</span></summary>
    <p class="muted small">Người trong thư mục <strong>được nhắn riêng với bot</strong> và dùng đúng các tính năng của thư mục (bên dưới) khi nhắn riêng. Muốn chỉnh riêng một người thì vào Nhắn riêng › Danh sách người. Mỗi người thuộc một thư mục.</p>
    <${BulkList} id="fp-have" label="Người trong thư mục" action="Bỏ khỏi thư mục"
      items=${people.map((p) => ({ uid: p.uid, name: nameOf(p), note: elsewhere.has(p.uid) ? `· sẽ chuyển từ "${elsewhere.get(p.uid)}"` : '' }))}
      onRemove=${(uids) => setPeople(people.filter((x) => !uids.includes(x.uid)))}
      extra=${(sel, clear) => html`<${MoveToFolder} id="fp-move" folders=${folders} exclude=${folder.id} count=${sel.length} unit="người"
        disabled=${dirty || busy !== ''}
        onMove=${async (fid) => {
          const moving = people.filter((p) => sel.includes(p.uid)).map((p) => ({ uid: p.uid, name: nameOf(p) === 'Chưa rõ tên' ? '' : nameOf(p) }));
          const r = await addPeopleToFolder(fid, moving);
          onSaved(r); clear();
          return `Đã chuyển ${moving.length} người sang thư mục "${r.folders.find((f) => f.id === fid)?.name || ''}".`;
        }} />`} />
    ${dirty ? html`<p class="muted small">Lưu danh sách người trước khi chuyển sang thư mục khác.</p>` : null}
    <h4 class="multi-pick-head">Thêm người</h4>
    <${MultiPick} id="fp-pick" options=${options} label="Chọn người đã biết"
      onAdd=${(list) => { setPeople([...people, ...list.map((o) => ({ uid: o.uid, name: o.name || '' }))]); setError(''); }} />
    <div class="dm-add">
      <label for="fp-uid" class="sr-only">UID Zalo</label>
      <input id="fp-uid" inputmode="numeric" maxlength="22" placeholder="Hoặc nhập UID Zalo (15–22 chữ số)" value=${uid}
        onInput=${(e) => { setUid(e.currentTarget.value); setError(''); }} />
      <button type="button" class="btn btn-secondary btn-sm" disabled=${!uid.trim()} onClick=${() => add(uid)}>Thêm</button>
    </div>
    <p class="small dm-add-error" aria-live="polite">${error}</p>
    <div class="row">
      <button type="button" class="btn btn-primary btn-sm" disabled=${busy !== '' || !dirty}
        onClick=${() => run('people', `${base}/people`, 'PUT', { people: people.map((p) => ({ uid: p.uid, name: nameOf(p) === 'Chưa rõ tên' ? '' : nameOf(p) })) }, `Đã lưu ${people.length} người vào thư mục.`)}>Lưu danh sách người</button>
      <button type="button" class="btn btn-ghost btn-sm" disabled=${busy !== '' || !dirty} onClick=${() => setPeople(saved)}>Hoàn tác</button>
    </div>
  </details>`;
}
