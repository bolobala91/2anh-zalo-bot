import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboundQueue } from './inbound-queue.js';

const frame = (id, extra = {}) => ({ id, threadId: 'group', threadType: 1, senderUid: 'member', text: id, ...extra });

test('queued IDs deduplicate within a sender/chat, preserving complete frames and FIFO order', async () => {
  const q = createInboundQueue();
  const first = frame('one', { quote: { id: 'reply' }, attachments: [{ url: 'https://example.com/file' }] });
  assert.equal(q.enqueue(first), true);
  q.enqueue(frame('one'));
  q.enqueue(frame('two'));
  const sent = [];
  await q.drain(async (data) => { sent.push(JSON.parse(data)); return true; });
  assert.deepEqual(sent, [first, frame('two')]);
  assert.equal(q.size, 0);
});

test('the same IDs from different senders or chats remain separate', async () => {
  const q = createInboundQueue();
  q.enqueue(frame('one'));
  q.enqueue(frame('one', { threadId: 'other' }));
  q.enqueue(frame('one', { senderUid: 'other' }));
  q.enqueue(frame(null, { cliMsgId: 'cli-one' }));
  q.enqueue(frame(null, { cliMsgId: 'cli-two' }));
  const sent = [];
  await q.drain(async (data) => { sent.push(data); return true; });
  assert.equal(sent.length, 5);
});

test('send failure retains the unsent head for reconnect without replaying delivered entries', async () => {
  const q = createInboundQueue();
  q.enqueue(frame('one')); q.enqueue(frame('two')); q.enqueue(frame('three'));
  const sent = [];
  await q.drain(async (data) => {
    const id = JSON.parse(data).id;
    if (id === 'two') return false;
    sent.push(id); return true;
  });
  assert.deepEqual(sent, ['one']);
  assert.equal(q.size, 2);
  await q.drain(async (data) => { sent.push(JSON.parse(data).id); return true; });
  assert.deepEqual(sent, ['one', 'two', 'three']);
});

test('concurrent drains and arrivals during replay keep one ordered delivery stream', async () => {
  const q = createInboundQueue();
  q.enqueue(frame('one'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const send = async (data) => { sent.push(JSON.parse(data).id); await gate; return true; };
  const first = q.drain(send);
  const second = q.drain(send);
  q.enqueue(frame('two'));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, ['one', 'two']);
});

test('expired items are dropped explicitly and do not reach the sender', async () => {
  let clock = 0;
  const dropped = [];
  const q = createInboundQueue({ now: () => clock, maxAgeMs: 10, onDrop: (reason) => dropped.push(reason) });
  q.enqueue(frame('old'));
  clock = 11;
  q.enqueue(frame('new'));
  const sent = [];
  await q.drain(async (data) => { sent.push(JSON.parse(data).id); return true; });
  assert.deepEqual(sent, ['new']);
  assert.deepEqual(dropped, ['expired']);
});

test('entry and byte limits bound memory without exposing message content to diagnostics', async () => {
  const dropped = [];
  const q = createInboundQueue({ maxItems: 2, maxBytes: 300, onDrop: (...args) => dropped.push(args) });
  q.enqueue(frame('one')); q.enqueue(frame('two')); q.enqueue(frame('three'));
  assert.equal(q.enqueue(frame('huge', { text: 'private'.repeat(100) })), false);
  const sent = [];
  await q.drain(async (data) => { sent.push(JSON.parse(data).id); return true; });
  assert.deepEqual(sent, ['two', 'three']);
  assert.deepEqual(dropped, [['capacity'], ['oversized']]);
});

test('closing the queue prevents account/session leakage even with a send in flight', async () => {
  const q = createInboundQueue();
  q.enqueue(frame('one')); q.enqueue(frame('two'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const task = q.drain(async (data) => { sent.push(JSON.parse(data).id); await gate; return true; });
  q.close(); release(); await task;
  assert.deepEqual(sent, ['one']);
  assert.equal(q.size, 0);
  assert.equal(q.enqueue(frame('late')), false);
});

test('thrown send errors retain the frame for a later drain', async () => {
  const q = createInboundQueue();
  q.enqueue(frame('one'));
  await q.drain(() => { throw new Error('socket closed'); });
  assert.equal(q.size, 1);
  await q.drain(async () => true);
  assert.equal(q.size, 0);
});
