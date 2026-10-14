/**
 * Bạn bè, lời mời kết bạn và lời nhắc Zalo cho dashboard (spec §18.4). Dashboard không bao giờ chạm Zalo trực
 * tiếp — mọi lời gọi đi qua /control/* (control-api.js) rồi tới đây. Đọc thì gọi thẳng zca-js (danh sách bạn
 * đệm 10 phút); ghi (đồng ý/từ chối kết bạn, xoá lời nhắc) xin lượt từ bộ giới hạn nhịp như lệnh thường và
 * để lại một dòng audit_log `actor_role="dashboard"` mang tên người dùng dashboard.
 */

export const ZALO_UID = /^[1-9]\d{14,21}$/;
export const THREAD_ID = /^\d{1,32}$/;
export const REMINDER_ID = /^[\w-]{1,64}$/;
const FRIENDS_TTL_MS = 10 * 60_000;
const MAX_FRIENDS = 5000;
const MAX_REMINDERS = 50;

const text = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Một người bạn từ `getAllFriends` → `{ uid, name, zaloName }`; UID lạ thì null. */
export function normalizeFriend(u) {
  const uid = String(u?.userId ?? '');
  if (!ZALO_UID.test(uid)) return null;
  return { uid, name: text(u.displayName || u.zaloName), zaloName: text(u.zaloName) };
}

/** Lời mời người khác gửi tới bot (`getFriendRecommendations`, recommType 2) → `{ uid, name, message, at }`. */
export function normalizeRequests(res) {
  const items = Array.isArray(res?.recommItems) ? res.recommItems : [];
  return items.map((it) => it?.dataInfo).filter((d) => d && d.recommType === 2 && ZALO_UID.test(String(d.userId ?? '')))
    .map((d) => ({
      uid: String(d.userId), name: text(d.displayName || d.zaloName), message: text(d.recommInfo?.message, 300),
      at: Number.isFinite(d.recommTime) ? d.recommTime : null,
    }));
}

/** Lời nhắc của một hội thoại (`getListReminder`): nhóm dùng `id`, tin riêng dùng `reminderId`. */
export function normalizeReminder(r, selfUid) {
  const id = String(r?.reminderId ?? r?.id ?? '');
  if (!REMINDER_ID.test(id)) return null;
  const creatorUid = String(r.creatorId ?? r.creatorUid ?? '');
  return {
    id, title: text(r.params?.title, 300), startAt: Number(r.startTime) || null, repeat: Number(r.repeat) || 0,
    creatorUid, mine: Boolean(selfUid) && creatorUid === String(selfUid), createdAt: Number(r.createTime) || null,
  };
}

const bad = (message) => Object.assign(new Error(message), { validation: true });

const INFO_TTL_MS = 10 * 60_000;
const AVATAR_TTL_MS = 6 * 3600_000;
const BOARD_TTL_MS = 60_000;
const AVATAR_BATCH = 50;
/** Chỉ nhận link ảnh https — dashboard tải ảnh qua bộ lọc máy chủ ảnh Zalo của nó. */
const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\/[^\s]{1,500}$/.test(v) ? v : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Hồ sơ trong `getUserInfo().changed_profiles` → `[uid, profile]` (khoá có thể là "uid" hoặc "uid_0"). */
function profiles(res) {
  const map = res?.changed_profiles && typeof res.changed_profiles === 'object' ? res.changed_profiles : {};
  return Object.entries(map).map(([k, p]) => [String(p?.userId || k.replace(/_\d+$/, '')), p]).filter(([uid]) => ZALO_UID.test(uid));
}

/** Một mục bảng tin nhóm (`getListBoard`): 1 ghi chú, 2 tin ghim, 3 bình chọn; loại khác → null. */
export function normalizeBoardItem(item) {
  const d = item?.data || {};
  const p = d.params && typeof d.params === 'object' ? d.params : {};
  if (item?.boardType === 2) {
    return { kind: 'pin', id: text(d.id, 64), text: text(p.title ?? p.content ?? p.msg, 300), sender: text(p.senderName, 80),
      msgId: /^\d{1,32}$/.test(String(p.global_msg_id ?? p.msgId ?? '')) ? String(p.global_msg_id ?? p.msgId) : '',
      cliMsgId: /^\d{1,32}$/.test(String(p.client_msg_id ?? p.cliMsgId ?? '')) ? String(p.client_msg_id ?? p.cliMsgId) : '',
      at: num(d.createTime) };
  }
  if (item?.boardType === 1) return { kind: 'note', id: text(d.id, 64), text: text(p.title, 1000), at: num(d.createTime) };
  if (item?.boardType === 3) {
    return { kind: 'poll', id: text(d.poll_id, 64), question: text(d.question, 300), closed: Boolean(d.closed), votes: num(d.num_vote) || 0,
      at: num(d.created_time), options: (Array.isArray(d.options) ? d.options : []).slice(0, 30).map((o) => ({ text: text(o?.content, 200), votes: num(o?.votes) || 0 })) };
  }
  return null;
}

export function checkThread(threadId, threadType) {
  if (!THREAD_ID.test(String(threadId ?? ''))) throw bad('threadId không hợp lệ');
  if (threadType !== 0 && threadType !== 1) throw bad('threadType phải là 0 hoặc 1');
}

/**
 * @param {{ getApi: () => object|null, acquire?: () => Promise<void>,
 *   audit?: (meta: {action: string, actor: string, threadId: string, threadType: number}, fn: () => Promise<any>) => Promise<any>,
 *   now?: () => number }} deps
 */
export function createZaloDirectory({ getApi, acquire = async () => {}, audit = async (_meta, fn) => fn(), now = Date.now }) {
  let friendsCache = null; // { at, list }
  const infoCache = new Map();   // "type:id" → { at, value }
  const avatarCache = new Map(); // uid → { at, url } (url '' = người không có ảnh — cũng đệm để khỏi hỏi lại)
  const boardCache = new Map();  // groupId → { at, value }
  const fresh = (hit, ttl) => hit && now() - hit.at < ttl;
  const api = () => {
    const a = getApi();
    if (!a) throw new Error('Zalo chưa đăng nhập');
    return a;
  };

  return {
    async friends({ fresh = false } = {}) {
      if (!fresh && friendsCache && now() - friendsCache.at < FRIENDS_TTL_MS) return friendsCache.list;
      const raw = await api().getAllFriends(MAX_FRIENDS, 1);
      const list = (Array.isArray(raw) ? raw : []).map(normalizeFriend).filter(Boolean);
      friendsCache = { at: now(), list };
      return list;
    },
    async friendRequests() {
      return normalizeRequests(await api().getFriendRecommendations());
    },
    async answerFriendRequest({ uid, accept, actor }) {
      if (!ZALO_UID.test(String(uid ?? ''))) throw bad('UID Zalo không hợp lệ');
      if (typeof accept !== 'boolean') throw bad('accept phải là true/false');
      const a = api();
      await audit({ action: accept ? 'dashboard_friend_accept' : 'dashboard_friend_reject', actor, threadId: String(uid), threadType: 0 }, async () => {
        await acquire();
        if (accept) await a.acceptFriendRequest(String(uid)); else await a.rejectFriendRequest(String(uid));
      });
      friendsCache = null;
      return {};
    },
    async reminders({ threadId, threadType }) {
      checkThread(threadId, threadType);
      const a = api();
      const raw = await a.getListReminder({ page: 1, count: MAX_REMINDERS }, String(threadId), threadType);
      const self = typeof a.getOwnId === 'function' ? a.getOwnId() : '';
      return (Array.isArray(raw) ? raw : []).map((r) => normalizeReminder(r, self)).filter(Boolean);
    },
    /** Đầu khung chat / bảng Thông tin: tên, ảnh, số thành viên (nhóm), mô tả. Đệm 10 phút. */
    async chatInfo({ threadId, threadType }) {
      checkThread(threadId, threadType);
      const key = `${threadType}:${threadId}`;
      const hit = infoCache.get(key);
      if (fresh(hit, INFO_TTL_MS)) return hit.value;
      let value;
      if (threadType === 1) {
        const g = (await api().getGroupInfo(String(threadId)))?.gridInfoMap?.[String(threadId)] || {};
        value = { name: text(g.name), avatar: httpsUrl(g.fullAvt) || httpsUrl(g.avt), members: num(g.totalMember) || 0, desc: text(g.desc, 500) };
      } else {
        const [, u = {}] = profiles(await api().getUserInfo(String(threadId))).find(([uid]) => uid === String(threadId)) || [];
        value = { name: text(u.displayName || u.zaloName), avatar: httpsUrl(u.avatar), members: 0, desc: '' };
      }
      infoCache.set(key, { at: now(), value });
      return value;
    },
    /** Ảnh đại diện theo lô → `{ uid: url }` (bỏ người không có ảnh). Đệm 6 giờ; Zalo lỗi thì trả phần đã đệm. */
    async avatars(uids) {
      const list = [...new Set((Array.isArray(uids) ? uids : []).map(String))].filter((u) => ZALO_UID.test(u)).slice(0, 200);
      const missing = list.filter((u) => !fresh(avatarCache.get(u), AVATAR_TTL_MS));
      for (let i = 0; i < missing.length; i += AVATAR_BATCH) {
        const batch = missing.slice(i, i + AVATAR_BATCH);
        let found;
        try { found = new Map(profiles(await api().getUserInfo(batch)).map(([uid, p]) => [uid, httpsUrl(p?.avatar)])); } catch { break; }
        for (const u of batch) avatarCache.set(u, { at: now(), url: found.get(u) || '' });
      }
      const out = {};
      for (const u of list) { const url = avatarCache.get(u)?.url; if (url) out[u] = url; }
      return out;
    },
    /** Ảnh nhóm theo lô (danh sách hội thoại) → `{ groupId: url }`. Đệm 6 giờ; Zalo lỗi thì trả phần đã đệm. */
    async groupAvatars(ids) {
      const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((g) => THREAD_ID.test(g)).slice(0, 200);
      const missing = list.filter((g) => !fresh(avatarCache.get(`g:${g}`), AVATAR_TTL_MS));
      for (let i = 0; i < missing.length; i += AVATAR_BATCH) {
        const batch = missing.slice(i, i + AVATAR_BATCH);
        let map;
        try { map = (await api().getGroupInfo(batch))?.gridInfoMap || {}; } catch { break; }
        for (const g of batch) avatarCache.set(`g:${g}`, { at: now(), url: httpsUrl(map[g]?.avt) || httpsUrl(map[g]?.fullAvt) });
      }
      const out = {};
      for (const g of list) { const url = avatarCache.get(`g:${g}`)?.url; if (url) out[g] = url; }
      return out;
    },
    /** Bảng tin nhóm: tin ghim, ghi chú, bình chọn (chỉ đọc). Đệm 1 phút. */
    async board({ groupId }) {
      if (!THREAD_ID.test(String(groupId ?? ''))) throw bad('groupId không hợp lệ');
      const hit = boardCache.get(String(groupId));
      if (fresh(hit, BOARD_TTL_MS)) return hit.value;
      const res = await api().getListBoard({ page: 1, count: 30 }, String(groupId));
      const items = (Array.isArray(res?.items) ? res.items : []).map(normalizeBoardItem).filter(Boolean);
      const strip = ({ kind, ...rest }) => rest;
      const value = { pins: items.filter((x) => x.kind === 'pin').map(strip), notes: items.filter((x) => x.kind === 'note').map(strip), polls: items.filter((x) => x.kind === 'poll').map(strip) };
      boardCache.set(String(groupId), { at: now(), value });
      return value;
    },
    async removeReminder({ reminderId, threadId, threadType, actor }) {
      checkThread(threadId, threadType);
      if (!REMINDER_ID.test(String(reminderId ?? ''))) throw bad('Mã lời nhắc không hợp lệ');
      const a = api();
      await audit({ action: 'dashboard_reminder_remove', actor, threadId: String(threadId), threadType }, async () => {
        await acquire();
        await a.removeReminder(String(reminderId), String(threadId), threadType);
      });
      return {};
    },
  };
}
