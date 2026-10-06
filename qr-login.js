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

  let generation = 0;

  function run() {
    const gen = ++generation;
    const current = () => gen === generation;
    status = 'qr-pending';
    image = null;
    health?.setZaloState('qr-pending');
    let credentials = null;
    let rejectRun;
    const result = new Promise((resolve, reject) => {
      rejectRun = reject;
      // zca-js không tự kết thúc loginQR khi QR hết hạn/bị từ chối (chỉ chờ retry/abort),
      // nên ta bỏ lần chạy này và cho lần sau bắt đầu mới.
      const giveUp = (evt, type, reason) => {
        status = 'idle'; image = null; health?.setZaloState('idle'); broadcast({ type });
        try { evt.actions?.abort?.(); } catch { /* đã đóng */ }
        pending = null;
        generation += 1;
        reject(new Error(reason));
      };
      const onEvent = async (evt) => {
        if (!current()) return;
        switch (evt.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            image = toDataUrl(evt.data.image); status = 'qr-pending';
            broadcast({ type: 'qr-generated', data: { image: evt.data.image } }); break;
          case LoginQRCallbackEventType.QRCodeScanned:
            status = 'scanned'; health?.setZaloState('scanned'); broadcast({ type: 'qr-scanned' }); break;
          case LoginQRCallbackEventType.QRCodeExpired:
            giveUp(evt, 'qr-expired', 'Mã QR đã hết hạn'); break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            giveUp(evt, 'qr-declined', 'Đã từ chối đăng nhập'); break;
          case LoginQRCallbackEventType.GotLoginInfo:
            credentials = evt.data; break;
          default: break;
        }
      };
      let login;
      try {
        login = createZalo().loginQR({ userAgent: USER_AGENT, language: 'vi' }, onEvent);
      } catch (err) { reject(err); return; }
      Promise.resolve(login).then(async (api) => {
        if (!current()) return;
        const u = await onLoggedIn(api, credentials);
        if (!current()) return;
        user = u; status = 'logged-in'; image = null;
        resolve(u);
      }).catch((err) => { if (current()) reject(err); });
    });
    pending = result;
    result.catch((err) => {
      if (current()) {
        status = 'idle'; image = null; health?.setZaloState('idle');
        broadcast({ type: 'error', data: String(err?.message || err) }); // trang cũ đọc data là chuỗi
        pending = null;
      }
    });
    result.then(() => { if (current()) pending = null; }, () => {});
    return result;
  }

  return {
    async start() { if (status !== 'logged-in' && !pending) run(); },
    waitForLogin() { return pending || run(); },
    state: () => ({ status, image, user }),
    markLoggedIn(u) { status = 'logged-in'; user = u; image = null; },
    markLoggedOut() { status = 'idle'; user = null; image = null; },
  };
}
