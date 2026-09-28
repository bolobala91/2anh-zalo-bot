/**
 * Chào thành viên mới theo từng nhóm, gom theo đợt.
 *
 * Người vào nhóm thường đến dồn dập (mở link là vài chục người trong mấy
 * phút), chào từng người một là spam cả nhóm. Nên gom lại: đủ `batchSize`
 * người thì gửi một tin tag tất cả; chưa đủ thì chờ tối đa `maxWaitMinutes`
 * kể từ người đầu tiên rồi gửi luôn, để không ai phải chờ mãi.
 *
 * Chào gì và ở nhóm nào là cấu hình của chủ bot (data/welcome.json, sửa qua
 * công cụ zalo_group_welcome). Tin chào là chữ cố định, không qua LLM: nhanh,
 * không tốn lượt model, và không bao giờ nói điều chủ bot không duyệt.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const WELCOME_DEFAULTS = Object.freeze({ batchSize: 5, maxWaitMinutes: 15 });
const MAX_BATCH = 20;
const MAX_WAIT_MINUTES = 24 * 60;
const MAX_MESSAGE_CHARS = 1500;

export function welcomeConfigPath() {
  return process.env.ZALO_WELCOME_FILE || join(__dirname, 'data', 'welcome.json');
}

export function readWelcomeConfig(path = welcomeConfigPath()) {
  if (!existsSync(path)) return { groups: {} };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data.groups === 'object' && data.groups ? data : { groups: {} };
  } catch (err) {
    console.warn('[welcome] không đọc được cấu hình chào:', err?.message || err);
    return { groups: {} };
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/**
 * Bật/sửa/tắt chào cho một nhóm. `patch` chỉ đổi những trường được gửi lên.
 * Trả cấu hình mới của nhóm đó.
 */
export function updateWelcomeGroup(groupId, patch = {}, path = welcomeConfigPath()) {
  const id = String(groupId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('groupId không hợp lệ');
  const config = readWelcomeConfig(path);
  const current = config.groups[id] || { enabled: false, message: '', ...WELCOME_DEFAULTS };
  const next = { ...current };
  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (patch.message !== undefined) next.message = String(patch.message).trim().slice(0, MAX_MESSAGE_CHARS);
  if (patch.name !== undefined) next.name = String(patch.name).trim().slice(0, 200);
  if (patch.batchSize !== undefined) next.batchSize = clampInt(patch.batchSize, 1, MAX_BATCH, current.batchSize);
  if (patch.maxWaitMinutes !== undefined) {
    next.maxWaitMinutes = clampInt(patch.maxWaitMinutes, 1, MAX_WAIT_MINUTES, current.maxWaitMinutes);
  }
  if (next.enabled && !next.message) throw new Error('Cần nội dung lời chào trước khi bật');
  config.groups[id] = next;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, path);
  return next;
}

/** "@A, @B, @C" + xuống dòng + lời chào, kèm vị trí tag cho Zalo. */
export function buildWelcomeMessage(members, message) {
  let text = '';
  const mentions = [];
  members.forEach((member, i) => {
    if (i) text += ', ';
    const tag = `@${member.name}`;
    mentions.push({ pos: text.length, len: tag.length, uid: member.uid });
    text += tag;
  });
  return { text: `${text}\n${message}`, mentions };
}

/**
 * @param {{
 *   send: (groupId: string, text: string, mentions: object[]) => Promise<unknown>,
 *   selfUid?: string,
 *   loadConfig?: () => {groups: object},
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout,
 * }} options
 */
export function createWelcomer({
  send, selfUid = '', loadConfig = () => readWelcomeConfig(),
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const pending = new Map(); // groupId → { members: Map<uid, name>, timer }

  async function flush(groupId) {
    const entry = pending.get(groupId);
    if (!entry) return;
    pending.delete(groupId);
    clearTimer(entry.timer);
    const cfg = loadConfig().groups?.[groupId];
    if (!cfg?.enabled || !cfg.message) return; // bị tắt trong lúc đang gom
    const members = [...entry.members].map(([uid, name]) => ({ uid, name }));
    const { text, mentions } = buildWelcomeMessage(members, cfg.message);
    try {
      await send(groupId, text, mentions);
      console.log(`[welcome] 👋 đã chào ${members.length} thành viên mới ở nhóm ${groupId}`);
    } catch (err) {
      console.error(`[welcome] không gửi được lời chào ở nhóm ${groupId}:`, err?.message || err);
    }
  }

  function onGroupEvent(event) {
    if (event?.type !== 'join') return;
    const groupId = String(event.threadId || event.data?.groupId || '');
    const cfg = loadConfig().groups?.[groupId];
    if (!cfg?.enabled || !cfg.message) return;
    const joined = (event.data?.updateMembers || [])
      .map((m) => ({ uid: String(m?.id ?? ''), name: String(m?.dName ?? '').trim() }))
      .filter((m) => m.uid && m.name && m.uid !== String(selfUid));
    if (!joined.length) return;

    let entry = pending.get(groupId);
    if (!entry) {
      entry = { members: new Map(), timer: null };
      pending.set(groupId, entry);
    }
    for (const m of joined) entry.members.set(m.uid, m.name);

    const batchSize = clampInt(cfg.batchSize, 1, MAX_BATCH, WELCOME_DEFAULTS.batchSize);
    if (entry.members.size >= batchSize) {
      flush(groupId);
    } else if (!entry.timer) {
      const waitMin = clampInt(cfg.maxWaitMinutes, 1, MAX_WAIT_MINUTES, WELCOME_DEFAULTS.maxWaitMinutes);
      entry.timer = setTimer(() => { flush(groupId); }, waitMin * 60_000);
      entry.timer?.unref?.();
    }
  }

  function stop() {
    for (const entry of pending.values()) clearTimer(entry.timer);
    pending.clear();
  }

  return { onGroupEvent, flush, stop, pendingCount: (groupId) => pending.get(String(groupId))?.members.size ?? 0 };
}
