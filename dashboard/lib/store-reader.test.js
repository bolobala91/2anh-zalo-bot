import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openZaloStore } from '../../zalo-store.js';
import { fold as clientFold } from '../public/fold.js';
import { createStoreReader, parseCursor, SEARCH_MATCH, SQL, startOfDayVN, StoreUnavailable } from './store-reader.js';

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

test('tìm không phân biệt dấu: hòa ↔ hoà, "hoc sinh" thấy "học sinh", Đoàn ↔ doan', (t) => {
  const s = setup(t);
  s.write([
    m(1, { text: 'hoà nhạc tối nay', ts: 1001 }), m(2, { text: 'Hòa ơi', ts: 1002 }),
    m(3, { text: 'Danh sách học sinh giỏi', ts: 1003 }), m(4, { text: 'ĐOÀN trường thông báo', ts: 1004 }),
    m(5, { text: 'doan van ban', ts: 1005 }), m(6, { text: 'hoa hồng', ts: 1006 }),
  ]);
  const r = s.reader();
  const texts = (q) => r.searchMessages(q).results.map((x) => x.text);
  assert.deepEqual(texts('hòa'), ['hoa hồng', 'Hòa ơi', 'hoà nhạc tối nay']);
  assert.deepEqual(texts('hoà'), texts('hòa'));
  assert.deepEqual(texts('hoc sinh'), ['Danh sách học sinh giỏi']);
  assert.deepEqual(texts('HỌC SINH'), ['Danh sách học sinh giỏi']);
  assert.deepEqual(texts('Đoàn'), ['doan van ban', 'ĐOÀN trường thông báo']);
  assert.deepEqual(texts('doan'), texts('Đoàn'));
  // Hàm zd_fold của SQLite chính là fold của giao diện: kết quả máy chủ trùng đúng phép so ở trình duyệt.
  const all = ['hoà nhạc tối nay', 'Hòa ơi', 'Danh sách học sinh giỏi', 'ĐOÀN trường thông báo', 'doan van ban', 'hoa hồng'];
  for (const q of ['hòa', 'HOA', 'sách', 'đoàn', 'trUONG', 'ơi', 'hòa']) {
    assert.deepEqual(new Set(texts(q)), new Set(all.filter((x) => clientFold(x).includes(clientFold(q)))), q);
  }
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

test('senderNames chỉ lấy từ tài khoản bot đang dùng; người chỉ nhắn trong nhóm lấy từ 30 ngày tính tới tin mới nhất', (t) => {
  const s = setup(t);
  const nowMs = 100 * 86_400_000;
  s.write([m(1, { senderUid: '100', senderName: 'Tên ở tài khoản cũ', ts: nowMs - 5 })], 'cu');
  s.write([
    m(2, { threadId: '100', senderUid: '100', senderName: 'Lan', ts: 1 }),                                     // nhắn riêng, rất cũ
    m(3, { threadId: '200', threadType: 1, senderUid: '300', senderName: 'Minh', ts: nowMs - 1000 }),           // chỉ trong nhóm, gần đây
    m(4, { threadId: '200', threadType: 1, senderUid: '301', senderName: 'Hà', ts: nowMs - 40 * 86_400_000 }),  // chỉ trong nhóm, quá 30 ngày
    m(5, { threadId: '900', senderUid: '900', senderName: 'Mới nhất', ts: nowMs }),                             // tin mới nhất → tài khoản bot1
  ]);
  const names = s.reader().senderNames(['100', '300', '301', '555']);
  assert.deepEqual([...names].sort(), [['100', 'Lan'], ['300', 'Minh']]);
});

test('listAudit chỉ lấy tài khoản bot đang dùng (và dòng chưa gắn tài khoản)', (t) => {
  const s = setup(t);
  s.write([m(1, { ts: 5000 })], 'bot1');
  s.closeWriter();
  let clock = 0;
  const w = openZaloStore({ path: s.path, now: () => clock });
  for (const [id, accountId, at] of [['a', 'bot1', 1000], ['b', 'cu', 1100], ['c', '', 1200]]) {
    clock = at;
    w.beginAudit({ requestId: id, accountId, actorUid: '555', actorRole: 'owner', action: `act_${id}`, category: 'send', threadId: '200', threadType: 1 });
    w.finishAudit(id, 'succeeded');
  }
  w.close();
  assert.deepEqual(s.reader().listAudit().map((x) => x.action), ['act_c', 'act_a']);
});

test('danh sách hội thoại đệm 10 s theo tài khoản; xoá đệm thì thấy tin mới ngay', (t) => {
  const s = setup(t);
  let clock = 0;
  s.write([m(1, { threadId: '100', ts: 1000 })]);
  const r = s.reader({ now: () => clock });
  assert.deepEqual(r.listConversations().map((c) => c.threadId), ['100']);
  s.write([m(2, { threadId: '101', ts: 2000 })]);
  clock = 9_999;
  assert.deepEqual(r.listConversations().map((c) => c.threadId), ['100']); // còn trong đệm
  clock = 10_000;
  assert.deepEqual(r.listConversations().map((c) => c.threadId), ['101', '100']);
  s.write([m(3, { threadId: '102', ts: 3000 })]);
  r.invalidateConversations();
  assert.deepEqual(r.listConversations().map((c) => c.threadId), ['102', '101', '100']);
  s.write([m(4, { threadId: '555', ts: 4000 })], 'tai-khoan-moi'); // đổi tài khoản → khoá đệm khác
  assert.deepEqual(r.listConversations().map((c) => c.threadId), ['555']);
});

test('tệp bị thay hoặc mất (khôi phục, cài lại): kiểm tối đa 30 s/lần rồi mở lại', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  let clock = 0; let id = 'v1'; let checks = 0;
  const statFile = () => { checks += 1; if (id === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return id; };
  const r = s.reader({ now: () => clock, statFile });
  assert.equal(r.getMessages('100', 0).messages.length, 1);
  const base = checks;
  clock = 29_999; r.getMessages('100', 0);
  assert.equal(checks, base); // chưa tới 30 s thì không stat
  id = null; clock = 30_000;
  assert.throws(() => r.getMessages('100', 0), StoreUnavailable);
  id = 'v2'; clock = 60_000;
  assert.equal(r.getMessages('100', 0).messages.length, 1); // mở lại được
});

test('tệp bị thay thật bằng bản khác: đọc bản mới sau lần kiểm kế tiếp', { skip: process.platform === 'win32' && 'Windows không cho đổi tên đè tệp SQLite đang mở' }, (t) => {
  const s = setup(t);
  s.write([m(1, { text: 'bản cũ' })]);
  s.closeWriter();
  const other = `${s.path}.new`;
  const w = openZaloStore({ path: other });
  w.insertMessages('bot1', [m(2, { text: 'bản khôi phục' })], 'live');
  w.close();
  let clock = 0;
  const r = s.reader({ now: () => clock });
  assert.deepEqual(r.getMessages('100', 0).messages.map((x) => x.text), ['bản cũ']);
  for (const suffix of ['-wal', '-shm']) rmSync(`${s.path}${suffix}`, { force: true });
  renameSync(other, s.path);
  clock = 30_000;
  assert.deepEqual(r.getMessages('100', 0).messages.map((x) => x.text), ['bản khôi phục']);
});

function seedBig(path, { rows, today, account = 'bot1' }) {
  openZaloStore({ path }).close();
  const d = new DatabaseSync(path);
  // Một câu INSERT … SELECT trong một giao dịch: 200k dòng trong khoảng 1 s.
  d.exec('BEGIN');
  d.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ?)
    INSERT INTO messages (identity_key, account_id, thread_id, thread_type, msg_id, sender_uid, sender_name, text, msg_type,
      timestamp_ms, is_self, source, created_at_ms, updated_at_ms)
    SELECT 'k' || i, CASE WHEN i % 50 = 0 THEN 'cu' ELSE ? END, CAST(100 + i % 300 AS TEXT), i % 3 = 0, 'm' || i,
      CAST(1000 + i % 700 AS TEXT), 'Người ' || (i % 700),
      CASE i % 5 WHEN 0 THEN 'Danh sách học sinh số ' WHEN 1 THEN 'hoà nhạc ' WHEN 2 THEN 'Đoàn trường thông báo ' ELSE 'chào cả nhà ' END || i,
      'webchat', ? - (? - i) * 150000, i % 4 = 0, 'live', 0, 0
    FROM n
  `).run(rows, account, today, rows);
  d.exec('COMMIT');
  d.close();
}

test('kế hoạch truy vấn: số liệu hôm nay và tìm kiếm đi theo idx_messages_retention, không quét cả bảng, không sắp xếp tạm', (t) => {
  const s = setup(t);
  seedBig(s.path, { rows: 2000, today: 10_000_000 });
  const d = new DatabaseSync(s.path, { readOnly: true });
  try {
    d.function('zd_fold', (x) => x);
    const plan = (sql) => d.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(sql.split('?').length - 1).fill(1)).map((r) => r.detail);
    for (const [name, sql] of [['todayTotals', SQL.todayTotals], ['todayTop', SQL.todayTop], ['search', SQL.search(SEARCH_MATCH.fold)], ['search LIKE', SQL.search(SEARCH_MATCH.like)]]) {
      const p = plan(sql);
      assert.ok(p.some((x) => /USING INDEX idx_messages_retention/.test(x)), `${name}: ${p.join(' | ')}`);
      assert.ok(!p.some((x) => /^SCAN messages/.test(x)), `${name} quét cả bảng: ${p.join(' | ')}`);
      if (name.startsWith('search')) assert.ok(!p.some((x) => /TEMP B-TREE/.test(x)), `${name} sắp xếp tạm: ${p.join(' | ')}`);
    }
  } finally { d.close(); }
});

test('200k tin: số liệu hôm nay < 5 ms, một trang tìm kiếm < 300 ms', (t) => {
  const s = setup(t);
  const today = 400 * 86_400_000;
  seedBig(s.path, { rows: 200_000, today });
  const r = s.reader();
  const best = (fn) => { fn(); let min = Infinity; for (let i = 0; i < 5; i += 1) { const a = performance.now(); fn(); min = Math.min(min, performance.now() - a); } return min; };
  const stats = r.todayStats(startOfDayVN(today));
  assert.ok(stats.received + stats.sent > 0 && stats.received + stats.sent < 1000);
  const statsMs = best(() => r.todayStats(startOfDayVN(today)));
  const page = r.searchMessages('hoc sinh');
  assert.equal(page.results.length, 30);
  assert.match(page.results[0].text, /học sinh/);
  const searchMs = best(() => r.searchMessages('hoc sinh'));
  t.diagnostic(`todayStats ${statsMs.toFixed(2)} ms · tìm 1 trang ${searchMs.toFixed(2)} ms`);
  assert.ok(statsMs < 5, `todayStats ${statsMs} ms`);
  assert.ok(searchMs < 300, `tìm ${searchMs} ms`);
});

test('startOfDayVN và parseCursor', () => {
  // 23:59 giờ VN ngày 7/10 → 0:00 giờ VN ngày 7/10 (= 17:00 UTC ngày 6/10)
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 16, 59)), Date.UTC(2026, 9, 6, 17, 0));
  assert.equal(startOfDayVN(Date.UTC(2026, 9, 7, 17, 0)), Date.UTC(2026, 9, 7, 17, 0));
  assert.deepEqual(parseCursor('5000:3'), { ts: 5000, id: 3 });
  for (const bad of ['x', '5:', ':3', '../5:3', '5:3;', '1'.repeat(17) + ':1', null, undefined]) assert.equal(parseCursor(bad), null);
});

test('listAudit: chỉ dòng kết quả, bỏ "đang gõ"/"đã xem", lọc lỗi, trước mốc', (t) => {
  const s = setup(t);
  s.write([m(1)]);
  s.closeWriter();
  let clock = 0;
  const w = openZaloStore({ path: s.path, now: () => clock });
  const add = (requestId, action, at, status, error) => {
    clock = at;
    w.beginAudit({ requestId, accountId: 'bot1', actorUid: '555', actorRole: 'owner', action, category: 'send', threadId: '200', threadType: 1 });
    if (status) w.finishAudit(requestId, status, { error });
  };
  add('r1', 'send', 1000, 'succeeded');
  add('r2', 'typing', 1100, 'succeeded');
  add('r3', 'ack_message', 1200, 'succeeded');
  add('r4', 'dashboard_send', 1300, 'failed', 'operation_failed');
  add('r5', 'send', 1400); // chỉ có attempted
  w.close();
  const r = s.reader();
  assert.deepEqual(r.listAudit().map((x) => [x.action, x.at, x.ok]), [['dashboard_send', 1300, false], ['send', 1000, true]]);
  assert.deepEqual(r.listAudit({ failedOnly: true }).map((x) => [x.action, x.error]), [['dashboard_send', 'operation_failed']]);
  assert.deepEqual(r.listAudit({ beforeMs: 1300 }).map((x) => x.action), ['send']);
  assert.equal(r.listAudit()[0].threadType, 1);
});
