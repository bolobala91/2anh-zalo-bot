import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { SERVER_NAME, createMcpServers, describeServer, globMatch, keyRefs } from './mcp-servers.js';

const CONFIG = [
  'mcp_servers:',
  '  rag:',
  '    url: http://127.0.0.1:9998/mcp?token=bi-mat',
  '    timeout: 180',
  '  github:',
  '    url: https://api.githubcopilot.com/mcp/',
  '    headers:',
  '      Authorization: Bearer ghp_bimat',
  '  files:',
  '    command: /usr/bin/npx',
  '    args: ["-y", "@modelcontextprotocol/server-filesystem", "/root"]',
  '    env:',
  '      SECRET: x',
  '    enabled: false',
  '',
].join('\n');

function setup(t, config = CONFIG) {
  const d = mkdtempSync(join(tmpdir(), 'zd-mcp-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'config.yaml'), config);
  return join(d, 'config.yaml');
}

test('mô tả an toàn: không bao giờ có khoá, header, env, args, đường dẫn/truy vấn URL', () => {
  const d = describeServer('rag', { url: 'http://127.0.0.1:9998/mcp?token=bi-mat' }, ['rag']);
  assert.deepEqual({ ...d }, { name: 'rag', transport: 'http', target: 'http://127.0.0.1:9998', enabled: true, loopback: true, publicToMembers: true, host: '127.0.0.1', port: 9998, auth: 'none', toolsOff: 0, toolsOnly: null,
    keys: [], timeout: null, connectTimeout: null, publicVia: '' });
  assert.deepEqual([describeServer('n', { url: 'https://x', auth: 'oauth', tools: { exclude: ['a', 'b'] } })].map((s) => [s.auth, s.toolsOff]), [['oauth', 2]]);
  assert.equal(describeServer('k', { url: 'https://x', headers: { Authorization: 'Bearer ${K}' } }).auth, 'key');
  assert.deepEqual(['..', '.', 'rag.v2', 'a..b'].map((n) => SERVER_NAME.test(n)), [false, false, true, true]);
  assert.equal(describeServer('f', { command: '/usr/bin/npx', enabled: 'false' }).enabled, false);
  assert.equal(describeServer('u', { url: 'http://user:pass@127.0.0.1:1/x' }).target, 'http://127.0.0.1:1', 'không lộ user:pass trong URL');
  assert.equal(globMatch('mcp-*', 'mcp-rag'), true);
  assert.equal(globMatch('r?g', 'rag'), true);
  assert.equal(globMatch('rag', 'rag2'), false);
});

test('liệt kê: chỉ dò loopback, máy ngoài không dò, tắt thì không dò, stdio không chạy để dò; mở cho thành viên theo ZALO_PUBLIC_MCP', async (t) => {
  const file = setup(t, `${CONFIG}  local:\n    command: uvx\n`);
  const probes = [];
  const mcp = createMcpServers({ configFile: file, publicMcp: () => 'mcp-rag', probe: async (h, p) => { probes.push(`${h}:${p}`); return true; } });
  const list = await mcp.list();
  assert.deepEqual(list.map((s) => [s.name, s.transport, s.target, s.enabled, s.status, s.publicToMembers]), [
    ['rag', 'http', 'http://127.0.0.1:9998', true, 'Đang mở', true],
    ['github', 'http', 'https://api.githubcopilot.com', true, 'Máy ngoài — không kiểm', false],
    ['files', 'stdio', 'npx', false, 'Đã tắt', false],
    ['local', 'stdio', 'uvx', true, 'Chạy cùng trợ lý — không kiểm được từ dashboard', false],
  ]);
  assert.deepEqual(probes, ['127.0.0.1:9998']);
  assert.doesNotMatch(JSON.stringify(list), /bi-mat|ghp_|SECRET|server-filesystem|\/root|"host"|"port"/);
});

test('bật/tắt: sửa đúng mcp_servers.<tên>.enabled, giữ khối khác; tên lạ 404', (t) => {
  const file = setup(t);
  const mcp = createMcpServers({ configFile: file });
  assert.equal(mcp.setEnabled('rag', false), true);
  assert.equal(mcp.setEnabled('files', true), true);
  const y = YAML.parse(readFileSync(file, 'utf8'));
  assert.equal(y.mcp_servers.rag.enabled, false);
  assert.equal(y.mcp_servers.files.enabled, true);
  assert.equal(y.mcp_servers.github.headers.Authorization, 'Bearer ghp_bimat');
  assert.deepEqual(y.mcp_servers.files.args, ['-y', '@modelcontextprotocol/server-filesystem', '/root']);
  assert.throws(() => mcp.setEnabled('khong-co', true), (e) => e.statusCode === 404);
  assert.throws(() => mcp.setEnabled('__proto__', true), (e) => e.statusCode === 404);
  assert.throws(() => mcp.setEnabled('rag', 'có'), (e) => e.statusCode === 400);
});

test('stdio: lệnh có khoảng trắng chỉ hiện tên lệnh, không lộ đối số', () => {
  const d = describeServer('x', { command: '/usr/bin/npx   -y pkg --token=X' });
  assert.equal(d.target, 'npx');
  assert.doesNotMatch(JSON.stringify(d), /token|pkg/);
});

test('khoá: chỉ tên biến ${…} trong headers/env (không giá trị, không ZALO_/HERMES_); thời gian chờ; mở theo mẫu chung', () => {
  assert.deepEqual(keyRefs({ headers: { Authorization: 'Bearer ${MCP_TL_API_KEY}', 'X-A': '${ZALO_PUBLIC_MCP}' }, env: { T: '${NOTION_TOKEN}', P: 'plain' } }), ['MCP_TL_API_KEY', 'NOTION_TOKEN']);
  assert.deepEqual(keyRefs({ headers: { Authorization: 'Bearer ghp_bimat' } }), [], 'khoá dán thẳng (không qua .env) → không sửa được ở đây');
  const d = describeServer('rag', { url: 'https://x', timeout: 120, connect_timeout: 30 }, ['r*']);
  assert.deepEqual([d.timeout, d.connectTimeout, d.publicVia, d.publicToMembers], [120, 30, 'r*', true]);
  assert.equal(describeServer('rag', { url: 'https://x' }, ['rag']).publicVia, '', 'đúng tên → không phải mẫu chung');
});

test('Ai được dùng: thêm/bỏ đúng tên trong ZALO_PUBLIC_MCP; mẫu chung thì không tự xoá; tối đa 20 mục', (t) => {
  const file = setup(t);
  let env = 'other';
  const mcp = createMcpServers({ configFile: file, publicMcp: () => env, writePublicMcp: (v) => { env = v; } });
  assert.equal(mcp.setMembers('rag', true), true);
  assert.equal(env, 'other,rag');
  assert.equal(mcp.setMembers('rag', true), false, 'đã mở → không ghi lại');
  assert.equal(mcp.setMembers('rag', false), true);
  assert.equal(env, 'other');
  env = 'other,mcp-rag';
  mcp.setMembers('rag', false);
  assert.equal(env, 'other', 'bỏ cả dạng mcp-<tên>');
  env = 'r*';
  assert.throws(() => mcp.setMembers('rag', false), (e) => e.statusCode === 409 && /r\*/.test(e.message));
  assert.equal(env, 'r*');
  env = Array.from({ length: 20 }, (_, i) => `x${i}`).join(',');
  assert.throws(() => mcp.setMembers('github', true), (e) => e.statusCode === 400);
  assert.throws(() => mcp.setMembers('khong-co', true), (e) => e.statusCode === 404);
  assert.throws(() => mcp.setMembers('rag', 'có'), (e) => e.statusCode === 400);
  assert.throws(() => createMcpServers({ configFile: file }).setMembers('rag', true), (e) => e.statusCode === 503);
});
