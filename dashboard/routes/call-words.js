// Cách gọi bot (Phân quyền Bot): từ khoá chủ nhân gọi bot trong nhóm không cần tag. Quản trị và Chủ bot đều sửa được;
// có hiệu lực ngay (plugin đọc lại tệp khi đổi). Ghi Nhật ký.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';

export function callWordsRoutes({ callWords, sidecar, activity }) {
  const r = express.Router();
  const fail = (res, err) => {
    if (err?.statusCode === 400) return res.status(400).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: 'Chưa đọc/ghi được danh sách cách gọi bot — thử lại.' });
  };
  const log = (req, action, detail) => { try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); } };
  const botName = async () => { try { return (await sidecar.health())?.zalo?.displayName || ''; } catch { return ''; } };

  r.get('/call-words', requireAuth, async (req, res) => {
    try { const name = await botName(); res.json({ ok: true, botName: name, ...callWords.view(name) }); } catch (err) { fail(res, err); }
  });
  r.put('/call-words', requireAuth, async (req, res) => {
    try {
      const words = callWords.save(req.body?.words);
      log(req, 'call_words_save', `${words.length} từ khoá`);
      const name = await botName();
      res.json({ ok: true, botName: name, ...callWords.view(name) });
    } catch (err) { fail(res, err); }
  });
  r.delete('/call-words', requireAuth, async (req, res) => {
    try {
      callWords.reset();
      log(req, 'call_words_reset', 'mặc định theo tên bot');
      const name = await botName();
      res.json({ ok: true, botName: name, ...callWords.view(name) });
    } catch (err) { fail(res, err); }
  });
  return r;
}
