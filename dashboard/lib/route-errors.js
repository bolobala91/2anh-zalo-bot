// Quy ước lỗi chung của route: chỉ lộ err.message khi là 4xx rõ ràng; 5xx trả câu chung có bước tiếp theo.
export const NO_HISTORY = 'Chưa có lịch sử trò chuyện — bot cần đăng nhập Zalo và nhận tin trước. Nếu bot đã chạy lâu mà vẫn thấy dòng này, hãy báo người cài đặt.';

export const SEND_UNKNOWN = 'Chưa rõ tin đã gửi được chưa — xem khung tin (tự cập nhật) trước khi gửi lại.';
export const ZALO_LOGGED_OUT = 'Zalo của bot đang đăng xuất — vào Tài khoản Zalo để quét QR.';
// Chữ lỗi bot trả (502) khi chưa có phiên Zalo — server.js, control.send/loginCode.
const NOT_LOGGED_IN = /^Zalo chưa đăng nhập$/;

export function failSidecar(res, err) {
  if (err?.name === 'SidecarDown') {
    return res.status(503).json({ ok: false, error: 'Kết nối Zalo đang tắt — đợi 1–2 phút để hệ thống tự bật lại, hoặc báo người cài đặt.' });
  }
  // Quá hạn chờ không có nghĩa là thất bại: bot có thể vẫn đang gửi.
  if (err?.name === 'SidecarTimeout') return res.status(504).json({ ok: false, error: SEND_UNKNOWN });
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  if (status === 502 && NOT_LOGGED_IN.test(String(err?.message || ''))) return res.status(503).json({ ok: false, error: ZALO_LOGGED_OUT });
  // 401/403 từ bot là lỗi khoá kết nối nội bộ — không được để trình duyệt thấy (sẽ bị hiểu là hết phiên đăng nhập).
  if (status >= 400 && status < 500 && status !== 401 && status !== 403) return res.status(status).json({ ok: false, error: err.message });
  console.error('[dashboard]', err);
  if (status === 401 || status === 403) {
    return res.status(502).json({ ok: false, error: 'Dashboard chưa kết nối được với bot (sai khoá kết nối). Hãy chạy lại trình cài đặt hoặc báo người cài đặt.' });
  }
  return res.status(502).json({ ok: false, error: 'Zalo chưa phản hồi đúng — thử lại sau ít phút, nếu vẫn lỗi hãy báo người cài đặt.' });
}

export function failStore(res, err, fallback) {
  if (err?.name === 'StoreUnavailable') return res.status(503).json({ ok: false, error: NO_HISTORY });
  console.error('[dashboard]', err);
  return res.status(500).json({ ok: false, error: fallback });
}
