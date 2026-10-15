/**
 * Địa chỉ trang đăng nhập Zalo (mục Tài khoản Zalo) của dashboard — sidecar chuyển người mở nhầm cổng của nó tới đây.
 * Ưu tiên ZALO_DASHBOARD_URL (VPS: tên miền có Caddy đứng trước); không có thì cùng máy, cổng ZALO_DASHBOARD_PORT/3880.
 */
export function dashboardLoginUrl(env = {}, host = '') {
  const configured = String(env.ZALO_DASHBOARD_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s]+$/i.test(configured)) return `${configured}/#/zalo`;
  const safeHost = /^[\w.-]{1,253}$/.test(String(host || '')) ? host : '127.0.0.1';
  return `http://${safeHost}:${Number(env.ZALO_DASHBOARD_PORT) || 3880}/#/zalo`;
}
