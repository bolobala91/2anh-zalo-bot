/**
 * Tạo ảnh & video (trang Khoá API & Model, chỉ Quản trị). Ghi `<HERMES_HOME>/zalo/media-engines.json` — plugin
 * zalo_tools/media_engines.py đọc lại theo mtime nên đổi là áp dụng ngay:
 *   - ảnh: nguồn Stali / 9router / ChatGPT (Codex) xếp ưu tiên, bật/tắt từng nguồn, model; lỗi thì sang nguồn bật kế;
 *   - video: Stali (bật/tắt, model, độ dài mặc định).
 * Lưu hoặc đặt khoá Stali thì config.yaml chọn `image_gen.provider: 2anh` + `video_gen.provider: stali`.
 * "Thử" chỉ đọc danh sách model (không tốn tiền); "Vẽ thử" vẽ thật một ảnh (Stali trừ 1.000đ). Khoá không bao giờ ra ngoài.
 */
import { join } from 'node:path';
import { readConfigYaml, editConfigYaml } from './config-yaml.js';
import { readJson, writeJsonAtomic } from './json-store.js';
import { readEnvAll } from './env-file.js';

export const STALI_REF = 'https://api.stali.vn/r/EB3F18B729DA';
export const IMAGE_ENGINES = ['stali', '9router', 'codex'];
export const ENGINE_LABELS = { stali: 'Stali', '9router': '9router', codex: 'ChatGPT (Codex)' };
export const DEFAULT_MODELS = { stali: 'req/gpt-image-2', '9router': 'ag/gemini-3.1-flash-image', codex: 'gpt-image-2-medium' };
// Model video Stali: độ dài cho phép (giây) và giá (đồng) theo tài liệu api.stali.vn/docs.
export const VIDEO_MODELS = {
  'seedance-2.0-fast': { label: 'Seedance 2.0 Fast', seconds: [5, 10, 15], price: { 5: 2200, 10: 3700, 15: 5700 } },
  'seedance-2.5': { label: 'Seedance 2.5', seconds: [5, 10, 15, 20, 25, 30], price: { 5: 2800, 10: 4300, 15: 6300, 20: 9300, 25: 9300, 30: 9300 } },
  'veo-3.1': { label: 'Veo 3.1', seconds: [4, 6, 8], price: { 4: 2500, 6: 2500, 8: 2500 } },
  'google-omni-flash': { label: 'Omni Flash', seconds: [5, 10], price: { 5: 3300, 10: 3300 } },
};
export const DEFAULT_VIDEO = { enabled: true, model: 'seedance-2.0-fast', seconds: 5 };
export const IMAGE_PROVIDER = '2anh';
export const VIDEO_PROVIDER = 'stali';
const STALI_URL = 'https://api.stali.vn/v1';
const ROUTER_URL = 'http://127.0.0.1:20128/v1';
const MODEL_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const DRAW_PROMPT = 'Một bông hoa sen hồng trên mặt hồ buổi sáng, phong cách minh hoạ phẳng, màu tươi sáng';

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export const fitSeconds = (model, s) => {
  const allowed = (VIDEO_MODELS[model] || VIDEO_MODELS[DEFAULT_VIDEO.model]).seconds;
  return [...allowed].sort((a, b) => Math.abs(a - s) - Math.abs(b - s) || a - b)[0];
};

/** Cài đặt hợp lệ — cùng luật với media_engines.normalize (Python). `strict` → giá trị sai ném 400. */
export function normalizeMedia(raw, { strict = false } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const engines = [];
  for (const e of Array.isArray(src.image?.engines) ? src.image.engines : []) {
    if (!e || !IMAGE_ENGINES.includes(e.id) || engines.some((x) => x.id === e.id)) { if (strict && e && !IMAGE_ENGINES.includes(e.id)) throw err(400, 'Nguồn ảnh không hợp lệ.'); continue; }
    const model = String(e.model ?? '').trim();
    if (model && !MODEL_RE.test(model)) { if (strict) throw err(400, 'Tên model chỉ gồm chữ, số và . _ - / : @ +'); }
    engines.push({ id: e.id, enabled: e.enabled !== false, model: model && MODEL_RE.test(model) ? model : DEFAULT_MODELS[e.id] });
  }
  for (const id of IMAGE_ENGINES) if (!engines.some((x) => x.id === id)) engines.push({ id, enabled: true, model: DEFAULT_MODELS[id] });
  const v = src.video && typeof src.video === 'object' ? src.video : {};
  if (strict && v.model !== undefined && !VIDEO_MODELS[v.model]) throw err(400, 'Model video không hợp lệ.');
  const model = VIDEO_MODELS[v.model] ? v.model : DEFAULT_VIDEO.model;
  const seconds = fitSeconds(model, Number.parseInt(v.seconds, 10) || DEFAULT_VIDEO.seconds);
  return { image: { engines }, video: { enabled: v.enabled !== false, model, seconds } };
}

/** config.yaml dùng bộ điều phối ảnh của plugin + video Stali. Trả true nếu vừa đổi (cần khởi động lại trợ lý). */
export function ensureMediaProviders(configFile) {
  const c = readConfigYaml(configFile);
  const edits = [];
  if (String(c?.image_gen?.provider ?? '') !== IMAGE_PROVIDER) edits.push({ path: ['image_gen', 'provider'], value: IMAGE_PROVIDER });
  if (String(c?.video_gen?.provider ?? '') !== VIDEO_PROVIDER) edits.push({ path: ['video_gen', 'provider'], value: VIDEO_PROVIDER });
  if (!edits.length) return false;
  editConfigYaml(configFile, edits);
  return true;
}

export function createMediaEngines({ hermesHome, configFile, envFile, fetchImpl = fetch }) {
  const file = join(hermesHome, 'zalo', 'media-engines.json');
  const statusFile = join(hermesHome, 'zalo', 'media-status.json');
  const env = () => readEnvAll(envFile);
  const modelConf = () => readConfigYaml(configFile)?.model || {};
  const stali = () => ({ base: String(env().STALI_BASE_URL || STALI_URL).replace(/\/+$/, ''), key: String(env().STALI_API_KEY || '') });
  const router = () => {
    const e = env(); const m = modelConf();
    return { base: String(e.ZALO_STUDIO_IMAGE_URL || e.ANH_AI_URL || m.base_url || ROUTER_URL).replace(/\/+$/, ''), key: String(e.ANH_AI_KEY || m.api_key || '') };
  };
  function current() {
    const saved = readJson(file, null);
    const s = normalizeMedia(saved);
    if (!saved) {   // chưa lưu lần nào: 9router dùng model ảnh đang cấu hình cho Studio (giống plugin)
      const m = String(env().ZALO_STUDIO_IMAGE_MODEL || env().ANH_AI_MO_HINH || '');
      if (MODEL_RE.test(m)) s.image.engines.find((x) => x.id === '9router').model = m;
    }
    return s;
  }
  const codexReady = () => readJson(statusFile, null)?.codex === true;
  async function call(url, init, ms) {
    const t0 = Date.now();
    try {
      const res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(ms) });
      let body = null;
      try { body = await res.json(); } catch { /* không phải JSON */ }
      return { res, body, ms: Date.now() - t0 };
    } catch { return { res: null, body: null, ms: Date.now() - t0 }; }
  }
  const why = (status) => (status === 401 || status === 403 ? 'Khoá sai hoặc đã bị thu hồi.' : status === 402 ? 'Hết số dư ví — nạp thêm.'
    : status === 429 ? 'Đang bị giới hạn lượt — thử lại sau.' : status === 404 ? 'Sai địa chỉ cổng.' : `Dịch vụ trả lỗi ${status}.`);
  function target(engine) {
    if (engine === 'stali') { const t = stali(); if (!t.key) throw err(409, 'Chưa đặt khoá Stali.'); return t; }
    if (engine === '9router') return router();
    throw err(400, 'Nguồn này không kiểm tra từ dashboard được.');
  }
  async function listModels(engine) {
    const t = target(engine);
    const { res, body, ms } = await call(`${t.base}/models`, { headers: t.key ? { Authorization: `Bearer ${t.key}` } : {} }, 10_000);
    if (!res) return { ok: false, ms, detail: 'Không gọi được dịch vụ (mạng hoặc dịch vụ đang lỗi).', ids: [] };
    if (!res.ok) return { ok: false, ms, detail: why(res.status), ids: [] };
    const ids = (Array.isArray(body?.data) ? body.data : []).map((m) => String(m?.id || '')).filter(Boolean);
    return { ok: true, ms, ids };
  }

  return {
    file,
    view() {
      const s = current();
      const c = readConfigYaml(configFile);
      return {
        settings: s, refLink: STALI_REF, videoModels: VIDEO_MODELS,
        ready: { stali: Boolean(stali().key), '9router': Boolean(router().base), codex: codexReady() },
        active: { image: String(c?.image_gen?.provider ?? '') === IMAGE_PROVIDER, video: String(c?.video_gen?.provider ?? '') === VIDEO_PROVIDER },
      };
    },
    /** Lưu cài đặt (đầy đủ) → { changedProviders }. */
    save(input) {
      const s = normalizeMedia(input, { strict: true });
      writeJsonAtomic(file, s);
      return { changedProviders: ensureMediaProviders(configFile) };
    },
    /** Danh sách model của một nguồn (Stali: chỉ model ảnh). */
    async models(engine) {
      const r = await listModels(engine);
      return engine === 'stali' ? r.ids.filter((id) => /image/i.test(id)) : r.ids;
    },
    /** "Thử": khoá còn dùng được + model có trong danh sách — không vẽ, không tốn tiền. */
    async test(kind, engine) {
      const s = current();
      if (kind === 'video') {
        const r = await listModels('stali');
        if (!r.ok) return r;
        const m = s.video.model;
        return { ok: true, ms: r.ms, detail: r.ids.includes(m) ? `Khoá dùng được, có model ${m}.` : `Khoá dùng được, nhưng danh sách chưa thấy ${m} — tạo thử một video để chắc.` };
      }
      if (engine === 'codex') {
        return codexReady() ? { ok: true, ms: 0, detail: 'Máy này đã đăng nhập ChatGPT (Codex).' }
          : { ok: false, ms: 0, detail: 'Máy này chưa đăng nhập ChatGPT (Codex) — đăng nhập bằng lệnh `hermes auth` trên máy chủ.' };
      }
      const e = s.image.engines.find((x) => x.id === engine);
      if (!e) throw err(400, 'Nguồn ảnh không hợp lệ.');
      const r = await listModels(engine);
      if (!r.ok) return r;
      return { ok: true, ms: r.ms, detail: r.ids.includes(e.model) ? `Khoá dùng được, có model ${e.model}.` : `Kết nối được, nhưng danh sách model chưa thấy ${e.model} — bấm "Vẽ thử" để chắc.` };
    },
    /** "Vẽ thử": vẽ thật một ảnh nhỏ bằng nguồn này → { ok, ms, image (data URL) | detail }. */
    async draw(engine) {
      const e = current().image.engines.find((x) => x.id === engine);
      if (!e) throw err(400, 'Nguồn ảnh không hợp lệ.');
      const t = target(engine);
      const headers = { 'Content-Type': 'application/json', ...(t.key ? { Authorization: `Bearer ${t.key}` } : {}) };
      const { res, body, ms } = await call(`${t.base}/images/generations`, { method: 'POST', headers, body: JSON.stringify({ model: e.model, prompt: DRAW_PROMPT, size: '1024x1024', n: 1 }) }, 240_000);
      if (!res) return { ok: false, ms, detail: 'Không gọi được dịch vụ hoặc vẽ quá lâu.' };
      if (!res.ok) return { ok: false, ms, detail: why(res.status) };
      const item = Array.isArray(body?.data) ? body.data[0] : null;
      if (item?.b64_json) return { ok: true, ms, detail: `Vẽ được bằng ${e.model}.`, image: `data:image/png;base64,${String(item.b64_json)}` };
      // Ảnh trả qua đường dẫn ngoài: trang chỉ hiện ảnh cùng nguồn/data: (CSP) — báo được, không xem trước.
      if (/^https:\/\//.test(String(item?.url || ''))) return { ok: true, ms, detail: `Vẽ được bằng ${e.model}.` };
      return { ok: false, ms, detail: 'Dịch vụ không trả ảnh.' };
    },
  };
}
