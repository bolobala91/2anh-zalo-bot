import test from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { buildDeps } from './server.js';
import { createDashboardApp } from './app.js';

test('buildDeps returns all required keys', () => {
  const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
  const sidecarRoot = join(tmpdir(), `sidecar-test-${Date.now()}`);

  try {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(sidecarRoot, { recursive: true });

    const env = {
      HERMES_HOME: tmpDir,
      ZALO_BRIDGE_TOKEN: 'x'.repeat(32),
      ZCA_PORT: '3872',
    };

    const deps = buildDeps({ env, sidecarRoot });

    const requiredKeys = [
      'config', 'users', 'sessions', 'guard', 'setupToken', 'activity',
      'sidecar', 'linker', 'watchdog', 'restartAssistant', 'publicDir', 'paths', 'store', 'threadNames', 'permissions'
    ];

    for (const key of requiredKeys) {
      assert.ok(key in deps, `Missing key: ${key}`);
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(sidecarRoot, { recursive: true, force: true }); } catch {}
  }
});

test('createDashboardApp responds to GET /healthz with {ok:true}', async (t) => {
  const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
  const sidecarRoot = join(tmpdir(), `sidecar-test-${Date.now()}`);

  try {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(sidecarRoot, { recursive: true });

    const env = {
      HERMES_HOME: tmpDir,
      ZALO_BRIDGE_TOKEN: 'x'.repeat(32),
      ZCA_PORT: '3872',
    };

    const deps = buildDeps({ env, sidecarRoot });
    const app = createDashboardApp(deps);

    const server = app.listen(0, '127.0.0.1');

    t.after(() => {
      server.close();
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      try { rmSync(sidecarRoot, { recursive: true, force: true }); } catch {}
    });

    await new Promise((resolve) => server.on('listening', resolve));

    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(body, { ok: true });
  } catch (err) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(sidecarRoot, { recursive: true, force: true }); } catch {}
    throw err;
  }
});

test('missing ZALO_BRIDGE_TOKEN throws error with ZALO_BRIDGE_TOKEN in message', () => {
  const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
  const sidecarRoot = join(tmpdir(), `sidecar-test-${Date.now()}`);

  try {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(sidecarRoot, { recursive: true });

    const env = {
      HERMES_HOME: tmpDir,
      // Missing ZALO_BRIDGE_TOKEN
    };

    assert.throws(
      () => buildDeps({ env, sidecarRoot }),
      (err) => err.message.includes('ZALO_BRIDGE_TOKEN')
    );
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(sidecarRoot, { recursive: true, force: true }); } catch {}
  }
});
