import { readJson, writeJsonAtomic } from './json-store.js';

export function createWatchdog({
  sidecar, notify, restartSidecar, stateFile, publicUrl, now = Date.now,
  zaloAfterMs = 120_000, listenerAfterMs = 600_000, sidecarAfterMs = 120_000, assistantAfterMs = 300_000, remindAfterMs = 6 * 3600_000,
  botName = () => 'Bot Zalo',
}) {
  let state = readJson(stateFile, {});
  const save = () => writeJsonAtomic(stateFile, state);
  const messages = {
    sidecar: (n) => `⚠️ ${n}: kết nối Zalo không chạy, đã thử tự bật lại nhưng chưa được. Báo người cài đặt kiểm tra máy chủ.\n${publicUrl}`,
    zalo: (n) => `⚠️ ${n} đang mất kết nối Zalo — cần quét mã QR đăng nhập lại.\nMở trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    listener: (n) => `⚠️ ${n} đang không nhận được tin nhắn Zalo (mất kết nối hơn 10 phút). Đợi thêm vài phút hoặc khởi động lại bot; nếu vẫn vậy, quét lại mã QR trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    assistant: (n) => `⚠️ ${n}: Trợ lý không phản hồi — tin nhắn Zalo đang không được trả lời.\n${publicUrl}`,
  };
  const recovered = { sidecar: 'kết nối Zalo', zalo: 'Zalo', assistant: 'Trợ lý' };
  // Sự cố zalo có hai lý do: mất phiên (báo sau 2 phút) hoặc chỉ listener đứt (zca-js tự nối lại, báo sau 10 phút).
  const threshold = (kind, reason) => (kind === 'zalo' && reason === 'listener' ? listenerAfterMs
    : { sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs }[kind]);

  async function update(kind, active, reason = kind) {
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
    if (!s) { state[kind] = { since: t, alertedAt: 0, restartTried: false, reason }; save(); return; }
    if ((s.reason ?? kind) !== reason) { s.reason = reason; save(); }
    if (t - s.since < threshold(kind, reason)) return;
    if (kind === 'sidecar' && !s.restartTried) {
      s.restartTried = true; s.since = t; save();
      await restartSidecar().catch((e) => console.warn('[watchdog] không khởi động lại được:', e.message));
      return;
    }
    // Lý do đổi (vd. listener đứt → bị đá phiên) thì báo ngay lời mới, không đợi nhắc lại.
    if (!s.alertedAt || (s.alertedReason ?? kind) !== reason || t - s.alertedAt >= remindAfterMs) {
      try {
        await notify(messages[reason](botName()));
        s.alertedAt = t; s.alertedReason = reason; save();
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
      const z = health?.zalo || {};
      const lostSession = Boolean(z.needsRelogin) || z.status !== 'logged-in';
      // listener null = chưa ai báo (không tính), giống runtime-health.
      const deaf = !lostSession && z.listener != null && z.listener !== 'connected';
      await update('zalo', lostSession || deaf, lostSession ? 'zalo' : 'listener');
      // Zalo hỏng thì cầu nối trợ lý cũng rớt theo — báo thêm "trợ lý" chỉ là nhiễu. Giữ nguyên trạng thái cũ.
      if (state.zalo || state.sidecar) return;
      await update('assistant', (health?.bridge?.attachedClients || 0) === 0);
    },
    incidents: () => structuredClone(state),
  };
}
