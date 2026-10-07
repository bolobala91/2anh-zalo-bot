import { readJson, writeJsonAtomic } from './json-store.js';

// Máy chủ quá tải (spec §16.B): vượt ON thì bắt đầu đếm, chỉ coi là hết khi xuống dưới OFF — tránh báo/hết
// liên tục khi số đo dao động quanh ngưỡng.
export const HOST_ON_PCT = 90;
export const HOST_OFF_PCT = 85;
const HOST_GAP_MS = 5 * 60_000; // lần đo trước cách quá 5 phút = dashboard từng tắt: không tính thời gian tắt vào "suốt N phút"
const HOST_NULL_LIMIT = 10; // ngần ấy lần đo null liên tiếp thì đóng sự cố (không đo được nữa)
const HOST_KINDS = [['disk', 'diskPct'], ['ram', 'ramPct'], ['cpu', 'cpuPct']];

export function createWatchdog({
  sidecar, notify, restartSidecar, stateFile, publicUrl, now = Date.now,
  zaloAfterMs = 120_000, listenerAfterMs = 600_000, sidecarAfterMs = 120_000, assistantAfterMs = 300_000, remindAfterMs = 6 * 3600_000,
  diskAfterMs = 0, ramAfterMs = 300_000, cpuAfterMs = 600_000,
  botName = () => 'Bot Zalo',
}) {
  let state = readJson(stateFile, {});
  const save = () => writeJsonAtomic(stateFile, state);
  const healthUrl = `${publicUrl}/#/health`;
  const messages = {
    sidecar: (n) => `⚠️ ${n}: kết nối Zalo không chạy, đã thử tự bật lại nhưng chưa được. Báo người cài đặt kiểm tra máy chủ.\n${publicUrl}`,
    zalo: (n) => `⚠️ ${n} đang mất kết nối Zalo — cần quét mã QR đăng nhập lại.\nMở trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    listener: (n) => `⚠️ ${n} đang không nhận được tin nhắn Zalo (mất kết nối hơn 10 phút). Đợi thêm vài phút hoặc khởi động lại bot; nếu vẫn vậy, quét lại mã QR trên máy tính (không phải điện thoại của bot): ${publicUrl}/#/zalo`,
    assistant: (n) => `⚠️ ${n}: Trợ lý không phản hồi — tin nhắn Zalo đang không được trả lời.\n${publicUrl}`,
    disk: (n, v) => `⚠️ ${n}: ổ đĩa máy chủ đã đầy ${v}%. Dọn bớt tệp (bản sao lưu, nhật ký cũ) hoặc tăng dung lượng ổ, không tự làm được thì báo người cài đặt — đầy hẳn thì bot ngừng lưu tin nhắn.\n${healthUrl}`,
    ram: (n, v) => `⚠️ ${n}: bộ nhớ (RAM) máy chủ đang dùng ${v}% suốt hơn 5 phút — bot có thể chậm hoặc tự khởi động lại. Khởi động lại dịch vụ ngốn bộ nhớ hoặc nâng RAM; không tự làm được thì báo người cài đặt.\n${healthUrl}`,
    cpu: (n, v) => `⚠️ ${n}: CPU máy chủ bận ${v}% suốt hơn 10 phút — bot có thể trả lời chậm. Kiểm tra tiến trình đang chạy nặng; không tự làm được thì báo người cài đặt.\n${healthUrl}`,
  };
  const recovered = {
    sidecar: 'kết nối Zalo đã hoạt động lại', zalo: 'Zalo đã hoạt động lại', assistant: 'Trợ lý đã hoạt động lại',
    disk: 'ổ đĩa máy chủ đã trở lại bình thường', ram: 'bộ nhớ (RAM) máy chủ đã trở lại bình thường', cpu: 'CPU máy chủ đã trở lại bình thường',
  };
  // Sự cố zalo có hai lý do: mất phiên (báo sau 2 phút) hoặc chỉ listener đứt (zca-js tự nối lại, báo sau 10 phút).
  const threshold = (kind, reason) => (kind === 'zalo' && reason === 'listener' ? listenerAfterMs
    : { sidecar: sidecarAfterMs, zalo: zaloAfterMs, assistant: assistantAfterMs, disk: diskAfterMs, ram: ramAfterMs, cpu: cpuAfterMs }[kind]);

  async function update(kind, active, reason = kind, detail = undefined) {
    const t = now();
    const s = state[kind];
    if (!active) {
      if (s) {
        delete state[kind]; save();
        if (s.alertedAt) {
          try { await notify(`✅ ${botName()}: ${recovered[kind]}.`); } catch { /* bỏ qua */ }
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
      // notify trả về số tin gửi được (broadcast); 0 = chưa ai nhận (chưa cài Telegram, chưa ai nối…) → thử lại sau.
      let delivered = 0;
      try { delivered = await notify(messages[reason](botName(), detail)); if (delivered === undefined) delivered = 1; } catch (e) {
        if (!s.unsentWarned) { s.unsentWarned = true; save(); console.warn('[watchdog] không gửi được cảnh báo:', e.message); }
        return;
      }
      if (delivered > 0) { s.alertedAt = t; s.alertedReason = reason; delete s.unsentWarned; save(); }
      else if (!s.unsentWarned) { s.unsentWarned = true; save(); console.warn('[watchdog] chưa ai nhận được cảnh báo (chưa cài/nối Telegram) — sẽ thử lại'); }
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
    /**
     * Mỗi lần đo máy chủ (1 phút/lần): ổ đĩa > 90 % (báo ở lần đo thứ hai liên tiếp), RAM > 90 % suốt 5 phút,
     * CPU > 90 % suốt 10 phút. Cùng cách báo một lần / nhắc sau 6 giờ / báo hồi phục như các sự cố khác.
     * Số đo null (vd. không đọc được ổ đĩa) thì giữ nguyên trạng thái; null 10 lần liên tiếp thì đóng sự cố
     * (không báo hồi phục). Lần đo trước cách quá 5 phút (dashboard tắt) thì đếm lại từ đầu.
     */
    async checkHost(sample) {
      const t = now();
      for (const [kind, key] of HOST_KINDS) {
        const v = sample?.[key];
        const s = state[kind];
        if (s && s.lastSeenAt && t - s.lastSeenAt > HOST_GAP_MS) { if (!s.alertedAt) s.since = t; s.nulls = 0; } // đã báo rồi thì giữ nguyên (còn nhắc lại sau 6 giờ)
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          if (!s) continue;
          s.nulls = (s.nulls || 0) + 1; s.lastSeenAt = t;
          if (s.nulls >= HOST_NULL_LIMIT) delete state[kind];
          save();
          continue;
        }
        if (s) s.nulls = 0;
        await update(kind, state[kind] ? v >= HOST_OFF_PCT : v > HOST_ON_PCT, kind, v);
        if (state[kind]) { state[kind].lastSeenAt = t; save(); }
      }
    },
    incidents: () => structuredClone(state),
  };
}
