/**
 * Báo về tin nhắn riêng khi có người TAG chủ nhân trong nhóm: "🔔 Tên (UID …) nhắc bạn trong nhóm «…» lúc 21:05" + nội
 * dung, để chủ nhân xem nhanh mà không phải lục nhóm. Bật/tắt ở dashboard › Cấu hình (ZALO_NOTIFY_OWNER_MENTION trong .env
 * của Hermes, đọc lại khi tệp đổi — có hiệu lực ngay). Nhiều bot cùng ở một nhóm thì chỉ bật ở một bot để khỏi báo trùng.
 *
 * Chỉ tính tag thật (mentions có đúng UID chủ nhân) — không tính @All, không báo khi chính chủ nhân hay bot gửi.
 * Mỗi tin báo một lần; tối đa MAX_PER_WINDOW thông báo mỗi WINDOW_MS để một nhóm ồn ào không xả tràn tin riêng.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const ENV_KEY = 'ZALO_NOTIFY_OWNER_MENTION';
const MAX_TEXT = 700;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const SEEN_MAX = 500;
const GROUP_NAME_TTL_MS = 30 * 60 * 1000;

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const falsy = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());
const oneLine = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Công tắc đọc từ .env của Hermes theo mtime (mặc định BẬT khi chưa đặt); không có tệp thì theo process.env. */
export function envFlag(file, key = ENV_KEY, def = true) {
  let cache = { mtime: -1, value: def };
  return () => {
    const fallback = () => (truthy(process.env[key]) ? true : falsy(process.env[key]) ? false : def);
    if (!file || !existsSync(file)) return fallback();
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime !== cache.mtime) {
        const raw = parseEnv(readFileSync(file, 'utf8'))[key];
        cache = { mtime, value: raw === undefined ? def : truthy(raw) ? true : falsy(raw) ? false : def };
      }
      return cache.value;
    } catch { return fallback(); }
  };
}

export function createOwnerMentionNotifier({ ownerUids, selfUid = () => '', enabled, groupName, notify, now = Date.now, tz = 'Asia/Ho_Chi_Minh' }) {
  const seen = new Set();
  let windowStart = 0; let sentInWindow = 0;
  const names = new Map();   // threadId → { name, at }
  const hhmm = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hourCycle: 'h23', timeZone: tz })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.hour}:${p.minute} ${p.day}/${p.month}`;
  };

  async function nameOf(threadId) {
    const hit = names.get(threadId);
    if (hit && now() - hit.at < GROUP_NAME_TTL_MS) return hit.name;
    let name = '';
    try { name = oneLine(await groupName(threadId), 100); } catch { /* tên nhóm chỉ để dễ đọc */ }
    names.set(threadId, { name, at: now() });
    return name;
  }

  /** Gọi cho mỗi tin nhóm. Trả số chủ nhân đã được báo. */
  async function onGroupMessage({ msg, threadId, senderUid, content }) {
    if (!enabled()) return 0;
    const owners = ownerUids();
    const sender = String(senderUid || '');
    if (!owners.length || !sender || owners.includes(sender) || sender === String(selfUid() || '')) return 0;
    const mentions = Array.isArray(msg?.data?.mentions) ? msg.data.mentions : [];
    const tagged = owners.filter((o) => mentions.some((m) => String(m?.uid ?? '') === o));
    if (!tagged.length) return 0;
    const key = String(msg?.data?.msgId || msg?.data?.cliMsgId || `${threadId}:${sender}:${content}`);
    if (seen.has(key)) return 0;
    seen.add(key);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    const t = now();
    if (t - windowStart > WINDOW_MS) { windowStart = t; sentInWindow = 0; }
    if (sentInWindow >= MAX_PER_WINDOW) return 0;
    sentInWindow += 1;
    const group = await nameOf(String(threadId));
    const who = `${oneLine(msg?.data?.dName, 60) || 'Một người'} (UID ${sender})`;
    const body = String(content || '').trim().slice(0, MAX_TEXT) || '[tin không có chữ — ảnh/tệp/nhãn dán]';
    const text = `🔔 ${who} nhắc bạn trong nhóm «${group || 'chưa rõ tên'}» lúc ${hhmm(t)}:\n${body}`;
    let sent = 0;
    for (const owner of tagged) {
      try { await notify(owner, text); sent += 1; } catch (err) { console.error('[mention] không gửi được thông báo tag:', err?.message || err); }
    }
    return sent;
  }

  return { onGroupMessage };
}
