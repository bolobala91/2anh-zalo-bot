import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDeps, startApp, loginAs, seedHistory, chatMsg } from '../test-helpers.js';
import { createContextGateReader } from '../lib/context-gate-reader.js';

async function setup(t) {
  const deps = makeDeps(t);
  seedHistory(deps, { messages: [chatMsg({ msgId: 'g1', threadId: '200', threadType: 1, text: 'Tin giả lập' })] });
  const file = join(deps.dir, 'context-gate-events.jsonl');
  deps.contextGate = createContextGateReader({ file, store: deps.store, now: () => 2000 });
  const account = deps.store.currentAccountId();
  const row = { id: 'a'.repeat(32), at: 1000, account, thread: '200', message: 'g1', decision: 'IGNORE',
    reason: 'probability', probability: .2, threshold: .72, duration_ms: 50, stages: [], text: 'MUST-NOT-LEAK' };
  const app = await startApp(t, deps);
  return { ...app, deps, file, row };
}

test('context diagnostics require admin and never expose text or other accounts/groups', async (t) => {
  const { call, deps, file, row } = await setup(t);
  const uri = '/api/chats/200/context-gate';
  writeFileSync(file, [row, { ...row, account: 'other' }, { ...row, thread: '201' }].map(JSON.stringify).join('\n') + '\n');
  assert.equal((await call(uri)).status, 401);
  const owner = await loginAs(t, deps, call, { username: 'owner-gate', role: 'owner' });
  assert.equal((await call(uri, { cookie: owner })).status, 403);
  const admin = await loginAs(t, deps, call, { username: 'admin-gate', role: 'admin' });
  const result = await call(uri, { cookie: admin });
  assert.equal(result.status, 200);
  assert.equal(result.json.items.length, 1);
  assert.ok(result.json.items[0].ref.id);
  assert.equal(result.json.items[0].probability, .2);
  assert.equal(JSON.stringify(result.json).includes('MUST-NOT-LEAK'), false);
  assert.equal('account' in result.json.items[0], false);
  assert.equal((await call(uri + '?filter=bad', { cookie: admin })).status, 400);
  assert.equal((await call('/api/chats/abc/context-gate', { cookie: admin })).status, 400);
});

test('reader tolerates partial lines, rotation and filters failures even if fallback succeeds', async (t) => {
  const { deps, file, row } = await setup(t);
  assert.equal(deps.contextGate.list('200').available, false);
  writeFileSync(file + '.1', JSON.stringify(row) + '\n');
  writeFileSync(file, JSON.stringify({ ...row, id: 'b'.repeat(32), at: 1001, decision: 'RESPOND',
    stages: [{ model: 'typesafe/jev-1.14', provider: 'openrouter', status: 'timeout', body: 'MUST-NOT-LEAK' }] }) + '\n{"partial":');
  assert.equal(deps.contextGate.list('200').items.length, 2);
  assert.equal(deps.contextGate.list('200', 'ignore').items.length, 1);
  const errors = deps.contextGate.list('200', 'errors').items;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].decision, 'RESPOND');
  assert.equal(JSON.stringify(errors).includes('MUST-NOT-LEAK'), false);
});

test('human feedback tracks quality separately from transport success and can be corrected', async (t) => {
  const { deps, file, row, call } = await setup(t);
  const samples = [
    { ...row, stages: [{ model: 'openrouter/typesafe/jev-1.13', provider: '9router', status: 'ok', duration_ms: 100 }] },
    { ...row, id: 'b'.repeat(32), decision: 'RESPOND', stages: [
      { model: 'openrouter/typesafe/jev-1.13', provider: '9router', status: 'timeout', duration_ms: 3000 },
      { model: 'gemini/gemini-3.8-flash', provider: '9router', status: 'ok', duration_ms: 200 }] },
  ];
  writeFileSync(file, samples.map(JSON.stringify).join('\n') + '\n');
  const cookie = await loginAs(t, deps, call, { username: 'metrics-admin', role: 'admin' });
  const summaryUrl = '/api/context-gate/summary';
  let response = await call(summaryUrl, { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.json.models[0].reviewed, 0);
  const feedbackUrl = `/api/chats/200/context-gate/${row.id}/feedback`;
  assert.equal((await call(feedbackUrl, { method: 'POST', cookie, body: { verdict: 'correct' } })).status, 200);
  assert.equal((await call(`/api/chats/200/context-gate/${'b'.repeat(32)}/feedback`, { method: 'POST', cookie, body: { verdict: 'incorrect' } })).status, 200);
  response = await call(summaryUrl, { cookie });
  const jev = response.json.models.find((m) => m.model.includes('jev'));
  const gemini = response.json.models.find((m) => m.model.includes('gemini'));
  assert.deepEqual([jev.calls, jev.succeeded, jev.failed, jev.reviewed, jev.correct], [2, 1, 1, 1, 1]);
  assert.deepEqual([gemini.reviewed, gemini.correct, gemini.falsePositive], [1, 0, 1]);
  assert.equal(gemini.avgMs, 200);
  await call(feedbackUrl, { method: 'POST', cookie, body: { verdict: 'incorrect' } });
  assert.equal(deps.contextGate.summary().models.find((m) => m.model.includes('jev')).correct, 0);
  await call(feedbackUrl, { method: 'POST', cookie, body: { verdict: null } });
  assert.equal(deps.contextGate.summary().models.find((m) => m.model.includes('jev')).reviewed, 0);
  assert.equal((await call(`/api/chats/201/context-gate/${row.id}/feedback`, { method: 'POST', cookie, body: { verdict: 'correct' } })).status, 404);
});

test('feedback and model metrics are admin-only and reject arbitrary data', async (t) => {
  const { deps, call, file, row } = await setup(t);
  writeFileSync(file, JSON.stringify(row) + '\n');
  const owner = await loginAs(t, deps, call, { username: 'feedback-owner', role: 'owner' });
  const admin = await loginAs(t, deps, call, { username: 'feedback-admin', role: 'admin' });
  const url = `/api/chats/200/context-gate/${row.id}/feedback`;
  assert.equal((await call('/api/context-gate/summary', { cookie: owner })).status, 403);
  assert.equal((await call(url, { method: 'POST', cookie: owner, body: { verdict: 'correct' } })).status, 403);
  assert.equal((await call(url, { method: 'POST', cookie: admin, body: { verdict: 'correct', text: 'private' } })).status, 400);
  assert.equal((await call(url, { method: 'POST', cookie: admin, body: { verdict: 'made-up' } })).status, 400);
});
