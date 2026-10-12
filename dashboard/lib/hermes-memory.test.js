import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHermesMemory, parseEntries } from './hermes-memory.js';

function home(t, { memory, user, config } = {}) {
  const h = mkdtempSync(join(tmpdir(), 'zd-mem-'));
  t.after(() => rmSync(h, { recursive: true, force: true }));
  mkdirSync(join(h, 'memories'));
  if (memory !== undefined) writeFileSync(join(h, 'memories', 'MEMORY.md'), memory);
  if (user !== undefined) writeFileSync(join(h, 'memories', 'USER.md'), user);
  if (config) writeFileSync(join(h, 'config.yaml'), config);
  return { h, mem: createHermesMemory({ hermesHome: h, configFile: join(h, 'config.yaml') }) };
}

test('tách mục như Hermes: "\\n§\\n", bỏ rỗng, giữ § nằm giữa câu', () => {
  assert.deepEqual(parseEntries('a\n§\n\n§\nb § c\r\n§\n  d  '), ['a', 'b § c', 'd']);
  assert.deepEqual(parseEntries('   '), []);
});

test('xem: hai tệp, số ký tự đã dùng, trần lấy từ config.yaml hoặc mặc định của Hermes', (t) => {
  const { mem } = home(t, { memory: 'Anh thích trả lời ngắn\n§\nDùng giờ VN', config: 'memory:\n  memory_char_limit: 3000\n' });
  const v = mem.view();
  assert.deepEqual(v.memory.entries, ['Anh thích trả lời ngắn', 'Dùng giờ VN']);
  assert.equal(v.memory.limit, 3000);
  assert.equal(v.memory.used, 'Anh thích trả lời ngắn\n§\nDùng giờ VN'.length);
  assert.deepEqual(v.user, { label: 'Hồ sơ chủ nhân', entries: [], used: 0, limit: 1375 });
});

test('sửa/xoá đúng mục người dùng thấy; ghi lại đúng định dạng; có .bak; mục đã đổi → 409', (t) => {
  const { h, mem } = home(t, { memory: 'a\n§\nb\n§\nc' });
  const file = join(h, 'memories', 'MEMORY.md');
  mem.replace('memory', 1, 'b', ' B mới ');
  assert.equal(readFileSync(file, 'utf8'), 'a\n§\nB mới\n§\nc');
  assert.ok(existsSync(`${file}.bak`));
  mem.remove('memory', 0, 'a');
  assert.equal(readFileSync(file, 'utf8'), 'B mới\n§\nc');
  assert.throws(() => mem.remove('memory', 0, 'a'), (e) => e.statusCode === 409);
  assert.throws(() => mem.replace('memory', 5, 'x', 'y'), (e) => e.statusCode === 409);
  assert.throws(() => mem.replace('memory', 0, 'B mới', 'x\n§\ny'), (e) => e.statusCode === 400);
  assert.throws(() => mem.replace('memory', 0, 'B mới', '   '), (e) => e.statusCode === 400);
  assert.throws(() => mem.replace('khac', 0, 'B mới', 'x'), (e) => e.statusCode === 400);
});

test('vượt trần ký tự → 400, tệp giữ nguyên; trợ lý vừa thêm mục khác vào chỗ đó → 409', (t) => {
  const { h, mem } = home(t, { user: 'ngắn', config: 'memory:\n  user_char_limit: 10\n' });
  assert.throws(() => mem.replace('user', 0, 'ngắn', 'x'.repeat(11)), (e) => e.statusCode === 400 && /10 ký tự/.test(e.message));
  assert.equal(readFileSync(join(h, 'memories', 'USER.md'), 'utf8'), 'ngắn');
  const file = join(h, 'memories', 'MEMORY.md');
  writeFileSync(file, 'a');
  assert.deepEqual(mem.view().memory.entries, ['a']);
  writeFileSync(file, 'mới của trợ lý\n§\na');   // trợ lý ghi sau khi trang đã tải
  utimesSync(file, 2_000_000_000, 2_000_000_000);
  assert.throws(() => mem.remove('memory', 0, 'a'), (e) => e.statusCode === 409);
  assert.equal(readFileSync(file, 'utf8'), 'mới của trợ lý\n§\na');
});

test('xoá luôn được dù tệp đã vượt trần; sửa vẫn bị chặn; ký tự đếm theo code point như Hermes', (t) => {
  const { h, mem } = home(t, { user: 'x'.repeat(30) + '\n§\nhai', config: 'memory:\n  user_char_limit: 10\n' });
  assert.throws(() => mem.replace('user', 1, 'hai', 'ba'), (e) => e.statusCode === 400, 'vẫn vượt trần thì không cho sửa');
  mem.remove('user', 1, 'hai');
  assert.equal(readFileSync(join(h, 'memories', 'USER.md'), 'utf8'), 'x'.repeat(30), 'xoá được dù còn vượt trần');
  // 😀 là 1 code point (2 đơn vị UTF-16): 10 emoji đúng bằng trần 10, 11 thì vượt.
  const e = createHermesMemory({ hermesHome: h, configFile: join(h, 'config.yaml') });
  mem.remove('user', 0, 'x'.repeat(30));
  writeFileSync(join(h, 'memories', 'USER.md'), 'a');
  const v = e.view();
  assert.equal(v.user.used, 1);
  e.replace('user', 0, 'a', '😀'.repeat(10));
  assert.equal(e.view().user.used, 10);
  assert.throws(() => e.replace('user', 0, '😀'.repeat(10), '😀'.repeat(11)), (err) => err.statusCode === 400);
});
