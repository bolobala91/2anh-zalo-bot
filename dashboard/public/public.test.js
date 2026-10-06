import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

test('mọi import tương đối trong giao diện đều trỏ tới tệp có thật', () => {
  for (const f of files(root).filter((x) => /\.m?js$/.test(x) && !x.endsWith('.test.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      assert.ok(existsSync(resolve(dirname(f), m[1])), `${f} → ${m[1]}`);
    }
  }
});

test('dải trạng thái và thẻ Zalo: listener đứt → vàng "Đang nối lại", mất phiên/chưa đăng nhập → đỏ', async () => {
  const { statusLevel } = await import('./views/shell.js');
  const { zaloCard } = await import('./views/overview.js');
  const st = (zalo) => ({ sidecar: 'up', assistant: 'connected', zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false, ...zalo } });
  assert.equal(statusLevel(st({})).kind, 'ok');
  assert.equal(zaloCard(st({})).kind, 'ok');
  for (const listener of ['reconnecting', 'closed', 'starting']) {
    const lv = statusLevel(st({ listener }));
    assert.equal(lv.kind, 'warn');
    assert.match(lv.text, /Đang nối lại/);
    assert.equal(zaloCard(st({ listener })).kind, 'warn');
  }
  assert.equal(statusLevel(st({ listener: null })).kind, 'ok');
  for (const bad of [{ needsRelogin: true, listener: 'reconnecting' }, { status: 'idle', listener: null }]) {
    assert.equal(statusLevel(st(bad)).kind, 'danger');
    assert.equal(zaloCard(st(bad)).kind, 'danger');
  }
});

test('index.html không tải tài nguyên từ Internet', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
});
