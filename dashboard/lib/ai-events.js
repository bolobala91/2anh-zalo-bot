/**
 * Sử dụng AI ngoài lượt gọi model chính (Tổng quan › Sử dụng AI): đọc ảnh (vision), vẽ ảnh, tạo video — từ sổ
 * `<HERMES_HOME>/zalo/ai-events.jsonl` do plugin ghi (zalo_tools/ai_events.py). Đếm theo loại, theo nguồn + model,
 * lỗi, theo ngày (giờ Việt Nam) và người dùng nhiều nhất. Chỉ tên người ra trình duyệt, UID ở lại máy chủ.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startOfDayVN } from './bot-uses.js';

export const PERIODS = [1, 7, 30];
export const KINDS = ['vision', 'image', 'video'];
const DAY = 86_400_000;
const VN = 7 * 3600_000;
const dateVN = (t) => new Date(t + VN).toISOString().slice(0, 10);

export function parseEvents(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!Number.isFinite(r?.t) || !KINDS.includes(r.kind)) continue;
      out.push({ t: r.t, kind: r.kind, engine: String(r.engine || ''), model: String(r.model || ''), ok: r.ok !== false,
        n: Math.max(1, Number(r.n) || 1), seconds: Number(r.seconds) || 0, fallbacks: Number(r.fallbacks) || 0,
        uid: String(r.uid || ''), name: String(r.name || ''), group: Boolean(r.group), owner: Boolean(r.owner) });
    } catch { /* dòng hỏng: bỏ */ }
  }
  return out;
}

export function summarize(rows, { days, now, personName = () => '' }) {
  const d = PERIODS.includes(Number(days)) ? Number(days) : 7;
  const since = startOfDayVN(now) - (d - 1) * DAY;
  const inRange = rows.filter((r) => r.t >= since);
  const totals = Object.fromEntries(KINDS.map((k) => [k, { ok: 0, failed: 0, images: 0, seconds: 0 }]));
  const models = new Map();
  const daily = new Map();
  const people = new Map();
  let fallbacks = 0;
  for (const r of inRange) {
    const tot = totals[r.kind];
    if (r.ok) tot.ok += 1; else tot.failed += 1;
    if (r.kind === 'vision') tot.images += r.n;
    if (r.kind === 'video' && r.ok) tot.seconds += r.seconds;
    fallbacks += r.fallbacks;
    const mk = `${r.kind}|${r.engine}|${r.model}`;
    const m = models.get(mk) || { kind: r.kind, engine: r.engine, model: r.model, ok: 0, failed: 0 };
    if (r.ok) m.ok += 1; else m.failed += 1;
    models.set(mk, m);
    const day = dateVN(r.t);
    const dd = daily.get(day) || { date: day, vision: 0, image: 0, video: 0 };
    dd[r.kind] += 1;
    daily.set(day, dd);
    if (r.uid && r.ok) {
      const p = people.get(r.uid) || { uid: r.uid, name: r.name, owner: r.owner, vision: 0, image: 0, video: 0, total: 0 };
      p[r.kind] += 1; p.total += 1;
      if (r.name) p.name = r.name;
      people.set(r.uid, p);
    }
  }
  const days_ = [];
  for (let t = since; t <= now; t += DAY) days_.push(daily.get(dateVN(t)) || { date: dateVN(t), vision: 0, image: 0, video: 0 });
  return {
    days: d, since, totals, fallbacks,
    byModel: [...models.values()].sort((a, b) => (b.ok + b.failed) - (a.ok + a.failed)),
    daily: days_,
    top: [...people.values()].sort((a, b) => b.total - a.total).slice(0, 10)
      .map(({ uid, ...p }) => ({ ...p, name: personName(uid) || p.name || 'Chưa rõ tên' })),
  };
}

export function createAiEvents({ hermesHome, personName = () => '', now = Date.now }) {
  const file = join(hermesHome, 'zalo', 'ai-events.jsonl');
  let cache = { mtime: -1, rows: [] };
  function rows() {
    let mtime = 0;
    try { mtime = statSync(file).mtimeMs; } catch { return []; }
    if (mtime !== cache.mtime) cache = { mtime, rows: parseEvents(readFileSync(file, 'utf8')) };
    return cache.rows;
  }
  return { stats: (days = 7) => summarize(rows(), { days, now: now(), personName }) };
}
