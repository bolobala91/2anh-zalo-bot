/**
 * Luồng đăng nhập QR. Tách khỏi server.js để dashboard bắt đầu quét qua HTTP
 * mà không phải giữ request mở tới khi người dùng quét (trang cũ vẫn chờ như trước).
 */
import { LoginQRCallbackEventType } from 'zca-js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

export function toDataUrl(image) {
  if (!image) return null;
  return String(image).startsWith('data:') ? String(image) : `data:image/png;base64,${image}`;
}

export function createQrLogin({ createZalo, onLoggedIn, health, broadcast = () => {} }) {
  let status = 'idle';
  let image = null;
  let user = null;
  let pending = null; // Promise của lần đăng nhập đang chạy

  function run() {
    status = 'qr-pending';
    image = null;
    health?.setZaloState('qr-pending');
    let credentials = null;
    const zalo = createZalo();
    pending = zalo.loginQR({ userAgent: USER_AGENT, language: 'vi' }, async (evt) => {
      switch (evt.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          image = toDataUrl(evt.data.image); status = 'qr-pending';
          broadcast({ type: 'qr-generated', data: { image: evt.data.image } }); break;
        case LoginQRCallbackEventType.QRCodeScanned:
          status = 'scanned'; health?.setZaloState('scanned'); broadcast({ type: 'qr-scanned' }); break;
        case LoginQRCallbackEventType.QRCodeExpired:
          status = 'idle'; image = null; health?.setZaloState('idle'); broadcast({ type: 'qr-expired' }); break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          status = 'idle'; image = null; health?.setZaloState('idle'); broadcast({ type: 'qr-declined' }); break;
        case LoginQRCallbackEventType.GotLoginInfo:
          credentials = evt.data; break;
        default: break;
      }
    }).then(async (api) => {
      user = await onLoggedIn(api, credentials);
      status = 'logged-in'; image = null;
      return user;
    }).catch((err) => {
      status = 'idle'; image = null; health?.setZaloState('idle');
      broadcast({ type: 'error', data: String(err?.message || err) }); // trang cũ đọc data là chuỗi
      throw err;
    }).finally(() => { pending = null; });
    pending.catch(() => {}); // lỗi đã được xử lý ở trên; tránh unhandled rejection khi không ai chờ
    return pending;
  }

  return {
    async start() { if (status !== 'logged-in' && !pending) run(); },
    waitForLogin() { return pending || run(); },
    state: () => ({ status, image, user }),
    markLoggedIn(u) { status = 'logged-in'; user = u; image = null; },
    markLoggedOut() { status = 'idle'; user = null; image = null; },
  };
}
