/** Danh sách nhóm có tên, đệm 10 phút — getAllGroups chỉ trả ID. */
export function createGroupDirectory({ getApi, now = Date.now, ttlMs = 10 * 60_000 }) {
  let cache = null;
  let inflight = null;
  return {
    clear() { cache = null; inflight = null; },
    async list() {
      const api = getApi();
      if (!api) throw new Error('Zalo chưa đăng nhập');
      if (cache && cache.api === api && now() - cache.at < ttlMs) return cache.groups;
      if (inflight && inflight.api === api) return inflight.promise;
      const mine = { api, promise: fetchAll(api).then((groups) => {
        if (inflight === mine) { cache = { at: now(), groups, api }; inflight = null; }
        return groups;
      }, (err) => { if (inflight === mine) inflight = null; throw err; }) };
      inflight = mine;
      return mine.promise;
    },
  };
  async function fetchAll(api) {
    const ids = Object.keys((await api.getAllGroups())?.gridVerMap || {});
    const groups = [];
    for (let i = 0; i < ids.length; i += 50) {
      const info = (await api.getGroupInfo(ids.slice(i, i + 50)))?.gridInfoMap || {};
      for (const id of ids.slice(i, i + 50)) {
        groups.push({ id, name: String(info[id]?.name || id), members: Number(info[id]?.totalMember) || 0 });
      }
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return groups;
  }
}
