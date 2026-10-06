/**
 * Màn Nhật ký (spec §6, §9): gộp audit_log của bot (đọc SQLite) với activity.jsonl của dashboard.
 * Chủ bot thấy chữ dễ hiểu; Quản trị thấy thêm mã kỹ thuật trong `code`.
 */
import { fallbackName } from './thread-names.js';

export const ACTION_LABELS = {
  // audit_log của bot
  send: 'Bot trả lời tin nhắn',
  sendMessage: 'Bot gửi tin nhắn',
  sendVoice: 'Bot gửi tin thoại',
  sendSticker: 'Bot gửi nhãn dán',
  sendLink: 'Bot gửi liên kết',
  uploadAttachment: 'Bot gửi tệp',
  undo: 'Thu hồi tin của bot',
  send_system_notice: 'Bot gửi thông báo hệ thống',
  dashboard_send: 'Nhắn tay từ dashboard',
  dashboard_login_code: 'Gửi mã đăng nhập dashboard',
  createReminder: 'Tạo lời nhắc',
  removeReminder: 'Xoá lời nhắc',
  createPoll: 'Tạo bình chọn',
  changeGroupName: 'Đổi tên nhóm',
  addUserToGroup: 'Thêm người vào nhóm',
  removeUserFromGroup: 'Mời người ra khỏi nhóm',
  addGroupDeputy: 'Thêm phó nhóm',
  removeGroupDeputy: 'Bỏ phó nhóm',
  // activity.jsonl của dashboard
  login: 'Đăng nhập dashboard',
  logout_all: 'Đăng xuất mọi nơi',
  setup_admin: 'Tạo tài khoản Quản trị đầu tiên',
  user_create: 'Tạo tài khoản dashboard',
  user_update: 'Sửa tài khoản dashboard',
  restart_assistant: 'Khởi động lại trợ lý',
  zalo_qr_start: 'Mở mã QR đăng nhập Zalo',
  zalo_logout: 'Đăng xuất Zalo',
  telegram_settings: 'Đổi cài đặt Telegram cảnh báo',
};

const REASONS = {
  operation_failed: 'Zalo từ chối hoặc mạng lỗi',
  zalo_not_logged_in: 'Bot chưa đăng nhập Zalo',
  owner_required: 'Không đủ quyền',
  cross_thread_denied: 'Không đủ quyền ở hội thoại này',
  confirmation_required: 'Cần xác nhận trước',
  command_denied: 'Lệnh không được phép',
  auth_required: 'Thiếu thông tin người gọi',
  friend_tools_disabled: 'Tính năng kết bạn đang tắt',
  own_message_not_found: 'Không tìm thấy tin để thu hồi',
};

const ROLE_LABELS = { owner: 'Chủ nhân', public: 'Thành viên' };

export function describe(x, { role, names = new Map(), groups = new Map() }) {
  const admin = role === 'admin';
  if (x.src === 'dashboard') {
    return {
      at: x.at, source: 'dashboard', who: `${x.actor} (dashboard)`,
      what: ACTION_LABELS[x.action] || (admin ? x.action : 'Thao tác khác trên dashboard'),
      where: 'Dashboard', ok: x.ok, result: x.ok ? 'Thành công' : 'Không thành công',
      ...(admin ? { code: { action: x.action, detail: x.detail || '' } } : {}),
    };
  }
  let who;
  if (x.actorRole === 'dashboard') who = `${x.actorUid} (dashboard)`;
  else if (x.actorRole === 'system') who = 'Bot (tự động)';
  else who = [ROLE_LABELS[x.actorRole] || 'Người dùng', names.get(x.actorUid)].filter(Boolean).join(' ');
  const type = x.threadType === 1 ? 1 : 0;
  const where = !x.threadId ? '—' : (type === 1 ? groups.get(x.threadId) : names.get(x.threadId)) || fallbackName(x.threadId, type);
  return {
    at: x.at, source: 'zalo', who,
    what: ACTION_LABELS[x.action] || (admin ? x.action : 'Thao tác khác của bot'),
    where, ok: x.ok,
    result: x.ok ? 'Thành công' : `Không thành công${REASONS[x.error] ? ` — ${REASONS[x.error]}` : ''}`,
    ...(admin ? { code: { action: x.action, category: x.category, actorUid: x.actorUid, actorRole: x.actorRole, threadId: x.threadId, error: x.error } } : {}),
  };
}

export function createAuditFeed({ store, activity, threadNames }) {
  return {
    async list({ role, beforeMs = Number.MAX_SAFE_INTEGER, limit = 50, failedOnly = false }) {
      const want = limit + 20; // dư ra để kéo dài trang qua các mục trùng mili-giây
      const fromBot = store.available() ? store.listAudit({ beforeMs, limit: want, failedOnly }) : [];
      const fromDashboard = activity.list({ before: beforeMs, limit: want }).filter((e) => !failedOnly || !e.ok);
      const merged = [
        ...fromBot.map((r) => ({ src: 'zalo', ...r })),
        ...fromDashboard.map((e) => ({ src: 'dashboard', at: e.at, actor: e.actor, action: e.action, detail: e.detail, ok: e.ok })),
      ].sort((a, b) => b.at - a.at);
      // Con trỏ là mốc thời gian (lấy "< before"), nên trang phải chứa trọn mọi mục cùng mốc cuối.
      let n = Math.min(limit, merged.length);
      while (n > 0 && n < merged.length && merged[n].at === merged[n - 1].at) n += 1;
      const page = merged.slice(0, n);
      const uids = page.filter((x) => x.src === 'zalo').flatMap((x) => [x.actorUid, x.threadType === 0 ? x.threadId : null]).filter(Boolean);
      const names = uids.length && store.available() ? store.senderNames(uids) : new Map();
      const groups = await threadNames.load();
      return {
        items: page.map((x) => describe(x, { role, names, groups })),
        nextBefore: merged.length > n ? page[page.length - 1].at : null,
      };
    },
  };
}
