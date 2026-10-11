import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSettings } from '../lib/settings.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

function withSettings(t) {
  const deps = makeDeps(t);
  writeFileSync(join(deps.dir, 'hermes.env'), 'TELEGRAM_BOT_TOKEN=bi-mat\n');
  writeFileSync(join(deps.dir, 'config.yaml'), 'platforms:\n  zalo:\n    extra:\n      dm_policy: owner-only\n');
  deps.settings = createSettings({ envFile: join(deps.dir, 'hermes.env'), configFile: join(deps.dir, 'config.yaml') });
  deps.welcomeFile = join(deps.dir, 'welcome.json');
  return deps;
}

test('Cấu hình: chỉ Quản trị; lưu đặt cờ chờ đúng đích + Nhật ký "cũ → mới"; khoá lạ 400; không bao giờ lộ khoá bí mật', async (t) => {
  const deps = withSettings(t);
  const { call } = await startApp(t, deps);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  assert.equal((await call('/api/admin/settings', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', cookie: owner, body: { values: { historyDays: 90 } } })).status, 403);
  assert.equal((await call('/api/admin/welcome', { cookie: owner })).status, 403);
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: owner, body: {} })).status, 403);
  const admin = await loginAs(t, deps, call);
  const v = await call('/api/admin/settings', { cookie: admin });
  assert.doesNotMatch(JSON.stringify(v.json), /bi-mat|TELEGRAM/);
  const put = await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { values: { dmPolicy: 'open', historyDays: 90 } } });
  assert.equal(put.json.changed, 2);
  assert.match(readFileSync(join(deps.dir, 'config.yaml'), 'utf8'), /dm_policy: open/);
  assert.match(readFileSync(join(deps.dir, 'hermes.env'), 'utf8'), /^ZALO_HISTORY_RETENTION_DAYS=90$/m);
  const flags = deps.restartFlags.get();
  assert.ok(!flags.assistant, 'Nhắn riêng áp dụng ngay — không đặt cờ khởi động lại trợ lý');
  assert.deepEqual(flags.sidecar.reasons, ['Cấu hình: Giữ lịch sử trò chuyện (ngày)']);
  assert.match(deps.activity.list().find((e) => e.action === 'settings_update').detail, /owner-only → open/);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { values: { TELEGRAM_BOT_TOKEN: 'x' } } })).status, 400);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', cookie: admin, body: { values: [] } })).status, 400);
});

test('Lời chào nhóm: liệt kê nhóm của bot; bật cần nội dung; giới hạn số; ghi data/welcome.json + Nhật ký', async (t) => {
  const deps = withSettings(t);
  const { call } = await startApp(t, deps);
  const admin = await loginAs(t, deps, call);
  assert.deepEqual((await call('/api/admin/welcome', { cookie: admin })).json.groups.map((g) => [g.id, g.name, g.enabled]), [['200', 'Tổ Hoá', false]]);
  const body = { enabled: true, message: '', batchSize: 5, maxWaitMinutes: 15, name: 'Tổ Hoá' };
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body })).status, 400);
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body: { ...body, message: 'Chào mừng!', batchSize: 99 } })).status, 400);
  assert.equal((await call('/api/admin/welcome/abc', { method: 'PUT', cookie: admin, body: { ...body, message: 'Chào mừng!' } })).status, 400);
  assert.equal((await call('/api/admin/welcome/200', { method: 'PUT', cookie: admin, body: { ...body, message: 'Chào mừng!' } })).status, 200);
  assert.equal(JSON.parse(readFileSync(deps.welcomeFile, 'utf8')).groups['200'].message, 'Chào mừng!');
  assert.equal(deps.activity.list().find((e) => e.action === 'welcome_update').detail, 'Tổ Hoá: bật');
});
