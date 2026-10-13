import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOwnerMentionNotifier, envFlag } from './owner-mention.js';

const OWNER = '111';
const msg = (over = {}) => ({ data: { msgId: 'm1', dName: 'Nguyễn Văn A', mentions: [{ uid: OWNER, pos: 0, len: 5 }], ...over } });

function setup({ on = true, owners = [OWNER] } = {}) {
  const sent = [];
  const n = createOwnerMentionNotifier({
    ownerUids: () => owners, selfUid: () => '999', enabled: () => on,
    groupName: async (id) => (id === 'g1' ? 'Đoàn trường CNT' : ''),
    notify: async (uid, text) => sent.push([uid, text]),
    now: () => Date.UTC(2026, 9, 13, 14, 5),
  });
  return { n, sent };
}

test('tag chủ nhân trong nhóm → nhắn riêng chủ nhân: tên + UID người gửi, tên nhóm, giờ, nội dung; mỗi tin một lần', async () => {
  const { n, sent } = setup();
  assert.equal(await n.onGroupMessage({ msg: msg(), threadId: 'g1', senderUid: '222', content: '@Hải Anh thầy duyệt giúp em kế hoạch' }), 1);
  assert.equal(sent[0][0], OWNER);
  assert.equal(sent[0][1], '🔔 Nguyễn Văn A (UID 222) nhắc bạn trong nhóm «Đoàn trường CNT» lúc 21:05 13/10:\n@Hải Anh thầy duyệt giúp em kế hoạch');
  assert.equal(await n.onGroupMessage({ msg: msg(), threadId: 'g1', senderUid: '222', content: 'x' }), 0, 'cùng tin không báo lại');
});

test('không báo: tắt công tắc, chủ nhân/bot tự gửi, @All hay tag người khác, chưa có chủ nhân', async () => {
  assert.equal(await setup({ on: false }).n.onGroupMessage({ msg: msg(), threadId: 'g1', senderUid: '222', content: 'x' }), 0);
  const { n, sent } = setup();
  assert.equal(await n.onGroupMessage({ msg: msg({ msgId: 'a' }), threadId: 'g1', senderUid: OWNER, content: 'x' }), 0);
  assert.equal(await n.onGroupMessage({ msg: msg({ msgId: 'b' }), threadId: 'g1', senderUid: '999', content: 'x' }), 0);
  assert.equal(await n.onGroupMessage({ msg: msg({ msgId: 'c', mentions: [{ uid: '-1', type: 1 }] }), threadId: 'g1', senderUid: '222', content: '@All' }), 0);
  assert.equal(await n.onGroupMessage({ msg: msg({ msgId: 'd', mentions: [{ uid: '333' }] }), threadId: 'g1', senderUid: '222', content: 'x' }), 0);
  assert.equal(sent.length, 0);
  assert.equal(await setup({ owners: [] }).n.onGroupMessage({ msg: msg(), threadId: 'g1', senderUid: '222', content: 'x' }), 0);
});

test('nhóm chưa rõ tên, tin chỉ có ảnh; giới hạn số thông báo trong 10 phút', async () => {
  const { n, sent } = setup();
  await n.onGroupMessage({ msg: msg({ dName: '' }), threadId: 'g2', senderUid: '222', content: '' });
  assert.match(sent[0][1], /^🔔 Một người \(UID 222\) nhắc bạn trong nhóm «chưa rõ tên»/);
  assert.match(sent[0][1], /\[tin không có chữ/);
  for (let i = 0; i < 40; i += 1) await n.onGroupMessage({ msg: msg({ msgId: `x${i}` }), threadId: 'g1', senderUid: '222', content: 'x' });
  assert.equal(sent.length, 30, 'tối đa 30 thông báo / 10 phút');
});

test('công tắc đọc lại .env khi tệp đổi; chưa đặt = bật', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mention-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, '.env');
  writeFileSync(file, 'OTHER=1\n');
  const flag = envFlag(file);
  assert.equal(flag(), true);
  writeFileSync(file, 'ZALO_NOTIFY_OWNER_MENTION=false\n');
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(flag(), false);
});
