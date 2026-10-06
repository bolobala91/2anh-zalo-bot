import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupDirectory } from './group-directory.js';

function fakeApi() {
  const calls = { all: 0, info: 0 };
  return {
    calls,
    getAllGroups: async () => { calls.all += 1; return { gridVerMap: { 2: 1, 1: 1 } }; },
    getGroupInfo: async () => { calls.info += 1; return { gridInfoMap: { 1: { name: 'Zeta', totalMember: 5 }, 2: { name: 'Alpha', totalMember: 7 } } }; },
  };
}

test('danh sách nhóm sắp theo tên và đệm trong 10 phút', async () => {
  const api = fakeApi();
  let t = 0;
  const dir = createGroupDirectory({ getApi: () => api, now: () => t });
  const groups = await dir.list();
  assert.deepEqual(groups, [{ id: '2', name: 'Alpha', members: 7 }, { id: '1', name: 'Zeta', members: 5 }]);
  t = 9 * 60_000;
  await dir.list();
  assert.deepEqual(api.calls, { all: 1, info: 1 });
  t = 11 * 60_000;
  await dir.list();
  assert.equal(api.calls.all, 2);
});

test('chưa đăng nhập thì từ chối', async () => {
  const dir = createGroupDirectory({ getApi: () => null });
  await assert.rejects(dir.list(), /Zalo chưa đăng nhập/);
});
