import { openSync, fstatSync, readSync, closeSync, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { REASONS, MODELS, STATUSES, PROVIDERS } from '../public/context-gate-data.js';

const MAX_BYTES = 512 * 1024;
const numeric = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const known = (map, value, fallback) => Object.hasOwn(map, value) ? value : fallback;
const CATEGORIES = new Set(['addressed_to_bot', 'follow_up', 'member_conversation', 'new_topic', 'ambiguous']);
function tail(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - MAX_BYTES);
    const buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
    const length = readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, length).toString('utf8').split('\n');
    if (start) lines.shift();
    return lines;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  } finally { if (fd !== undefined) closeSync(fd); }
}

const feedbackError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function createContextGateReader({ file, store, now = Date.now, feedbackFile = file + '.feedback.json' }) {
  function ratings() {
    if (!existsSync(feedbackFile)) return {};
    const raw = readFileSync(feedbackFile, 'utf8');
    if (raw.length > 2 * 1024 * 1024) throw new Error('feedback too large');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid feedback');
    return data;
  }
  function records(thread = null) {
    const parts = [tail(file + '.1'), tail(file)];
    const available = parts.some((p) => p !== null);
    const account = store.available() ? store.currentAccountId() : null;
    if (!account) return { available, items: [] };
    const rows = new Map();
    for (const line of parts.flatMap((p) => p || [])) {
      let raw;
      try { raw = JSON.parse(line); } catch { continue; }
      if (!raw || raw.account !== account || (thread !== null && raw.thread !== thread) || !/^\d{1,32}$/.test(raw.thread) || !/^[a-f0-9]{32}$/.test(raw.id)
          || !numeric(raw.at, now() + 60_000) || !['RESPOND', 'IGNORE'].includes(raw.decision)) continue;
      const row = { id: raw.id, at: raw.at, thread: raw.thread, decision: raw.decision, reason: known(REASONS, raw.reason, 'unavailable'), stages: [] };
      if (CATEGORIES.has(raw.classification)) row.classification = raw.classification;
      if (typeof raw.evidence_ref === 'string' && /^m[0-7]$/.test(raw.evidence_ref)) row.evidence_ref = raw.evidence_ref;
      if (numeric(raw.duration_ms, 60000)) row.duration_ms = raw.duration_ms;
      for (const s of (Array.isArray(raw.stages) ? raw.stages : []).slice(0, 3)) {
        if (!s || typeof s !== 'object') continue;
        const stage = { provider: known(PROVIDERS, s.provider, 'custom'), model: known(MODELS, s.model, 'custom'), status: known(STATUSES, s.status, 'error') };
        if (CATEGORIES.has(s.classification)) stage.classification = s.classification;
        if (typeof s.evidence_ref === 'string' && /^m[0-7]$/.test(s.evidence_ref)) stage.evidence_ref = s.evidence_ref;
        if (numeric(s.duration_ms, 60000)) stage.duration_ms = s.duration_ms;
        if (Number.isInteger(s.http_status) && s.http_status >= 100 && s.http_status <= 599) stage.http_status = s.http_status;
        row.stages.push(stage);
      }
      rows.set(row.id, { ...row, message: raw.message, cli: raw.cli_message });
    }
    const saved = ratings();
    return { available, items: [...rows.values()].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).map((row) => {
      const verdict = saved[`${account}:${row.id}`]?.verdict;
      return { ...row, feedback: ['correct', 'incorrect'].includes(verdict) ? verdict : null };
    }) };
  }
  function list(thread, filter = 'all') {
    const data = records(thread);
    const items = data.items.filter((row) => filter !== 'ignore' || row.decision === 'IGNORE')
      .filter((row) => filter !== 'errors' || row.reason === 'unavailable' || row.stages.some((s) => s.status !== 'ok'))
      .slice(0, 100).map(({ message, cli, thread: _thread, ...row }) => {
      const ref = store.findByMsgId(thread, 1, typeof message === 'string' ? message : '', typeof cli === 'string' ? cli : '');
      return { ...row, ref };
    });
    return { available: data.available, items };
  }
  function feedback(thread, id, verdict) {
    if (!['correct', 'incorrect', null].includes(verdict)) throw feedbackError('Đánh giá không hợp lệ — chọn Đúng hoặc Sai.');
    const row = records(thread).items.find((r) => r.id === id);
    if (!row) throw feedbackError('Quyết định không còn trong nhật ký — tải lại bảng.', 404);
    const account = store.currentAccountId();
    const data = ratings();
    const key = `${account}:${id}`;
    if (verdict === null) delete data[key];
    else data[key] = { verdict, at: now() };
    const bounded = Object.fromEntries(Object.entries(data).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, 5000));
    mkdirSync(dirname(feedbackFile), { recursive: true });
    writeFileSync(feedbackFile + '.tmp', JSON.stringify(bounded));
    renameSync(feedbackFile + '.tmp', feedbackFile);
    return verdict;
  }
  function summary() {
    const data = records();
    const models = new Map();
    for (const row of data.items) for (const stage of row.stages) {
      const key = `${stage.provider}:${stage.model}`;
      if (!models.has(key)) models.set(key, { model: stage.model, provider: stage.provider, calls: 0, succeeded: 0, failed: 0,
        timeouts: 0, respond: 0, ignore: 0, reviewed: 0, correct: 0, falsePositive: 0, falseNegative: 0, durations: [] });
      const m = models.get(key); m.calls += 1;
      if (numeric(stage.duration_ms, 60000)) m.durations.push(stage.duration_ms);
      if (stage.status !== 'ok') { m.failed += 1; if (stage.status === 'timeout') m.timeouts += 1; continue; }
      m.succeeded += 1; m[row.decision === 'RESPOND' ? 'respond' : 'ignore'] += 1;
      if (row.feedback) {
        m.reviewed += 1;
        if (row.feedback === 'correct') m.correct += 1;
        else m[row.decision === 'RESPOND' ? 'falsePositive' : 'falseNegative'] += 1;
      }
    }
    return { available: data.available, events: data.items.length, from: data.items.at(-1)?.at || null, to: data.items[0]?.at || null,
      models: [...models.values()].map(({ durations, ...m }) => {
        durations.sort((a, b) => a - b);
        return { ...m, avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
          p95Ms: durations.length ? durations[Math.ceil(durations.length * .95) - 1] : null };
      }).sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)) };
  }
  return { list, summary, feedback };
}
