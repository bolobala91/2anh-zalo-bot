import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createCallWords } from '../lib/call-words.js';
import { loginAs, makeDeps, startApp } from '../test-helpers.js';

test('Cách gọi bot: Chủ bot xem/sửa/khôi phục, ghi Nhật ký; chưa đăng nhập → 401', async (t) => {
  const deps = makeDeps(t);
  deps.callWords = createCallWords({ file: join(deps.dir, 'call-words.json') });
  deps.sidecar.health = async () => ({ zalo: { displayName: 'Uyển Nhi' } });
  const { call } = await startApp(t, deps);
  assert.equal((await call('/api/call-words')).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'khach', role: 'owner' });
  const first = await call('/api/call-words', { cookie: owner });
  assert.deepEqual([first.json.botName, first.json.custom, first.json.words[0]], ['Uyển Nhi', false, { text: 'uyển nhi', at: 'start' }]);
  const saved = await call('/api/call-words', { method: 'PUT', cookie: owner, body: { words: [{ text: 'Nhi ơi', at: 'any' }] } });
  assert.deepEqual([saved.json.custom, saved.json.words], [true, [{ text: 'nhi ơi', at: 'any' }]]);
  assert.equal((await call('/api/call-words', { method: 'PUT', cookie: owner, body: { words: [{ text: '', at: 'any' }] } })).status, 400);
  assert.equal((await call('/api/call-words', { method: 'DELETE', cookie: owner })).json.custom, false);
  assert.deepEqual(deps.activity.list().map((e) => e.action).filter((a) => a.startsWith('call_words')).sort(), ['call_words_reset', 'call_words_save']);
});
