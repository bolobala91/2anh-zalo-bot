// Môi trường cho tiến trình con khởi động lại: không mang theo danh sách chủ nhân cũ (nó tự nạp từ .env Hermes).
export function childEnv(env = process.env) {
  const { ZALO_ALLOWED_USERS: _stale, ...rest } = env;
  return rest;
}

// Chờ tiến trình con thật sự khởi động (sự kiện 'spawn') hoặc báo lỗi ('error', ví dụ ENOENT)
// trước khi tách rời. Không gắn listener 'error' thì lỗi này làm sập cả dashboard.
export function waitSpawned(child) {
  return new Promise((resolve, reject) => {
    if (typeof child?.once !== 'function') { child?.unref?.(); resolve(); return; }
    child.once('error', reject);
    child.once('spawn', () => { child.removeListener?.('error', reject); child.on?.('error', () => {}); child.unref?.(); resolve(); });
  });
}
