import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaEngines, normalizeMedia, fitSeconds } from './media-engines.js';
import { readConfigYaml } from './config-yaml.js';

const STALI = 'sk-stali-0123456789abcdefXYZW';
const ROUTER = 'sk-9router-0123456789abcdef';

function setup(t, { fetchImpl, env = `STALI_API_KEY=${STALI}\n` } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zd-media-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'zalo'));
  const envFile = join(dir, '.env');
  const configFile = join(dir, 'config.yaml');
  writeFileSync(envFile, env);
  writeFileSync(configFile, `model:\n  default: hermes\n  base_url: http://127.0.0.1:20128/v1\n  api_key: ${ROUTER}\n`);
  return { dir, configFile, media: createMediaEngines({ hermesHome: dir, configFile, envFile, fetchImpl }) };
}

test('chuẩn hoá: đủ 3 nguồn theo thứ tự đã lưu, model lạ bị chặn khi lưu, độ dài video theo model', () => {
  const s = normalizeMedia({ image: { engines: [{ id: 'codex', enabled: false }, { id: '9router', model: 'cx/gpt-image' }] }, video: { model: 'veo-3.1', seconds: 7 } });
  assert.deepEqual(s.image.engines.map((e) => [e.id, e.enabled, e.model]), [['codex', false, 'gpt-image-2-medium'], ['9router', true, 'cx/gpt-image'], ['stali', true, 'req/gpt-image-2']]);
  assert.equal(s.video.seconds, 6);
  assert.equal(fitSeconds('seedance-2.5', 22), 20);
  assert.throws(() => normalizeMedia({ image: { engines: [{ id: '9router', model: 'a b"c' }] } }, { strict: true }), (e) => e.statusCode === 400);
  assert.throws(() => normalizeMedia({ video: { model: 'sora' } }, { strict: true }), (e) => e.statusCode === 400);
});

test('xem + lưu: ghi media-engines.json, chọn bộ điều phối ảnh 2anh + video Stali trong config.yaml (một lần)', (t) => {
  const { dir, configFile, media } = setup(t, { env: `STALI_API_KEY=${STALI}\nZALO_STUDIO_IMAGE_MODEL=ag/gemini-3-pro-image\n` });
  const v = media.view();
  assert.equal(v.settings.image.engines.find((e) => e.id === '9router').model, 'ag/gemini-3-pro-image', 'chưa lưu: theo model ảnh của Studio');
  assert.deepEqual(v.ready, { stali: true, '9router': true, codex: false });
  assert.equal(v.refLink, 'https://api.stali.vn/r/EB3F18B729DA');
  assert.ok(!JSON.stringify(v).includes(STALI) && !JSON.stringify(v).includes(ROUTER), 'không lộ khoá');
  const order = { image: { engines: [{ id: '9router', model: 'cx/gpt-image' }, { id: 'stali' }, { id: 'codex', enabled: false }] }, video: { enabled: false, model: 'seedance-2.5', seconds: 10 } };
  assert.equal(media.save(order).changedProviders, true);
  assert.equal(media.save(order).changedProviders, false, 'đã đúng thì không đổi config');
  const saved = JSON.parse(readFileSync(join(dir, 'zalo', 'media-engines.json'), 'utf8'));
  assert.deepEqual(saved.image.engines.map((e) => e.id), ['9router', 'stali', 'codex']);
  assert.equal(saved.video.enabled, false);
  assert.equal(readConfigYaml(configFile).image_gen.provider, '2anh');
  assert.equal(readConfigYaml(configFile).video_gen.provider, 'stali');
  writeFileSync(join(dir, 'zalo', 'media-status.json'), JSON.stringify({ codex: true }));
  assert.equal(media.view().ready.codex, true, 'plugin báo máy có ChatGPT');
});

test('thử nguồn: chỉ đọc danh sách model (không vẽ); báo khoá sai/hết tiền; codex theo trạng thái plugin', async (t) => {
  const seen = [];
  const { media } = setup(t, { fetchImpl: async (url, init) => {
    seen.push([url, init.method || 'GET', init.headers?.Authorization]);
    if (url.startsWith('https://api.stali.vn')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'req/gpt-image-2' }, { id: 'seedance-2.0-fast' }, { id: 'claude-fable-5' }] }) };
    return { ok: false, status: 401, json: async () => ({}) };
  } });
  const r = await media.test('image', 'stali');
  assert.equal(r.ok, true);
  assert.match(r.detail, /có model req\/gpt-image-2/);
  assert.deepEqual(seen[0], ['https://api.stali.vn/v1/models', 'GET', `Bearer ${STALI}`]);
  assert.match((await media.test('video')).detail, /seedance-2.0-fast/);
  assert.deepEqual(await media.models('stali'), ['req/gpt-image-2']);
  const bad = await media.test('image', '9router');
  assert.deepEqual([bad.ok, bad.detail], [false, 'Khoá sai hoặc đã bị thu hồi.']);
  assert.equal(seen.at(-1)[2], `Bearer ${ROUTER}`, '9router dùng khoá cổng AI chính');
  assert.equal((await media.test('image', 'codex')).ok, false);
  assert.ok(seen.every(([, m]) => m === 'GET'), 'Thử không vẽ');
});

test('vẽ thử: một ảnh thật, trả ảnh để xem; thiếu khoá Stali báo rõ; ChatGPT không vẽ thử từ dashboard', async (t) => {
  const { media } = setup(t, { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.stali.vn/v1/images/generations');
    assert.equal(JSON.parse(init.body).model, 'req/gpt-image-2');
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'iVBORw0KGgo=' }] }) };
  } });
  const r = await media.draw('stali');
  assert.equal(r.ok, true);
  assert.equal(r.image, 'data:image/png;base64,iVBORw0KGgo=');
  await assert.rejects(media.draw('codex'), (e) => e.statusCode === 400);
  const empty = setup(t, { env: '' }).media;
  await assert.rejects(empty.draw('stali'), /Chưa đặt khoá Stali/);
});
