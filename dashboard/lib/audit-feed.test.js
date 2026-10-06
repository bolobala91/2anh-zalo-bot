import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditFeed, describe } from './audit-feed.js';

const fakeStore = (rows, { available = true } = {}) => ({
  available: () => available,
  listAudit: ({ beforeMs, limit, failedOnly }) => rows.filter((r) => r.at < beforeMs && (!failedOnly || !r.ok)).sort((a, b) => b.at - a.at).slice(0, limit),
  senderNames: () => new Map([['555', 'Anh Chủ'], ['100', 'Lan']]),
});
const fakeActivity = (entries) => ({ list: ({ before, limit }) => entries.filter((e) => e.at < before).sort((a, b) => b.at - a.at).slice(0, limit) });
const names = { load: async () => new Map([['200', 'Tổ Hoá']]) };
const row = (at, over = {}) => ({ id: at, at, actorUid: '555', actorRole: 'owner', action: 'send', category: 'send', threadId: '200', threadType: 1, ok: true, error: null, ...over });

test('gộp hai nguồn, mới nhất trước; trùng mili-giây ở ranh giới trang không mất mục', async () => {
  const feed = createAuditFeed({
    store: fakeStore([row(10), row(9), row(9, { id: 91 }), row(8)]),
    activity: fakeActivity([{ at: 9, actor: 'anh', action: 'login', detail: '', ok: true }]),
    threadNames: names,
  });
  const p1 = await feed.list({ role: 'admin', limit: 2 });
  assert.deepEqual(p1.items.map((i) => i.at), [10, 9, 9, 9]); // kéo dài trang tới hết mốc 9
  assert.equal(p1.nextBefore, 9);
  const p2 = await feed.list({ role: 'admin', limit: 2, beforeMs: p1.nextBefore });
  assert.deepEqual(p2.items.map((i) => i.at), [8]);
  assert.equal(p2.nextBefore, null);
});

test('lọc chỉ lỗi ở cả hai nguồn', async () => {
  const feed = createAuditFeed({
    store: fakeStore([row(10), row(9, { ok: false, error: 'operation_failed', action: 'dashboard_send', actorRole: 'dashboard', actorUid: 'khach' })]),
    activity: fakeActivity([{ at: 8, actor: 'x', action: 'login', detail: 'mật khẩu', ok: false }, { at: 7, actor: 'anh', action: 'login', ok: true }]),
    threadNames: names,
  });
  const { items } = await feed.list({ role: 'owner', failedOnly: true });
  assert.deepEqual(items.map((i) => [i.what, i.ok]), [['Nhắn tay từ dashboard', false], ['Đăng nhập dashboard', false]]);
});

test('chưa có lịch sử bot: chỉ hiện hoạt động dashboard', async () => {
  const feed = createAuditFeed({ store: fakeStore([], { available: false }), activity: fakeActivity([{ at: 5, actor: 'anh', action: 'zalo_logout', ok: true }]), threadNames: names });
  const { items } = await feed.list({ role: 'owner' });
  assert.deepEqual(items.map((i) => [i.who, i.what, i.where]), [['anh (dashboard)', 'Đăng xuất Zalo', 'Dashboard']]);
});

test('nhãn: Chủ bot chữ dễ hiểu không có mã; Quản trị có mã; việc lạ không lộ mã với Chủ bot', () => {
  const ctx = { names: new Map([['555', 'Anh Chủ'], ['100', 'Lan']]), groups: new Map([['200', 'Tổ Hoá']]) };
  const owner = describe({ src: 'zalo', ...row(1) }, { role: 'owner', ...ctx });
  assert.deepEqual(owner, { at: 1, source: 'zalo', who: 'Chủ nhân Anh Chủ', what: 'Bot trả lời tin nhắn', where: 'Tổ Hoá', ok: true, result: 'Thành công' });
  const failed = describe({ src: 'zalo', ...row(2, { action: 'dashboard_send', actorRole: 'dashboard', actorUid: 'khach', threadId: '100', threadType: 0, ok: false, error: 'operation_failed' }) }, { role: 'owner', ...ctx });
  assert.deepEqual([failed.who, failed.where, failed.result], ['khach (dashboard)', 'Lan', 'Không thành công — Zalo từ chối hoặc mạng lỗi']);
  const odd = { src: 'zalo', ...row(3, { action: 'createNote', actorRole: 'system', threadId: '', threadType: null }) };
  assert.equal(describe(odd, { role: 'owner', ...ctx }).what, 'Thao tác khác của bot');
  assert.equal(describe(odd, { role: 'owner', ...ctx }).who, 'Bot (tự động)');
  assert.equal(describe(odd, { role: 'owner', ...ctx }).where, '—');
  const admin = describe(odd, { role: 'admin', ...ctx });
  assert.equal(admin.what, 'createNote');
  assert.deepEqual(admin.code, { action: 'createNote', category: 'send', actorUid: '555', actorRole: 'system', threadId: '', error: null });
  const act = describe({ src: 'dashboard', at: 4, actor: 'anh', action: 'user_create', detail: 'khach (owner)', ok: true }, { role: 'admin', ...ctx });
  assert.deepEqual(act.code, { action: 'user_create', detail: 'khach (owner)' });
  assert.equal('code' in describe({ src: 'dashboard', at: 4, actor: 'anh', action: 'user_create', detail: 'khach (owner)', ok: true }, { role: 'owner', ...ctx }), false);
});
