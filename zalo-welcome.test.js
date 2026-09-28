import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildWelcomeMessage, createWelcomer, readWelcomeConfig, updateWelcomeGroup,
} from './zalo-welcome.js';

const GROUP = '1893515820840681584';

function joinEvent(members, groupId = GROUP) {
  return {
    type: 'join',
    threadId: groupId,
    data: { groupId, updateMembers: members.map(([id, dName]) => ({ id, dName })) },
  };
}

function harness(cfg) {
  const sent = [];
  const timers = [];
  const welcomer = createWelcomer({
    selfUid: 'bot',
    loadConfig: () => ({ groups: { [GROUP]: cfg } }),
    send: async (groupId, text, mentions) => { sent.push({ groupId, text, mentions }); },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
  });
  return { welcomer, sent, timers };
}

const ON = { enabled: true, message: 'Đề nghị các bạn điểm danh.', batchSize: 3, maxWaitMinutes: 10 };

test('tag đúng vị trí và độ dài từng người, lời chào ở dòng sau', () => {
  const { text, mentions } = buildWelcomeMessage(
    [{ uid: '1', name: 'Ngô Lan Phương' }, { uid: '2', name: 'Bùi Vy' }], 'Chào mừng!');
  assert.equal(text, '@Ngô Lan Phương, @Bùi Vy\nChào mừng!');
  for (const m of mentions) {
    assert.equal(text.slice(m.pos, m.pos + m.len), m.uid === '1' ? '@Ngô Lan Phương' : '@Bùi Vy');
  }
});

test('gom đủ batchSize người thì gửi một tin tag tất cả', async () => {
  const { welcomer, sent } = harness(ON);
  welcomer.onGroupEvent(joinEvent([['1', 'An'], ['2', 'Bình']]));
  assert.equal(sent.length, 0);
  welcomer.onGroupEvent(joinEvent([['3', 'Chi']]));
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].groupId, GROUP);
  assert.deepEqual(sent[0].mentions.map((m) => m.uid), ['1', '2', '3']);
  assert.match(sent[0].text, /\nĐề nghị các bạn điểm danh\.$/);
  assert.equal(welcomer.pendingCount(GROUP), 0);
});

test('chưa đủ người thì hết thời gian chờ vẫn gửi cho những người đã vào', async () => {
  const { welcomer, sent, timers } = harness(ON);
  welcomer.onGroupEvent(joinEvent([['1', 'An']]));
  welcomer.onGroupEvent(joinEvent([['2', 'Bình']]));
  assert.equal(timers.length, 1, 'chỉ đặt một hẹn giờ cho cả đợt');
  assert.equal(timers[0].ms, 10 * 60_000);
  await timers[0].fn();
  assert.deepEqual(sent[0].mentions.map((m) => m.uid), ['1', '2']);
});

test('bỏ qua nhóm chưa bật, sự kiện không phải vào nhóm, chính bot và người trùng', async () => {
  const off = harness({ ...ON, enabled: false });
  off.welcomer.onGroupEvent(joinEvent([['1', 'An'], ['2', 'B'], ['3', 'C']]));
  assert.equal(off.welcomer.pendingCount(GROUP), 0);

  const { welcomer, sent } = harness(ON);
  welcomer.onGroupEvent({ ...joinEvent([['1', 'An']]), type: 'leave' });
  welcomer.onGroupEvent(joinEvent([['bot', 'Lăng Tiêu'], ['1', 'An']]));
  welcomer.onGroupEvent(joinEvent([['1', 'An']]));
  welcomer.onGroupEvent(joinEvent([['9', 'X']], '999'));
  assert.equal(welcomer.pendingCount(GROUP), 1);
  assert.equal(sent.length, 0);
});

test('tắt giữa chừng thì đợt đang gom không gửi nữa', async () => {
  const cfg = { ...ON };
  const { welcomer, sent, timers } = harness(cfg);
  welcomer.onGroupEvent(joinEvent([['1', 'An']]));
  cfg.enabled = false;
  await timers[0].fn();
  assert.equal(sent.length, 0);
});

test('lưu cấu hình: chỉ đổi trường được gửi, chặn số vô lý, bắt buộc có lời chào khi bật', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'welcome-')), 'welcome.json');
  assert.throws(() => updateWelcomeGroup(GROUP, { enabled: true }, path), /lời chào/);
  assert.throws(() => updateWelcomeGroup('abc', { enabled: false }, path), /groupId/);

  updateWelcomeGroup(GROUP, { enabled: true, message: '  Chào  ', batchSize: 999, name: 'Vũ Đài' }, path);
  const saved = updateWelcomeGroup(GROUP, { maxWaitMinutes: 0 }, path);
  assert.deepEqual(saved, { enabled: true, message: 'Chào', batchSize: 20, maxWaitMinutes: 1, name: 'Vũ Đài' });
  assert.deepEqual(readWelcomeConfig(path).groups[GROUP], saved);
  assert.ok(JSON.parse(readFileSync(path, 'utf8')).groups[GROUP].enabled);

  assert.equal(updateWelcomeGroup(GROUP, { enabled: false }, path).enabled, false);
  assert.deepEqual(readWelcomeConfig(join(path, '..', 'missing.json')), { groups: {} });
});
