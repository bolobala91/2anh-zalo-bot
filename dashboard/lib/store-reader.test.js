import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openZaloStore } from '../../zalo-store.js';
import { createStoreReader, parseCursor, startOfDayVN, StoreUnavailable } from './store-reader.js';

const m = (n, over = {}) => ({
  threadId: '100', threadType: 0, msgId: `m${n}`, senderUid: '100', senderName: 'Lan',
  text: `tin ${n}`, msgType: 'webchat', ts: 1000 + n, isSelf: false, ...over,
});

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-store-'));
  const path = join(dir, 'zalo.sqlite');
  const readers = [];
  let writer = null;
  t.after(() => {
    for (const r of readers) r.close();
    writer?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path,
    write(messages, account = 'bot1') {
      writer ??= openZaloStore({ path });
      writer.insertMessages(account, messages, 'live');
    },
    closeWriter() { writer?.close(); writer = null; },
    reader(opts = {}) { const r = createStoreReader({ path, ...opts }); readers.push(r); return r; },
  };
}

test('chưa có tệp SQLite thì báo StoreUnavailable và không tạo tệp', (t) => {
  const s = setup(t);
  const r = s.reader();
  assert.equal(r.available(), false);
  assert.throws(() => r.listConversations(), StoreUnavailable);
  assert.throws(() => r.getMessages('100', 0), (e) => e.name === 'StoreUnavailable');
  assert.equal(existsSync(s.path), false);
});

test('kết nối chỉ đọc; đọc được khi bot đang ghi và cả khi bot đã tắt', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  const r = s.reader();
  assert.equal(r.isReadOnly(), true);
  assert.equal(r.getMessages('100', 0).messages.length, 1);
  s.write([m(2)]); // bot ghi tiếp trong lúc dashboard đang giữ kết nối đọc
  assert.equal(r.getMessages('100', 0).messages.length, 2);
  s.closeWriter(); // bot tắt
  assert.equal(r.getMessages('100', 0).messages.length, 2);
  assert.equal(s.reader().getMessages('100', 0).messages.length, 2); // mở mới sau khi bot tắt
});

test('danh sách hội thoại: mới nhất trước, xem trước 200 ký tự, tên người nhắn riêng', (t) => {
  const s = setup(t);
  s.write([
    m(1, { threadId: '100', threadType: 0, senderUid: '100', senderName: 'Lan', text: 'Chào bot', ts: 1000 }),
    m(2, { threadId: '100', threadType: 0, senderUid: '999', senderName: 'Uyển Nhi', text: 'Chào Lan', ts: 1100, isSelf: true }),
    m(3, { threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', text: 'x'.repeat(500), ts: 3000 }),
  ]);
  const list = s.reader().listConversations();
  assert.deepEqual(list.map((c) => [c.threadId, c.threadType, c.total]), [['200', 1, 1], ['100', 0, 2]]);
  assert.equal(list[0].lastText.length, 200);
  assert.equal(list[0].peerName, '');
  assert.deepEqual([list[1].peerName, list[1].lastText, list[1].lastIsSelf, list[1].lastAtMs], ['Lan', 'Chào Lan', true, 1100]);
});

test('chỉ hiện tài khoản bot đang dùng (tài khoản có tin mới nhất)', (t) => {
  const s = setup(t);
  s.write([m(1, { threadId: '100', ts: 1000 })], 'tai-khoan-cu');
  s.write([m(2, { threadId: '555', ts: 2000 })], 'bot1');
  assert.deepEqual(s.reader().listConversations().map((c) => c.threadId), ['555']);
});

test('phân trang tin cũ dần theo con trỏ, tin trùng mili-giây không mất không lặp', (t) => {
  const s = setup(t);
  s.write([1, 2, 3, 4, 5].map((n) => m(n, { ts: 5000 })).concat([m(6, { ts: 4000 }), m(7, { ts: 6000 }), m(8, { ts: 3000 })]));
  const r = s.reader();
  const seen = [];
  let before = null;
  let pages = 0;
  do {
    const page = r.getMessages('100', 0, { before, limit: 2 });
    assert.ok(page.messages.length <= 2);
    const ts = page.messages.map((x) => x.ts);
    assert.deepEqual(ts, [...ts].sort((a, b) => a - b)); // trong trang: cũ trước
    seen.push(...page.messages.map((x) => x.text));
    before = page.nextBefore;
    pages += 1;
  } while (before && pages < 10);
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  assert.equal(seen.includes('tin 7'), true);
});

test('tin trả ra không có senderUid', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  assert.deepEqual(Object.keys(s.reader().getMessages('100', 0).messages[0]).sort(), ['id', 'isSelf', 'msgType', 'senderName', 'text', 'ts']);
});

test('tin mã đăng nhập dashboard không bao giờ lộ ra: khung tin, xem trước, tìm kiếm', (t) => {
  const s = setup(t);
  s.write([
    m(1, { text: 'Chào bot', ts: 1000 }),
    m(2, { text: 'Mã đăng nhập dashboard: 123456\nMã có hiệu lực 5 phút. Đừng đưa mã này cho ai.', isSelf: true, ts: 2000 }),
  ]);
  const r = s.reader();
  assert.deepEqual(r.getMessages('100', 0).messages.map((x) => x.text), ['Chào bot']);
  assert.equal(r.searchMessages('123456').results.length, 0);
  assert.equal(r.searchMessages('Mã đăng nhập').results.length, 0);
  assert.equal(r.listConversations()[0].lastText, 'Chào bot');
});

test('tin mã đăng nhập không tính vào danh sách hội thoại và số liệu hôm nay', (t) => {
  const s = setup(t);
  const code = 'Mã đăng nhập dashboard: 123456\nMã có hiệu lực 5 phút.';
  s.write([
    m(1, { text: 'Chào bot', ts: 1000 }),
    m(2, { text: code, isSelf: true, ts: 2000 }),
    m(3, { threadId: '300', text: code, isSelf: true, ts: 3000 }),                  // chỉ có tin mã
    m(4, { threadId: '400', threadType: 1, text: code, isSelf: true, ts: 4000 }),   // nhóm chỉ có tin mã
  ]);
  const r = s.reader();
  assert.deepEqual(r.listConversations().map((c) => [c.threadId, c.total, c.lastAtMs]), [['100', 1, 1000]]);
  assert.deepEqual(r.todayStats(0), { received: 1, sent: 0, topGroups: [] });
});

test('tìm toàn văn: không phân biệt hoa thường tiếng Việt; % và _ là chữ thường', (t) => {
  const s = setup(t);
  s.write([
    m(1, { text: 'Họp tổ chiều nay' }), m(2, { text: 'giảm 50% học phí' }), m(3, { text: 'giảm 50 nghìn' }),
    m(4, { text: 'tên_tệp.pdf' }), m(5, { text: 'tênXtệp.pdf' }),
    m(6, { threadId: '200', threadType: 1, text: 'họp TỔ lúc 3 giờ', ts: 9000 }),
  ]);
  for (const caseFold of [true, false]) {
    const r = s.reader({ caseFold });
    assert.deepEqual(r.searchMessages('50%').results.map((x) => x.text), ['giảm 50% học phí']);
    assert.deepEqual(r.searchMessages('n_t').results.map((x) => x.text), ['tên_tệp.pdf']);
  }
  const hits = s.reader().searchMessages('HỌP TỔ').results;
  assert.deepEqual(hits.map((x) => [x.threadId, x.threadType]), [['200', 1], ['100', 0]]); // mới nhất trước
});

test('tìm kiếm có con trỏ và cắt chữ 300 ký tự', (t) => {
  const s = setup(t);
  s.write([1, 2, 3].map((n) => m(n, { text: `chung ${n} ${'y'.repeat(400)}` })));
  const r = s.reader();
  const p1 = r.searchMessages('chung', { limit: 2 });
  assert.equal(p1.results.length, 2);
  assert.equal(p1.results[0].text.length, 300);
  const p2 = r.searchMessages('chung', { limit: 2, before: p1.nextBefore });
  assert.equal(p2.results.length, 1);
  assert.equal(p2.nextBefore, null);
});

test('hasThread phân biệt loại hội thoại', (t) => {
  const s = setup(t);
  s.write([m(1, { threadId: '100', threadType: 0 })]);
  const r = s.reader();
  assert.equal(r.hasThread('100', 0), true);
  assert.equal(r.hasThread('100', 1), false);
  assert.equal(r.hasThread('101', 0), false);
});

test('số liệu hôm nay: nhận/gửi và 5 nhóm sôi nổi nhất', (t) => {
  const s = setup(t);
  const since = 100_000;
  const msgs = [m(1, { ts: since - 1 }), m(2, { ts: since + 1, isSelf: true }), m(3, { ts: since + 2 })];
  let n = 10;
  for (const [gid, count] of [['g1', 1], ['g2', 6], ['g3', 3], ['g4', 2], ['g5', 5], ['g6', 4]]) {
    for (let i = 0; i < count; i += 1) msgs.push(m(n++, { threadId: gid.replace('g', '20'), threadType: 1, ts: since + n }));
  }
  s.write(msgs);
  const stats = s.reader().todayStats(since);
  assert.equal(stats.sent, 1);
  assert.equal(stats.received, 1 + 21);
  assert.deepEqual(stats.topGroups, [
    { threadId: '202', count: 6 }, { threadId: '205', count: 5 }, { threadId: '206', count: 4 },
    { threadId: '203', count: 3 }, { threadId: '204', count: 2 },
  ]);
});

test('senderNames lấy tên mới nhất, bỏ tin của bot và UID không hợp lệ', (t) => {
  const s = setup(t);
  s.write([
    m(1, { senderUid: '100', senderName: 'Lan cũ', ts: 1 }),
    m(2, { senderUid: '100', senderName: 'Lan', ts: 2 }),
    m(3, { senderUid: '100', senderName: 'Bot', ts: 3, isSelf: true }),
  ]);
  const names = s.reader().senderNames(['100', '../x', '']);
  assert.deepEqual([...names], [['100', 'Lan']]);
});

test('startOfDayVN và parseCursor', () => {
  // 23:59 giờ VN ngày 7/10 → 0:00 giờ VN ngày 7/10 (= 17:00 UTC ngày 6/10)
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 16, 59)), Date.UTC(2026, 9, 6, 17, 0));
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 17, 0)), Date.UTC(2026, 9, 7, 17, 0));
  assert.deepEqual(parseCursor('5000:3'), { ts: 5000, id: 3 });
  for (const bad of ['x', '5:', ':3', '../5:3', '5:3;', '1'.repeat(17) + ':1', null, undefined]) assert.equal(parseCursor(bad), null);
});
