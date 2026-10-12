import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFF_NOTE, WINDOWS_NOTE, createLearnedMemory, learnedMemoryStatus, memoryUri, parseScope, readMemorySettings, readProvider } from './learned-memory.js';

const G = 'zalo-g-2054797107487294899';
const U = 'zalo-u-5554567890123456789';            // một khách nhắn riêng
const O = 'zalo-u-1234567890123456789';            // chủ nhân bot nhắn riêng

function fakeOv(reply = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    const r = reply[`${opts.method} ${u.pathname}`];
    return { ok: true, json: async () => ({ status: 'ok', result: typeof r === 'function' ? r(u) : r ?? null }) };
  };
  return { calls, fetchImpl };
}
const on = (over = {}) => () => ({ provider: 'zalo_memory', endpoint: '', ...over });
function tmp(t) { const dir = mkdtempSync(join(tmpdir(), 'zd-lm-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const make = (ov, over = {}) => createLearnedMemory({
  settings: on(), platform: 'linux', fetchImpl: ov.fetchImpl, settingsFile: join(tmpdir(), 'khong-co-memory.json'),
  names: (kind, id) => (kind === 'group' ? `Tổ Hoá ${id.slice(-2)}` : ''), owners: () => ['1234567890123456789'], ...over,
});
const scopesReply = { 'GET /api/v1/fs/ls': [{ uri: `viking://user/${O}`, isDir: true }, { uri: 'viking://user/default', isDir: true },
  { uri: `viking://user/${U}`, isDir: true }, { uri: `viking://user/${G}`, isDir: true }] };

test('phạm vi và URI: chỉ zalo-g-/zalo-u- số; chỉ dưới memories/ của đúng phạm vi; sửa/xoá chỉ tệp .md không tự sinh', () => {
  assert.deepEqual(parseScope(G), { kind: 'group', id: '2054797107487294899' });
  assert.deepEqual(parseScope(O), { kind: 'dm', id: '1234567890123456789' });
  for (const bad of ['default', 'zalo-g-', 'zalo-x-1', 'zalo-g-1/../default', 'zalo-dashboard']) assert.equal(parseScope(bad), null, bad);
  assert.equal(memoryUri(`viking://user/${G}/memories`, G), true);
  assert.equal(memoryUri(`viking://user/${G}/memories/preferences/mem_1.md`, G, { file: true }), true);
  for (const bad of [`viking://user/${U}/memories/a.md`, `viking://user/${G}/sessions/s1`, `viking://user/${G}/memories/../../${U}/memories/a.md`,
    `viking://user/${G}/memories/a%2f.md`, `viking://user/${G}/memoriesX/a.md`, `viking://user/${G}/memories/a.md?x=1`, 'viking://resources/a.md']) {
    assert.equal(memoryUri(bad, G, { file: true }), false, bad);
  }
  assert.equal(memoryUri(`viking://user/${G}/memories/preferences/.overview.md`, G, { file: true }), false);
  assert.equal(memoryUri(`viking://user/${G}/memories`, G, { file: true }), false, 'thư mục gốc không phải tệp');
});

test('bật/tắt: Windows luôn tắt; provider khác → tắt kèm hướng dẫn; endpoint không loopback → tắt; không gọi mạng khi tắt', async (t) => {
  assert.equal(learnedMemoryStatus({ provider: 'zalo_memory', endpoint: '', platform: 'win32' }).note, WINDOWS_NOTE);
  assert.equal(learnedMemoryStatus({ provider: 'openviking', endpoint: '', platform: 'linux' }).note, OFF_NOTE);
  assert.equal(learnedMemoryStatus({ provider: 'zalo_memory', endpoint: 'http://10.0.0.2:1933', platform: 'linux' }).reason, 'not-loopback');
  assert.equal(learnedMemoryStatus({ provider: 'zalo_memory', endpoint: '', platform: 'linux' }).base, 'http://127.0.0.1:1933');
  const ov = fakeOv();
  await assert.rejects(make(ov, { settings: on({ provider: '' }) }).as('admin').scopes(), (e) => e.statusCode === 404);
  assert.equal(ov.calls.length, 0);
  const dir = tmp(t);
  writeFileSync(join(dir, 'config.yaml'), 'memory:\n  memory_enabled: true\n  provider: zalo_memory\n');
  assert.equal(readProvider(join(dir, 'config.yaml')), 'zalo_memory');
  assert.equal(readProvider(join(dir, 'khong-co.yaml')), '');
});

test('phân vai: Chủ bot thấy nhóm và DM khách nhưng KHÔNG thấy kho DM của chủ nhân bot — chặn cả khi gọi thẳng', async () => {
  const ov = fakeOv(scopesReply);
  const lm = make(ov);
  const admin = await lm.as('admin').scopes();
  assert.deepEqual(admin.map((s) => [s.scope, s.kind, s.name, s.owner]), [[G, 'group', 'Tổ Hoá 99', false], [U, 'dm', '', false], [O, 'dm', '', true]]);
  assert.equal(ov.calls[0].headers['X-OpenViking-Account'], 'zalo');
  assert.deepEqual((await lm.as('owner').scopes()).map((s) => s.scope), [G, U]);
  const before = ov.calls.length;
  const file = `viking://user/${O}/memories/preferences/mem_1.md`;
  for (const run of [() => lm.as('owner').list(O), () => lm.as('owner').read(O, file), () => lm.as('owner').search(O, 'cà phê'),
    () => lm.as('owner').edit(O, file, 'x'), () => lm.as('owner').remove(O, file), () => lm.as('owner').forget(O)]) {
    await assert.rejects(run(), (e) => e.statusCode === 404);
  }
  assert.equal(ov.calls.length, before, 'từ chối trước khi gọi mạng');
  await lm.as('owner').edit(U, `viking://user/${U}/memories/preferences/mem_2.md`, 'Khách thích gọi là chị');
  assert.equal(ov.calls.at(-1).headers['X-OpenViking-User'], U);
});

test('đóng khi lỗi: danh sách chủ nhân trống/không đọc được → Chủ bot không thấy MỌI kho DM, Quản trị vẫn thấy', async () => {
  for (const owners of [() => [], () => { throw new Error('không đọc được .env'); }, () => [' ']]) {
    const ov = fakeOv(scopesReply);
    const lm = make(ov, { owners });
    assert.deepEqual((await lm.as('owner').scopes()).map((s) => s.scope), [G]);
    const before = ov.calls.length;
    for (const sc of [O, U]) await assert.rejects(lm.as('owner').read(sc, `viking://user/${sc}/memories/a.md`), (e) => e.statusCode === 404);
    assert.equal(ov.calls.length, before, 'từ chối trước khi gọi mạng');
    assert.deepEqual((await lm.as('admin').scopes()).map((s) => s.scope).sort(), [G, O, U]);
  }
});

test('UID từng là chủ nhân: lưu tệp; bỏ khỏi danh sách thì kho DM của họ vẫn chỉ Quản trị thấy', async (t) => {
  const everOwnersFile = join(tmp(t), 'ever-owners.json');
  let current = ['1234567890123456789'];
  const ov = fakeOv(scopesReply);
  const lm = make(ov, { owners: () => current, everOwnersFile });
  assert.deepEqual((await lm.as('owner').scopes()).map((s) => s.scope), [G, U]);
  assert.deepEqual(JSON.parse(readFileSync(everOwnersFile, 'utf8')).uids, ['1234567890123456789']);
  current = ['5554567890123456789'];   // đổi chủ nhân: người cũ bị bỏ, khách cũ thành chủ nhân
  assert.deepEqual((await lm.as('owner').scopes()).map((s) => s.scope), [G]);
  await assert.rejects(lm.as('owner').list(O), (e) => e.statusCode === 404);
  assert.deepEqual(JSON.parse(readFileSync(everOwnersFile, 'utf8')).uids.sort(), ['1234567890123456789', '5554567890123456789']);
  // Dashboard khởi động lại (tạo mới) vẫn nhớ người cũ từ tệp.
  const again = make(fakeOv(scopesReply), { owners: () => ['5554567890123456789'], everOwnersFile });
  assert.deepEqual((await again.as('owner').scopes()).map((s) => s.scope), [G]);
  assert.deepEqual((await again.as('admin').scopes()).map((s) => [s.scope, s.owner]), [[G, false], [O, true], [U, true]]);
});

test('nguồn ghi đè (.env bot, biến môi trường) cũng tính là chủ nhân', async () => {
  const lm = make(fakeOv(scopesReply), { owners: () => ['9994567890123456789'], ownerOverrides: () => ['5554567890123456789', '1234567890123456789'] });
  assert.deepEqual((await lm.as('owner').scopes()).map((s) => s.scope), [G]);
  await assert.rejects(lm.as('owner').search(U, 'cà phê'), (e) => e.statusCode === 404);
  // Nguồn ghi đè hỏng → bỏ qua nguồn đó, vẫn chặn theo danh sách chính.
  const broken = make(fakeOv(scopesReply), { ownerOverrides: () => { throw new Error('x'); } });
  assert.deepEqual((await broken.as('owner').scopes()).map((s) => s.scope), [G, U]);
});

test('kho chưa có dữ liệu: OpenViking NOT_FOUND → danh sách rỗng, không phải lỗi; lỗi khác vẫn là lỗi', async () => {
  const notFound = (code) => ({ fetchImpl: async () => ({ ok: false, json: async () => ({ status: 'error', error: { code } }) }) });
  const lm = make(notFound('NOT_FOUND')).as('owner');
  assert.deepEqual(await lm.scopes(), []);
  assert.deepEqual(await lm.list(G), []);
  assert.deepEqual(await lm.search(G, 'lịch họp'), []);
  await assert.rejects(make(notFound('INTERNAL')).as('owner').list(G), (e) => e.statusCode === 502);
});

test('tìm chỉ trong một phạm vi (target_uri), đi bằng danh tính phạm vi, bỏ kết quả lọt ra ngoài', async () => {
  const ov = fakeOv({ 'POST /api/v1/search/find': { memories: [
    { uri: `viking://user/${G}/memories/events/mem_a.md`, score: 0.4, abstract: 'Họp tổ thứ Năm' },
    { uri: `viking://user/${O}/memories/preferences/mem_b.md`, score: 0.99, abstract: 'BÍ MẬT CỦA CHỦ' },
  ] } });
  const hits = await make(ov).as('owner').search(G, 'lịch họp');
  assert.deepEqual(hits.map((h) => h.abstract), ['Họp tổ thứ Năm']);
  assert.equal(ov.calls[0].body.target_uri, `viking://user/${G}/memories`);
  assert.equal(ov.calls[0].headers['X-OpenViking-User'], G);
  await assert.rejects(make(ov).as('admin').search('default', 'x'), (e) => e.statusCode === 404);
});

test('sửa thay nội dung đúng tệp; xoá một tệp không đệ quy; quên cả phạm vi xoá đệ quy đúng gốc của nó', async () => {
  const ov = fakeOv();
  const lm = make(ov).as('admin');
  const file = `viking://user/${G}/memories/preferences/mem_1.md`;
  await lm.edit(G, file, '  Nhóm gọi bot là Nhi\r\n');
  assert.deepEqual(ov.calls.at(-1).body, { uri: file, content: 'Nhóm gọi bot là Nhi\n', mode: 'replace' });
  await lm.remove(G, file);
  assert.deepEqual([ov.calls.at(-1).method, ov.calls.at(-1).query], ['DELETE', { uri: file, recursive: 'false' }]);
  await lm.forget(O);
  assert.deepEqual(ov.calls.at(-1).query, { uri: `viking://user/${O}`, recursive: 'true' });
  const before = ov.calls.length;
  await assert.rejects(lm.edit(G, `viking://user/${U}/memories/a.md`, 'x'), (e) => e.statusCode === 400);
  await assert.rejects(lm.edit(G, file, '   '), (e) => e.statusCode === 400);
  await assert.rejects(lm.remove(G, `viking://user/${G}/memories`), (e) => e.statusCode === 400);
  assert.equal(ov.calls.length, before, 'từ chối trước khi gọi mạng');
});

test('chu kỳ rút: mặc định 120, đọc giống provider (kẹp 30–1440, sai kiểu → 120); chỉ ghi số nguyên trong khoảng', (t) => {
  const file = join(tmp(t), 'zalo', 'memory.json');
  const lm = make(fakeOv(), { settingsFile: file });
  assert.equal(lm.settings().extractMinutes, 120);
  assert.deepEqual(lm.setSettings({ extractMinutes: 45 }), { extractMinutes: 45, min: 30, max: 1440, default: 120 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, extractMinutes: 45 });
  for (const bad of [29, 1441, 60.5, '60', null]) assert.throws(() => lm.setSettings({ extractMinutes: bad }), (e) => e.statusCode === 400, String(bad));
  writeFileSync(file, JSON.stringify({ version: 1, extractMinutes: 5 }));
  assert.equal(readMemorySettings(file).extractMinutes, 30);
  writeFileSync(file, '{hỏng');
  assert.equal(readMemorySettings(file).extractMinutes, 120);
});

test('rút ngay: chỉ Quản trị; commit đúng phiên còn tin chờ của kho đó; tối đa 3 lần/kho/ngày', async () => {
  let clock = Date.UTC(2026, 9, 9, 3, 0);
  const ov = fakeOv({
    'GET /api/v1/fs/ls': [{ uri: `viking://user/${G}/sessions/s-old`, isDir: true, modTime: '2026-10-01T00:00:00Z' },
      { uri: `viking://user/${G}/sessions/s-new`, isDir: true, modTime: '2026-10-09T00:00:00Z' }],
    'GET /api/v1/sessions/s-new': { pending_tokens: 320 },
    'GET /api/v1/sessions/s-old': { pending_tokens: 0 },
  });
  const lm = make(ov, { now: () => clock });
  await assert.rejects(lm.as('owner').extractNow(G), (e) => e.statusCode === 403);
  assert.deepEqual(await lm.as('admin').extractNow(G), { committed: 1, left: 2 });
  const commits = ov.calls.filter((c) => c.path.endsWith('/commit'));
  assert.deepEqual(commits.map((c) => [c.path, c.headers['X-OpenViking-User'], c.body]), [['/api/v1/sessions/s-new/commit', G, { keep_recent_count: 0 }]]);
  await lm.as('admin').extractNow(G);
  await lm.as('admin').extractNow(G);
  await assert.rejects(lm.as('admin').extractNow(G), (e) => e.statusCode === 429);
  clock += 24 * 3600_000;
  assert.equal((await lm.as('admin').extractNow(G)).committed, 1, 'sang ngày mới được rút lại');
});

test('tóm tắt thư mục chưa sinh (lộ ID nhóm) không hiện ra giao diện', async () => {
  const { cleanAbstract } = await import('./learned-memory.js');
  assert.equal(cleanAbstract('# viking://user/zalo-g-7903718250465581275/memories/entities [Directory abstract is not ready]'), '');
  assert.equal(cleanAbstract('Sở thích: cầu lông'), 'Sở thích: cầu lông');
  assert.equal(cleanAbstract(undefined), '');
});
