import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCallWords, defaultWords, parseWords } from './call-words.js';

test('mặc định theo tên bot: tên đầy đủ + tên ngắn, đầu tin và "… ơi/chào/đâu/nhờ" (có và không dấu)', () => {
  const w = defaultWords('Lăng Tiêu');
  assert.equal(w.length, 18);
  assert.deepEqual(w.slice(0, 3), [{ text: 'lăng tiêu', at: 'start' }, { text: 'lăng tiêu ơi', at: 'any' }, { text: 'lăng tiêu oi', at: 'any' }]);
  assert.ok(w.some((x) => x.text === 'nho tiêu' && x.at === 'any'));
  assert.deepEqual(defaultWords('Bot').map((x) => x.text).slice(0, 2), ['bot', 'bot ơi']);
  assert.deepEqual(defaultWords(''), []);
});

test('mặc định khớp đúng plugin Python (call_words.default_words)', (t) => {
  const py = process.env.PYTHON || (existsSync('E:/Hermes/hermes-agent/venv/Scripts/python.exe') ? 'E:/Hermes/hermes-agent/venv/Scripts/python.exe' : 'python3');
  let out;
  try {
    out = execFileSync(py, ['-c', [
      'import importlib.util, json, sys',
      "s = importlib.util.spec_from_file_location('cw', 'hermes-plugin/zalo/call_words.py'); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)",
      "sys.stdout.buffer.write(json.dumps([m.default_words(n) for n in ['Lăng Tiêu', 'Uyển Nhi', 'Bot', 'A B']], ensure_ascii=False).encode())",
    ].join('\n')], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  } catch { t.skip('không có Python'); return; }
  assert.deepEqual(JSON.parse(out), ['Lăng Tiêu', 'Uyển Nhi', 'Bot', 'A B'].map(defaultWords));
});

test('kiểm danh sách: chuẩn hoá chữ thường/khoảng trắng, bỏ trùng, chặn sai', () => {
  assert.deepEqual(parseWords([{ text: '  Sếp  Gọi ', at: 'start' }, { text: 'sếp gọi', at: 'start' }, { text: 'em ơi', at: 'any' }]),
    [{ text: 'sếp gọi', at: 'start' }, { text: 'em ơi', at: 'any' }]);
  for (const bad of [[{ text: '', at: 'any' }], [{ text: 'x'.repeat(41), at: 'any' }], [{ text: 'a', at: 'giữa' }], 'x', Array(51).fill({ text: 'a', at: 'any' })]) {
    assert.throws(() => parseWords(bad), { statusCode: 400 });
  }
});

test('lưu / xem / khôi phục mặc định', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zalo-cw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'call-words.json');
  const cw = createCallWords({ file });
  assert.equal(cw.view('Uyển Nhi').custom, false);
  cw.save([{ text: 'nhi ơi', at: 'any' }]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, owner: [{ text: 'nhi ơi', at: 'any' }] });
  assert.deepEqual(cw.view('Uyển Nhi').words, [{ text: 'nhi ơi', at: 'any' }]);
  cw.save([]);
  assert.deepEqual(cw.view('Uyển Nhi'), { words: [], custom: true, defaults: defaultWords('Uyển Nhi') }, 'rỗng = chủ nhân cũng phải tag');
  cw.reset();
  assert.equal(existsSync(file), false);
  assert.equal(cw.view('Uyển Nhi').custom, false);
});
