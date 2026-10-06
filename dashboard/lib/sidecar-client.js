export class SidecarDown extends Error {
  constructor(message = 'Không liên lạc được với kết nối Zalo') { super(message); this.name = 'SidecarDown'; }
}

export function createSidecarClient({ baseUrl = 'http://127.0.0.1:3872', token, fetchImpl = fetch, timeoutMs = 4000 }) {
  async function call(path, { method = 'GET', body } = {}) {
    let res;
    let json = {};
    // Dùng setTimeout thường (không phải AbortSignal.timeout, vốn bị unref) để hạn giờ cả lúc đọc thân phản hồi.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetchImpl(`${baseUrl}/control${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      try { json = await res.json(); } catch (err) { if (ctrl.signal.aborted) throw err; /* thân rỗng */ }
    } catch (err) { throw new SidecarDown(); } finally { clearTimeout(timer); }
    if (!res.ok || json.ok === false) throw Object.assign(new Error(json.error || `Lỗi ${res.status}`), { statusCode: res.status });
    return json;
  }
  return {
    health: async () => (await call('/health')).health,
    qrStart: () => call('/qr/start', { method: 'POST' }),
    qr: async () => { const { status, image, user } = await call('/qr'); return { status, image, user }; },
    logout: () => call('/logout', { method: 'POST' }),
    send: async (m) => (await call('/send', { method: 'POST', body: m })).result,
    loginCode: (m) => call('/login-code', { method: 'POST', body: m }),
    groups: async () => (await call('/groups')).groups,
  };
}
