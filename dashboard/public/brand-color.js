// Màu thương hiệu — dùng chung cho trình duyệt (xem trước, kiểm tương phản) và máy chủ (/brand.css, kiểm khi lưu).
export const DEFAULT_COLOR = '#0f766e';
export const MIN_CONTRAST = 4.5;

/** Sáu gợi ý — đều cho chữ trắng tương phản ≥ 4,5 : 1. */
export const SUGGESTIONS = [
  { color: '#0f766e', label: 'Xanh ngọc' },
  { color: '#1d4ed8', label: 'Xanh dương' },
  { color: '#6d28d9', label: 'Tím' },
  { color: '#be123c', label: 'Đỏ son' },
  { color: '#c2410c', label: 'Cam đất' },
  { color: '#334155', label: 'Xám than' },
];

/** "#ABC", "abc123", " #0F766E " → "#0f766e"; không hợp lệ → null. */
export function normalizeHex(value) {
  const s = String(value ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join('')}`;
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tỉ lệ tương phản WCAG giữa chữ trắng và nền màu `hex` (đã chuẩn hoá). */
export function contrastWithWhite(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

const toHex = (parts) => `#${parts.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (hex, target, t) => toHex(rgb(hex).map((v) => v + (target - v) * t));

/** Bộ biến CSS suy ra từ một màu: đậm hơn (di chuột, chữ trên nền nhạt), nền nhạt, viền focus. */
export function brandVars(hex) {
  const [r, g, b] = rgb(hex);
  return {
    '--brand': hex,
    '--brand-dark': mix(hex, 0, 0.2),
    '--brand-soft': mix(hex, 255, 0.9),
    '--focus': `0 0 0 3px rgba(${r}, ${g}, ${b}, 0.35)`,
  };
}
