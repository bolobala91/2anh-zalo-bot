import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiKeys, maskTail, MODEL_KEY } from './ai-keys.js';
import { readConfigYaml } from './config-yaml.js';

const SECRET = 'tvly-abcdefghijklmnopqrstuvwxyz123456';
const MODEL_SECRET = 'sk-9router-0123456789abcdefWXYZ';

function setup(t, fetchImpl) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-aikeys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  writeFileSync(envFile, `TAVILY_API_KEY=${SECRET}\nZALO_BRIDGE_TOKEN=noi-bo-khong-dong\nMY_SERVICE_TOKEN=abcdefgh12345678\nVBEE_WEBHOOK_SECRET=webhook-bi-mat-123\nPLAIN=1\n`);
  writeFileSync(configFile, `model:\n  default: 2anhPRO\n  provider: custom\n  base_url: http://127.0.0.1:20128/v1\n  api_key: ${MODEL_SECRET}\n`);
  return { envFile, configFile, keys: createAiKeys({ envFile, configFile, fetchImpl }) };
}

test('danh sách khoá: chỉ 4 ký tự cuối, không bao giờ có giá trị; khoá hệ thống ZALO_* không hiện; khoá lạ vào "Khác"', (t) => {
  const { keys } = setup(t);
  const { keys: rows, available } = keys.list();
  const json = JSON.stringify({ rows, available });
  assert.ok(!json.includes(SECRET) && !json.includes(MODEL_SECRET), 'không lộ khoá');
  assert.equal(rows.find((r) => r.key === 'TAVILY_API_KEY').hint, '••••3456');
  assert.equal(rows.find((r) => r.key === MODEL_KEY).set, true);
  assert.equal(rows.find((r) => r.key === 'CORE_API_KEY').set, false, 'khoá quen thuộc hay dùng hiện cả khi chưa đặt');
  assert.ok(!rows.some((r) => r.key === 'ZALO_BRIDGE_TOKEN'));
  assert.equal(rows.find((r) => r.key === 'MY_SERVICE_TOKEN').known, false);
  assert.ok(!rows.some((r) => r.key === 'VBEE_WEBHOOK_SECRET'), 'khoá nội bộ không hiện');
  assert.ok(available.some((a) => a.key === 'APIFY_TOKEN'));
  assert.equal(maskTail('ngan'), '••••');
});

test('thay / gỡ khoá: luật giá trị chặt, không ghi được khoá hệ thống, khoá cổng AI chính ghi vào config.yaml', (t) => {
  const { keys, envFile, configFile } = setup(t);
  assert.equal(keys.set('CORE_API_KEY', 'core-key-abcdef123456'), true);
  assert.match(readFileSync(envFile, 'utf8'), /^CORE_API_KEY=core-key-abcdef123456$/m);
  assert.equal(keys.set('CORE_API_KEY', 'core-key-abcdef123456'), false, 'không đổi thì không ghi');
  for (const bad of ['có khoảng trắng 123', 'abc"def12345', 'abc\nEVIL=1xxxx', 'ngan']) {
    assert.throws(() => keys.set('CORE_API_KEY', bad), (e) => e.statusCode === 400, JSON.stringify(bad));
  }
  for (const k of ['ZALO_ALLOWED_USERS', 'ZALO_BRIDGE_TOKEN', 'HERMES_HOME', 'PATH', 'VBEE_WEBHOOK_SECRET']) {
    assert.throws(() => keys.set(k, 'abcdefgh12345678'), (e) => e.statusCode === 400, k);
  }
  assert.equal(keys.set('TAVILY_API_KEY', ''), true, 'gỡ khoá');
  assert.match(readFileSync(envFile, 'utf8'), /^TAVILY_API_KEY=$/m);
  assert.throws(() => keys.set(MODEL_KEY, ''), /Không gỡ được/);
  keys.set(MODEL_KEY, 'sk-moi-0000111122223333');
  assert.match(readFileSync(configFile, 'utf8'), /api_key: sk-moi-0000111122223333/);
  assert.match(readFileSync(configFile, 'utf8'), /default: 2anhPRO/, 'giữ nguyên phần khác');
});

test('khoá Stali: dán khoá là đủ — trợ lý dùng bộ điều phối ảnh 2anh + video Stali; có link đăng ký; gỡ khoá không đổi config', (t) => {
  const { keys, configFile } = setup(t);
  const conf = () => readConfigYaml(configFile);
  const row = keys.list().keys.find((r) => r.key === 'STALI_API_KEY');
  assert.equal(row.set, false, 'hiện sẵn ô khoá Stali');
  assert.equal(row.signup, 'https://api.stali.vn/r/EB3F18B729DA');
  assert.equal(keys.needsRestart('STALI_API_KEY'), true);
  writeFileSync(configFile, `${readFileSync(configFile, 'utf8')}image_gen:\n  model: gpt-image-2-medium\n  provider: openai-codex\n`);
  keys.set('STALI_API_KEY', 'sk-stali-0123456789abcdef');
  assert.equal(conf().image_gen.provider, '2anh');
  assert.equal(conf().image_gen.model, 'gpt-image-2-medium', 'giữ phần khác của image_gen');
  assert.equal(conf().video_gen.provider, 'stali', 'tạo mục video_gen khi chưa có');
  keys.set('STALI_API_KEY', '');
  assert.equal(conf().image_gen.provider, '2anh', 'bộ điều phối tự bỏ qua Stali khi không có khoá');
  assert.equal(conf().model.default, '2anhPRO');
});

test('kiểm tra khoá: gọi địa chỉ cố định của dịch vụ bằng khoá đang lưu; trả được/không + lý do, không trả khoá', async (t) => {
  const seen = [];
  const { keys } = setup(t, async (url, init) => {
    seen.push([url, init.headers]);
    return { ok: !url.includes('tavily'), status: url.includes('tavily') ? 401 : 200 };
  });
  const bad = await keys.test('TAVILY_API_KEY');
  assert.deepEqual([bad.ok, bad.detail], [false, 'Khoá sai hoặc đã bị thu hồi.']);
  assert.equal(seen[0][0], 'https://api.tavily.com/search');
  assert.equal(seen[0][1].Authorization, `Bearer ${SECRET}`);
  const good = await keys.test(MODEL_KEY);
  assert.equal(good.ok, true);
  assert.equal(seen[1][0], 'http://127.0.0.1:20128/v1/models');
  assert.ok(!JSON.stringify([bad, good]).includes(SECRET));
  await assert.rejects(keys.test('CORE_API_KEY'), (e) => e.statusCode === 400, 'chưa đặt');
  await assert.rejects(keys.test('MY_SERVICE_TOKEN'), /chưa có cách kiểm tra/);
});

test('khoá trùng khoá cổng AI (vd. GEMINI_API_KEY dùng qua 9router) → kiểm qua cổng AI, không gọi Google', async (t) => {
  const seen = [];
  const { keys, envFile } = setup(t, async (url) => { seen.push(url); return { ok: true, status: 200 }; });
  writeFileSync(envFile, `GEMINI_API_KEY=${MODEL_SECRET}
ANH_AI_KEY=${MODEL_SECRET}
`);
  assert.equal(keys.list().keys.find((r) => r.key === 'ANH_AI_KEY').testable, true);
  const r = await keys.test('GEMINI_API_KEY');
  assert.deepEqual([r.ok, r.detail], [true, 'Khoá hoạt động (dùng qua cổng AI chính).']);
  assert.deepEqual(seen, ['http://127.0.0.1:20128/v1/models']);
});

test('kho khoá dự phòng: thêm (giữ khoá đang dùng làm khoá đầu), dùng khoá khác, đổi thứ tự, xoá; .env luôn khớp khoá đang dùng; không lộ khoá', (t) => {
  const { envFile } = setup(t);
  const poolFile = join(envFile, '..', 'key-pool.json');
  const { keys: base } = setup(t);
  const keys = createAiKeys({ envFile, configFile: join(envFile, '..', 'config.yaml'), poolFile, now: () => 1_800_000_000_000 });
  const B2 = 'tvly-backup-two-000000000000ABCD';
  const B3 = 'tvly-backup-three-00000000000EFGH';
  keys.addBackup('TAVILY_API_KEY', B2, 'tài khoản 2');
  keys.addBackup('TAVILY_API_KEY', B3);
  assert.throws(() => keys.addBackup('TAVILY_API_KEY', B2), (e) => e.statusCode === 409);
  let row = keys.list().keys.find((r) => r.key === 'TAVILY_API_KEY');
  assert.deepEqual(row.pool.map((e) => [e.id, e.hint, e.active]), [['k1', '••••3456', true], ['k2', '••••ABCD', false], ['k3', '••••EFGH', false]]);
  assert.equal(row.pool[1].label, 'tài khoản 2');
  assert.ok(!JSON.stringify(keys.list()).includes(B2), 'không lộ khoá dự phòng');
  keys.activate('TAVILY_API_KEY', 'k3');
  assert.match(readFileSync(envFile, 'utf8'), new RegExp(`^TAVILY_API_KEY=${B3}$`, 'm'));
  keys.move('TAVILY_API_KEY', 'k3', -1);
  assert.deepEqual(keys.list().keys.find((r) => r.key === 'TAVILY_API_KEY').pool.map((e) => e.id), ['k1', 'k3', 'k2']);
  keys.removeEntry('TAVILY_API_KEY', 'k3');
  row = keys.list().keys.find((r) => r.key === 'TAVILY_API_KEY');
  assert.equal(row.pool.find((e) => e.active).id, 'k2', 'xoá khoá đang dùng → chuyển sang khoá kế');
  assert.match(readFileSync(envFile, 'utf8'), new RegExp(`^TAVILY_API_KEY=${B2}$`, 'm'));
  // Plugin cho khoá nghỉ → dashboard hiện "nghỉ đến".
  const data = JSON.parse(readFileSync(poolFile, 'utf8'));
  data.keys.TAVILY_API_KEY.list[0].cool_until = 1_800_000_000 + 3600;
  writeFileSync(poolFile, JSON.stringify(data));
  assert.equal(keys.list().keys.find((r) => r.key === 'TAVILY_API_KEY').pool[0].coolUntil, (1_800_000_000 + 3600) * 1000);
  keys.removeEntry('TAVILY_API_KEY', 'k1');
  assert.throws(() => keys.removeEntry('TAVILY_API_KEY', 'k2'), /khoá cuối cùng/);
  assert.throws(() => keys.addBackup('model.api_key', B2), /9router/);
  keys.set('TAVILY_API_KEY', '');
  assert.equal(JSON.parse(readFileSync(poolFile, 'utf8')).keys.TAVILY_API_KEY, undefined, 'gỡ khoá = bỏ cả kho');
  assert.equal(keys.needsRestart('TELEGRAM_BOT_TOKEN'), true);
  assert.equal(keys.needsRestart('TAVILY_API_KEY'), false);
  void base;
});
