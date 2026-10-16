import test from 'node:test';
import assert from 'node:assert/strict';
import { MCP_GROUPS, accessNote, filterCatalog, viEntry } from './mcp-vi.js';
import { fold } from './fold.js';
import { editBody, usesOwnerAccount } from './views/mcp.js';

const RAW = [
  { name: 'wolfram', auth: 'none', description: 'Wolfram|Alpha computation.' },
  { name: 'canva', auth: 'oauth', description: 'Create Canva designs.' },
  { name: 'sentry', auth: 'oauth', description: 'Issues from Sentry.' },
  { name: 'moi-ra', auth: 'none', description: 'Brand new service.' },
];

test('danh mục tiếng Việt: tên, mô tả, nhóm; kết nối mới chưa dịch vẫn hiện (mô tả gốc, nhóm Khác)', () => {
  const w = viEntry(RAW[0]);
  assert.equal(w.title, 'Wolfram|Alpha');
  assert.match(w.descVi, /giải phương trình/);
  assert.equal(w.pick, true);
  const n = viEntry(RAW[3]);
  assert.deepEqual([n.title, n.descVi, n.groups, n.pick], ['moi-ra', 'Brand new service.', ['khac'], false]);
  const ids = new Set(MCP_GROUPS.map(([id]) => id));
  for (const e of RAW.slice(0, 3).map(viEntry)) for (const g of e.groups) assert.ok(ids.has(g), `${e.name}: nhóm lạ ${g}`);
});

test('lọc danh mục: theo nhóm, không dấu, chỉ không cần tài khoản; Gợi ý lên đầu', () => {
  const all = RAW.map(viEntry);
  assert.deepEqual(filterCatalog(all, { group: 'goi-y', fold }).map((e) => e.name), ['canva', 'wolfram']);
  assert.deepEqual(filterCatalog(all, { group: 'lap-trinh', fold }).map((e) => e.name), ['sentry']);
  assert.deepEqual(filterCatalog(all, { q: 'thiet ke', fold }).map((e) => e.name), ['canva']);
  assert.deepEqual(filterCatalog(all, { q: 'phuong trinh', fold }).map((e) => e.name), ['wolfram']);
  assert.deepEqual(filterCatalog(all, { noAccount: true, fold }).map((e) => e.name), ['wolfram', 'moi-ra']);
  assert.equal(filterCatalog(all, { fold })[0].pick, true, 'mục Gợi ý lên đầu');
  assert.equal(accessNote('none').kind, 'ok');
  assert.equal(accessNote('oauth').kind, 'warn');
});

test('hộp Sửa: chỉ gửi trường đổi; khoá trống = giữ; xoá thời gian chờ = về mặc định; tài khoản của chủ bot', () => {
  const s = { name: 'tl', transport: 'http', target: 'https://x', keys: ['MCP_TL_API_KEY'], timeout: 120, connectTimeout: null, auth: 'key' };
  const form = { url: '', keys: { MCP_TL_API_KEY: '' }, timeout: '120', connect_timeout: '' };
  assert.deepEqual(editBody(s, form), {});
  assert.deepEqual(editBody(s, { ...form, keys: { MCP_TL_API_KEY: ' moi ' } }), { keys: { MCP_TL_API_KEY: 'moi' } });
  assert.deepEqual(editBody(s, { ...form, timeout: '' }), { timeout: '' });
  assert.deepEqual(editBody(s, { ...form, connect_timeout: '30', url: ' https://y/mcp ' }), { url: 'https://y/mcp', connect_timeout: 30 });
  assert.deepEqual(editBody({ ...s, transport: 'stdio' }, { ...form, url: 'https://y' }), {}, 'kiểu chạy lệnh không có địa chỉ');
  assert.equal(usesOwnerAccount(s), true);
  assert.equal(usesOwnerAccount({ auth: 'none', keys: [] }), false);
  assert.equal(usesOwnerAccount({ auth: 'none', keys: ['NOTION_TOKEN'] }), true, 'khoá trong env cũng là của chủ bot');
});
