/**
 * Tên hội thoại cho dashboard. Tên nhóm lấy từ bot (/control/groups, bot đã đệm 10 phút);
 * dashboard đệm thêm một lớp để vẫn có tên khi kết nối Zalo tắt, và không gọi bot dồn dập khi nó hỏng.
 * Có `file` thì tên đã biết được lưu xuống đĩa: khởi động lại (cập nhật, bảo trì) vẫn hiện tên ngay, nhóm bot đã
 * rời vẫn giữ tên cũ. Giao diện chỉ hiện tên — UID ở lại phía máy chủ.
 */
import { readJson, writeJsonAtomic } from './json-store.js';

export function fallbackName(threadId, threadType) {
  return threadType === 1 ? 'Nhóm chưa rõ tên' : 'Người chưa rõ tên';
}

const MAX_SAVED = 2000;

export function createThreadNames({ loadGroups, file = null, ttlMs = 10 * 60_000, retryMs = 60_000, now = Date.now }) {
  let map = new Map();
  if (file) {
    try {
      const saved = readJson(file, {});
      map = new Map(Object.entries(saved && typeof saved === 'object' ? saved : {})
        .filter(([id, name]) => /^\d+$/.test(id) && typeof name === 'string' && name.trim()));
    } catch { /* tệp hỏng — học lại từ bot */ }
  }
  let loadedAt = -Infinity;
  let failedAt = -Infinity;
  let inflight = null;
  const due = () => now() - loadedAt >= ttlMs && now() - failedAt >= retryMs;

  function refresh() {
    // Promise.resolve().then(...) để cả lỗi ném đồng bộ cũng đi vào nhánh lỗi, và finally luôn chạy sau khi gán inflight.
    inflight ??= Promise.resolve()
      .then(loadGroups)
      .then((groups) => {
        // Bot trả name = id khi Zalo không cho tên nhóm — coi như chưa có tên.
        const fresh = (Array.isArray(groups) ? groups : [])
          .filter((g) => g?.id && g?.name && String(g.name).trim() !== String(g.id))
          .map((g) => [String(g.id), String(g.name)]);
        const before = JSON.stringify([...map]);
        const merged = new Map([...map, ...fresh]);
        map = new Map([...merged].slice(-MAX_SAVED));
        loadedAt = now();
        if (file && JSON.stringify([...map]) !== before) {
          try { writeJsonAtomic(file, Object.fromEntries(map)); } catch (e) { console.warn('[dashboard] không lưu được tên nhóm:', e.message); }
        }
      }, (err) => {
        failedAt = now();
        if (err?.name !== 'SidecarDown') console.warn('[dashboard] chưa lấy được tên nhóm:', err?.message || err);
      })
      .finally(() => { inflight = null; })
      .then(() => map);
    return inflight;
  }

  return {
    /** Tên đang có, không chờ; quá hạn thì làm mới ngầm. */
    cached() { if (due()) refresh(); return map; },
    /** Chờ làm mới khi quá hạn; bot hỏng thì trả tên cũ, không ném lỗi. */
    async load() { if (due()) await refresh(); return map; },
  };
}
