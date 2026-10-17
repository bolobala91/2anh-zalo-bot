// Phiên chat › Thành viên nhóm (giống Zalo): ảnh đại diện, tên, nhãn Trưởng nhóm / Phó nhóm / Bot, lọc theo tên.
// Nhóm cộng đồng Zalo giấu danh sách (chỉ trả trưởng/phó) → máy chủ gộp thêm người từng nhắn trong nhóm.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon } from '../ui.js';
import { fold } from '../fold.js';
import { Avatar } from './chat-info.js';

const num = (n) => new Intl.NumberFormat('vi-VN').format(n);
const ROLE = { owner: 'Trưởng nhóm', admin: 'Phó nhóm' };
const RANK = { owner: 0, admin: 1 };

/** Trưởng nhóm → phó nhóm → bot → còn lại theo tên. */
export function sortMembers(list) {
  const rank = (m) => (m.role ? RANK[m.role] : m.self ? 2 : 3);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'vi'));
}

/** Lọc theo tên, không phân biệt dấu ("hai anh" khớp "Hải Anh"). */
export function filterMembers(list, q) {
  const k = fold(q).trim();
  return k ? list.filter((m) => fold(m.name).includes(k)) : list;
}

export function MembersPanel({ conv, onClose }) {
  const [state, setState] = useState(null); // { total, listed, members } | { error }
  const [q, setQ] = useState('');
  const input = useRef(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    api(`/api/chats/${encodeURIComponent(conv.threadId)}/members?full=1`)
      .then((r) => { if (alive) setState({ total: r.total, listed: r.listed ?? r.members.length, members: sortMembers(r.members) }); },
        (e) => { if (alive) setState({ error: e.message }); });
    return () => { alive = false; };
  }, [conv.threadId]);
  useEffect(() => { input.current?.focus(); }, []);
  const shown = state?.members ? filterMembers(state.members, q) : [];
  const partial = state?.members && state.listed < state.total;
  return html`<aside class="side-panel members-panel" aria-label="Thành viên nhóm" onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); }}>
    <header class="side-head">
      <h3>Thành viên${state?.total ? ` (${num(state.total)})` : ''}</h3>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Đóng danh sách thành viên"><${Icon} name="close" /></button>
    </header>
    <div class="chat-search">
      <label for="member-q" class="sr-only">Tìm thành viên theo tên</label>
      <input id="member-q" ref=${input} type="search" maxlength="60" placeholder="Tìm theo tên" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
    </div>
    <div class="side-body">
      ${!state ? html`<p class="muted small">Đang tải danh sách thành viên…</p>`
        : state.error ? html`<p class="muted small" role="alert">${state.error}</p>`
          : html`
            ${partial ? html`<p class="muted small member-note">Zalo chỉ cho xem ${num(state.listed)}/${num(state.total)} người của nhóm này (nhóm cộng đồng chỉ hiện trưởng, phó nhóm). Danh sách có thêm những người từng nhắn trong nhóm.</p>` : null}
            ${q.trim() ? html`<p class="muted small" aria-live="polite">${shown.length ? `${num(shown.length)} người khớp` : 'Không có ai khớp tên này.'}</p>` : null}
            <ul class="member-list">${shown.map((m) => html`<li key=${m.uid} class="member-row">
              <${Avatar} name=${m.name} url=${m.avatar || ''} />
              <span class="member-name">${m.name}</span>
              ${m.role ? html`<span class=${`badge member-role role-${m.role}`}>${ROLE[m.role]}</span>` : null}
              ${m.self ? html`<span class="badge member-role role-bot">Bot</span>` : null}
            </li>`)}</ul>`}
    </div>
  </aside>`;
}
