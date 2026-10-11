// Phiên chat (spec §9): trái là hội thoại + tìm toàn văn; phải là tin nhắn (bot canh phải, khác màu),
// cuộn lên tải tin cũ, ô soạn gửi dưới tên bot. Chữ tin nhắn chỉ đi qua htm — không bao giờ thành HTML.
import { useEffect, useLayoutEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Notice, PageHead, Spinner, fmtTime } from '../ui.js';
import { fold, indexOfFolded, markMatches } from '../fold.js';
import { classifyMedia } from '../media.js';
import { FileCard, Lightbox, MediaPanel, Thumb, VideoCard } from './chat-media.js';

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

// Zalo gửi link chia sẻ (Drive, Docs…) cũng dưới loại chat.recommended như danh thiếp — gọi đúng tên theo trang.
const SITE_NAMES = [
  ['drive.google.com', 'Google Drive'], ['docs.google.com', 'Google Docs'], ['forms.gle', 'Google Forms'],
  ['forms.google.com', 'Google Forms'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'],
  ['facebook.com', 'Facebook'], ['fb.watch', 'Facebook'], ['tiktok.com', 'TikTok'], ['zalo.me', 'Zalo'],
];

export function siteName(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  const hit = SITE_NAMES.find(([h]) => host === h || host.endsWith(`.${h}`));
  return hit ? hit[1] : null;
}

/** Link rút gọn để hiện: tên máy + đường dẫn, cắt bớt nếu dài. */
export function shortUrl(url, max = 48) {
  let s = url;
  try { const u = new URL(url); s = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname); } catch { /* giữ nguyên */ }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const keyOf = (c) => `${c.threadType}:${c.threadId}`;

export function messageView(m) {
  const label = TYPE_LABELS[m.msgType] || null;
  const raw = String(m.text ?? '');
  // Ảnh/tệp/video trên máy chủ Zalo: vẽ thành ảnh thu nhỏ hoặc thẻ (xem chat-media.js).
  const media = classifyMedia(m.msgType, raw);
  if (media) return { label, text: media.kind === 'file' ? '' : media.caption, link: null, media };
  const trimmed = raw.trim();
  if (/^https:\/\/\S+$/.test(trimmed)) {
    const linkLabel = siteName(trimmed) || (m.msgType === 'chat.recommended' ? 'Liên kết' : label) || 'Liên kết';
    return { label: linkLabel, text: '', link: trimmed, media: null };
  }
  // Bot lưu sẵn "[Nhãn dán]"… cho tin không có chữ — nhãn đã nói đủ, không lặp lại.
  return { label, text: label && /^\[[^\]]*\]$/.test(trimmed) ? '' : raw, link: null, media: null };
}

/** Đoạn chữ quanh chỗ trùng: chỗ trùng nằm sâu thì cắt bớt phần đầu. */
export function snippet(text, q) {
  const s = String(text ?? '');
  const at = indexOfFolded(s, q);
  return at > LEAD * 2 ? `…${s.slice(at - LEAD)}` : s;
}

const hits = (text, q) => markMatches(text, q).map((s) => (s.hit ? html`<mark>${s.text}</mark>` : s.text));

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
  const text = snippet(v.text, q);
  return html`<li><button type="button" class="conv" onClick=${() => onSelect({ threadId: r.threadId, threadType: r.threadType, name: r.threadName })}>
    <span class="conv-top"><span class="conv-name">${r.threadName}</span><time class="conv-time">${fmtTime(r.ts)}</time></span>
    <span class="conv-preview conv-wrap">${who}${text ? hits(text, q) : (v.label ? `[${v.label}]` : '')}</span>
  </button></li>`;
}

/** Đang gõ "@abc" ngay trước con trỏ (đầu dòng hoặc sau khoảng trắng) → "abc"; không thì null. */
export function mentionQuery(beforeCaret) {
  const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(String(beforeCaret || ''));
  return m ? m[1] : null;
}

/**
 * Vị trí tag trên nội dung gửi đi (đã cắt khoảng trắng): mỗi tên đã chọn tìm "@Tên" lần lượt từ trái sang;
 * tên đã bị xoá khỏi ô thì bỏ. Trả [{ pos, len, uid? | msg? }].
 */
export function placeMentions(body, picks) {
  const out = [];
  let from = 0;
  for (const p of picks) {
    const tag = `@${p.name}`;
    const pos = body.indexOf(tag, from);
    if (pos < 0) continue;
    out.push({ pos, len: tag.length, ...(p.uid ? { uid: p.uid } : { msg: p.msg }) });
    from = pos + tag.length;
  }
  return out;
}

const LONG_PRESS_MS = 450;

function Bubble({ m, group, focus, onOpenPhoto, active, onActive, onReply, onMention }) {
  const v = messageView(m);
  const md = v.media;
  const timer = useRef(0);
  const start = useRef(null);
  // Bấm giữ (điện thoại) hoặc chuột phải → hiện nút Trả lời / Nhắc tên / Chép; máy tính rê chuột là thấy.
  const press = (e) => { const t = e.touches?.[0]; start.current = t ? [t.clientX, t.clientY] : null; clearTimeout(timer.current); timer.current = setTimeout(() => onActive(m.id), LONG_PRESS_MS); };
  const move = (e) => { const t = e.touches?.[0]; if (start.current && t && Math.hypot(t.clientX - start.current[0], t.clientY - start.current[1]) > 10) clearTimeout(timer.current); };
  const release = () => clearTimeout(timer.current);
  const copy = async () => { try { await navigator.clipboard.writeText(v.text || v.link || ''); } catch { /* trình duyệt chặn */ } onActive(null); };
  const canMention = group && !m.isSelf;
  const li = useRef(null);
  // Hiện nút thao tác cho tin sát mép khung (vd. tin cuối) → cuộn cho thấy trọn, kẻo nút bị khung cắt mất.
  useEffect(() => { if (active) li.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [active]);
  return html`<li ref=${li} id=${`msg-${m.id}`} class=${`msg${m.isSelf ? ' msg-self' : ''}${focus ? ' msg-focus' : ''}${active ? ' msg-active' : ''}`}>
    ${group && !m.isSelf ? html`<span class="msg-from">${m.senderName || 'Thành viên'}</span>` : null}
    <div class="msg-row">
    <div class=${`msg-bubble${md ? ' msg-media' : ''}`} onTouchStart=${press} onTouchMove=${move} onTouchEnd=${release} onTouchCancel=${release}
      onContextMenu=${(e) => { e.preventDefault(); onActive(m.id); }}>
      ${md?.kind === 'photo' ? html`<${Thumb} url=${md.url} alt=${md.caption || `Ảnh của ${m.isSelf ? 'bot' : (m.senderName || 'thành viên')}`} onOpen=${() => onOpenPhoto(m.id)} />` : null}
      ${md?.kind === 'file' ? html`<${FileCard} name=${md.name} url=${md.url} ext=${md.ext} />` : null}
      ${md?.kind === 'video' ? html`<${VideoCard} url=${md.url} />` : null}
      ${!md && v.label ? html`<span class="msg-kind">[${v.label}]</span> ` : null}
      ${v.link ? html`<a href=${v.link} target="_blank" rel="noopener noreferrer" title=${v.link}>${shortUrl(v.link)}</a>` : null}
      ${v.text ? html`<span class="msg-text">${v.text}</span>` : null}
    </div>
    <span class="msg-actions" role="group" aria-label="Thao tác với tin">
      <button type="button" class="msg-act" onClick=${() => { onReply(m); onActive(null); }} aria-label="Trả lời tin này" title="Trả lời"><${Icon} name="reply" size=${16} /><span>Trả lời</span></button>
      ${canMention ? html`<button type="button" class="msg-act" onClick=${() => { onMention(m); onActive(null); }} aria-label=${`Nhắc tên ${m.senderName || 'thành viên'}`} title="Nhắc tên (@)"><span aria-hidden="true">@</span><span>Nhắc tên</span></button>` : null}
      ${v.text || v.link ? html`<button type="button" class="msg-act" onClick=${copy} aria-label="Chép nội dung" title="Chép"><${Icon} name="copy" size=${16} /><span>Chép</span></button>` : null}
    </span>
    </div>
    <time class="msg-time" datetime=${new Date(m.ts).toISOString()}>${m.isSelf ? 'Bot · ' : ''}${fmtTime(m.ts)}</time>
  </li>`;
}

/** Bảng tìm trong một hội thoại; bấm kết quả thì khung tin nhảy tới đúng tin đó. */
function ThreadSearch({ conv, onJump, onClose }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null); // { q, items, next }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);

  async function search(e, more = null) {
    e?.preventDefault();
    const term = more ? more.q : q.trim();
    if (term.length < 2 || term.length > 100) { setError('Nhập từ 2 đến 100 ký tự để tìm trong hội thoại này.'); return; }
    const my = ++seq.current;
    setBusy(true); setError('');
    try {
      const params = new URLSearchParams({ type: String(conv.threadType), q: term, ...(more ? { before: more.next } : {}) });
      const r = await api(`/api/chats/${encodeURIComponent(conv.threadId)}/search?${params}`);
      if (my !== seq.current) return;
      setFound((cur) => ({ q: term, items: more && cur ? [...cur.items, ...r.results] : r.results, next: r.nextBefore }));
    } catch (err) {
      if (my === seq.current) setError(err.message);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  return html`<aside class="side-panel" aria-label="Tìm trong hội thoại" onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); }}>
    <header class="side-head">
      <h3>Tìm trong hội thoại</h3>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Đóng bảng tìm"><${Icon} name="close" /></button>
    </header>
    <form class="chat-search" role="search" onSubmit=${search} novalidate>
      <label for="thread-q" class="sr-only">Từ khoá tìm trong hội thoại này</label>
      <input id="thread-q" ref=${input} type="search" maxlength="100" placeholder="Nhập từ khoá rồi Enter" value=${q}
        onInput=${(e) => setQ(e.currentTarget.value)} />
      <button class="btn btn-secondary btn-sm" disabled=${busy} aria-label="Tìm trong hội thoại"><${Icon} name="search" size=${16} /></button>
    </form>
    <${Live} error=${error} />
    <div class="side-body">
      ${!found
        ? html`<p class="muted small">${busy ? 'Đang tìm…' : 'Tìm không phân biệt hoa thường và dấu: “hoc sinh” cũng thấy “học sinh”.'}</p>`
        : !found.items.length
          ? html`<p class="muted small">Không thấy tin nào có “${found.q}” trong hội thoại này — thử từ khoá ngắn hơn.</p>`
          : html`<p class="muted small" aria-live="polite">Kết quả cho “${found.q}” — bấm để xem tin trong khung chat.</p>
            <ul class="conv-list">${found.items.map((r) => {
              const v = messageView(r);
              const text = snippet(v.text, found.q);
              return html`<li key=${r.id}><button type="button" class="conv" onClick=${() => onJump(r)}>
                <span class="conv-top"><span class="conv-name">${r.isSelf ? 'Bot' : (r.senderName || 'Thành viên')}</span><time class="conv-time">${fmtTime(r.ts)}</time></span>
                <span class="conv-preview conv-wrap">${text ? hits(text, found.q) : (v.label ? `[${v.label}]` : '')}</span>
              </button></li>`;
            })}</ul>`}
      ${found?.next ? html`<button type="button" class="btn btn-ghost btn-sm panel-more" disabled=${busy} onClick=${() => search(null, found)}>${busy ? 'Đang tìm…' : 'Xem thêm kết quả'}</button>` : null}
    </div>
  </aside>`;
}

/**
 * Ô soạn gửi dưới tên bot. Trả lời: thanh "Đang trả lời …" (gửi kèm trích dẫn). Nhóm: gõ "@" hiện danh sách thành viên
 * để gắn tag thật; "Nhắc tên" từ một tin chèn "@Tên " của người gửi tin đó.
 */
function Compose({ conv, onSent, reply, onClearReply, mentionReq }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({});
  const [picks, setPicks] = useState([]); // [{ name, uid? , msg? }]
  const [members, setMembers] = useState(null); // null = chưa tải; [] khi lỗi/không có
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState(null); // chuỗi sau "@" đang gõ, null = không gợi ý
  const [hi, setHi] = useState(0);
  const area = useRef(null);
  const group = conv.threadType === 1;

  useEffect(() => { setText(''); setPicks([]); setMembers(null); setQuery(null); }, [conv.threadId]);
  function insertAt(pos, removeLen, insert) {
    const el = area.current;
    const next = text.slice(0, pos) + insert + text.slice(pos + removeLen);
    setText(next);
    requestAnimationFrame(() => { if (el) { el.focus(); const c = pos + insert.length; el.setSelectionRange(c, c); } });
  }
  // "Nhắc tên" từ một tin: chèn "@Tên " vào chỗ con trỏ.
  useEffect(() => {
    if (!mentionReq) return;
    const name = mentionReq.name.trim();
    if (!name) return;
    const el = area.current;
    const pos = el ? el.selectionStart ?? text.length : text.length;
    const lead = pos > 0 && !/\s$/.test(text.slice(0, pos)) ? ' ' : '';
    insertAt(pos, 0, `${lead}@${name} `);
    setPicks((p) => [...p, { name, msg: mentionReq.msg }]);
  }, [mentionReq]);
  useEffect(() => { if (reply) area.current?.focus(); }, [reply]);

  async function loadMembers() {
    if (members !== null || loading || !group) return;
    setLoading(true);
    try { setMembers((await api(`/api/chats/${encodeURIComponent(conv.threadId)}/members`)).members); } catch { setMembers([]); } finally { setLoading(false); }
  }
  function onInput(e) {
    const el = e.currentTarget;
    setText(el.value);
    const q = group ? mentionQuery(el.value.slice(0, el.selectionStart)) : null;
    setQuery(q); setHi(0);
    if (q !== null) loadMembers();
  }
  const n = query === null ? '' : fold(query);
  const suggestions = query === null || !members ? [] : members.filter((m) => !n || fold(m.name).includes(n)).slice(0, 8);
  function pick(m) {
    const el = area.current;
    const caret = el ? el.selectionStart : text.length;
    const start = caret - (query?.length ?? 0) - 1;
    insertAt(start, caret - start, `@${m.name} `);
    setPicks((p) => [...p, { name: m.name, uid: m.uid }]);
    setQuery(null);
  }

  async function send(e) {
    e?.preventDefault();
    if (busy) return;
    const body = text.trim();
    if (!body) { setMsg({ error: 'Nội dung đang trống — gõ tin nhắn rồi gửi.' }); return; }
    if (body.length > MAX_TEXT) { setMsg({ error: `Tin nhắn dài quá ${MAX_TEXT} ký tự — rút gọn hoặc chia làm nhiều tin.` }); return; }
    setBusy(true); setMsg({});
    const mentions = group ? placeMentions(body, picks) : [];
    try {
      await api(`/api/chats/${encodeURIComponent(conv.threadId)}/send`, {
        method: 'POST', body: { text: body, threadType: conv.threadType, ...(reply ? { replyTo: reply.id } : {}), ...(mentions.length ? { mentions } : {}) },
      });
      setText((cur) => (cur.trim() === body ? '' : cur)); setPicks([]); onClearReply();
      setMsg({ ok: 'Đã gửi dưới tên bot.' }); onSent();
    } catch (err) {
      // 504: chưa rõ tin đã đi chưa; 409: vừa gửi đúng tin này. Giữ nguyên chữ trong ô, làm mới khung tin để người dùng tự kiểm.
      setMsg({ error: err.message });
      if (err.status === 504 || err.status === 409) onSent();
    } finally { setBusy(false); }
  }
  function onKeyDown(e) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[hi] || suggestions[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
  }
  const replyView = reply ? messageView(reply) : null;
  return html`<form class="compose" onSubmit=${send} novalidate>
    ${reply ? html`<div class="reply-bar">
      <${Icon} name="reply" size=${16} />
      <span class="reply-main"><strong>Trả lời ${reply.isSelf ? 'Bot' : (reply.senderName || 'thành viên')}</strong>
        <small class="muted reply-text">${replyView.text || (replyView.label ? `[${replyView.label}]` : '')}</small></span>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClearReply} aria-label="Bỏ trả lời"><${Icon} name="close" size=${16} /></button>
    </div>` : null}
    ${query !== null && group ? html`<ul class="mention-list" role="listbox" aria-label="Chọn người để nhắc tên">
      ${loading ? html`<li class="muted small mention-empty">Đang tải thành viên…</li>` : null}
      ${members && !members.length ? html`<li class="muted small mention-empty">Chưa lấy được danh sách thành viên — vẫn có thể bấm giữ một tin rồi chọn Nhắc tên.</li>` : null}
      ${members && members.length && !suggestions.length ? html`<li class="muted small mention-empty">Không thấy ai tên “${query}”.</li>` : null}
      ${suggestions.map((m, i) => html`<li key=${m.uid} role="option" aria-selected=${i === hi ? 'true' : 'false'}>
        <button type="button" class=${`mention-item${i === hi ? ' active' : ''}`} onMouseDown=${(e) => e.preventDefault()} onClick=${() => pick(m)}>@${m.name}</button></li>`)}
    </ul>` : null}
    <label for="chat-compose" class="sr-only">Tin nhắn gửi dưới tên bot</label>
    <textarea id="chat-compose" ref=${area} rows="2" maxlength=${MAX_TEXT} value=${text} readOnly=${busy}
      placeholder=${group ? (narrow() ? 'Nhắn dưới tên bot… (@ để nhắc tên)' : 'Nhắn dưới tên bot… (@ để nhắc tên, Ctrl+Enter để gửi)') : (narrow() ? 'Nhắn dưới tên bot…' : 'Nhắn dưới tên bot… (Ctrl+Enter để gửi)')}
      aria-describedby="chat-compose-help" aria-autocomplete=${group ? 'list' : undefined} onInput=${onInput} onKeyDown=${onKeyDown}
      onBlur=${() => setTimeout(() => setQuery(null), 150)}></textarea>
    <div class="compose-foot">
      <small class="muted"><span id="chat-compose-help">Tin gửi dưới tên bot, ghi vào Nhật ký kèm tên bạn.</span> ${text.length}/${MAX_TEXT}</small>
      <button class="btn btn-primary btn-sm" disabled=${busy}><${Icon} name="send" size=${16} /> ${busy ? 'Đang gửi…' : 'Gửi'}</button>
    </div>
    <${Live} error=${msg.error} ok=${msg.ok} />
  </form>`;
}

const FLASH_MS = 2500;
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;

function Thread({ conv, onBack }) {
  const [reply, setReply] = useState(null); // tin đang trả lời
  const [active, setActive] = useState(null); // id tin đang mở nút thao tác (bấm giữ)
  const [mentionReq, setMentionReq] = useState(null); // { name, msg, n } — chèn @Tên vào ô soạn
  useEffect(() => { setReply(null); setActive(null); }, [conv.threadId]);
  useEffect(() => {
    if (active === null) return undefined;
    const close = (e) => { if (!e.target.closest?.('.msg-actions')) setActive(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [active]);
  const [msgs, setMsgs] = useState(null);
  const [older, setOlder] = useState(null);
  const [newer, setNewer] = useState(null); // khác null: đang xem một đoạn cũ (sau khi nhảy tới kết quả tìm)
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [error, setError] = useState('');
  const [side, setSide] = useState(null); // 'search' | 'media'
  const [flash, setFlash] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { items, index }
  const box = useRef(null);
  const atBottom = useRef(true);   // đang ở đáy → có tin mới thì cuộn theo
  const anchor = useRef(null);     // khoảng cách tới đáy trước khi chèn tin cũ — giữ nguyên chỗ đang đọc
  const scrollTo = useRef(null);   // id tin cần đưa vào giữa khung sau lần vẽ kế tiếp
  const olderBusy = useRef(false);
  const newerBusy = useRef(false);
  const detached = useRef(false);  // đang xem đoạn cũ: không gộp trang mới nhất vào (sẽ hở một khoảng)
  const first = useRef(true);
  const view = useRef(0);          // tăng mỗi lần thay cả khung tin (nhảy tới tin, về tin mới nhất)
  const kick = useRef(() => {});
  const base = `/api/chats/${encodeURIComponent(conv.threadId)}/messages?type=${conv.threadType}`;

  // Poll trang mới nhất 5 s/lần, không chồng yêu cầu; gộp theo id nên tin cũ đã tải không mất.
  useEffect(() => {
    let alive = true; let timer = null; let inflight = false; let again = false;
    const tick = async () => {
      if (inflight) { again = true; return; }
      clearTimeout(timer); inflight = true;
      try {
        const r = await api(base);
        if (!alive) return;
        if (!detached.current) {
          setMsgs((cur) => mergeMessages(cur || [], r.messages));
          if (first.current) { setOlder(r.nextBefore); first.current = false; }
        }
        setError('');
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        inflight = false;
        const next = again ? 0 : THREAD_MS; again = false;
        if (alive) timer = setTimeout(tick, next);
      }
    };
    kick.current = () => {
      if (detached.current) {
        // Về tin mới nhất: bỏ đoạn đang xem, tải lại từ đầu như lúc mới mở hội thoại.
        view.current += 1; detached.current = false; first.current = true;
        setMsgs(null); setOlder(null); setNewer(null);
      }
      atBottom.current = true; tick();
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [base]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (scrollTo.current != null) {
      const target = el.querySelector(`#msg-${scrollTo.current}`);
      // Đưa tin vào giữa khung; tin cao hơn khung thì canh đầu tin.
      if (target) el.scrollTop = target.offsetTop - Math.max(8, (el.clientHeight - target.offsetHeight) / 2);
      scrollTo.current = null;
    } else if (anchor.current != null) { el.scrollTop = el.scrollHeight - anchor.current; anchor.current = null; }
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    if (flash == null) return undefined;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  async function loadOlder() {
    if (!older || olderBusy.current) return;
    olderBusy.current = true; setLoadingOlder(true);
    const v = view.current;
    try {
      const r = await api(`${base}&before=${encodeURIComponent(older)}`);
      if (v !== view.current) return;
      const el = box.current;
      anchor.current = el ? el.scrollHeight - el.scrollTop : null;
      setMsgs((cur) => mergeMessages(r.messages, cur || []));
      setOlder(r.nextBefore);
    } catch (err) { setError(err.message); } finally { olderBusy.current = false; setLoadingOlder(false); }
  }

  async function loadNewer() {
    if (!newer || newerBusy.current) return;
    newerBusy.current = true; setLoadingNewer(true);
    const v = view.current;
    try {
      const r = await api(`${base}&after=${encodeURIComponent(newer)}`);
      if (v !== view.current) return;
      setMsgs((cur) => mergeMessages(cur || [], r.messages));
      setNewer(r.nextAfter);
      if (!r.nextAfter) detached.current = false; // đã nối tới tin mới nhất — poll gộp tiếp như thường
    } catch (err) { setError(err.message); } finally { newerBusy.current = false; setLoadingNewer(false); }
  }

  async function jumpTo(hit) {
    const v = ++view.current;
    const was = detached.current;
    detached.current = true;
    try {
      const r = await api(`${base}&around=${encodeURIComponent(`${hit.ts}:${hit.id}`)}`);
      if (v !== view.current) return;
      atBottom.current = false; anchor.current = null; scrollTo.current = hit.id; first.current = false;
      setMsgs(r.messages); setOlder(r.nextBefore); setNewer(r.nextAfter);
      if (!r.nextAfter) detached.current = false;
      setFlash(hit.id); setError('');
      // Điện thoại: bảng tìm phủ cả màn hình — đóng để thấy tin, tiêu điểm về khung tin.
      if (narrow()) { setSide(null); setTimeout(() => box.current?.focus({ preventScroll: true }), 0); }
    } catch (err) {
      if (v === view.current) { detached.current = was; setError(err.message); }
    }
  }

  function onScroll(e) {
    const el = e.currentTarget;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = !newer && fromBottom < 40;
    if (el.scrollTop < 40) loadOlder();
    if (newer && fromBottom < 80) loadNewer();
  }

  function openPhoto(id) {
    const items = (msgs || []).flatMap((m) => {
      const md = m.id && classifyMedia(m.msgType, m.text);
      return md?.kind === 'photo' ? [{ id: m.id, url: md.url, caption: md.caption, senderName: m.isSelf ? 'Bot' : m.senderName, ts: m.ts }] : [];
    });
    const index = items.findIndex((x) => x.id === id);
    if (index >= 0) setLightbox({ items, index });
  }

  const toggle = (name) => setSide((cur) => (cur === name ? null : name));
  const toggles = { search: useRef(null), media: useRef(null) };
  // Đóng bảng thì trả tiêu điểm về đúng nút đã mở nó trên đầu khung tin.
  const closeSide = (name) => { setSide(null); setTimeout(() => toggles[name].current?.focus(), 0); };
  const group = conv.threadType === 1;
  return html`
    <header class="thread-head">
      <button type="button" class="btn btn-ghost btn-sm only-mobile" onClick=${onBack}>← Danh sách</button>
      <h2>${conv.name}</h2>
      ${group ? html`<span class="tag">Nhóm</span>` : null}
      <button type="button" ref=${toggles.search} class=${`btn btn-ghost btn-sm head-tool${side === 'search' ? ' active' : ''}`} aria-pressed=${side === 'search' ? 'true' : 'false'}
        onClick=${() => toggle('search')} aria-label="Tìm trong hội thoại" title="Tìm trong hội thoại"><${Icon} name="search" /></button>
      <button type="button" ref=${toggles.media} class=${`btn btn-ghost btn-sm head-tool${side === 'media' ? ' active' : ''}`} aria-pressed=${side === 'media' ? 'true' : 'false'}
        onClick=${() => toggle('media')} aria-label="Ảnh/Video · Tệp · Link" title="Ảnh/Video · Tệp · Link"><${Icon} name="image" /><span class="head-tool-label">Ảnh/Video · Tệp · Link</span></button>
    </header>
    <${Live} error=${error} />
    ${newer ? html`<div class="jump-bar"><span class="muted small">Đang xem tin cũ.</span>
      <button type="button" class="btn btn-secondary btn-sm" onClick=${() => kick.current()}>Về tin mới nhất ↓</button></div>` : null}
    ${msgs === null ? (error ? null : html`<${Spinner} />`) : html`
      <ol class="msgs" ref=${box} tabindex="0" onScroll=${onScroll} aria-label=${`Tin nhắn với ${conv.name}`}>
        <li class="msgs-top">
          ${older
            ? html`<button type="button" class="btn btn-ghost btn-sm" disabled=${loadingOlder} onClick=${loadOlder}>${loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}</button>`
            : html`<span class="muted small">${msgs.length ? 'Đầu cuộc trò chuyện' : 'Chưa có tin nhắn nào.'}</span>`}
        </li>
        ${msgs.map((m) => html`<${Bubble} key=${m.id} m=${m} group=${group} focus=${flash === m.id} onOpenPhoto=${openPhoto}
          active=${active === m.id} onActive=${setActive} onReply=${setReply}
          onMention=${(x) => setMentionReq({ name: x.senderName || '', msg: x.id, n: Date.now() })} />`)}
        ${newer ? html`<li class="msgs-top"><button type="button" class="btn btn-ghost btn-sm" disabled=${loadingNewer} onClick=${loadNewer}>${loadingNewer ? 'Đang tải…' : 'Tải tin mới hơn'}</button></li>` : null}
      </ol>`}
    <${Compose} conv=${conv} onSent=${() => kick.current()} reply=${reply} onClearReply=${() => setReply(null)} mentionReq=${mentionReq} />
    ${side === 'search' ? html`<${ThreadSearch} conv=${conv} onJump=${jumpTo} onClose=${() => closeSide('search')} />` : null}
    ${side === 'media' ? html`<${MediaPanel} conv=${conv} onClose=${() => closeSide('media')} onOpenPhoto=${(items, index) => setLightbox({ items, index })} />` : null}
    ${lightbox ? html`<${Lightbox} items=${lightbox.items} index=${lightbox.index}
      onIndex=${(index) => setLightbox((cur) => ({ ...cur, index }))} onClose=${() => setLightbox(null)} />` : null}`;
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
