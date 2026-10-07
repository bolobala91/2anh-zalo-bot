import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './json-store.js';

const sha = (v) => createHash('sha256').update(String(v)).digest('hex');
export const maskToken = (tok) => { const [id, rest = ''] = String(tok || '').split(':'); return tok ? `${id}:•••••${rest.slice(-3)}` : ''; };

export function createTelegramApi({ token, fetchImpl = fetch, base = 'https://api.telegram.org' }) {
  async function call(method, body = {}) {
    let json;
    try {
      const res = await fetchImpl(`${base}/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(((body.timeout || 0) + 15) * 1000),
      });
      json = await res.json();
    } catch {
      // Lỗi mạng của fetch có thể chứa URL (có token) — không chuyển tiếp message gốc.
      throw Object.assign(new Error(`Không kết nối được Telegram (${method})`), { network: true });
    }
    if (!json.ok) throw new Error(json.description || `Telegram lỗi ${method}`);
    return json.result;
  }
  return {
    getMe: () => call('getMe'),
    sendMessage: (chatId, text) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }),
    getUpdates: ({ offset = 0, timeout = 0 } = {}) => call('getUpdates', { offset, timeout, allowed_updates: ['message'] }),
  };
}

// isActive(username): người dùng còn tồn tại và chưa bị khoá — người bị khoá/xoá không nhận cảnh báo nữa.
export function createTelegramLinker({ file, apiFactory = (token) => createTelegramApi({ token }), now = Date.now, codeTtlMs = 10 * 60_000, hermesTelegramToken = '', isActive = () => true }) {
  const load = () => readJson(file, { token: '', botUsername: '', offset: 0, links: {}, pending: {} });
  const save = (d) => writeJsonAtomic(file, d);
  const api = () => { const d = load(); return d.token ? apiFactory(d.token) : null; };

  return {
    configured: () => Boolean(load().token),
    settings() { const d = load(); return { botUsername: d.botUsername, tokenMasked: maskToken(d.token), linkedUsers: Object.keys(d.links) }; },
    async setToken(token) {
      const tok = String(token || '').trim();
      if (!/^\d+:[\w-]{3,}$/.test(tok)) throw Object.assign(new Error('Token không đúng dạng — lấy token từ @BotFather.'), { statusCode: 400 });
      if (hermesTelegramToken && tok === hermesTelegramToken) {
        throw Object.assign(new Error('Token này đang dùng cho bot Telegram của trợ lý — tạo một bot riêng cho cảnh báo.'), { statusCode: 400 });
      }
      let me;
      try {
        me = await apiFactory(tok).getMe();
      } catch (err) {
        if (err?.network) throw Object.assign(new Error('Không kết nối được Telegram — kiểm tra mạng của máy chủ rồi thử lại.'), { statusCode: 502 });
        throw Object.assign(new Error('Telegram không nhận token này — kiểm tra lại token lấy từ @BotFather.'), { statusCode: 400 });
      }
      const d = load();
      Object.assign(d, { token: tok, botUsername: me.username, offset: 0, links: d.token === tok ? d.links : {}, pending: {} });
      save(d);
      return { botUsername: me.username };
    },
    clearToken() { save({ token: '', botUsername: '', offset: 0, links: {}, pending: {} }); },
    linkUrl(username) {
      const d = load();
      if (!d.token) throw Object.assign(new Error('Chưa cài bot Telegram cảnh báo — báo người cài đặt.'), { statusCode: 409 });
      const code = randomBytes(12).toString('base64url');
      const t = now();
      for (const [k, p] of Object.entries(d.pending)) if (p.expiresAt < t || p.username === username) delete d.pending[k];
      d.pending[sha(code)] = { username, expiresAt: t + codeTtlMs };
      save(d);
      return `https://t.me/${d.botUsername}?start=${code}`;
    },
    async pollOnce(timeoutSec = 0) {
      const start = load();
      if (!start.token) return 0;
      const tg = apiFactory(start.token);
      const updates = await tg.getUpdates({ offset: start.offset, timeout: timeoutSec });
      // Từ đây đến save(d) không được có await, để không ghi đè thay đổi đồng thời.
      const d = load();
      if (d.token !== start.token) return 0; // token đã bị đổi/gỡ trong lúc chờ
      const confirms = [];
      for (const u of updates) {
        d.offset = Math.max(d.offset, u.update_id + 1);
        if (u.message?.chat?.type !== 'private') continue;
        const m = /^\/start(?:@\w+)?\s+(\S+)/.exec(u.message?.text || '');
        const p = m && d.pending[sha(m[1])];
        if (p && p.expiresAt >= now()) {
          d.links[p.username] = String(u.message.chat.id);
          delete d.pending[sha(m[1])];
          confirms.push([u.message.chat.id, p.username]);
        }
      }
      save(d);
      for (const [chat, username] of confirms) {
        await tg.sendMessage(chat, `Đã nối cảnh báo cho tài khoản "${username}". Khi bot gặp sự cố, bạn sẽ nhận tin ở đây.`).catch(() => {});
      }
      return confirms.length;
    },
    isLinked: (username) => Boolean(load().links[username]),
    chatIds: () => Object.values(load().links),
    async sendTo(username, text) { const tg = api(); const chat = load().links[username]; if (!tg || !chat) throw new Error('Chưa nối Telegram'); await tg.sendMessage(chat, text); },
    /** Gửi cho mọi người đã nối và còn hoạt động; trả về SỐ tin gửi được (0 = không ai nhận, kể cả chưa cài bot). */
    async broadcast(text) {
      const tg = api(); if (!tg) return 0;
      let delivered = 0;
      for (const [username, chat] of Object.entries(load().links)) {
        if (!isActive(username)) continue;
        try { await tg.sendMessage(chat, text); delivered++; } catch (e) { console.warn('[telegram]', e.message); }
      }
      return delivered;
    },
  };
}
