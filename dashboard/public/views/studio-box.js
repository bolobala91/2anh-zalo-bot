// Hộp "Xưởng tạo sản phẩm" (spec §17) dùng chung cho Mặc định, từng nhóm và Nhắn riêng: 4 nút + số lượt.
// Hộp gập như "Tính năng cho thành viên", nhưng gập sẵn để khung sửa gọn.
import { html, Toggle, onText } from '../ui.js';

export const MAX_QUOTA = 50;
export const STUDIO_NOTE = 'Người không phải chủ nhân nhờ bot làm các sản phẩm dưới đây bằng tài nguyên AI của chủ bot; '
  + 'bot làm xong tự gửi tệp vào đúng cuộc trò chuyện. Mỗi việc tốn một lượt. Chủ nhân luôn dùng được, không giới hạn.';

const vnDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD (cùng cách sổ lượt xưởng ghi ngày). */
export const vnToday = (now = Date.now()) => vnDate.format(new Date(now));

/** 4 nút xưởng đủ khoá (máy chủ mới) thì gửi kèm; thiếu (dữ liệu cũ) thì không gửi — máy chủ giữ như cũ. */
export function studioComplete(studio, features) {
  return Boolean(studio) && features.length > 0 && features.every((f) => typeof studio[f.key] === 'boolean');
}

/** Ô số lượt: rỗng → null (theo mặc định); số nguyên 0–50 → số; còn lại → lỗi kèm cách sửa. */
export function parseQuota(text, { allowEmpty = true } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return allowEmpty ? { value: null } : { error: 'Nhập số lượt (0–50).' };
  if (!/^\d{1,2}$/.test(t) || Number(t) > MAX_QUOTA) return { error: `Số lượt là số nguyên từ 0 đến ${MAX_QUOTA}.` };
  return { value: Number(t) };
}

/** Nút bị chính sách máy chủ khoá (Windows / Linux không hộp cát: video) — hiện tắt, không bấm được, kèm ghi chú. */
export const lockedByPolicy = (key, policy) => key === 'studioVideo' && Boolean(policy?.videoBlocked);

/** Bản sao của `studio` với nút bị khoá ép về tắt — thứ gửi lên máy chủ, để giao diện (tắt) và giá trị lưu khớp nhau. */
export const applyPolicy = (studio, policy) =>
  Object.fromEntries(Object.entries(studio || {}).map(([key, on]) => [key, lockedByPolicy(key, policy) ? false : on]));

/** Giá trị đang có hiệu lực: nút bị khoá luôn tính là tắt (câu "a/b đang bật", tóm tắt từng người). */
export const effectiveStudio = (studio, features, policy) =>
  Object.fromEntries(features.map((f) => [f.key, lockedByPolicy(f.key, policy) ? false : Boolean(studio?.[f.key])]));

/** Đuôi dòng tóm tắt của hộp ở nhóm: số lượt đang áp (riêng của nhóm hoặc theo mặc định). */
export function quotaSummary(quotaText, defaultQuota) {
  const q = parseQuota(quotaText);
  if (q.error) return 'số lượt chưa đúng';
  return q.value === null ? `${defaultQuota} lượt/người/ngày (mặc định)` : `${q.value} lượt/người/ngày`;
}

const MEDIA_FIELDS = [['imageQuota', 'image', 'Số ảnh AI mỗi người mỗi ngày'], ['videoQuota', 'video', 'Số video AI mỗi người mỗi ngày']];

export function StudioBox({ id, studio, features, onChange, disabled = false, quota, onQuota, defaultQuota, quotaError, quotaHint, note, policy,
  media = null, onMedia = null, mediaDefaults = { image: 5, video: 1 }, mediaErrors = {} }) {
  if (!features?.length || !studioComplete(studio, features)) return null;
  // Gập sẵn để khung sửa gọn; dòng tóm tắt đã đủ "a/b đang bật" (và số lượt ở nhóm).
  return html`<details class="perm-box studio-box">
    <summary><span>Xưởng tạo sản phẩm</span><span class="muted perm-box-sum">· ${onText(effectiveStudio(studio, features, policy), features)}${onQuota ? ` · ${quotaSummary(quota, defaultQuota)}` : ''}</span></summary>
    <p class="muted small studio-note">${STUDIO_NOTE}</p>
    <fieldset class="perm-grid" disabled=${disabled}>
      <legend class="sr-only">Xưởng tạo sản phẩm</legend>
      ${features.map((f) => (lockedByPolicy(f.key, policy)
        ? html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${false} disabled=${true} onChange=${() => {}}
            label=${f.label} hint=${policy.note || 'Máy chủ này chưa chạy được video — video tắt'} />`
        : html`<${Toggle} key=${f.key} id=${`${id}-${f.key}`} checked=${studio[f.key]}
            onChange=${(v) => onChange({ ...studio, [f.key]: v })} label=${f.label} hint=${f.hint} />`))}
    </fieldset>
    ${onQuota ? html`<div class="studio-quota">
      <label for=${`${id}-quota`}>Số lượt mỗi người mỗi ngày</label>
      <input id=${`${id}-quota`} inputmode="numeric" maxlength="2" disabled=${disabled}
        placeholder=${`Theo mặc định (${defaultQuota})`} value=${quota ?? ''} aria-invalid=${quotaError ? 'true' : undefined}
        aria-describedby=${`${id}-quota-hint`} onInput=${(e) => onQuota(e.currentTarget.value)} />
      <small id=${`${id}-quota-hint`} class=${quotaError ? 'studio-quota-error' : 'muted'}>${quotaError ? `${quotaError} Sửa ô này rồi lưu, hoặc để trống để theo mặc định.` : quotaHint || ''}</small>
    </div>` : null}
    ${onMedia ? MEDIA_FIELDS.map(([key, def, label]) => html`<div class="studio-quota" key=${key}>
      <label for=${`${id}-${key}`}>${label}</label>
      <input id=${`${id}-${key}`} inputmode="numeric" maxlength="2" disabled=${disabled}
        placeholder=${`Theo mặc định (${mediaDefaults?.[def] ?? ''})`} value=${media?.[key] ?? ''} aria-invalid=${mediaErrors[key] ? 'true' : undefined}
        aria-describedby=${`${id}-${key}-hint`} onInput=${(e) => onMedia(key, e.currentTarget.value)} />
      <small id=${`${id}-${key}-hint`} class=${mediaErrors[key] ? 'studio-quota-error' : 'muted'}>${mediaErrors[key] ? `${mediaErrors[key]} Sửa ô này rồi lưu, hoặc để trống để theo mặc định.` : 'Để trống để theo mặc định; chỉ tính khi nút tương ứng ở trên đang bật.'}</small>
    </div>`) : null}
    ${note ? html`<p class="muted small studio-foot">${note}</p>` : null}
  </details>`;
}
