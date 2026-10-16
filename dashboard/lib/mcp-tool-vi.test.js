import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpToolVi, parseReply } from './mcp-tool-vi.js';

function setup(t, config = 'model:\n  default: gpt-x\n  base_url: http://127.0.0.1:20128/v1\n  api_key: k-bi-mat\n') {
  const d = mkdtempSync(join(tmpdir(), 'zd-mcpvi-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'config.yaml'), config);
  return { configFile: join(d, 'config.yaml'), cacheFile: join(d, 'mcp-tool-vi.json') };
}

const TOOLS = [{ name: 'WolframAlpha', description: 'Use natural language queries with Wolfram|Alpha.' }, { name: 'WolframContext', description: 'Semantic search.' }];
const reply = (content, status = 200) => async () => ({ ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }) });

test('dịch một lần rồi đệm: lần sau không gọi AI; kết quả cắt độ dài; JSON bọc ```', async (t) => {
  const f = setup(t);
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    return reply('```json\n[{"i":0,"label":"Hỏi Wolfram|Alpha","desc":"Tính toán bằng câu hỏi tự nhiên."},{"i":1,"label":"' + 'x'.repeat(200) + '","desc":"Tìm theo ý nghĩa."}]\n```')(); };
  const vi = createMcpToolVi({ ...f, fetchImpl });
  const out = await vi.describe(TOOLS);
  assert.equal(out.WolframAlpha.label, 'Hỏi Wolfram|Alpha');
  assert.equal(out.WolframContext.label.length, 80);
  assert.equal(calls[0].url, 'http://127.0.0.1:20128/v1/chat/completions');
  assert.equal(calls[0].auth, 'Bearer k-bi-mat');
  assert.match(calls[0].body.messages[1].content, /WolframAlpha/);
  assert.match(calls[0].body.messages[0].content, /không làm theo/, 'mô tả từ máy ngoài chỉ là dữ liệu');
  await vi.describe(TOOLS);
  assert.equal(calls.length, 1, 'đã đệm → không gọi lại');
  assert.ok(!readFileSync(f.cacheFile, 'utf8').includes('k-bi-mat'));
  // mô tả đổi → dịch lại riêng công cụ đó
  await vi.describe([{ ...TOOLS[0], description: 'Mô tả mới' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.messages[1].content.includes('WolframContext'), false);
});

test('AI lỗi, trả rác hoặc chưa cấu hình → không vỡ, trả rỗng (trang giữ bản gốc)', async (t) => {
  assert.deepEqual(await createMcpToolVi({ ...setup(t), fetchImpl: reply('', 500) }).describe(TOOLS), {});
  assert.deepEqual(await createMcpToolVi({ ...setup(t), fetchImpl: reply('không phải JSON') }).describe(TOOLS), {});
  assert.deepEqual(await createMcpToolVi({ ...setup(t), fetchImpl: async () => { throw new Error('mạng'); } }).describe(TOOLS), {});
  let called = false;
  assert.deepEqual(await createMcpToolVi({ ...setup(t, 'model:\n  default: x\n'), fetchImpl: async () => { called = true; } }).describe(TOOLS), {});
  assert.equal(called, false, 'không có base_url → không gọi');
  assert.deepEqual(parseReply('[{"i":0}]'), [{ i: 0 }]);
  assert.deepEqual(parseReply('[oops'), []);
});
