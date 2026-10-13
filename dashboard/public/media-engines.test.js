import test from 'node:test';
import assert from 'node:assert/strict';

const ENGINES = [
  { id: 'stali', enabled: true, model: 'req/gpt-image-2' },
  { id: '9router', enabled: true, model: 'ag/gemini-3.1-flash-image' },
  { id: 'codex', enabled: true, model: 'gpt-image-2-medium' },
];

test('Tạo ảnh & video: ChatGPT chỉ hiện ở máy đã đăng nhập Codex; vai trò Đang dùng / Dự phòng / Chưa có khoá / Tắt', async () => {
  const { visibleEngines, engineRoles } = await import('./views/media.js');
  assert.deepEqual(visibleEngines(ENGINES, { codex: false }).map((e) => e.id), ['stali', '9router']);
  assert.deepEqual(visibleEngines(ENGINES, { codex: true }).map((e) => e.id), ['stali', '9router', 'codex']);
  const roles = engineRoles(ENGINES, { stali: true, '9router': true, codex: true });
  assert.deepEqual(Object.values(roles).map((r) => r.text), ['Đang dùng', 'Dự phòng 1', 'Dự phòng 2']);
  const noKey = engineRoles([{ ...ENGINES[0] }, { ...ENGINES[1], enabled: false }, ENGINES[2]], { stali: false, '9router': true, codex: true });
  assert.deepEqual(Object.values(noKey).map((r) => r.text), ['Chưa có khoá', 'Đang tắt', 'Đang dùng']);
});

test('Tạo ảnh & video: ↑↓ đổi chỗ với nguồn hiện kế bên, bỏ qua nguồn ẩn; ở đầu/cuối thì giữ nguyên', async () => {
  const { moveEngine } = await import('./views/media.js');
  const hidden = { codex: false };
  assert.deepEqual(moveEngine(ENGINES, hidden, '9router', -1).map((e) => e.id), ['9router', 'stali', 'codex']);
  assert.deepEqual(moveEngine(ENGINES, hidden, '9router', 1).map((e) => e.id), ['stali', '9router', 'codex'], 'ChatGPT ẩn — không đổi');
  assert.deepEqual(moveEngine(ENGINES, hidden, 'stali', -1), ENGINES);
  const codexFirst = [ENGINES[2], ENGINES[0], ENGINES[1]];
  assert.deepEqual(moveEngine(codexFirst, hidden, 'stali', 1).map((e) => e.id), ['codex', '9router', 'stali']);
});
