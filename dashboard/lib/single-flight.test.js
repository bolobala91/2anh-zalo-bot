import test from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight.js';

test('singleFlight: bỏ qua lần gọi khi lần trước còn chạy; chạy lại được sau khi xong hoặc lỗi', async () => {
  let release; let calls = 0;
  const f = singleFlight(() => { calls++; return new Promise((r) => { release = r; }); });
  const first = f();
  assert.equal(await f(), undefined);
  assert.equal(calls, 1);
  release('xong'); assert.equal(await first, 'xong');
  const second = f(); release(); await second;
  assert.equal(calls, 2);
  const bad = singleFlight(async () => { calls++; throw new Error('x'); });
  await assert.rejects(bad()); await assert.rejects(bad());
  assert.equal(calls, 4);
});
