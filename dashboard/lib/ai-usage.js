/**
 * Lượt gọi AI và token theo ngày (spec §16.B) từ CSDL của chính Hermes: `<HERMES_HOME>/state.db`,
 * bảng `session_model_usage` (cộng dồn theo phiên — một phiên có thể kéo dài nhiều tuần, nên KHÔNG
 * chia ngày theo `last_seen`). Cách làm: mỗi lần lấy mẫu đọc TỔNG cộng dồn (chỉ đọc), lấy phần tăng so
 * với lần trước và cộng vào ngày hiện tại (giờ Việt Nam). Lưu ở `<dashboard>/ai-usage.json` (quyền 600).
 * Số liệu bắt đầu từ lần lấy mẫu đầu tiên sau khi cài bản này — không đoán ngược quá khứ.
 * Không có tiền: Hermes ghi chi phí 0/"unknown" với cổng AI tuỳ chỉnh, và 9router dùng chung cho
 * nhiều ứng dụng khác trên máy nên con số của nó không phải của riêng bot.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readJson, writeJsonAtomic } from './json-store.js';

const FIELDS = ['calls', 'input', 'output', 'cached'];
const SQL_USAGE = `SELECT COALESCE(SUM(api_call_count), 0) AS calls, COALESCE(SUM(input_tokens), 0) AS input,
  COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(cache_read_tokens), 0) AS cached FROM session_model_usage`;
// Bản Hermes cũ chưa có session_model_usage: số tổng nằm ngay trên bảng sessions.
const SQL_SESSIONS = SQL_USAGE.replace('session_model_usage', 'sessions');

export class UsageUnavailable extends Error {
  constructor(message) { super(message); this.name = 'UsageUnavailable'; }
}

/** Tổng cộng dồn `{ calls, input, output, cached }` — mở CSDL chỉ đọc rồi đóng ngay. */
export function readUsageTotals(dbPath) {
  if (!existsSync(dbPath)) throw new UsageUnavailable('Chưa có state.db của Hermes');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    let row;
    try { row = db.prepare(SQL_USAGE).get(); } catch { row = db.prepare(SQL_SESSIONS).get(); }
    return Object.fromEntries(FIELDS.map((k) => [k, Number(row[k]) || 0]));
  } finally { db.close(); }
}

/** Ngày theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
export const vnDate = (ms) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export function createAiUsage({ dbPath, file, now = Date.now, keepDays = 30, readTotals = readUsageTotals }) {
  let state = readJson(file, { v: 1, since: null, last: null, days: {} });
  if (!state || typeof state !== 'object' || typeof state.days !== 'object' || state.days === null) state = { v: 1, since: null, last: null, days: {} };
  let error = null;
  const save = () => { try { writeJsonAtomic(file, state); } catch (e) { console.warn('[usage] không ghi được:', e.message); } };

  return {
    /** Lấy một mẫu. Không bao giờ ném lỗi — lỗi đọc được giữ lại để trang hiện câu dễ hiểu. */
    sample() {
      let cur;
      try { cur = readTotals(dbPath); error = null; } catch (e) {
        error = e?.name === 'UsageUnavailable' ? 'missing' : 'unreadable';
        if (error === 'unreadable') console.warn('[usage] không đọc được state.db:', e?.message || e);
        return;
      }
      const t = now();
      if (state.last) {
        const day = vnDate(t);
        const bucket = state.days[day] || Object.fromEntries(FIELDS.map((k) => [k, 0]));
        // Tổng giảm (Hermes dọn phiên cũ, thay CSDL): coi phần giảm là 0, lấy mốc mới.
        for (const k of FIELDS) bucket[k] += Math.max(0, cur[k] - (Number(state.last[k]) || 0));
        state.days[day] = bucket;
        const cut = vnDate(t - (keepDays - 1) * 86_400_000);
        for (const d of Object.keys(state.days)) if (d < cut) delete state.days[d];
      } else {
        state.since = t;
      }
      state.last = cur;
      save();
    },
    /** `{ since, error: null|'missing'|'unreadable', days: [{ date, calls, input, output, cached }] }` — cũ trước. */
    report() {
      return {
        since: state.since,
        error,
        days: Object.entries(state.days).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, ...v })),
      };
    },
  };
}
