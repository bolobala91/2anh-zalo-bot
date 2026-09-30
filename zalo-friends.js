/**
 * Kết bạn theo lệnh chủ bot, và "kết bạn xong thì lập nhóm".
 *
 * Zalo không cho kéo người chưa là bạn vào nhóm, nên chủ bot muốn lập nhóm
 * với người lạ phải đi hai bước: gửi lời mời kết bạn, chờ họ đồng ý, rồi mới
 * tạo nhóm. Module này giữ phần chờ: lưu kế hoạch ra data/friend-groups.json
 * (sống qua khởi động lại), nghe sự kiện kết bạn của zca-js, và cứ 10 phút hỏi
 * lại Zalo phòng khi sự kiện bị lỡ (sidecar tắt lúc người ta bấm đồng ý).
 *
 * Người đầu tiên đồng ý → tạo nhóm ngay với họ và chủ bot; ai đồng ý sau thì
 * thêm vào nhóm đó. Tạo/thêm chạy ngay trong sidecar, không qua LLM: chủ bot
 * đã duyệt lúc ra lệnh, và vai "system" của cầu nối không được gọi API nhóm.
 * Vì chạy ngoài cầu nối nên mọi lời mời / tạo / thêm vẫn phải xin lượt từ bộ
 * giới hạn nhịp (`acquire`) như lệnh thường.
 *
 * Kế hoạch được lưu TRƯỚC khi gửi lời mời và lời mời gửi nền: danh sách dài
 * mà bắt cầu nối chờ gửi xong thì quá hạn ack, agent tưởng lỗi và lập lại lần
 * hai — gửi mời hai lần, tạo hai nhóm.
 *
 * Lời mời do người lạ tự gửi tới bot thì KHÔNG đồng ý — chỉ nhắn riêng báo chủ
 * bot. Tất cả nằm sau công tắc ZALO_FRIEND_TOOLS (mặc định tắt).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FriendEventType } from 'zca-js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const THREAD_USER = 0;
const DAY_MS = 24 * 3600_000;
const POLL_MS = 10 * 60_000;
const MAX_AGE_MS = 30 * DAY_MS;
const KEEP_CLOSED_MS = 60 * DAY_MS;
const STRANGER_NOTICE_COOLDOWN_MS = 12 * 3600_000;
const MAX_MEMBERS = 50;
const DEFAULT_REQUEST_MESSAGE = 'Xin chào, mình kết bạn nhé!';
// sendFriendRequest: 222 = người kia đã mời bot trước (gửi lại = đồng ý), 225 = đã là bạn.
const ALREADY_FRIEND_CODES = new Set([222, 225]);

export function friendToolsEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.ZALO_FRIEND_TOOLS || '').trim());
}

export function friendPlansPath() {
  return process.env.ZALO_FRIEND_PLANS_FILE || join(__dirname, 'data', 'friend-groups.json');
}

export function readPlans(path = friendPlansPath()) {
  if (!existsSync(path)) return { plans: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(data?.plans)) return data;
    throw new Error('thiếu mảng plans');
  } catch (err) {
    // Cất tệp hỏng sang bên cạnh: trả rỗng rồi lần ghi sau đè lên là mất hết kế hoạch.
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); } catch { /* noop */ }
    console.warn(`[friends] tệp kế hoạch hỏng, đã cất sang ${aside}:`, err?.message || err);
    return { plans: [] };
  }
}

export function writePlans(data, path = friendPlansPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

let activeManager = null;
export function setActiveFriendManager(manager) { activeManager = manager; }
export function getActiveFriendManager() { return activeManager; }

/**
 * @param {{
 *   api: object,
 *   notify: (threadId: string, threadType: number, text: string) => Promise<unknown>,
 *   ownerUids: () => string[],
 *   acquire?: (method: string) => Promise<void>,
 *   selfUid?: string,
 * }} options
 */
export function createFriendManager({
  api, notify, ownerUids, selfUid = '', acquire = async () => {},
  loadPlans = () => readPlans(), savePlans = (data) => writePlans(data),
  now = Date.now, requestGapMs = 1500, pollMs = POLL_MS, maxAgeMs = MAX_AGE_MS,
  setInterval: setIntervalFn = setInterval, clearInterval: clearIntervalFn = clearInterval,
} = {}) {
  // Mọi thay đổi kế hoạch đi qua một hàng đợi: hai người đồng ý cùng lúc mà
  // chạy song song thì cả hai cùng thấy "chưa có nhóm" và tạo hai nhóm; huỷ
  // chạy song song thì bị lượt tạo nhóm đang dở ghi đè.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  let sending = Promise.resolve();
  const strangerNoticeAt = new Map();

  const label = (plan, uid) => plan.members[uid]?.name || `UID ${uid}`;
  const say = (plan, text) => notify(plan.threadId, plan.threadType, text).catch((err) => {
    console.error('[friends] không gửi được thông báo:', err?.message || err);
  });
  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const uidsWith = (plan, status) => Object.keys(plan.members).filter((u) => plan.members[u].status === status);

  async function isFriend(uid) {
    try {
      const status = await api.getFriendRequestStatus(uid);
      return Boolean(Number(status?.is_friend));
    } catch {
      return false;
    }
  }

  function closeIfDone(plan) {
    if (!uidsWith(plan, 'pending').length && !uidsWith(plan, 'accepted').length) plan.closed = true;
  }

  // Đưa mọi người đã đồng ý (status accepted) vào nhóm; tạo nhóm nếu chưa có.
  // Lỗi thì giữ nguyên accepted để lần sau (người kế tiếp / lượt kiểm định kỳ) thử lại.
  async function settle(plan, data) {
    const ready = uidsWith(plan, 'accepted');
    if (!ready.length) return;
    const who = ready.map((u) => label(plan, u)).join(', ');
    if (!plan.groupId) {
      try {
        await acquire('createGroup');
        const res = await api.createGroup({ name: plan.name, members: [...ready, plan.ownerUid] });
        if (!res?.groupId) throw new Error('Zalo không trả về mã nhóm');
        plan.groupId = String(res.groupId);
        const failed = new Set((res.errorMembers || []).map(String));
        for (const uid of ready) plan.members[uid].status = failed.has(uid) ? 'failed' : 'added';
        closeIfDone(plan);
        savePlans(data); // ghi mã nhóm ngay, trước khi báo — lỗi báo không được để mất nhóm đã tạo
        const lost = ready.filter((u) => failed.has(u)).map((u) => label(plan, u));
        await say(plan, `✅ ${who} đã đồng ý kết bạn — đã tạo nhóm "${plan.name}".`
          + (lost.length ? ` Chưa kéo được: ${lost.join(', ')}.` : ''));
      } catch (err) {
        await say(plan, `⚠️ ${who} đã đồng ý kết bạn nhưng chưa tạo được nhóm "${plan.name}": `
          + `${err?.message || err}. Bot sẽ thử lại.`);
      }
      return;
    }
    for (const uid of ready) {
      try {
        await acquire('addUserToGroup');
        const res = await api.addUserToGroup(uid, plan.groupId);
        if ((res?.errorMembers || []).map(String).includes(uid)) throw new Error('Zalo từ chối thêm vào nhóm');
        plan.members[uid].status = 'added';
        await say(plan, `✅ ${label(plan, uid)} đã đồng ý kết bạn — đã thêm vào nhóm "${plan.name}".`);
      } catch (err) {
        plan.members[uid].status = 'failed';
        plan.members[uid].error = String(err?.message || err);
        await say(plan, `⚠️ ${label(plan, uid)} đã đồng ý kết bạn nhưng chưa thêm được vào nhóm "${plan.name}": ${plan.members[uid].error}`);
      }
    }
    closeIfDone(plan);
  }

  function accepted(uid) {
    return serial(async () => {
      const data = loadPlans();
      const plans = data.plans.filter((p) => !p.closed && p.members?.[uid]?.status === 'pending');
      if (!plans.length) return;
      for (const plan of plans) {
        plan.members[uid].status = 'accepted';
        await settle(plan, data);
        closeIfDone(plan);
      }
      savePlans(data);
    });
  }

  function rejected(uids) {
    return serial(async () => {
      const data = loadPlans();
      let touched = false;
      for (const uid of uids) {
        for (const plan of data.plans.filter((p) => !p.closed && p.members?.[uid]?.status === 'pending')) {
          plan.members[uid].status = 'rejected';
          closeIfDone(plan);
          touched = true;
          await say(plan, `❌ ${label(plan, uid)} đã từ chối lời mời kết bạn (kế hoạch nhóm "${plan.name}").`);
        }
      }
      if (touched) savePlans(data);
    });
  }

  async function strangerRequest(event) {
    const fromUid = String(event.data?.fromUid || '');
    if (!fromUid || fromUid === String(selfUid)) return;
    const owners = ownerUids().map(String);
    if (owners.includes(fromUid)) return;
    const t = now();
    for (const [uid, at] of strangerNoticeAt) if (t - at >= STRANGER_NOTICE_COOLDOWN_MS) strangerNoticeAt.delete(uid);
    if (strangerNoticeAt.has(fromUid)) return;
    strangerNoticeAt.set(fromUid, t);
    // Không chép lời nhắn của người lạ: tin này nằm trong lịch sử như lời của bot,
    // chữ người lạ tự soạn không được lọt vào ngữ cảnh của chủ nhân.
    const text = `📨 UID ${fromUid} vừa gửi lời mời kết bạn cho bot. Bot chưa đồng ý.\n`
      + 'Muốn nhận thì bảo bot "đồng ý kết bạn UID này".';
    for (const owner of owners) {
      await notify(owner, THREAD_USER, text).catch((err) => {
        console.error('[friends] không báo được chủ bot:', err?.message || err);
      });
    }
  }

  async function onFriendEvent(event) {
    const type = event?.type;
    if (type === FriendEventType.ADD) {
      const uid = String(typeof event.data === 'string' ? event.data : event.threadId || '');
      if (uid) await accepted(uid);
    } else if (type === FriendEventType.REQUEST) {
      if (!event.isSelf) await strangerRequest(event);
    } else if (type === FriendEventType.REJECT_REQUEST) {
      const uids = [event.data?.fromUid, event.data?.toUid].map((u) => String(u || '')).filter(Boolean);
      await rejected(uids);
    }
  }

  // Gửi lời mời cho từng người còn pending; chạy nền sau khi kế hoạch đã lưu.
  async function sendInvites(planId, text) {
    await new Promise((r) => setImmediate(r)); // nhường cho sự kiện đến ngay sau khi lập kế hoạch
    let sent = 0;
    const failures = [];
    let plan = loadPlans().plans.find((p) => p.id === planId);
    const uids = plan ? Object.keys(plan.members) : [];
    for (const [i, uid] of uids.entries()) {
      plan = loadPlans().plans.find((p) => p.id === planId);
      if (!plan || plan.closed || plan.members[uid]?.status !== 'pending') continue;
      if (await isFriend(uid)) { await accepted(uid); continue; }
      if (i) await sleep(requestGapMs); // gửi dồn dễ bị Zalo khoá tính năng kết bạn
      try {
        await acquire('sendFriendRequest');
        await api.sendFriendRequest(text, uid);
        sent += 1;
      } catch (err) {
        if (ALREADY_FRIEND_CODES.has(Number(err?.code)) || await isFriend(uid)) {
          await accepted(uid);
          continue;
        }
        failures.push(`${label(plan, uid)} (${err?.message || err})`);
        await serial(async () => {
          const data = loadPlans();
          const p = data.plans.find((x) => x.id === planId);
          if (p?.members[uid]?.status !== 'pending') return;
          p.members[uid].status = 'failed';
          p.members[uid].error = String(err?.message || err);
          closeIfDone(p);
          savePlans(data);
        });
      }
    }
    if (plan) {
      await say(plan, `📨 Kế hoạch nhóm "${plan.name}": đã gửi lời mời kết bạn cho ${sent} người.`
        + (failures.length ? ` Không gửi được: ${failures.join('; ')}.` : '')
        + ' Ai đồng ý bot sẽ báo ở đây.');
    }
  }

  async function startPlan({
    memberIds = [], memberNames = [], name = '', message = '', ownerUid = '', threadId = '', threadType = THREAD_USER,
  } = {}) {
    const owner = String(ownerUid || '');
    const names = new Map();
    const ids = [];
    memberIds.forEach((raw, i) => {
      const uid = String(raw ?? '').trim();
      if (uid === owner || uid === String(selfUid) || ids.includes(uid)) return;
      if (!/^\d+$/.test(uid)) throw new Error(`UID không hợp lệ: ${raw}`);
      ids.push(uid);
      const n = String(memberNames[i] ?? '').trim();
      if (n) names.set(uid, n.slice(0, 100));
    });
    if (!ids.length) throw new Error('Cần ít nhất một thành viên khác ngoài bot và chủ nhân');
    if (ids.length > MAX_MEMBERS) throw new Error(`Tối đa ${MAX_MEMBERS} thành viên mỗi kế hoạch`);
    if (!owner || !threadId) throw new Error('Thiếu người ra lệnh hoặc nơi báo kết quả');
    const groupName = String(name || '').trim().slice(0, 100) || 'Nhóm mới';
    const text = String(message || '').trim().slice(0, 150) || DEFAULT_REQUEST_MESSAGE;

    const plan = await serial(async () => {
      const data = loadPlans();
      const key = [...ids].sort().join(',');
      const dup = data.plans.find((p) => !p.closed && p.ownerUid === owner && p.name === groupName
        && Object.keys(p.members).sort().join(',') === key);
      if (dup) throw new Error(`Đã có kế hoạch ${dup.id} đang mở cho nhóm "${groupName}" với đúng những người này`);
      const fresh = {
        id: `fg-${now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: groupName,
        ownerUid: owner,
        threadId: String(threadId),
        threadType: Number(threadType) === 1 ? 1 : THREAD_USER,
        createdAt: now(),
        groupId: null,
        closed: false,
        members: Object.fromEntries(ids.map((uid) => [uid, {
          status: 'pending', ...(names.has(uid) ? { name: names.get(uid) } : {}),
        }])),
      };
      data.plans.push(fresh);
      savePlans(data);
      return fresh;
    });

    sending = sending.then(() => sendInvites(plan.id, text)).catch((err) => {
      console.error('[friends] lỗi khi gửi lời mời kết bạn:', err?.message || err);
    });
    return plan;
  }

  function listPlans({ includeClosed = false } = {}) {
    return loadPlans().plans.filter((p) => includeClosed || !p.closed);
  }

  function cancelPlan(planId) {
    return serial(async () => {
      const data = loadPlans();
      const plan = data.plans.find((p) => p.id === String(planId));
      if (!plan) throw new Error(`Không có kế hoạch ${planId}`);
      plan.closed = true;
      plan.cancelled = true;
      savePlans(data);
      return plan;
    });
  }

  async function poll() {
    const due = [];
    await serial(async () => {
      const data = loadPlans();
      const t = now();
      const before = data.plans.length;
      data.plans = data.plans.filter((p) => !p.closed || t - p.createdAt < KEEP_CLOSED_MS);
      let touched = data.plans.length !== before;
      for (const plan of data.plans.filter((p) => !p.closed)) {
        if (t - plan.createdAt > maxAgeMs) {
          plan.closed = true;
          touched = true;
          const waiting = uidsWith(plan, 'pending').map((u) => label(plan, u));
          await say(plan, `⌛ Kế hoạch nhóm "${plan.name}" đã hết hạn 30 ngày. Chưa đồng ý: `
            + (waiting.join(', ') || 'không còn ai') + '.');
          continue;
        }
        if (uidsWith(plan, 'accepted').length) { // lần trước tạo/thêm lỗi → thử lại
          await settle(plan, data);
          touched = true;
        }
        due.push(...uidsWith(plan, 'pending'));
      }
      if (touched) savePlans(data);
    });
    for (const uid of new Set(due)) {
      if (await isFriend(uid)) await accepted(uid);
    }
  }

  const timer = setIntervalFn(() => {
    poll().catch((err) => console.error('[friends] lỗi khi kiểm tra kế hoạch:', err?.message || err));
  }, pollMs);
  timer?.unref?.();

  return {
    startPlan, listPlans, cancelPlan, onFriendEvent, poll,
    idle: async () => { await sending; await queue; },
    stop: () => clearIntervalFn(timer),
  };
}
