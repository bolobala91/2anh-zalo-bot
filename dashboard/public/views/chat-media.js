// Ảnh, tệp, video trong Phiên chat: thẻ trong khung tin, khung xem ảnh lớn, bảng "Ảnh/Video · Tệp · Link".
// Ảnh luôn đi qua /api/media/img (cùng nguồn, hợp CSP); tệp và video chỉ là link ngoài, mở thẻ mới.
import { useEffect, useRef, useState } from '../vendor/hooks.mjs';
import { api } from '../api.js';
import { html, Icon, Live, Spinner, fmtTime } from '../ui.js';
import { proxied } from '../media.js';

const EXT_LABEL = {
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', csv: 'XLS', ppt: 'PPT', pptx: 'PPT',
  zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', txt: 'TXT', mp3: 'NHẠC', m4a: 'NHẠC', mp4: 'VIDEO', mov: 'VIDEO',
  jpg: 'ẢNH', jpeg: 'ẢNH', png: 'ẢNH',
};

/** Nhãn và nhóm màu của biểu tượng tệp theo đuôi. */
export function fileBadge(ext) {
  const e = String(ext || '').toLowerCase();
  const label = EXT_LABEL[e] || (e ? e.slice(0, 4).toUpperCase() : 'TỆP');
  const tone = { PDF: 'pdf', DOC: 'doc', XLS: 'xls', PPT: 'ppt', ZIP: 'zip' }[label] || 'other';
  return { label, tone };
}

export function FileBadge({ ext: e }) {
  const b = fileBadge(e);
  return html`<span class=${`file-ico file-ico-${b.tone}`} aria-hidden="true">${b.label}</span>`;
}

// Dashboard đang bận (giới hạn tải cùng lúc/mỗi phút) hoặc Zalo lỗi tạm: tự thử lại một lần sau chừng này.
const RETRY_MIN_MS = 1200;
const RETRY_SPREAD_MS = 1800;
const TRANSIENT = [0, 200, 429, 502, 503, 504]; // 0: mất mạng; 200: lần hỏi lại đã được → lỗi tạm

/**
 * Ảnh không hiện được → làm gì, theo mã trả về của /api/media/img:
 * 'gone' (404: Zalo đã xoá) · 'retry' (bận/lỗi tạm, chưa thử lại) · 'busy' (đã thử lại vẫn bận) · 'failed' (lỗi khác).
 */
export function imageFailure(status, retried) {
  if (status === 404) return 'gone';
  if (TRANSIENT.includes(status)) return retried ? 'busy' : 'retry';
  return 'failed';
}

// Hàng chờ ảnh thu nhỏ của cả trang: tối đa IMAGE_SLOTS ảnh tải cùng lúc — dưới mức 4 ảnh/người của máy chủ,
// nên một trang không tự làm mình bị 429, và lần hỏi lại mã lỗi chạy trong chính chỗ của ảnh đó.
export const IMAGE_SLOTS = 3;
let slotsUsed = 0;
const slotWaiters = [];
export function acquireSlot() {
  return new Promise((resolve) => { if (slotsUsed < IMAGE_SLOTS) { slotsUsed += 1; resolve(); } else slotWaiters.push(resolve); });
}
export function releaseSlot() {
  const next = slotWaiters.shift();
  if (next) next(); else slotsUsed = Math.max(0, slotsUsed - 1);
}

/**
 * Ảnh qua dashboard: chờ chỗ trong hàng (trừ khi queued=false), hỏng thì hỏi mã lỗi,
 * bận thì tự thử lại một lần, sau đó để người dùng bấm thử lại.
 */
export function useProxiedImage(url, { queued = true } = {}) {
  const [st, setSt] = useState({ phase: 'ok', attempt: 0, retried: false });
  const [ready, setReady] = useState(!queued);
  const alive = useRef(true);
  const held = useRef(false);
  const free = () => { if (held.current) { held.current = false; releaseSlot(); } };
  useEffect(() => () => { alive.current = false; free(); }, []);
  useEffect(() => { setSt({ phase: 'ok', attempt: 0, retried: false }); }, [url]);
  useEffect(() => {
    if (!queued || st.phase !== 'ok') return undefined;
    let cancelled = false;
    setReady(false);
    acquireSlot().then(() => {
      if (cancelled || !alive.current) { releaseSlot(); return; }
      held.current = true; setReady(true);
    });
    return () => { cancelled = true; free(); };
  }, [url, st.attempt, st.phase]);
  const src = `${proxied(url)}${st.attempt ? `&r=${st.attempt}` : ''}`;
  async function onError() {
    const retried = st.retried;
    let status = 0;
    try { status = (await fetch(src, { credentials: 'same-origin' })).status; } catch { /* mất mạng */ }
    free();
    if (!alive.current) return;
    const next = imageFailure(status, retried);
    if (next !== 'retry') { setSt((s) => ({ ...s, phase: next })); return; }
    setSt((s) => ({ ...s, phase: 'wait' }));
    setTimeout(() => { if (alive.current) setSt((s) => ({ phase: 'ok', attempt: s.attempt + 1, retried: true })); },
      RETRY_MIN_MS + Math.random() * RETRY_SPREAD_MS);
  }
  const retry = () => setSt((s) => ({ phase: 'ok', attempt: s.attempt + 1, retried: false }));
  return { src, phase: st.phase, ready: !queued || ready, onError, onLoad: free, retry };
}

/** Chữ báo ảnh không hiện: chỉ 404 mới nói Zalo đã xoá. */
export const IMAGE_TEXT = {
  wait: 'Đang thử tải lại…',
  gone: 'Ảnh không còn trên Zalo — có thể Zalo đã xoá ảnh cũ.',
  goneShort: 'Zalo đã xoá ảnh',
  busy: 'Đang tải nhiều ảnh — bấm để thử lại',
  failed: 'Không tải được ảnh.',
  failedLarge: 'Không tải được ảnh này — thử “Ảnh gốc” ở trên hoặc xem trong ứng dụng Zalo.',
};
const GONE = IMAGE_TEXT.gone;
const BUSY = IMAGE_TEXT.busy;

/** Ảnh thu nhỏ qua bộ tải của dashboard; hỏng thì báo đúng lý do. */
export function Thumb({ url, alt = 'Ảnh', onOpen, className = 'thumb', compact = false }) {
  const img = useProxiedImage(url);
  if (img.phase === 'busy') {
    return html`<button type="button" class=${`${className} thumb-broken thumb-retry`} onClick=${img.retry}>
      <${Icon} name="refresh" size=${18} /><span>${BUSY}</span></button>`;
  }
  if (img.phase !== 'ok') {
    const text = { wait: IMAGE_TEXT.wait, gone: compact ? IMAGE_TEXT.goneShort : GONE, failed: IMAGE_TEXT.failed }[img.phase];
    return html`<span class=${`${className} thumb-broken`} title=${img.phase === 'gone' ? GONE : undefined}><${Icon} name="image" size=${18} />
      <span>${text}${img.phase === 'failed'
        ? html` <a href=${url} target="_blank" rel="noopener noreferrer">${compact ? 'Mở gốc' : 'Thử mở ảnh gốc'}</a>` : null}</span></span>`;
  }
  if (!img.ready) return html`<span class=${`${className} thumb-pending`} role="img" aria-label=${`Đang chờ tải: ${alt}`}></span>`;
  return html`<button type="button" class=${`${className} thumb-btn`} onClick=${onOpen} aria-label=${`Xem lớn: ${alt}`}>
    <img key=${img.src} src=${img.src} alt=${alt} decoding="async" onLoad=${img.onLoad} onError=${img.onError} />
  </button>`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab/Shift+Tab chạy vòng trong `box` (khung xem ảnh là hộp thoại modal). */
export function trapTab(e, box) {
  if (e.key !== 'Tab' || !box) return;
  const list = [...box.querySelectorAll(FOCUSABLE)];
  if (!list.length) return;
  const first = list[0]; const last = list[list.length - 1];
  const at = list.indexOf(document.activeElement);
  if (e.shiftKey && at <= 0) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === -1 || at === list.length - 1)) { e.preventDefault(); first.focus(); }
}

export function FileCard({ name, url, ext: e }) {
  return html`<span class="file-card">
    <${FileBadge} ext=${e} />
    <span class="file-name">${name}</span>
    <a class="btn btn-secondary btn-sm" href=${url} target="_blank" rel="noopener noreferrer"><${Icon} name="download" size=${16} /> Tải về</a>
  </span>`;
}

export function VideoCard({ url }) {
  return html`<a class="video-card" href=${url} target="_blank" rel="noopener noreferrer">
    <span class="video-play" aria-hidden="true"><${Icon} name="play" size=${28} /></span>
    <span>Video — bấm để mở</span>
  </a>`;
}

/**
 * Khung xem ảnh lớn: ← → chuyển ảnh, Esc đóng, Tab chạy vòng bên trong, trang phía sau không cuộn;
 * đóng xong trả tiêu điểm về chỗ cũ.
 */
export function Lightbox({ items, index, onIndex, onClose }) {
  const closeBtn = useRef(null);
  const box = useRef(null);
  const item = items[index];
  const img = useProxiedImage(item?.url || '', { queued: false }); // ảnh đang xem lớn không xếp hàng sau lưới
  useEffect(() => {
    const back = document.activeElement;
    closeBtn.current?.focus();
    document.body.classList.add('no-scroll');
    return () => {
      document.body.classList.remove('no-scroll');
      if (back && typeof back.focus === 'function' && back.isConnected) back.focus();
    };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      else trapTab(e, box.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length]);
  if (!item) return null;
  let stage;
  if (img.phase === 'ok') stage = html`<img class="lightbox-img" key=${img.src} src=${img.src} alt=${item.caption || 'Ảnh'} onError=${img.onError} />`;
  else if (img.phase === 'busy') stage = html`<button type="button" class="btn btn-secondary lightbox-retry" onClick=${img.retry}><${Icon} name="refresh" /> ${BUSY}</button>`;
  else {
    stage = html`<p class="lightbox-broken">${{
      wait: IMAGE_TEXT.wait,
      gone: `${GONE} Xem ảnh này trong ứng dụng Zalo.`,
      failed: IMAGE_TEXT.failedLarge,
    }[img.phase]}</p>`;
  }
  return html`<div class="lightbox" ref=${box} role="dialog" aria-modal="true" aria-label="Xem ảnh" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="lightbox-bar">
      <span class="lightbox-count">${index + 1}/${items.length}${item.senderName ? ` · ${item.senderName}` : ''}${item.ts ? ` · ${fmtTime(item.ts)}` : ''}</span>
      <a class="btn btn-ghost btn-sm lightbox-btn" href=${item.url} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${16} /> Ảnh gốc</a>
      <button type="button" ref=${closeBtn} class="btn btn-ghost btn-sm lightbox-btn" onClick=${onClose} aria-label="Đóng"><${Icon} name="close" /></button>
    </div>
    <div class="lightbox-stage">
      <button type="button" class="lightbox-nav" disabled=${index === 0} onClick=${() => onIndex(index - 1)} aria-label="Ảnh trước"><${Icon} name="prev" size=${28} /></button>
      ${stage}
      <button type="button" class="lightbox-nav" disabled=${index >= items.length - 1} onClick=${() => onIndex(index + 1)} aria-label="Ảnh sau"><${Icon} name="next" size=${28} /></button>
    </div>
    ${item.caption ? html`<p class="lightbox-caption">${item.caption}</p>` : null}
  </div>`;
}

const TABS = [['photo', 'Ảnh/Video'], ['file', 'Tệp'], ['link', 'Link']];
const EMPTY = { photo: 'Chưa có ảnh hay video nào trong hội thoại này.', file: 'Chưa có tệp nào trong hội thoại này.', link: 'Chưa có link nào trong hội thoại này.' };

/** Bảng bên phải (điện thoại: phủ cả màn hình) liệt kê ảnh/video, tệp, link của một hội thoại. */
export function MediaPanel({ conv, onClose, onOpenPhoto, initialTab = 'photo' }) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState({}); // kind → { items, next }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const base = `/api/chats/${encodeURIComponent(conv.threadId)}/media?type=${conv.threadType}`;

  async function load(kind, more = null) {
    const my = ++seq.current;
    setBusy(true); setError('');
    try {
      const r = await api(`${base}&kind=${kind}${more ? `&before=${encodeURIComponent(more)}` : ''}`);
      if (my !== seq.current) return;
      setData((cur) => ({ ...cur, [kind]: { items: more && cur[kind] ? [...cur[kind].items, ...r.items] : r.items, next: r.nextBefore } }));
    } catch (err) {
      if (my === seq.current) setError(err.message);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }

  useEffect(() => { if (!data[tab]) load(tab); }, [tab]);

  const cur = data[tab];
  const photos = (data.photo?.items || []).filter((x) => !x.video);
  let body;
  if (!cur) body = error ? null : html`<${Spinner} />`;
  // Trang link có thể rỗng mà vẫn còn tin cũ chưa đọc (máy chủ dừng sau một số lô) — chỉ báo "chưa có" khi đã hết.
  else if (!cur.items.length) body = cur.next ? html`<p class="muted small panel-empty">Chưa thấy mục nào trong các tin gần đây — bấm Xem thêm để tìm tiếp.</p>`
    : html`<p class="muted small panel-empty">${EMPTY[tab]}</p>`;
  else if (tab === 'photo') {
    body = html`<ul class="media-grid">${cur.items.map((x) => html`<li key=${x.id}>
      ${x.video
        ? html`<a class="media-tile media-video" href=${x.url} target="_blank" rel="noopener noreferrer" aria-label=${`Mở video của ${x.senderName || 'thành viên'}, ${fmtTime(x.ts)}`}>
            <${Icon} name="play" size=${30} /><span class="media-video-label">Video</span></a>`
        : html`<${Thumb} className="media-tile" compact url=${x.url} alt=${`Ảnh của ${x.isSelf ? 'bot' : (x.senderName || 'thành viên')}, ${fmtTime(x.ts)}`}
            onOpen=${() => onOpenPhoto(photos, photos.indexOf(x))} />`}
    </li>`)}</ul>`;
  } else if (tab === 'file') {
    body = html`<ul class="media-list">${cur.items.map((x) => html`<li key=${x.id} class="media-row">
      <${FileBadge} ext=${x.ext} />
      <span class="media-main">
        <span class="file-name">${x.name}</span>
        <span class="muted small">${x.isSelf ? 'Bot' : (x.senderName || 'Thành viên')} · ${fmtTime(x.ts)}</span>
      </span>
      <a class="btn btn-ghost btn-sm" href=${x.url} target="_blank" rel="noopener noreferrer" aria-label=${`Tải về ${x.name}`}><${Icon} name="download" size=${16} /> Tải về</a>
    </li>`)}</ul>`;
  } else {
    body = html`<ul class="media-list">${cur.items.map((x) => html`<li key=${x.id}>
      <a class="media-row media-link" href=${x.url} target="_blank" rel="noopener noreferrer">
        <span class="link-ico" aria-hidden="true"><${Icon} name="link" size=${16} /></span>
        <span class="media-main">
          <span class="link-host">${x.host}</span>
          <span class="link-text">${x.title || x.url}</span>
          <span class="muted small">${x.isSelf ? 'Bot' : (x.senderName || 'Thành viên')} · ${fmtTime(x.ts)}</span>
        </span>
      </a>
    </li>`)}</ul>`;
  }

  return html`<aside class="side-panel" aria-label="Ảnh, tệp và link" onKeyDown=${(e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) onClose(); }}>
    <header class="side-head">
      <h3>Ảnh/Video · Tệp · Link</h3>
      <button type="button" class="btn btn-ghost btn-sm" onClick=${onClose} aria-label="Đóng bảng ảnh, tệp, link"><${Icon} name="close" /></button>
    </header>
    <div class="tabs" role="tablist" aria-label="Loại mục">
      ${TABS.map(([k, label]) => html`<button type="button" role="tab" id=${`media-tab-${k}`} aria-selected=${tab === k ? 'true' : 'false'}
        aria-controls="media-tabpanel" class=${`tab${tab === k ? ' active' : ''}`} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>
    <div class="side-body" role="tabpanel" id="media-tabpanel" aria-labelledby=${`media-tab-${tab}`}>
      <${Live} error=${error} />
      ${body}
      ${cur?.next ? html`<button type="button" class="btn btn-ghost btn-sm panel-more" disabled=${busy} onClick=${() => load(tab, cur.next)}>${busy ? 'Đang tải…' : 'Xem thêm'}</button>` : null}
    </div>
  </aside>`;
}
