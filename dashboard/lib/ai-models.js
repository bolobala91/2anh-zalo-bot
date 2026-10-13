/**
 * Model AI theo từng chức năng (trang "Khoá API & Model", chỉ Quản trị): đọc config.yaml của Hermes (+ ov.conf của
 * OpenViking nếu bật trí nhớ tự học, + biến ảnh của xưởng) để cho thấy mỗi việc đang dùng model nào, qua đâu.
 * Không hiện khoá, đường dẫn lệnh hay URL đầy đủ (chỉ máy chủ:cổng). "Thử" gửi một câu ngắn tới cổng AI chính.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfigYaml } from './config-yaml.js';
import { MODEL_NAME } from './agent-config.js';

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const str = (v, n = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const hostOf = (url) => { try { return new URL(String(url)).host; } catch { return ''; } };

/** Giọng đọc đang chọn: tts.<provider>.voice hoặc tts.providers.<provider>.voice hoặc tts.voice. */
function ttsVoice(tts) {
  const p = String(tts?.provider || '');
  return str(tts?.[p]?.voice || tts?.providers?.[p]?.voice || tts?.voice || tts?.gemini?.voice || '', 60);
}

export function createAiModels({ configFile, envValue = () => null, ovConf = join(homedir(), '.openviking', 'ov.conf'), fetchImpl = fetch }) {
  const conf = () => readConfigYaml(configFile) || {};
  function openviking(c) {
    if (String(c?.memory?.provider || '') !== 'zalo_memory' || !existsSync(ovConf)) return null;
    try {
      const j = JSON.parse(readFileSync(ovConf, 'utf8'));
      return { embedding: str(j?.embedding?.dense?.model, 80), vlm: str(j?.vlm?.model, 80), via: hostOf(j?.vlm?.api_base || j?.embedding?.dense?.api_base) };
    } catch { return null; }
  }
  return {
    /** Thẻ cho từng chức năng: { id, label, model, via, note }. */
    view() {
      const c = conf();
      const m = c.model || {};
      const tts = c.tts || {};
      const stt = c.stt || {};
      const img = c.image_gen || {};
      const ov = openviking(c);
      const studio = hostOf(envValue('ZALO_STUDIO_IMAGE_URL'));
      const cards = [
        { id: 'main', label: 'Trò chuyện chính', model: str(m.default), via: hostOf(m.base_url) || str(m.provider), note: 'Mọi câu trả lời của bot trong nhóm và tin nhắn riêng.', testable: true, editable: true },
        { id: 'fallback', label: 'Dự phòng khi model chính lỗi', model: str(c.fallback_model?.model || c.fallback_model || ''), via: str(c.fallback_provider || c.fallback_model?.provider || ''), note: 'Bot tự chuyển sang khi model chính không trả lời được.' },
        { id: 'tts', label: 'Giọng đọc (tin nhắn thoại)', model: ttsVoice(tts) ? `giọng ${ttsVoice(tts)}` : '', via: str(tts.provider), note: tts.fallback_provider ? `Dự phòng: ${str(tts.fallback_provider)}.` : '' },
        { id: 'stt', label: 'Nghe giọng nói', model: str(stt?.openai?.model || stt?.model || ''), via: stt.enabled === false ? 'đang tắt' : str(stt.provider), note: 'Chuyển tin nhắn thoại thành chữ.' },
        { id: 'image', label: 'Tạo ảnh', ...(img.provider === 'stali' ? { model: 'req/gpt-image-2', via: 'Stali API' } : { model: str(img.model), via: str(img.provider) }), note: 'Khi được nhờ vẽ/tạo ảnh.' },
        ...(studio ? [{ id: 'studio', label: 'Ảnh cho xưởng (slide, tài liệu)', model: '', via: studio, note: 'Ảnh minh hoạ trong sản phẩm của 2Anh Studio.' }] : []),
        ...(ov ? [{ id: 'memory', label: 'Trí nhớ tự học (OpenViking)', model: ov.vlm, via: ov.via, note: `Rút trí nhớ sau trò chuyện; tìm theo ý nghĩa bằng ${ov.embedding || 'embedding'}.` }] : []),
      ].filter((x) => x.id === 'main' || x.model || x.via);
      return { cards, reasoning: str(c.agent?.reasoning_effort || 'medium', 20) };
    },
    /** Gửi một câu ngắn tới cổng AI chính bằng `model` (mặc định model chính): { ok, ms, reply|detail }. */
    async test(model) {
      const m = conf().model || {};
      const name = String(model || m.default || '').trim();
      if (!MODEL_NAME.test(name)) throw err(400, 'Tên model không hợp lệ.');
      const base = String(m.base_url || '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(base)) throw err(409, 'config.yaml chưa có model.base_url — báo người cài đặt.');
      const t0 = Date.now();
      try {
        const res = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
          headers: { 'Content-Type': 'application/json', ...(m.api_key ? { Authorization: `Bearer ${m.api_key}` } : {}) },
          body: JSON.stringify({ model: name, stream: false, max_tokens: 30, messages: [{ role: 'user', content: 'Trả lời đúng một câu ngắn: "Xin chào, mình sẵn sàng."' }] }),
        });
        const ms = Date.now() - t0;
        let j = null;
        try { j = await res.json(); } catch { /* không phải JSON */ }
        if (!res.ok) return { ok: false, ms, detail: res.status === 401 ? 'Khoá cổng AI sai.' : res.status === 404 ? `Cổng AI không có model ${name}.` : `Cổng AI trả lỗi ${res.status}.` };
        const reply = str(j?.choices?.[0]?.message?.content, 160);
        return reply ? { ok: true, ms, reply } : { ok: false, ms, detail: 'Model trả lời rỗng.' };
      } catch { return { ok: false, ms: Date.now() - t0, detail: 'Không gọi được cổng AI (mạng hoặc hết thời gian chờ).' }; }
    },
  };
}
