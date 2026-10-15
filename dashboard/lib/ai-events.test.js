import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiEvents } from './ai-events.js';

const NOW = Date.UTC(2026, 9, 15, 8, 0); // 15:00 giờ VN
const H = 3600_000;

test('sử dụng AI: đếm vision/ảnh/video, lỗi, theo model, theo ngày, người dùng nhiều nhất (chỉ tên)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'zd-aiev-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'zalo'));
  const e = (h, kind, extra = {}) => JSON.stringify({ t: NOW - h * H, kind, ok: true, uid: '111', name: 'Lan cũ', ...extra });
  writeFileSync(join(dir, 'zalo', 'ai-events.jsonl'), [
    e(1, 'vision', { model: 'hermes', n: 3 }), e(2, 'image', { engine: 'stali', model: 'gpt-image-2', fallbacks: 0 }),
    e(2, 'image', { engine: '9router', model: 'ag/gemini-3.1-flash-image', fallbacks: 1, uid: '222', name: 'Minh' }),
    e(3, 'image', { ok: false, engine: '', model: '', fallbacks: 2 }), e(4, 'video', { engine: 'stali', model: 'seedance', seconds: 5 }),
    e(30, 'image', { engine: 'stali', model: 'gpt-image-2' }), e(1, 'la', {}), 'hỏng',
  ].join('\n'));
  const ev = createAiEvents({ hermesHome: dir, now: () => NOW, personName: (uid) => ({ 111: 'Lan' }[uid] || '') });
  const s = ev.stats(1);
  assert.deepEqual(s.totals.vision, { ok: 1, failed: 0, images: 3, seconds: 0 });
  assert.deepEqual([s.totals.image.ok, s.totals.image.failed], [2, 1]);
  assert.deepEqual([s.totals.video.ok, s.totals.video.seconds], [1, 5]);
  assert.equal(s.fallbacks, 3);
  assert.deepEqual(s.byModel.find((m) => m.model === 'gpt-image-2'), { kind: 'image', engine: 'stali', model: 'gpt-image-2', ok: 1, failed: 0 });
  assert.equal(s.daily.length, 1);
  assert.deepEqual(s.top.map((p) => [p.name, p.total]), [['Lan', 3], ['Minh', 1]]);
  assert.equal(JSON.stringify(s).includes('"111"'), false, 'UID không ra trình duyệt');
  assert.equal(ev.stats(7).totals.image.ok, 3, '7 ngày tính cả hôm qua');
  assert.equal(ev.stats(7).daily.length, 7);
  assert.equal(ev.stats(99).days, 7);
  assert.deepEqual(createAiEvents({ hermesHome: join(dir, 'khong-co') }).stats(1).totals.image, { ok: 0, failed: 0, images: 0, seconds: 0 });
});
