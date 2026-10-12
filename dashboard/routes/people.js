// Sổ người quen (spec §18.5) — Quản trị và Chủ bot đều xem/sửa/xoá (§18.2). Mọi lần ghi vào Nhật ký.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { parsePerson } from '../lib/people-store.js';
import { fold } from '../public/fold.js';
import { ZALO_UID } from '../lib/users.js';

const MAX_LIST = 500;

export function peopleRoutes({ people, activity, threadNames }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    if (status >= 400 && status < 600 && status !== 500) return res.status(status).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };
  const log = (req, action, detail) => {
    try { activity.append({ actor: req.user.username, action, detail }); } catch (e) { console.error('[dashboard] không ghi được Nhật ký:', e); }
  };

  /** `updatedAt` khách đã thấy (số hoặc null); không gửi = không kiểm. */
  const seen = (req) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Object.hasOwn(b, 'updatedAt')) return undefined;
    return b.updatedAt === null || Number.isFinite(b.updatedAt) ? b.updatedAt : NaN;
  };

  r.get('/people', requireAuth, async (req, res) => {
    try {
      const q = fold(String(req.query.q ?? '')).trim().slice(0, 100);
      const all = people.list();
      // Nơi dùng mục hồ sơ → chữ dễ hiểu: tên nhóm, "Nhắn riêng" (với chính người đó) hoặc "Nhắn riêng của <tên>".
      let groups = new Map();
      try { groups = await threadNames.load(); } catch { /* tên dự phòng */ }
      const byUid = new Map(all.map((p) => [p.uid, p.name]));
      const label = (uid, place) => {
        if (place === '*') return 'Mọi nơi';
        const id = place.slice(2);
        if (place.startsWith('g:')) return groups.get(id) || `Nhóm …${id.slice(-4)}`;
        return id === uid ? 'Nhắn riêng' : `Nhắn riêng của ${byUid.get(id) || `…${id.slice(-4)}`}`;
      };
      // Lựa chọn "Dùng ở" hiện tại của từng mục (giao diện chọn sẵn): "*" → Mọi nơi, có nơi → Như cũ, không → Chỉ nhắn riêng.
      const useOf = (places) => (places.includes('*') ? 'all' : places.length ? 'keep' : 'dm');
      for (const p of all) {
        for (const f of p.fields) { f.use = useOf(f.places); f.places = f.places.map((x) => label(p.uid, x)); }
        p.noteUse = useOf(p.notePlaces);
        p.notePlaces = p.notePlaces.map((x) => label(p.uid, x));
      }
      const hits = q ? all.filter((p) => fold(`${p.name} ${p.note} ${p.uid} ${p.fields.map((f) => `${f.key} ${f.value}`).join(' ')}`).includes(q)) : all;
      res.json({ ok: true, total: all.length, people: hits.slice(0, MAX_LIST), truncated: hits.length > MAX_LIST });
    } catch (err) { fail(res, err, 'Chưa đọc được sổ người quen — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.put('/people/:uid', requireAuth, (req, res) => {
    try {
      if (!ZALO_UID.test(req.params.uid)) return res.status(400).json({ ok: false, error: 'UID Zalo không hợp lệ — chọn lại người trong danh sách.' });
      const person = people.put(req.params.uid, parsePerson(req.body), req.user.username, { expectedUpdatedAt: seen(req) });
      log(req, 'people_update', person.name || req.params.uid);
      res.json({ ok: true, person });
    } catch (err) { fail(res, err, 'Chưa lưu được hồ sơ — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });

  r.delete('/people/:uid', requireAuth, (req, res) => {
    try {
      if (!ZALO_UID.test(req.params.uid)) return res.status(400).json({ ok: false, error: 'UID Zalo không hợp lệ — chọn lại người trong danh sách.' });
      if (!people.remove(req.params.uid, { expectedUpdatedAt: seen(req) })) return res.status(404).json({ ok: false, error: 'Hồ sơ này không còn — tải lại trang.' });
      log(req, 'people_delete', req.params.uid);
      res.json({ ok: true });
    } catch (err) { fail(res, err, 'Chưa xoá được hồ sơ — thử lại, nếu vẫn lỗi hãy báo người cài đặt.'); }
  });
  return r;
}
