export const NETWORK_ERROR = 'Không kết nối được tới dashboard — kiểm tra mạng hoặc máy chủ, rồi tải lại trang.';

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'zalo-dashboard' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(NETWORK_ERROR), { status: 0 });
  }
  let json = {};
  try { json = await res.json(); } catch { /* không phải JSON */ }
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('zd:logout'));
  if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Lỗi ${res.status} — tải lại trang rồi thử lại.`), { status: res.status });
  return json;
}
