/** Bọc hàm async: nếu lần gọi trước còn chạy thì bỏ qua lần này (trả `undefined`) — để nhịp định kỳ không chồng nhau. */
export function singleFlight(fn) {
  let running = false;
  return async (...args) => {
    if (running) return undefined;
    running = true;
    try { return await fn(...args); } finally { running = false; }
  };
}
