/**
 * Khoá API (trang "Khoá API & Model", chỉ Quản trị): các khoá dịch vụ trong .env của Hermes + khoá cổng AI chính
 * (`model.api_key` trong config.yaml). Trình duyệt chỉ thấy: tên dễ hiểu, dùng cho tính năng nào, đã đặt chưa và 4 ký tự
 * cuối — KHÔNG BAO GIỜ thấy giá trị. "Kiểm tra" gọi một địa chỉ CỐ ĐỊNH của đúng dịch vụ đó (không theo dữ liệu người
 * dùng) và chỉ trả được/không + lý do ngắn. "Thay khoá" chỉ ghi (có .bak), trợ lý cần khởi động lại mới dùng khoá mới.
 */
import { existsSync, readFileSync } from 'node:fs';
import { readConfigYaml, editConfigYaml } from './config-yaml.js';
import { readJson, writeJsonAtomic } from './json-store.js';
import { readEnvAll, SECRET_NAME, SECRET_VALUE, writeSecretEnvKey } from './env-file.js';

export const MODEL_KEY = 'model.api_key';
const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const bearer = (v) => ({ Authorization: `Bearer ${v}` });
/** Khoá quen thuộc: nhãn, tính năng dùng, cách kiểm tra (địa chỉ cố định). */
export const REGISTRY = [
  { key: MODEL_KEY, label: 'Cổng AI chính (9router…)', feature: 'Mọi câu trả lời của bot, giọng đọc, nghe giọng nói, trí nhớ' },
  { key: 'TAVILY_API_KEY', label: 'Tra web — Tavily', feature: 'Tìm kiếm thông tin trên mạng',
    test: (v) => ({ url: 'https://api.tavily.com/search', init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(v) }, body: JSON.stringify({ query: 'ping', max_results: 1 }) } }) },
  { key: 'EXA_API_KEY', label: 'Tra web — Exa', feature: 'Tìm kiếm thông tin trên mạng',
    test: (v) => ({ url: 'https://api.exa.ai/search', init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': v }, body: JSON.stringify({ query: 'ping', numResults: 1 }) } }) },
  { key: 'CORE_API_KEY', label: 'Học thuật — CORE', feature: 'Tra bài báo khoa học, tải PDF',
    test: (v) => ({ url: 'https://api.core.ac.uk/v3/search/works/?q=chemistry&limit=1', init: { headers: bearer(v) } }) },
  { key: 'OPENALEX_API_KEY', label: 'Học thuật — OpenAlex', feature: 'Tra bài báo khoa học (nhiều lượt hơn)' },
  { key: 'GEMINI_API_KEY', label: 'Google Gemini', feature: 'Gọi Gemini trực tiếp (giọng đọc/dự phòng)',
    test: (v) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(v)}`, init: {} }) },
  { key: 'CUSTOM_API_KEY', label: 'Cổng AI tuỳ chỉnh (biến môi trường)', feature: 'Khoá cổng AI đọc từ .env (thường trùng khoá cổng AI chính)' },
  { key: 'VBEE_API_KEY', label: 'Giọng đọc — Vbee', feature: 'Đọc tin nhắn thoại tiếng Việt' },
  { key: 'VBEE_ACCESS_TOKEN', label: 'Giọng đọc — Vbee (token)', feature: 'Đọc tin nhắn thoại tiếng Việt' },
  { key: 'APIFY_TOKEN', label: 'Thu thập web — Apify', feature: 'Đọc Facebook, TikTok, trang khó đọc',
    test: (v) => ({ url: 'https://api.apify.com/v2/users/me', init: { headers: bearer(v) } }) },
  { key: 'STALI_API_KEY', label: 'Tạo ảnh — Stali', feature: 'Vẽ/sửa ảnh khi được nhờ (GPT Image 2, 1.000đ/ảnh). Đặt khoá là bot dùng Stali để vẽ ảnh.',
    test: (v) => ({ url: 'https://api.stali.vn/v1/models', init: { headers: bearer(v) } }) },
  { key: 'ANH_AI_KEY', label: 'Ảnh cho xưởng (2Anh Studio)', feature: 'Tạo ảnh minh hoạ trong slide, tài liệu' },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram', feature: 'Kênh Telegram của trợ lý',
    test: (v) => ({ url: `https://api.telegram.org/bot${v}/getMe`, init: {} }) },
  { key: 'DISCORD_BOT_TOKEN', label: 'Discord', feature: 'Kênh Discord của trợ lý',
    test: (v) => ({ url: 'https://discord.com/api/v10/users/@me', init: { headers: { Authorization: `Bot ${v}` } } }) },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', feature: 'Gọi OpenAI trực tiếp',
    test: (v) => ({ url: 'https://api.openai.com/v1/models', init: { headers: bearer(v) } }) },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic', feature: 'Gọi Claude trực tiếp' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter', feature: 'Gọi model qua OpenRouter',
    test: (v) => ({ url: 'https://openrouter.ai/api/v1/auth/key', init: { headers: bearer(v) } }) },
  { key: 'FIRECRAWL_API_KEY', label: 'Đọc web — Firecrawl', feature: 'Đọc trang web khó' },
  { key: 'ELEVENLABS_API_KEY', label: 'Giọng đọc — ElevenLabs', feature: 'Giọng đọc' },
];
const KNOWN = new Map(REGISTRY.map((r) => [r.key, r]));
// Khoá nội bộ không cho sửa ở đây (đổi sẽ làm đứt kết nối của chính bot / webhook).
const INTERNAL = new Set(['VBEE_WEBHOOK_SECRET', 'OPENVIKING_API_KEY']);

// Khoá chỉ được đọc lúc trợ lý khởi động (kết nối Telegram/Discord, cổng AI) — đổi xong vẫn phải khởi động lại.
// Các khoá khác: plugin đồng bộ kho khoá vào bộ nhớ trợ lý trước mỗi lời gọi công cụ → có hiệu lực ngay.
// STALI_API_KEY: khoá thì có hiệu lực ngay, nhưng đặt/gỡ khoá đổi nguồn vẽ ảnh (image_gen.provider) — trợ lý chỉ
// lập danh sách công cụ lúc tạo phiên, nên khởi động lại để mọi phiên thấy công cụ vẽ ảnh mới.
const NEEDS_RESTART = new Set([MODEL_KEY, 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'CUSTOM_API_KEY', 'STALI_API_KEY']);
export const IMAGE_KEY = 'STALI_API_KEY';
export const IMAGE_PROVIDER = 'stali';
const MAX_POOL = 10;

/** "••••a1b2" — chỉ 4 ký tự cuối, và chỉ khi khoá đủ dài để 4 ký tự không đoán được phần còn lại. */
export const maskTail = (v) => (String(v).length >= 16 ? `••••${String(v).slice(-4)}` : '••••');

export function createAiKeys({ envFile, configFile, poolFile = null, now = Date.now, fetchImpl = fetch }) {
  const modelConf = () => readConfigYaml(configFile)?.model || {};
  // Kho khoá dự phòng (plugin zalo_tools/key_pool.py đọc + tự đổi): { version, keys: { NAME: { active, list: [{ id, value, label, cool_until, last_error }] } } }.
  const readPool = () => { const d = poolFile ? readJson(poolFile, null) : null; return d && typeof d.keys === 'object' && d.keys ? d : { version: 1, keys: {} }; };
  const writePool = (d) => writeJsonAtomic(poolFile, d, { mode: 0o600 });
  const newId = (list) => { let i = list.length + 1; while (list.some((e) => e.id === `k${i}`)) i += 1; return `k${i}`; };
  const eventsFile = () => (poolFile ? poolFile.replace(/key-pool\.json$/, 'key-events.jsonl') : null);
  function events(key) {
    const f = eventsFile();
    if (!f || !existsSync(f)) return [];
    try {
      return readFileSync(f, 'utf8').trim().split('\n').slice(-200).map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e) => e && e.key === key).slice(-5).reverse().map((e) => ({ at: Number(e.at) || 0, from: String(e.from || ''), to: String(e.to || ''), reason: String(e.reason || '').slice(0, 160) }));
    } catch { return []; }
  }
  /** Khoá đang dùng (plugin đồng bộ từ kho) ghi lại vào .env để lần khởi động sau vẫn đúng. */
  function applyActive(key, pool) {
    const e = pool.list.find((x) => x.id === pool.active);
    if (e) writeSecretEnvKey(envFile, key, e.value);
  }
  function poolOf(key, create) {
    if (!poolFile || key === MODEL_KEY) throw err(400, 'Khoá này không dùng kho dự phòng — cổng AI chính tự xoay vòng trong 9router.');
    const data = readPool();
    let pool = data.keys[key];
    if (!pool && create) {
      const cur = String(readEnvAll(envFile)[key] ?? '');
      pool = { active: cur ? 'k1' : '', list: cur ? [{ id: 'k1', value: cur, label: '', cool_until: 0, last_error: '' }] : [] };
      data.keys[key] = pool;
    }
    if (!pool) throw err(404, 'Dịch vụ này chưa có khoá dự phòng.');
    pool.list = Array.isArray(pool.list) ? pool.list.filter((e) => e && typeof e === 'object' && e.id) : [];
    return { data, pool };
  }
  function valueOf(key) {
    if (key === MODEL_KEY) return String(modelConf().api_key || '');
    return String(readEnvAll(envFile)[key] ?? '');
  }
  function editable(key) {
    return key === MODEL_KEY || (SECRET_NAME.test(key) && !INTERNAL.has(key));
  }
  // Nguồn vẽ ảnh trước khi chuyển sang Stali — gỡ khoá Stali thì trả lại đúng nguồn đó.
  const imagePrevFile = () => (poolFile ? poolFile.replace(/key-pool\.json$/, 'image-provider-before-stali.json') : `${envFile}.image-provider-before-stali.json`);
  /** Có khoá Stali → image_gen.provider = stali; gỡ khoá khi đang dùng Stali → trả nguồn cũ. */
  function syncImageProvider(hasKey) {
    const cur = String(readConfigYaml(configFile)?.image_gen?.provider ?? '');
    if (hasKey) {
      if (cur === IMAGE_PROVIDER) return;
      writeJsonAtomic(imagePrevFile(), { provider: cur });
      editConfigYaml(configFile, [{ path: ['image_gen', 'provider'], value: IMAGE_PROVIDER }]);
    } else if (cur === IMAGE_PROVIDER) {
      const prev = String(readJson(imagePrevFile(), null)?.provider ?? '');
      editConfigYaml(configFile, [{ path: ['image_gen', 'provider'], value: prev === IMAGE_PROVIDER ? '' : prev }]);
    }
  }
  return {
    /** Danh sách cho giao diện: khoá quen thuộc trước (kể cả chưa đặt), rồi khoá bí mật khác đang có trong .env. */
    list() {
      const env = readEnvAll(envFile);
      const poolData = readPool();
      const row = (key, known) => {
        const v = key === MODEL_KEY ? String(modelConf().api_key || '') : String(env[key] ?? '');
        const pool = key === MODEL_KEY ? null : poolData.keys[key];
        const entries = pool && Array.isArray(pool.list) ? pool.list.filter((e) => e && e.id && e.value).map((e) => ({
          id: String(e.id), hint: maskTail(e.value), label: String(e.label || '').slice(0, 40), active: e.id === pool.active,
          coolUntil: Number(e.cool_until) > now() / 1000 ? Number(e.cool_until) * 1000 : 0, lastError: String(e.last_error || '').slice(0, 160),
        })) : [];
        return { key, label: known?.label || key, feature: known?.feature || '', known: Boolean(known), set: Boolean(v), hint: v ? maskTail(v) : '',
          pool: entries, events: entries.length ? events(key) : [], restart: NEEDS_RESTART.has(key), poolable: key !== MODEL_KEY && Boolean(poolFile),
          testable: Boolean(known?.test) || key === MODEL_KEY || (Boolean(v) && v === String(modelConf().api_key || '')), editable: editable(key) };
      };
      const known = REGISTRY.filter((r) => r.key === MODEL_KEY || Object.hasOwn(env, r.key) || ['TAVILY_API_KEY', 'CORE_API_KEY', 'GEMINI_API_KEY', IMAGE_KEY].includes(r.key))
        .map((r) => row(r.key, r));
      const others = Object.keys(env).filter((k) => !KNOWN.has(k) && !INTERNAL.has(k) && SECRET_NAME.test(k)).sort().map((k) => row(k, null));
      const more = REGISTRY.filter((r) => !known.some((x) => x.key === r.key)).map((r) => ({ key: r.key, label: r.label, feature: r.feature }));
      return { keys: [...known, ...others], available: more };
    },
    /** Thay (hoặc gỡ khi rỗng) một khoá. Trả `changed`. */
    set(key, value) {
      const k = String(key ?? '');
      if (!editable(k)) throw err(400, 'Khoá này không đổi được ở đây — báo người cài đặt.');
      const v = String(value ?? '').trim();
      if (v && !SECRET_VALUE.test(v)) throw err(400, 'Khoá có ký tự lạ (khoảng trắng, nháy…) — dán lại đúng khoá dịch vụ cấp.');
      if (k === MODEL_KEY && !v) throw err(400, 'Không gỡ được khoá cổng AI chính — bot sẽ ngừng trả lời.');
      if (valueOf(k) === v) return false;
      if (k === MODEL_KEY) editConfigYaml(configFile, [{ path: ['model', 'api_key'], value: v }]);
      else {
        writeSecretEnvKey(envFile, k, v);
        if (poolFile) {
          const data = readPool();
          if (!v) delete data.keys[k];                                   // gỡ khoá = bỏ cả kho dự phòng
          else {
            const pool = data.keys[k] && Array.isArray(data.keys[k].list) ? data.keys[k] : { active: '', list: [] };
            const cur = pool.list.find((e) => e.id === pool.active);
            if (cur) Object.assign(cur, { value: v, cool_until: 0, last_error: '' });
            else { const id = newId(pool.list); pool.list.unshift({ id, value: v, label: '', cool_until: 0, last_error: '' }); pool.active = id; }
            data.keys[k] = pool;
          }
          writePool(data);
        }
        if (k === IMAGE_KEY) syncImageProvider(Boolean(v));
      }
      return true;
    },
    /** Cần khởi động lại trợ lý sau khi đổi khoá này không. */
    needsRestart: (key) => NEEDS_RESTART.has(String(key)),
    /** Thêm khoá dự phòng (cuối danh sách). Chưa có kho thì lấy khoá đang dùng làm khoá đầu. */
    addBackup(key, value, label = '') {
      const k = String(key ?? '');
      if (!editable(k)) throw err(400, 'Khoá này không đổi được ở đây — báo người cài đặt.');
      const v = String(value ?? '').trim();
      if (!SECRET_VALUE.test(v)) throw err(400, 'Khoá có ký tự lạ (khoảng trắng, nháy…) — dán lại đúng khoá dịch vụ cấp.');
      const { data, pool } = poolOf(k, true);
      if (pool.list.some((e) => e.value === v)) throw err(409, 'Khoá này đã có trong danh sách.');
      if (pool.list.length >= MAX_POOL) throw err(400, `Tối đa ${MAX_POOL} khoá cho một dịch vụ.`);
      const id = newId(pool.list);
      pool.list.push({ id, value: v, label: String(label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), cool_until: 0, last_error: '' });
      if (!pool.active) { pool.active = id; applyActive(k, pool); }
      writePool(data);
    },
    /** Dùng khoá này ngay (bỏ trạng thái nghỉ). */
    activate(key, id) {
      const { data, pool } = poolOf(String(key ?? ''), false);
      const e = pool.list.find((x) => x.id === id);
      if (!e) throw err(404, 'Không thấy khoá này — tải lại trang.');
      Object.assign(e, { cool_until: 0, last_error: '' });
      pool.active = e.id;
      writePool(data); applyActive(String(key), pool);
    },
    /** Đổi thứ tự ưu tiên: dir -1 lên, +1 xuống. */
    move(key, id, dir) {
      const { data, pool } = poolOf(String(key ?? ''), false);
      const i = pool.list.findIndex((x) => x.id === id);
      const j = i + (Number(dir) < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= pool.list.length) return;
      [pool.list[i], pool.list[j]] = [pool.list[j], pool.list[i]];
      writePool(data);
    },
    /** Xoá một khoá trong danh sách (khoá đang dùng → chuyển sang khoá kế). Không xoá khoá cuối cùng (dùng "Gỡ khoá"). */
    removeEntry(key, id) {
      const k = String(key ?? '');
      const { data, pool } = poolOf(k, false);
      const i = pool.list.findIndex((x) => x.id === id);
      if (i < 0) throw err(404, 'Không thấy khoá này — tải lại trang.');
      if (pool.list.length < 2) throw err(400, 'Đây là khoá cuối cùng — muốn bỏ hẳn dịch vụ hãy bấm "Gỡ khoá".');
      pool.list.splice(i, 1);
      if (pool.active === id) { pool.active = pool.list[Math.min(i, pool.list.length - 1)].id; applyActive(k, pool); }
      writePool(data);
    },
    /** Kiểm tra một khoá trong danh sách (không đổi khoá đang dùng). */
    async testEntry(key, id) {
      const { pool } = poolOf(String(key ?? ''), false);
      const e = pool.list.find((x) => x.id === id);
      if (!e) throw err(404, 'Không thấy khoá này — tải lại trang.');
      return this.test(String(key), e.value);
    },
    /** Gọi thử dịch vụ bằng khoá đang lưu: { ok, ms, detail }. Không bao giờ trả khoá hay nội dung phản hồi thô. */
    async test(key, override) {
      const k = String(key ?? '');
      const v = override === undefined ? valueOf(k) : String(override);
      if (!v) throw err(400, 'Chưa đặt khoá này.');
      let req;
      // Khoá giống hệt khoá cổng AI chính (vd. GEMINI_API_KEY dùng qua 9router) → kiểm qua cổng AI, không gọi thẳng Google.
      const viaGateway = k === MODEL_KEY || (k !== MODEL_KEY && v === String(modelConf().api_key || ''));
      if (viaGateway) {
        const base = String(modelConf().base_url || '').replace(/\/+$/, '');
        if (!/^https?:\/\//.test(base)) throw err(409, 'config.yaml chưa có model.base_url.');
        req = { url: `${base}/models`, init: { headers: bearer(v) } };
      } else {
        const known = KNOWN.get(k);
        if (!known?.test) throw err(400, 'Dịch vụ này chưa có cách kiểm tra tự động.');
        req = known.test(v);
      }
      const t0 = Date.now();
      try {
        const res = await fetchImpl(req.url, { ...req.init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        const ms = Date.now() - t0;
        if (res.ok) return { ok: true, ms, detail: viaGateway && k !== MODEL_KEY ? 'Khoá hoạt động (dùng qua cổng AI chính).' : 'Khoá hoạt động.' };
        const detail = res.status === 401 || res.status === 403 || (res.status === 400 && k === 'GEMINI_API_KEY') ? 'Khoá sai hoặc đã bị thu hồi.'
          : res.status === 429 ? 'Khoá đúng nhưng đang hết lượt / bị giới hạn — thử lại sau.'
            : res.status === 402 ? 'Khoá đúng nhưng tài khoản hết tiền/hạn mức.' : `Dịch vụ trả lỗi ${res.status}.`;
        return { ok: false, ms, detail };
      } catch {
        return { ok: false, ms: Date.now() - t0, detail: 'Không gọi được dịch vụ (mạng hoặc dịch vụ đang lỗi).' };
      }
    },
  };
}
