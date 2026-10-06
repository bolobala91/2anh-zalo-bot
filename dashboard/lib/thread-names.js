/**
 * Tên hội thoại cho dashboard. Tên nhóm lấy từ bot (/control/groups, bot đã đệm 10 phút);
 * dashboard đệm thêm một lớp để vẫn có tên khi kết nối Zalo tắt, và không gọi bot dồn dập khi nó hỏng.
 */
export function fallbackName(threadId, threadType) {
  const tail = String(threadId).slice(-4);
  return threadType === 1 ? `Nhóm …${tail}` : `Người dùng …${tail}`;
}

export function createThreadNames({ loadGroups, ttlMs = 10 * 60_000, retryMs = 60_000, now = Date.now }) {
  let map = new Map();
  let loadedAt = -Infinity;
  let failedAt = -Infinity;
  let inflight = null;
  const due = () => now() - loadedAt >= ttlMs && now() - failedAt >= retryMs;

  function refresh() {
    // Promise.resolve().then(...) để cả lỗi ném đồng bộ cũng đi vào nhánh lỗi, và finally luôn chạy sau khi gán inflight.
    inflight ??= Promise.resolve()
      .then(loadGroups)
      .then((groups) => {
        map = new Map((Array.isArray(groups) ? groups : []).filter((g) => g?.id && g?.name).map((g) => [String(g.id), String(g.name)]));
        loadedAt = now();
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
