// Phiên chat (spec §9): trái là hội thoại + tìm toàn văn; phải là tin nhắn (bot canh phải, khác màu),
// cuộn lên tải tin cũ, ô soạn gửi dưới tên bot. Chữ tin nhắn chỉ đi qua htm — không bao giờ thành HTML.
import { useEffect, useLayoutEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner, fmtTime } from '../ui.js';
import { fold, indexOfFolded, markMatches } from '../fold.js';

export { markMatches };

const LIST_MS = 10_000;
const THREAD_MS = 5_000;
const MAX_TEXT = 2000;
const LEAD = 30; // kết quả tìm: chỗ trùng nằm sâu thì cắt bớt phần đầu, chừa lại chừng này ký tự

const TYPE_LABELS = {
  'chat.photo': 'Ảnh', 'chat.sticker': 'Nhãn dán', 'share.file': 'Tệp', 'chat.voice': 'Tin thoại',
  'chat.video.msg': 'Video', 'group.poll': 'Bình chọn', 'chat.recommended': 'Danh thiếp', 'chat.delete': 'Tin đã thu hồi',
  'chat.gif': 'Ảnh động', 'chat.location.new': 'Vị trí', 'chat.link': 'Liên kết',
};

const keyOf = (c) => `${c.threadType}:${c.threadId}`;

export function messageView(m) {
  const label = TYPE_LABELS[m.msgType] || null;
  const raw = String(m.text ?? '');
  const trimmed = raw.trim();
  if (/^https:\/\/\S+$/.test(trimmed)) return { label: label || 'Liên kết', text: '', link: trimmed };
  // Bot lưu sẵn "[Nhãn dán]"… cho tin không có chữ — nhãn đã nói đủ, không lặp lại.
  return { label, text: label && /^\[[^\]]*\]$/.test(trimmed) ? '' : raw, link: null };
}

export function mergeMessages(a, b) {
  const byId = new Map();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.ts - y.ts || x.id - y.id);
}

export function preview(c) {
  const v = messageView({ msgType: c.lastMsgType, text: c.lastText });
  return `${c.lastIsSelf ? 'Bot: ' : ''}${v.text || (v.label ? `[${v.label}]` : '')}`;
}

function ConvItem({ c, active, onSelect }) {
  return html`<li><button type="button" class=${`conv${active ? ' active' : ''}`} aria-current=${active ? 'true' : undefined} onClick=${() => onSelect(c)}>
    <span class="conv-top"><span class="conv-name">${c.name}</span><time class="conv-time">${fmtTime(c.lastAtMs)}</time></span>
    <span class="conv-sub">${c.threadType === 1 ? html`<span class="tag">Nhóm</span>` : null}<span class="conv-preview">${preview(c)}</span></span>
  </button></li>`;
}

function ResultItem({ r, q, onSelect }) {
  const v = messageView(r);
  const who = r.isSelf ? 'Bot: ' : r.senderName ? `${r.senderName}: ` : '';
  let text = v.text;
  const at = indexOfFolded(text, q);
  if (at > LEAD * 2) text = `…${text.slice(at - LEAD)}`;
  return html`<li><button type="button" class="conv" onClick=${() => onSelect({ threadId: r.threadId, threadType: r.threadType, name: r.threadName })}>
    <span class="conv-top"><span class="conv-name">${r.threadName}</span><time class="conv-time">${fmtTime(r.ts)}</time></span>
    <span class="conv-preview conv-wrap">${who}${text
      ? markMatches(text, q).map((s) => (s.hit ? html`<mark>${s.text}</mark>` : s.text))
      : (v.label ? `[${v.label}]` : '')}</span>
  </button></li>`;
}

function Bubble({ m, group }) {
  const v = messageView(m);
  return html`<li class=${`msg${m.isSelf ? ' msg-self' : ''}`}>
    ${group && !m.isSelf ? html`<span class="msg-from">${m.senderName || 'Thành viên'}</span>` : null}
    <div class="msg-bubble">
      ${v.label ? html`<span class="msg-kind">[${v.label}]</span> ` : null}
      ${v.link ? html`<a href=${v.link} target="_blank" rel="noopener noreferrer">Mở ${v.label ? v.label.toLowerCase() : 'liên kết'}</a>` : null}
      ${v.text ? html`<span class="msg-text">${v.text}</span>` : null}
    </div>
    <time class="msg-time" datetime=${new Date(m.ts).toISOString()}>${m.isSelf ? 'Bot · ' : ''}${fmtTime(m.ts)}</time>
  </li>`;
}

function Compose({ conv, onSent }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  async function send(e) {
    e?.preventDefault();
    if (busy) return;
    const body = text.trim();
    if (!body) { setMsg({ error: 'Nội dung đang trống — gõ tin nhắn rồi gửi.' }); return; }
    if (body.length > MAX_TEXT) { setMsg({ error: `Tin nhắn dài quá ${MAX_TEXT} ký tự — rút gọn hoặc chia làm nhiều tin.` }); return; }
    setBusy(true); setMsg({});
    try {
      await api(`/api/chats/${encodeURIComponent(conv.threadId)}/send`, { method: 'POST', body: { text: body, threadType: conv.threadType } });
      setText((cur) => (cur.trim() === body ? '' : cur)); setMsg({ ok: 'Đã gửi dưới tên bot.' }); onSent();
    } catch (err) { setMsg({ error: err.message }); } finally { setBusy(false); }
  }
  return html`<form class="compose" onSubmit=${send} novalidate>
    <label for="chat-compose" class="sr-only">Tin nhắn gửi dưới tên bot</label>
    <textarea id="chat-compose" rows="2" maxlength=${MAX_TEXT} value=${text} readOnly=${busy} placeholder="Nhắn dưới tên bot… (Ctrl+Enter để gửi)"
      aria-describedby="chat-compose-help" onInput=${(e) => setText(e.currentTarget.value)}
      onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }}></textarea>
    <div class="compose-foot">
      <small class="muted"><span id="chat-compose-help">Tin gửi dưới tên bot, ghi vào Nhật ký kèm tên bạn.</span> ${text.length}/${MAX_TEXT}</small>
      <button class="btn btn-primary btn-sm" disabled=${busy}><${Icon} name="send" size=${16} /> ${busy ? 'Đang gửi…' : 'Gửi'}</button>
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

function Thread({ conv, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [older, setOlder] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);
  const atBottom = useRef(true);   // đang ở đáy → có tin mới thì cuộn theo
  const anchor = useRef(null);     // khoảng cách tới đáy trước khi chèn tin cũ — giữ nguyên chỗ đang đọc
  const olderBusy = useRef(false);
  const kick = useRef(() => {});
  const base = `/api/chats/${encodeURIComponent(conv.threadId)}/messages?type=${conv.threadType}`;

  // Poll trang mới nhất 5 s/lần, không chồng yêu cầu; gộp theo id nên tin cũ đã tải không mất.
  useEffect(() => {
    let alive = true; let timer = null; let inflight = false; let again = false; let first = true;
    const tick = async () => {
      if (inflight) { again = true; return; }
      clearTimeout(timer); inflight = true;
      try {
        const r = await api(base);
        if (!alive) return;
        setMsgs((cur) => mergeMessages(cur || [], r.messages));
        if (first) { setOlder(r.nextBefore); first = false; }
        setError('');
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        inflight = false;
        const next = again ? 0 : THREAD_MS; again = false;
        if (alive) timer = setTimeout(tick, next);
      }
    };
    kick.current = () => { atBottom.current = true; tick(); };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [base]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (anchor.current != null) { el.scrollTop = el.scrollHeight - anchor.current; anchor.current = null; }
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function loadOlder() {
    if (!older || olderBusy.current) return;
    olderBusy.current = true; setLoadingOlder(true);
    try {
      const r = await api(`${base}&before=${encodeURIComponent(older)}`);
      const el = box.current;
      anchor.current = el ? el.scrollHeight - el.scrollTop : null;
      setMsgs((cur) => mergeMessages(r.messages, cur || []));
      setOlder(r.nextBefore);
    } catch (err) { setError(err.message); } finally { olderBusy.current = false; setLoadingOlder(false); }
  }

  function onScroll(e) {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 40) loadOlder();
  }

  const group = conv.threadType === 1;
  return html`
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${conv.name}</h2>
      ${group ? html`<span class="tag">Nhóm</span>` : null}
    </header>
    <${Live} error=${error} />
    ${msgs === null ? html`<${Spinner} />` : html`
      <ol class="msgs" ref=${box} tabindex="0" onScroll=${onScroll} aria-label=${`Tin nhắn với ${conv.name}`}>
        <li class="msgs-top">
          ${older
            ? html`<button type="button" class="btn btn-ghost btn-sm" disabled=${loadingOlder} onClick=${loadOlder}>${loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}</button>`
            : html`<span class="muted small">${msgs.length ? 'Đầu cuộc trò chuyện' : 'Chưa có tin nhắn nào.'}</span>`}
        </li>
        ${msgs.map((m) => html`<${Bubble} key=${m.id} m=${m} group=${group} />`)}
      </ol>`}
    <${Compose} conv=${conv} onSent=${() => kick.current()} />`;
}

export function Chats() {
  const [list, setList] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [listError, setListError] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // { q, items, next } khi đang xem kết quả tìm
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selected, setSelected] = useState(null);
  const searchSeq = useRef(0); // bỏ kết quả về muộn của lần tìm đã bị thay hoặc huỷ

  useEffect(() => {
    let alive = true; let timer = null;
    const tick = async () => {
      try {
        const r = await api('/api/chats');
        if (!alive) return;
        setList(r.conversations); setUnavailable(Boolean(r.unavailable)); setListError('');
      } catch (err) {
        if (alive) { setListError(err.message); setList((cur) => cur || []); }
      }
      if (alive) timer = setTimeout(tick, LIST_MS);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  function clearSearch() { searchSeq.current += 1; setFound(null); setSearching(false); setSearchError(''); }

  async function search(e, more = null) {
    e?.preventDefault();
    // "Xem thêm" tiếp tục đúng từ khoá đã tìm, kể cả khi ô tìm đã bị sửa.
    const q = more ? more.q : query.trim();
    if (q.length < 2 || q.length > 100) { setSearchError('Nhập từ 2 đến 100 ký tự để tìm trong tin nhắn.'); return; }
    const seq = ++searchSeq.current;
    setSearching(true); setSearchError('');
    try {
      const params = new URLSearchParams(more ? { q, before: more.next } : { q });
      const r = await api(`/api/chats/search?${params}`);
      if (seq !== searchSeq.current) return;
      setFound((cur) => ({ q, items: more && cur ? [...cur.items, ...r.results] : r.results, next: r.nextBefore }));
    } catch (err) {
      if (seq === searchSeq.current) setSearchError(err.message);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  const needle = fold(query.trim());
  const shown = (list || []).filter((c) => !needle || fold(c.name).includes(needle));
  let left;
  if (found) {
    left = html`
      <div class="row found-head">
        <span class="muted small">${found.items.length ? `Kết quả cho “${found.q}”` : `Không thấy tin nào có “${found.q}”.`}</span>
        <button type="button" class="link" onClick=${() => { clearSearch(); setQuery(''); }}>Quay lại danh sách</button>
      </div>
      <ul class="conv-list">${found.items.map((r) => html`<${ResultItem} key=${r.id} r=${r} q=${found.q} onSelect=${setSelected} />`)}</ul>
      ${found.next ? html`<button type="button" class="btn btn-ghost btn-sm" disabled=${searching} onClick=${() => search(null, found)}>${searching ? 'Đang tìm…' : 'Xem thêm kết quả'}</button>` : null}`;
  } else if (list === null) {
    left = html`<${Spinner} />`;
  } else if (!shown.length) {
    left = html`<p class="muted small">${list.length ? 'Không có hội thoại nào trùng tên — bấm Enter để tìm trong nội dung tin nhắn.' : 'Chưa có hội thoại nào.'}</p>`;
  } else {
    left = html`<ul class="conv-list">${shown.map((c) => html`<${ConvItem} key=${keyOf(c)} c=${c}
      active=${Boolean(selected) && keyOf(selected) === keyOf(c)} onSelect=${setSelected} />`)}</ul>`;
  }

  return html`
    <${PageHead} title="Phiên chat" sub="Xem tin nhắn của bot và nhắn tay dưới tên bot khi cần." />
    ${unavailable ? html`<${Notice} kind="info">Chưa có lịch sử trò chuyện — bot cần đăng nhập Zalo và nhận tin trước. Nếu bot đã chạy lâu mà vẫn thấy dòng này, hãy báo người cài đặt.<//>` : null}
    <div class=${`chat${selected ? ' has-thread' : ''}`}>
      <section class="card chat-list" aria-label="Hội thoại">
        <form class="chat-search" role="search" onSubmit=${search} novalidate>
          <label for="chat-q" class="sr-only">Lọc theo tên, hoặc Enter để tìm trong tin nhắn</label>
          <input id="chat-q" type="search" maxlength="100" placeholder="Lọc tên, Enter để tìm trong tin nhắn" value=${query}
            onInput=${(e) => { setQuery(e.currentTarget.value); if (!e.currentTarget.value) clearSearch(); }} />
          <button class="btn btn-secondary btn-sm" disabled=${searching} aria-label="Tìm trong tin nhắn"><${Icon} name="search" size=${16} /></button>
        </form>
        <${Live} error=${searchError || listError} />
        ${left}
      </section>
      <section class="card chat-thread" aria-label="Tin nhắn">
        ${selected
          ? html`<${Thread} key=${keyOf(selected)} conv=${selected} onBack=${() => setSelected(null)} />`
          : html`<p class="muted chat-empty">Chọn một hội thoại bên trái để xem tin nhắn.</p>`}
      </section>
    </div>`;
}
