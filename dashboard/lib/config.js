export function loadDashboardConfig(env = process.env) {
  const port = Number.parseInt(env.ZALO_DASHBOARD_PORT, 10);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3880,
    publicUrl: String(env.ZALO_DASHBOARD_URL || 'http://localhost:3880').trim().replace(/\/+$/, ''),
    restartCmd: String(env.ZALO_SIDECAR_RESTART_CMD || '').trim() || null,
  };
}
