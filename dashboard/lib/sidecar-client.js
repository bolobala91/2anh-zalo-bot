export class SidecarDown extends Error {
  constructor(message = 'Không liên lạc được với kết nối Zalo') { super(message); this.name = 'SidecarDown'; }
}

/** Đã gửi yêu cầu nhưng quá hạn chờ: bot có thể vẫn đang làm (vd. đang gửi tin) — không được coi là "bot tắt". */
export class SidecarTimeout extends Error {
  constructor(message = 'Kết nối Zalo chưa trả lời kịp') { super(message); this.name = 'SidecarTimeout'; }
}

export function createSidecarClient({ baseUrl = 'http://127.0.0.1:3872', token, fetchImpl = fetch, timeoutMs = 4000, sendTimeoutMs = 20_000 }) {
  // distinctTimeout: chỉ lệnh gửi phân biệt "quá hạn" với "không kết nối được"; lệnh khác quá hạn vẫn là SidecarDown
  // (watchdog, trạng thái, tên nhóm coi bot treo như bot tắt).
  async function call(path, { method = 'GET', body, limitMs = timeoutMs, distinctTimeout = false } = {}) {
    let res;
    let json = {};
    // Dùng setTimeout thường (không phải AbortSignal.timeout, vốn bị unref) để hạn giờ cả lúc đọc thân phản hồi.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limitMs);
    try {
      res = await fetchImpl(`${baseUrl}/control${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      try { json = await res.json(); } catch (err) { if (ctrl.signal.aborted) throw err; /* thân rỗng */ }
    } catch (err) {
      throw distinctTimeout && ctrl.signal.aborted ? new SidecarTimeout() : new SidecarDown();
    } finally { clearTimeout(timer); }
    if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Lỗi ${res.status}`), { statusCode: res.status });
    return json;
  }
  return {
    health: async () => (await call('/health')).health,
    qrStart: () => call('/qr/start', { method: 'POST' }),
    qr: async () => { const { status, image, user } = await call('/qr'); return { status, image, user }; },
    logout: () => call('/logout', { method: 'POST' }),
    // Gửi tin qua Zalo có thể mất vài giây (mạng chậm, ảnh xem trước liên kết) — hạn riêng dài hơn.
    send: async (m) => (await call('/send', { method: 'POST', body: m, limitMs: sendTimeoutMs, distinctTimeout: true })).result,
    loginCode: (m) => call('/login-code', { method: 'POST', body: m }),
    groups: async () => (await call('/groups')).groups,
  };
}
