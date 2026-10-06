import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginGuard } from './login-guard.js';

test('sai 5 lần thì khoá 15 phút theo từng khoá', () => {
  const clock = { t: 0 };
  const g = createLoginGuard({ now: () => clock.t });
  for (let i = 0; i < 4; i++) g.fail(['u:anh', 'ip:1.2.3.4']);
  assert.equal(g.locked(['u:anh']), 0);
  g.fail(['u:anh', 'ip:1.2.3.4']);
  assert.ok(g.locked(['u:anh']) > 0);
  assert.ok(g.locked(['ip:1.2.3.4']) > 0);
  assert.equal(g.locked(['u:khach']), 0);
  clock.t = 15 * 60_000 + 1;
  assert.equal(g.locked(['u:anh']), 0);
});

test('thành công thì xoá đếm sai', () => {
  const g = createLoginGuard({});
  for (let i = 0; i < 4; i++) g.fail(['u:anh']);
  g.succeed(['u:anh']);
  g.fail(['u:anh']);
  assert.equal(g.locked(['u:anh']), 0);
});

test('mã 6 số: đúng một lần, hết hạn sau 5 phút, sai quá 5 lần thì huỷ', () => {
  const clock = { t: 0 };
  const g = createLoginGuard({ now: () => clock.t });
  const code = g.issueCode('anh');
  assert.match(code, /^\d{6}$/);
  assert.equal(g.verifyCode('anh', code), true);
  assert.equal(g.verifyCode('anh', code), false); // dùng một lần
  const c2 = g.issueCode('anh'); clock.t = 5 * 60_000 + 1;
  assert.equal(g.verifyCode('anh', c2), false);
  const c3 = g.issueCode('anh');
  const wrong = c3 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(g.verifyCode('anh', wrong), false);
  assert.equal(g.verifyCode('anh', c3), false); // đã quá 5 lần sai nên mã đúng cũng bị từ chối
});
