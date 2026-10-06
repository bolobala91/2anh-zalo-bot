const ZALO_UID = /^[1-9]\d{14,21}$/;

export function loadDashboardConfig(env = process.env) {
  const parsed = Number.parseInt(env.ZALO_DASHBOARD_PORT, 10);
  const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 3880;
  return {
    port,
    publicUrl: String(env.ZALO_DASHBOARD_URL || `http://localhost:${port}`).trim().replace(/\/+$/, ''),
    restartCmd: String(env.ZALO_SIDECAR_RESTART_CMD || '').trim() || null,
    assistantRestartCmd: String(env.ZALO_ASSISTANT_RESTART_CMD || '').trim() || null,
    // UID chủ bot đầu tiên — điền sẵn ở trang tạo Quản trị đầu tiên.
    suggestedZaloUid: String(env.ZALO_ALLOWED_USERS || '').split(',').map((s) => s.trim()).find((s) => ZALO_UID.test(s)) || '',
  };
}
