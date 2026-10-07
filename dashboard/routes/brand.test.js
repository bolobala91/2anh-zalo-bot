import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDeps, startApp, loginAs, pngOf } from '../test-helpers.js';

const dataUrl = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const BODY = { name: 'Trường CNT', color: '#be123c', poweredBy: false };

test('GET /api/brand công khai, chỉ có tên, màu, logo, dòng vận hành và gợi ý màu', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const r = await call('/api/brand');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['color', 'logoUrl', 'name', 'ok', 'poweredBy', 'suggestions']);
  assert.equal(r.json.name, 'Dashboard Zalo');
  assert.equal(r.json.suggestions.length, 6);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('chưa đăng nhập thì không sửa được gì: 401', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  for (const [method, path, body] of [['PUT', '/api/brand', BODY], ['POST', '/api/brand/logo', { dataUrl: dataUrl(pngOf(8, 8)) }], ['DELETE', '/api/brand/logo'], ['DELETE', '/api/brand']]) {
    assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  }
  assert.equal(deps.brand.get().name, 'Dashboard Zalo');
});

test('Chủ bot đổi tên/màu/logo được; /brand.css và /brand/logo.png phục vụ cùng nguồn; Nhật ký ghi tên người sửa', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const put = await call('/api/brand', { method: 'PUT', cookie, body: BODY });
  assert.equal(put.status, 200);
  assert.equal(put.json.name, 'Trường CNT');
  assert.equal((await call('/api/brand')).json.color, '#be123c');

  const css = await fetch(`${base}/brand.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(await css.text(), /--brand: #be123c;/);
  assert.match(css.headers.get('content-security-policy'), /default-src 'self'/);

  const up = await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: dataUrl(pngOf(64, 32)) } });
  assert.equal(up.status, 200);
  const logo = await fetch(base + up.json.logoUrl);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.equal(logo.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), 'PNG');

  const actions = deps.activity.list().map((e) => `${e.actor}:${e.action}`);
  assert.ok(actions.includes('khach:brand_update') && actions.includes('khach:brand_logo'));
});

test('logo SVG / không phải PNG / quá cỡ bị 400 kèm bước tiếp theo, không ghi gì', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
  for (const body of [{ dataUrl: svg }, { dataUrl: dataUrl(pngOf(300, 300)) }, { dataUrl: 'x' }, {}]) {
    const r = await call('/api/brand/logo', { method: 'POST', cookie, body });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /—/);
  }
  assert.equal((await fetch(`${base}/brand/logo.png`)).status, 404);
  assert.equal(deps.brand.get().logoUrl, null);
});

test('màu không đủ tương phản bị 400; thân quá 2 MB bị 413', async (t) => {
  const deps = makeDeps(t); const { call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  const r = await call('/api/brand', { method: 'PUT', cookie, body: { ...BODY, color: '#fde68a' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /đậm hơn/);
  const big = await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}` } });
  assert.equal(big.status, 413);
});

test('gỡ logo và khôi phục mặc định', async (t) => {
  const deps = makeDeps(t); const { base, call } = await startApp(t, deps);
  const cookie = await loginAs(t, deps, call);
  await call('/api/brand', { method: 'PUT', cookie, body: BODY });
  await call('/api/brand/logo', { method: 'POST', cookie, body: { dataUrl: dataUrl(pngOf(16, 16)) } });
  assert.equal((await call('/api/brand/logo', { method: 'DELETE', cookie })).json.logoUrl, null);
  const reset = await call('/api/brand', { method: 'DELETE', cookie });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.name, 'Dashboard Zalo');
  assert.doesNotMatch(await (await fetch(`${base}/brand.css`)).text(), /--brand/);
  assert.ok(deps.activity.list().some((e) => e.action === 'brand_reset'));
});
