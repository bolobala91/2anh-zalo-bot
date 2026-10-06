import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginQRCallbackEventType as E } from 'zca-js';
import { createQrLogin } from './qr-login.js';

function harness() {
  const h = { starts: 0, states: [] };
  h.promise = new Promise((resolve, reject) => { h.resolve = resolve; h.reject = reject; });
  h.createZalo = () => ({
    loginQR: (opts, cb) => { h.starts += 1; h.cb = cb; return h.promise; },
  });
  h.health = { setZaloState: (s) => h.states.push(s) };
  return h;
}

test('start() trả ngay, không chờ quét', async () => {
  const h = harness();
  const qr = createQrLogin({ createZalo: h.createZalo, onLoggedIn: async () => ({}), health: h.health });
  await qr.start();
  assert.equal(h.starts, 1);
  assert.equal(qr.state().status, 'qr-pending');
});

test('QRCodeGenerated cho ảnh dạng data URL dù sự kiện có hay không có tiền tố', async () => {
  const h = harness();
  const qr = createQrLogin({ createZalo: h.createZalo, onLoggedIn: async () => ({}), health: h.health });
  await qr.start();
  await h.cb({ type: E.QRCodeGenerated, data: { image: 'AAA' } });
  assert.equal(qr.state().image, 'data:image/png;base64,AAA');
  await h.cb({ type: E.QRCodeGenerated, data: { image: 'data:image/png;base64,BBB' } });
  assert.equal(qr.state().image, 'data:image/png;base64,BBB');
});

test('đăng nhập xong gọi onLoggedIn với api và credentials, trạng thái logged-in', async () => {
  const h = harness();
  const seen = [];
  const user = { user_id: 'u1' };
  const qr = createQrLogin({ createZalo: h.createZalo, onLoggedIn: async (...a) => { seen.push(a); return user; }, health: h.health });
  const waiting = qr.waitForLogin();
  const creds = { cookie: 'c', imei: 'i' };
  await h.cb({ type: E.GotLoginInfo, data: creds });
  const api = { fake: true };
  h.resolve(api);
  assert.equal(await waiting, user);
  assert.deepEqual(seen, [[api, creds]]);
  assert.equal(qr.state().status, 'logged-in');
  assert.equal(qr.state().user, user);
});

test('loginQR lỗi thì về idle, không unhandled rejection', async () => {
  const h = harness();
  const unhandled = [];
  const on = (e) => unhandled.push(e);
  process.on('unhandledRejection', on);
  try {
    const qr = createQrLogin({ createZalo: h.createZalo, onLoggedIn: async () => ({}), health: h.health });
    await qr.start();
    h.reject(new Error('hết hạn'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(qr.state().status, 'idle');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', on);
  }
});

test('start() hai lần khi đang chờ không mở lần đăng nhập thứ hai', async () => {
  const h = harness();
  const qr = createQrLogin({ createZalo: h.createZalo, onLoggedIn: async () => ({}), health: h.health });
  await qr.start();
  await qr.start();
  assert.equal(h.starts, 1);
});
