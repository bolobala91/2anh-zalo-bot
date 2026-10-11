import test from 'node:test';
import assert from 'node:assert/strict';
import { dmStatus, setPersonAllowed } from './views/chat-perms.js';
import { dmPayload } from './views/dm-permissions.js';

const LIEN = '123456789012345678';
const base = (who, people = []) => ({ who, features: { web: true, image: false }, people });

test('dmStatus: chỉ chủ nhân → chưa được; danh sách → theo có tên; mọi người → luôn được', () => {
  assert.deepEqual(dmStatus(base('owners'), LIEN), { person: null, allowed: false });
  assert.equal(dmStatus(base('list'), LIEN).allowed, false);
  assert.equal(dmStatus(base('list', [{ uid: LIEN, name: 'c Liên', custom: false, features: {} }]), LIEN).allowed, true);
  assert.equal(dmStatus(base('everyone'), LIEN).allowed, true);
});

test('cho c Liên nhắn riêng khi đang "Chỉ chủ nhân" → thêm đúng c ấy và chuyển sang chế độ danh sách', () => {
  const { draft } = setPersonAllowed(base('owners'), LIEN, 'c Liên', true);
  assert.equal(draft.who, 'list');
  assert.deepEqual(draft.people.map((p) => [p.uid, p.name, p.custom]), [[LIEN, 'c Liên', false]]);
  // Theo tính năng chung → gửi features: null.
  assert.equal(dmPayload(draft).people[0].features, null);
});

test('bật lần hai không thêm trùng; tắt thì bỏ khỏi danh sách, giữ nguyên chế độ', () => {
  const once = setPersonAllowed(base('list'), LIEN, 'c Liên', true).draft;
  assert.equal(setPersonAllowed(once, LIEN, 'c Liên', true).draft.people.length, 1);
  const off = setPersonAllowed(once, LIEN, '', false).draft;
  assert.equal(off.who, 'list');
  assert.equal(off.people.length, 0);
});

test('chế độ mọi người: bật chỉ để chỉnh riêng, không đổi chế độ', () => {
  const { draft } = setPersonAllowed(base('everyone'), LIEN, 'c Liên', true);
  assert.equal(draft.who, 'everyone');
  assert.equal(draft.people.length, 1);
});

test('UID sai → báo lỗi, không thêm', () => {
  assert.match(setPersonAllowed(base('owners'), '0987654321', 'x', true).error, /UID/);
});
