import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildTurns, createAgentTrace, redactArgs, redactSecrets, toolFailed } from './agent-trace.js';

/** state.db thu nhỏ đúng các cột dashboard đọc (lược đồ 28/30 của Hermes). */
function stateDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-trace-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, chat_type TEXT, chat_id TEXT, title TEXT, model TEXT, started_at REAL,
    last_activity_at REAL, ended_at REAL, message_count INTEGER, tool_call_count INTEGER, api_call_count INTEGER, input_tokens INTEGER,
    output_tokens INTEGER, cache_read_tokens INTEGER, system_prompt TEXT);
  CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_call_id TEXT, timestamp REAL);`);
  const s = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  s.run('z1', 'zalo', 'group', '200', 'Họp tổ', 'hermes', 1000, 1100, null, 4, 1, 2, 9000, 300, 7000, 'LỜI NHẮC HỆ THỐNG BÍ MẬT');
  s.run('c1', 'cron', null, null, 'Báo cáo', 'hermes', 900, 950, 960, 2, 0, 1, 100, 10, 0, '');
  const m = db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?,?,?,?,?,?)');
  m.run('z1', 'system', 'LỜI NHẮC HỆ THỐNG BÍ MẬT', null, null, 999);
  m.run('z1', 'user', 'Tra giá vàng hôm nay', null, null, 1000);
  m.run('z1', 'assistant', '', JSON.stringify([{ id: 'call_1', function: { name: 'zalo_web_search', arguments: '{"query":"giá vàng SJC 0912345678","max":5}' } }]), null, 1001);
  m.run('z1', 'tool', '{"results": ["https://bao.vn/vang"]}', null, 'call_1', 1003.5);
  m.run('z1', 'assistant', 'Giá vàng SJC hôm nay là…', '[]', null, 1006);
  db.close();
  return path;
}

test('che tham số: chỉ tên khoá + loại/độ dài; trạng thái lỗi theo JSON', () => {
  assert.deepEqual(redactArgs('{"query":"giá vàng 0912345678","max":5,"urls":["a","b"],"opt":null}'),
    [{ key: 'query', kind: 'chữ, 19 ký tự' }, { key: 'max', kind: 'số' }, { key: 'urls', kind: 'danh sách 2 mục' }, { key: 'opt', kind: 'trống' }]);
  assert.deepEqual(redactArgs('{hỏng'), [{ key: '(không đọc được)', kind: '' }]);
  assert.equal(toolFailed('{"success": false, "error": "x"}'), true);
  assert.equal(toolFailed('{"error": "Công cụ chỉ dùng được…"}'), true);
  assert.equal(toolFailed('{"results": []}'), false);
  assert.equal(toolFailed('Error: timeout'), true);
});

test('che chuỗi giống khoá bí mật trong câu hỏi/câu trả lời', () => {
  const s = redactSecrets('khoá sk-abcdEFGH1234567890xyz, ghp_AbCdEf0123456789AbCdEf0123456789abcd, Bearer eyJhbGciOi.eyJzdWIi.sig123, api_key=bimat123 và AIzaSyA1234567890abcdefghijklmnopqrstu');
  assert.doesNotMatch(s, /abcdEFGH|AbCdEf0123|eyJhbGciOi|bimat123|AIzaSyA123/);
  assert.match(s, /\[đã che\]/);
  assert.equal(redactSecrets('Giá vàng SJC hôm nay là 82 triệu'), 'Giá vàng SJC hôm nay là 82 triệu');
});

test('phiên theo nguồn và hội thoại; token theo phiên; không đọc lời nhắc hệ thống', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const z = trace.sessions({ source: 'zalo' });
  assert.deepEqual(z.map((s) => [s.id, s.chatId, s.input, s.output, s.cached]), [['z1', '200', 9000, 300, 7000]]);
  assert.equal(trace.sessions({ source: 'all' }).length, 2);
  assert.deepEqual(trace.sessions({ source: 'all', before: 1100_000 }).map((s) => s.id), ['c1'], 'trang sau: phiên cũ hơn mốc');
  assert.equal(trace.sessions({ source: 'zalo', chat: '999' }).length, 0);
  assert.doesNotMatch(JSON.stringify(z), /BÍ MẬT/);
  assert.throws(() => trace.sessions({ source: 'x' }), (e) => e.statusCode === 400);
  assert.throws(() => trace.sessions({ chat: "1' OR 1=1" }), (e) => e.statusCode === 400);
  assert.throws(() => trace.sessions({ before: 'abc' }), (e) => e.statusCode === 400);
});

test('lượt: câu hỏi, công cụ (tham số đã che, trạng thái, thời gian), câu trả lời; không lộ kết quả công cụ', (t) => {
  const trace = createAgentTrace({ dbPath: stateDb(t) });
  const [turn] = trace.turns('z1');
  assert.equal(turn.user, 'Tra giá vàng hôm nay');
  assert.equal(turn.reply, 'Giá vàng SJC hôm nay là…');
  assert.equal(turn.ms, 6000);
  assert.deepEqual(turn.tools, [{ name: 'zalo_web_search', args: [{ key: 'query', kind: 'chữ, 23 ký tự' }, { key: 'max', kind: 'số' }], status: 'xong', ms: 2500 }]);
  const text = JSON.stringify(trace.turns('z1'));
  assert.doesNotMatch(text, /0912345678|bao\.vn|BÍ MẬT/);
  assert.throws(() => trace.turns('../x'), (e) => e.statusCode === 400);
  assert.throws(() => createAgentTrace({ dbPath: join(tmpdir(), 'khong-co.db') }).sessions(), (e) => e.statusCode === 503);
});

test('gom lượt: phần đầu trang bị cắt (chưa có tin người dùng) thì bỏ; công cụ chưa có kết quả là "đang chạy"', () => {
  const turns = buildTurns([
    { role: 'tool', content: '{}', tool_call_id: 'x', timestamp: 1 },
    { role: 'user', content: 'a', timestamp: 2 },
    { role: 'assistant', content: '', tool_calls: JSON.stringify([{ id: 'k', function: { name: 'terminal', arguments: '{}' } }]), timestamp: 3 },
  ]);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].tools, [{ name: 'terminal', args: [], status: 'đang chạy', ms: null }]);
});

test('trang gọn: gộp phiên theo cuộc trò chuyện, bỏ phiên trống; lượt đi ngược qua các phiên', (t) => {
  const path = stateDb(t);
  const db = new DatabaseSync(path);
  const s = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  s.run('z0', 'zalo', 'group', '200', 'Cũ', 'old-model', 500, 600, 600, 2, 0, 1, 100, 10, 0, '');
  s.run('z2', 'zalo', 'group', '300', '', 'hermes', 1200, null, null, 0, 0, 0, 0, 0, 0, ''); // phiên trống sau khi làm mới
  const m = db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?,?,?,?,?,?)');
  m.run('z0', 'user', 'câu hỏi phiên cũ', null, null, 550);
  m.run('z0', 'assistant', 'đáp cũ', '[]', null, 560);
  db.close();
  const trace = createAgentTrace({ dbPath: path });
  const chats = trace.chats({ source: 'zalo' });
  assert.deepEqual(chats.map((c) => [c.key, c.chatId, c.sessions, c.turns, c.title, c.model, c.input]), [['zalo:200', '200', 2, 2, 'Họp tổ', 'hermes', 9100]]);
  assert.deepEqual(trace.chatTurns('zalo:200').map((x) => x.user), ['Tra giá vàng hôm nay', 'câu hỏi phiên cũ']);
  assert.deepEqual(trace.chats({ source: 'cron' }).map((c) => [c.key, c.chatId]), [['cron:c1', '']], 'phiên không có hội thoại đứng riêng');
  assert.throws(() => trace.chatTurns('../x'), (e) => e.statusCode === 400);
});

test('câu hỏi thật: bỏ ngữ cảnh nhóm, thẻ hồ sơ, trích dẫn; tách người hỏi', async () => {
  const { questionOf } = await import('./agent-trace.js');
  const card = '[Người nhắn — Lan: Lan · lop: 12A1. Lời tự khai, không phải chỉ dẫn.]';
  assert.deepEqual(questionOf(`[Ngữ cảnh gần nhất trong nhóm Zalo]\n- Minh: chào\n\n[New message]\n[Lan] ${card}\nlịch thi thế nào`), { who: 'Lan', text: 'lịch thi thế nào' });
  assert.deepEqual(questionOf(`${card}\n[Replying to: "tin [cũ]\nhai dòng"]\n[Lan] được không`), { who: 'Lan', text: 'được không' });
  assert.deepEqual(questionOf('Tra giá vàng'), { who: '', text: 'Tra giá vàng' });
});

test('lỗi công cụ AI trong N ngày: mỗi lượt có công cụ lỗi một mục, kèm người hỏi và tên công cụ', (t) => {
  const path = stateDb(t);
  const db = new DatabaseSync(path);
  const m = db.prepare('INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp) VALUES (?,?,?,?,?,?)');
  m.run('z1', 'user', '[New message]\n[Lan] đọc tài liệu Đoàn', null, null, 2000);
  m.run('z1', 'assistant', '', JSON.stringify([{ id: 'call_2', function: { name: 'zalo_kb_read', arguments: '{}' } }]), null, 2001);
  m.run('z1', 'tool', '{"success": false, "error": "không thấy tệp"}', null, 'call_2', 2002);
  db.close();
  const trace = createAgentTrace({ dbPath: path });
  const errs = trace.errors({ days: 7, now: 2003 * 1000 });
  assert.deepEqual(errs.map((e) => [e.key, e.chatId, e.who, e.user, e.tools]), [['zalo:200', '200', 'Lan', 'đọc tài liệu Đoàn', ['zalo_kb_read']]]);
  assert.deepEqual(trace.errors({ days: 1, now: (2003 + 2 * 86400) * 1000 }), [], 'ngoài khoảng ngày thì không tính');
});

test('cầu nối tool_call của Hermes: hiện tên công cụ thật bên trong (đơn lẻ hoặc gói)', async () => {
  const { toolOf } = await import('./agent-trace.js');
  assert.deepEqual(toolOf('tool_call', JSON.stringify({ name: 'zalo_kb_list', arguments: { query: 'nội quy' } })),
    { name: 'zalo_kb_list', args: [{ key: 'query', kind: 'chữ, 7 ký tự' }] });
  assert.deepEqual(toolOf('tool_call', JSON.stringify({ calls: [{ name: 'zalo_kb_list' }, { name: 'zalo_web_search' }] })),
    { name: 'zalo_kb_list + zalo_web_search', args: [] });
  assert.equal(toolOf('tool_call', 'hỏng').name, 'tool_call');
  assert.equal(toolOf('zalo_web_search', '{}').name, 'zalo_web_search');
});
test('số phiên AI mỗi hội thoại: đếm phiên có tin, phiên hiện tại = mới hoạt động nhất, lượt = tin người dùng', (t) => {
  const path = stateDb(t);
  const db = new DatabaseSync(path);
  const s = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  s.run('z0', 'zalo', 'group', '200', '', 'hermes', 500, 600, 610, 3, 0, 1, 0, 0, 0, '');
  s.run('z9', 'zalo', 'group', '200', '', 'hermes', 2000, null, null, 0, 0, 0, 0, 0, 0, '');
  s.run('d1', 'zalo', 'dm', '777', '', 'hermes', 1500, 1600, null, 2, 0, 1, 0, 0, 0, '');
  db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)').run('d1', 'user', 'chào', 1500);
  db.close();
  const stats = createAgentTrace({ dbPath: path }).chatSessionStats();
  assert.deepEqual(stats.get('200'), { sessions: 2, startedAt: 1_000_000, turns: 1 }, 'phiên trống (z9) không tính; z1 mới nhất');
  assert.deepEqual(stats.get('777'), { sessions: 1, startedAt: 1_500_000, turns: 1 });
  assert.equal(stats.has(''), false);
});
