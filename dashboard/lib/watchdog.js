import { readJson, writeJsonAtomic } from './json-store.js';

export function createWatchdog({
  sidecar, notify, restartSidecar, stateFile, publicUrl, now = Date.now,
  zaloAfterMs = 120_000, sidecarAfterMs = 120_000, assistantAfterMs = 300_000, remindAfterMs = 6 * 3600_000,
  botName = () => 'Bot Zalo',
}) {
  let state = readJson(stateFile, {});
  const save = () => writeJsonAtomic(stateFile, state);
  const messages = {
    sidecar: (n) => `⚠️ ${n}: kết nối Zalo không chạy, đã thử tự bật lại nhưng chưa được. Báo người cài đặt kiểm tra máy chủ.\n${publicUrl}`,
    zalo: (n) => `⚠️ ${n} đang mất kết nối Zalo — cần quét mã QR đăng nhập lại.\nMở trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    assistant: (n) => `⚠️ ${n}: Trợ lý không phản hồi — tin nhắn Zalo đang không được trả lời.\n${publicUrl}`,
  };
  const recovered = { sidecar: 'kết nối Zalo', zalo: 'Zalo', assistant: 'Trợ lý' };
  const threshold = { sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs };

  async function update(kind, active) {
    const t = now();
    const s = state[kind];
    if (!active) {
      if (s) {
        delete state[kind]; save();
        if (s.alertedAt) {
          try { await notify(`✅ ${botName()}: ${recovered[kind]} đã hoạt động lại.`); } catch { /* bỏ qua */ }
        }
      }
      return;
    }
    if (!s) { state[kind] = { since: t, alertedAt: 0, restartTried: false }; save(); return; }
    if (t - s.since < threshold[kind]) return;
    if (kind === 'sidecar' && !s.restartTried) {
      s.restartTried = true; s.since = t; save();
      await restartSidecar().catch((e) => console.warn('[watchdog] không khởi động lại được:', e.message));
      return;
    }
    if (!s.alertedAt || t - s.alertedAt >= remindAfterMs) {
      try {
        await notify(messages[kind](botName()));
        s.alertedAt = t; save();
      } catch (e) { console.warn('[watchdog] không gửi được cảnh báo:', e.message); }
    }
  }

  return {
    async tick() {
      let health;
      try { health = await sidecar.health(); } catch (err) {
        if (err?.name !== 'SidecarDown') throw err;
        await update('sidecar', true);
        return;
      }
      await update('sidecar', false);
      await update('zalo', Boolean(health?.zalo?.needsRelogin) || health?.zalo?.status !== 'logged-in');
      await update('assistant', (health?.bridge?.attachedClients || 0) === 0);
    },
    incidents: () => structuredClone(state),
  };
}
