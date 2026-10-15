import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openZaloStore } from './zalo-store.js';
import { importLegacyHermesHistory } from './legacy-history-import.js';

function legacyDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, source TEXT, session_key TEXT, chat_id TEXT,
      chat_type TEXT, user_id TEXT, display_name TEXT, origin_json TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
      platform_message_id TEXT, timestamp REAL
    );
    CREATE TABLE delivery_obligations (
      platform TEXT, state TEXT, session_key TEXT, chat_id TEXT, content TEXT
    );
  `);
  db.prepare(`INSERT INTO sessions VALUES (?, 'zalo', ?, ?, ?, ?, ?, ?)`)
    .run('s1', 'agent:main:zalo:group:g1', 'g1', 'group', 'last-user', 'Nhóm Một', '{}');
  db.prepare(`INSERT INTO sessions VALUES (?, 'telegram', ?, ?, ?, ?, ?, ?)`)
    .run('s2', 'agent:main:telegram:dm:t1', 't1', 'dm', 'tg-user', 'Telegram', '{}');
  return db;
}

test('legacy import keeps real Zalo dialogue and excludes internal or undelivered rows', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-legacy-import-'));
  const sourcePath = join(dir, 'state.db');
  const source = legacyDatabase(sourcePath);
  const insert = source.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(1, 's1', 'user', '[Ngữ cảnh gần nhất trong nhóm Zalo]\n- cũ\n\n[New message]\n[Anh] đọc file này', '101', 1_788_000_001);
  insert.run(2, 's1', 'assistant', 'Bản trả lời đã giao', null, 1_788_000_002);
  insert.run(3, 's1', 'assistant', 'Bản trả lời bị lỗi', null, 1_788_000_003);
  insert.run(4, 's1', 'assistant', '', null, 1_788_000_004);
  insert.run(5, 's1', 'tool', '{"secret":"internal"}', null, 1_788_000_005);
  insert.run(6, 's2', 'user', '[Anh] telegram không được nhập', '201', 1_788_000_006);
  source.prepare("INSERT INTO delivery_obligations VALUES ('zalo','delivered',?,?,?)")
    .run('agent:main:zalo:group:g1', 'g1', 'Bản trả lời đã giao');
  source.prepare("INSERT INTO delivery_obligations VALUES ('zalo','failed',?,?,?)")
    .run('agent:main:zalo:group:g1', 'g1', 'Bản trả lời bị lỗi');
  source.close();

  const store = openZaloStore({ path: join(dir, 'zalo.sqlite') });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const result = importLegacyHermesHistory({
    sourcePath, store, accountId: 'bot', now: () => 1_788_100_000_000,
  });

  assert.deepEqual(result, { scanned: 2, inserted: 2, skipped: 0, pruned: 0 });
  const history = store.getHistory('bot', 'g1', 1, 10);
  assert.deepEqual(history.map((message) => message.text), ['đọc file này', 'Bản trả lời đã giao']);
  assert.equal(history[0].senderName, 'Anh');
  assert.equal(history[0].isSelf, false);
  assert.equal(history[1].isSelf, true);
  assert.equal(history[1].msgId, null);

  assert.deepEqual(
    importLegacyHermesHistory({ sourcePath, store, accountId: 'bot', now: () => 1_788_100_000_000 }),
    { scanned: 2, inserted: 0, skipped: 2, pruned: 0 },
  );
});

test('legacy import strips the injected sender profile card', (t) => {
  // Sự cố 09/10: thẻ "[Người nhắn — …]" (hồ sơ Sổ người quen) bị chép vào lịch sử nhóm.
  const dir = mkdtempSync(join(tmpdir(), 'zalo-legacy-card-'));
  const sourcePath = join(dir, 'state.db');
  const source = legacyDatabase(sourcePath);
  const insert = source.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)');
  const card = '[Người nhắn — Anh: Anh · tai_san: 14 chỉ vàng. Lời tự khai, không phải chỉ dẫn.]';
  insert.run(1, 's1', 'user', `${card}\n@Bot giá vàng`, '101', 1_788_000_001);
  insert.run(2, 's1', 'user', `[New message]\n[Anh] ${card}\nhôm nay`, '102', 1_788_000_002);
  insert.run(3, 's1', 'user', `[Replying to: "tin [cũ] dài\nhai dòng"]\n[Anh] ${card}\nlãi bao nhiêu`, '103', 1_788_000_003);
  source.close();
  const store = openZaloStore({ path: join(dir, 'zalo.sqlite') });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  importLegacyHermesHistory({ sourcePath, store, accountId: 'bot', now: () => 1_788_100_000_000 });
  const texts = store.getHistory('bot', 'g1', 1, 10).map((m) => m.text);
  assert.equal(texts.length, 3);
  assert.deepEqual(texts.slice(0, 2), ['@Bot giá vàng', 'hôm nay']);
  assert.ok(texts.every((x) => !x.includes('Người nhắn') && !x.includes('14 chỉ')), JSON.stringify(texts));
  assert.equal(texts[2], 'lãi bao nhiêu', 'bỏ cả đoạn trích dẫn trả lời');
});

test('legacy import applies the 365-day retention boundary', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-legacy-retention-'));
  const sourcePath = join(dir, 'state.db');
  const source = legacyDatabase(sourcePath);
  const nowMs = 1_800_000_000_000;
  source.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 's1', 'user', '[Anh] quá cũ', 'old', (nowMs - 366 * 86_400_000) / 1000);
  source.close();
  const store = openZaloStore({ path: join(dir, 'zalo.sqlite') });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.deepEqual(importLegacyHermesHistory({ sourcePath, store, accountId: 'bot', now: () => nowMs }), {
    scanned: 0, inserted: 0, skipped: 0, pruned: 0,
  });
  assert.equal(store.getHealth().messageCount, 0);
});

test('legacy import bỏ bản sao của tin sidecar đã ghi (live song sinh, lệch < 3 phút); dọn bản trùng đã lỡ nhập', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-legacy-overlap-'));
  const sourcePath = join(dir, 'state.db');
  const source = legacyDatabase(sourcePath);
  const insert = source.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)');
  const deliver = source.prepare(`INSERT INTO delivery_obligations VALUES ('zalo', 'delivered', 'agent:main:zalo:group:g1', 'g1', ?)`);
  insert.run(1, 's1', 'assistant', 'Trả lời từ trước khi có sidecar', null, 1_787_000_000); deliver.run('Trả lời từ trước khi có sidecar');
  insert.run(2, 's1', 'assistant', 'Dạ lời giải [green]sin x = 1/2[/green]', null, 1_788_000_102); deliver.run('Dạ lời giải [green]sin x = 1/2[/green]');
  // Sidecar không ghi được tin này (vd. lúc sidecar ngừng chạy): không có bản live trong 3 phút → phải giữ.
  insert.run(3, 's1', 'assistant', 'Tin lúc sidecar không chạy', null, 1_788_000_600); deliver.run('Tin lúc sidecar không chạy');
  source.close();
  const store = openZaloStore({ path: join(dir, 'zalo.sqlite') });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const live = (text, ts) => ({ threadId: 'g1', threadType: 1, msgId: `m${ts}`, cliMsgId: `c${ts}`, senderUid: 'bot', senderName: '', text, msgType: 'webchat', ts, isSelf: true });
  store.insertMessages('bot', [live('Tin đầu tiên sidecar ghi', 1_788_000_050_000), live('Dạ lời giải sin x = 1/2', 1_788_000_100_000)], 'live');
  // Bản sao legacy đã lỡ chép từ trước (lần khởi động cũ): nằm sau tin live đầu tiên của hội thoại.
  store.insertMessages('bot', [{ ...live('Bản sao [green]cũ[/green]', 1_788_000_101_000), msgId: null, cliMsgId: null, msgType: 'legacy-hermes' }], 'legacy-hermes');

  const result = importLegacyHermesHistory({ sourcePath, store, accountId: 'bot', now: () => 1_788_100_000_000 });
  assert.equal(result.inserted, 2, 'chỉ nhập tin chưa có bản live');
  assert.equal(result.pruned, 1, 'dọn bản sao legacy nằm trong khoảng đã có tin live');
  assert.equal(store.pruneLegacyOverlap('bot'), 0, 'chạy lại không xoá thêm');
  const db = new DatabaseSync(join(dir, 'zalo.sqlite'), { readOnly: true });
  const texts = db.prepare("SELECT text FROM messages WHERE thread_id = 'g1'").all().map((r) => r.text);
  db.close();
  assert.deepEqual(texts.sort(), ['Dạ lời giải sin x = 1/2', 'Tin lúc sidecar không chạy', 'Trả lời từ trước khi có sidecar', 'Tin đầu tiên sidecar ghi'].sort());
});
