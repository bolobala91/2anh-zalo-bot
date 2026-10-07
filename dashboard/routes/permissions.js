// Phân quyền Bot theo nhóm (spec §7.1, §8): Quản trị và Chủ bot đều xem và sửa (spec §6).
// Lưu là có hiệu lực ngay — plugin đọc lại permissions.json khi tệp đổi.
import express from 'express';
import { requireAuth } from '../lib/http-guards.js';
import { DM_FEATURES, FEATURES, GROUP_ID, parseDm, parseSettings } from '../lib/permissions.js';
import { fallbackName } from '../lib/thread-names.js';
import { failSidecar } from '../lib/route-errors.js';

const SAVE_FAIL = 'Chưa lưu được phân quyền — thử lại, nếu vẫn lỗi hãy báo người cài đặt.';
const READ_FAIL = 'Chưa đọc được phân quyền — tải lại trang, nếu vẫn lỗi hãy báo người cài đặt.';
const label = Object.fromEntries(FEATURES.map((f) => [f.key, f.label]));

/** Một dòng dễ đọc cho Nhật ký: "Hoạt động · chỉ trả lời khi được tag · tắt: Tra cứu web, Video". */
export function describeSettings(s) {
  const off = FEATURES.filter((f) => !s.features[f.key]).map((f) => label[f.key]);
  return [s.active ? 'Hoạt động' : 'Tạm tắt', s.replyOnlyTagged ? 'chỉ trả lời khi được tag' : 'trả lời mọi tin',
    off.length ? `tắt: ${off.join(', ')}` : 'bật mọi tính năng'].join(' · ');
}

export const WHO_LABELS = { owners: 'Chỉ chủ nhân', list: 'Những người trong danh sách', everyone: 'Mọi người' };

/** Dòng Nhật ký cho mục Nhắn riêng: "Chỉ chủ nhân · tắt: Video · 2 người trong danh sách (1 chỉnh riêng)". */
export function describeDm(s) {
  const off = DM_FEATURES.filter((f) => !s.features[f.key]).map((f) => f.label);
  const custom = s.people.filter((p) => p.features).length;
  return [WHO_LABELS[s.who], off.length ? `tắt: ${off.join(', ')}` : 'bật mọi tính năng',
    `${s.people.length} người trong danh sách${custom ? ` (${custom} chỉnh riêng)` : ''}`].join(' · ');
}

export function permissionRoutes({ permissions, sidecar, threadNames, activity }) {
  const r = express.Router();
  const fail = (res, err, fallback) => {
    if (err?.name === 'InvalidPermissions') return res.status(400).json({ ok: false, error: err.message });
    console.error('[dashboard]', err);
    return res.status(500).json({ ok: false, error: fallback });
  };

  r.get('/permissions', requireAuth, (req, res) => {
    try { res.json({ ok: true, features: FEATURES, dmFeatures: DM_FEATURES, ...permissions.get() }); } catch (err) { fail(res, err, READ_FAIL); }
  });

  r.get('/groups', requireAuth, async (req, res) => {
    try {
      const groups = await sidecar.groups();
      res.json({
        ok: true,
        groups: (Array.isArray(groups) ? groups : []).filter((g) => GROUP_ID.test(String(g?.id ?? ''))).map((g) => {
          const id = String(g.id);
          const name = String(g.name || '').trim();
          return { id, name: name && name !== id ? name : fallbackName(id, 1), members: Number(g.members) || 0 };
        }),
      });
    } catch (err) { failSidecar(res, err); }
  });

  r.put('/permissions/defaults', requireAuth, (req, res) => {
    try {
      const s = parseSettings(req.body);
      const state = permissions.setDefaults(s);
      try {
        activity.append({ actor: req.user.username, action: 'permissions_defaults', detail: describeSettings(s) });
      } catch (err) { console.error('[dashboard] không ghi được Nhật ký phân quyền:', err); }
      res.json({ ok: true, features: FEATURES, dmFeatures: DM_FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });

  r.put('/permissions/dm', requireAuth, (req, res) => {
    try {
      const s = parseDm(req.body);
      const state = permissions.setDm(s);
      try {
        activity.append({ actor: req.user.username, action: 'permissions_dm', detail: describeDm(s) });
      } catch (err) { console.error('[dashboard] không ghi được Nhật ký phân quyền:', err); }
      res.json({ ok: true, features: FEATURES, dmFeatures: DM_FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });

  r.put('/permissions/groups/:groupId', requireAuth, async (req, res) => {
    const { groupId } = req.params;
    if (!GROUP_ID.test(groupId)) return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ — chọn lại từ danh sách.' });
    let s;
    try { s = parseSettings(req.body); } catch (err) { return fail(res, err, SAVE_FAIL); }
    try {
      const name = (await threadNames.load()).get(groupId) || '';
      const { state, changed } = permissions.setGroup(groupId, s, name);
      try {
        activity.append({
          actor: req.user.username, action: 'permissions_group',
          detail: `${name || fallbackName(groupId, 1)}: ${changed.length ? describeSettings(s) : 'dùng mặc định'}`,
        });
      } catch (err) { console.error('[dashboard] không ghi được Nhật ký phân quyền:', err); }
      res.json({ ok: true, features: FEATURES, dmFeatures: DM_FEATURES, ...state });
    } catch (err) { fail(res, err, SAVE_FAIL); }
  });

  return r;
}
