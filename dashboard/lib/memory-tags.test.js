import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHermesMemory } from './hermes-memory.js';
import { createMemoryTags, normalizeTags, splitTag, withTag } from './memory-tags.js';

const D = '\n§\n';
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'mtags-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'memories'));
  const agentMemory = createHermesMemory({ hermesHome: home, configFile: join(home, 'config.yaml') });
  const mt = createMemoryTags({ hermesHome: home, agentMemory, newId: (() => { let n = 0; return () => `${'a'.repeat(15)}${n++}`; })() });
  const write = (file, entries) => writeFileSync(join(home, 'memories', file), entries.join(D));
  const read = (file) => readFileSync(join(home, 'memories', file), 'utf8').split(D);
  const result = (id, body) => { mkdirSync(join(home, 'zalo', 'memory-organize', 'results'), { recursive: true }); writeFileSync(join(home, 'zalo', 'memory-organize', 'results', `${id}.json`), JSON.stringify(body)); };
  return { home, mt, write, read, result, agentMemory };
}

test('thẻ: tách, ghép, danh sách luôn có "Khác", tên sai bị từ chối khi lưu', () => {
  assert.deepEqual(splitTag('[Dịch vụ & giá] Gói VIP'), { tag: 'Dịch vụ & giá', text: 'Gói VIP' });
  assert.deepEqual(splitTag('Không thẻ'), { tag: null, text: 'Không thẻ' });
  assert.equal(withTag('Khác', ' a '), '[Khác] a');
  assert.deepEqual(normalizeTags([{ label: 'Lớp', color: 'red' }]).map((t) => t.label), ['Lớp', 'Khác']);
  assert.throws(() => normalizeTags([{ label: 'a]b' }], { strict: true }), (e) => e.statusCode === 400);
  assert.throws(() => normalizeTags([{ label: 'A' }, { label: 'A' }], { strict: true }), (e) => e.statusCode === 400);
});

test('đổi tên loại thì mục đổi theo; xoá loại thì mục về "Khác"', (t) => {
  const { mt, write, read } = fixture(t);
  write('USER.md', ['[Về chủ nhân] Sếp dạy Hoá', '[Link & kênh] fb.com/x', 'chưa thẻ']);
  write('MEMORY.md', ['[Người quen] Chị Liên']);
  mt.saveTags([{ label: 'Hồ sơ', color: 'blue' }, { label: 'Khác', color: 'gray' }, { label: 'Người quen', color: 'pink' }], { 'Về chủ nhân': 'Hồ sơ' });
  assert.deepEqual(read('USER.md'), ['[Hồ sơ] Sếp dạy Hoá', '[Khác] fb.com/x', 'chưa thẻ']);
  assert.deepEqual(read('MEMORY.md'), ['[Người quen] Chị Liên']);
  assert.deepEqual(mt.tags().map((x) => x.label), ['Hồ sơ', 'Khác', 'Người quen']);
});

test('áp dụng đề xuất chỉ khi bộ nhớ chưa đổi; ghi lịch sử; hoàn tác gộp lại đúng chỗ', (t) => {
  const { mt, write, read, result } = fixture(t);
  write('MEMORY.md', ['[Khác] đầu', 'Gói VIP 1tr. Sếp dạy Hoá.', '[Khác] cuối']);
  const id = mt.request('memory', 'propose', 'anh');
  assert.equal(mt.result(id).status, 'pending');
  assert.throws(() => mt.request('memory', 'propose', 'anh'), (e) => e.statusCode === 409, 'một đề xuất mỗi lúc');
  const before = ['[Khác] đầu', 'Gói VIP 1tr. Sếp dạy Hoá.', '[Khác] cuối'];
  const after = ['[Khác] đầu', '[Dịch vụ & giá] Gói VIP 1tr.', '[Về chủ nhân] Sếp dạy Hoá.', '[Khác] cuối'];
  result(id, { ok: true, mode: 'propose', target: 'memory', before, after });

  write('MEMORY.md', [...before, 'bot vừa ghi']);
  assert.throws(() => mt.apply(id), (e) => e.statusCode === 409, 'bộ nhớ đổi sau khi AI đọc → không ghi đè');
  write('MEMORY.md', before);
  mt.apply(id);
  assert.deepEqual(read('MEMORY.md'), after);
  const [entry] = mt.log();
  assert.deepEqual(entry.before, ['Gói VIP 1tr. Sếp dạy Hoá.']);
  assert.equal(entry.after.length, 2);

  mt.undo(entry.id);
  assert.deepEqual(read('MEMORY.md'), before);
  assert.equal(mt.log()[0].undone, true);
  assert.throws(() => mt.undo(entry.id), (e) => e.statusCode === 404);
});

test('đề xuất vượt dung lượng thì không áp dụng được', (t) => {
  const { mt, write, result } = fixture(t);
  write('USER.md', ['a']);
  const id = mt.request('user', 'propose', 'anh');
  result(id, { ok: true, mode: 'propose', target: 'user', before: ['a'], after: ['[Khác] a'], overLimit: true });
  assert.throws(() => mt.apply(id), (e) => e.statusCode === 400);
});
