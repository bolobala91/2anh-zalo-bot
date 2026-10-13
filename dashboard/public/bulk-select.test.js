import test from 'node:test';
import assert from 'node:assert/strict';

const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';

test('chọn nhiều: tích/bỏ một mục; chỉ giữ mục đã chọn còn trong danh sách', async () => {
  const { flip, stillPicked } = await import('./views/multi-pick.js');
  const one = flip(new Set(), A);
  assert.deepEqual([...one], [A]);
  assert.deepEqual([...flip(one, A)], []);
  assert.deepEqual([...one], [A], 'không sửa Set cũ');
  assert.deepEqual(stillPicked(new Set([A, C]), [{ uid: A }, { uid: B }]), [A]);
});

test('phân quyền nhiều nhóm: chỉ gửi mục chọn Bật/Tắt, bỏ nút xưởng bị máy chủ khoá, đếm số mục', async () => {
  const { bulkPatch, bulkCount } = await import('./views/permissions.js');
  const features = [{ key: 'web' }, { key: 'files' }];
  const studioFeatures = [{ key: 'studioSlides' }, { key: 'studioVideo' }];
  assert.equal(bulkPatch({}, { features, studioFeatures }), null);
  assert.equal(bulkPatch({ active: 'keep', web: 'keep' }, { features, studioFeatures }), null);
  const p = bulkPatch({ active: 'off', web: 'off', files: 'keep', studioSlides: 'on', studioVideo: 'on' },
    { features, studioFeatures, policy: { videoBlocked: true } });
  assert.deepEqual(p, { active: false, features: { web: false }, studio: { studioSlides: true } });
  assert.equal(bulkCount(p), 3);
  assert.deepEqual(bulkPatch({ replyOnlyTagged: 'on', studioVideo: 'off' }, { features, studioFeatures, policy: { videoBlocked: false } }),
    { replyOnlyTagged: true, studio: { studioVideo: false } });
});

const draft = () => ({
  who: 'list', features: { web: true, video: true }, studio: { studioSlides: false },
  people: [A, B, C].map((uid) => ({ uid, name: '', custom: false, features: { web: true, video: true }, studio: { studioSlides: false } })),
});

test('nhắn riêng nhiều người: bỏ khỏi danh sách rồi hoàn tác đúng chỗ; đặt tính năng giống nhau; về theo chung', async () => {
  const { removePeople, restorePeople, setPeopleFeatures, resetPeople } = await import('./views/dm-permissions.js');
  const d = draft();
  const r = removePeople(d, [A, C]);
  assert.deepEqual(r.draft.people.map((p) => p.uid), [B]);
  assert.deepEqual(r.removed.map((x) => [x.person.uid, x.index]), [[A, 0], [C, 2]]);
  assert.deepEqual(restorePeople(r.draft, r.removed).people.map((p) => p.uid), [A, B, C]);
  assert.equal(d.people.length, 3, 'không sửa bản nháp cũ');

  const set = setPeopleFeatures(d, [A, B], { web: false, video: true }, { studioSlides: true });
  assert.deepEqual(set.people.map((p) => [p.custom, p.features.web, p.studio.studioSlides]), [[true, false, true], [true, false, true], [false, true, false]]);
  set.people[0].features.web = true;
  assert.equal(set.people[1].features.web, false, 'mỗi người một bản sao riêng');

  const back = resetPeople(set, [A]);
  assert.deepEqual(back.people.map((p) => [p.custom, p.features.web, p.studio.studioSlides]), [[false, true, false], [true, false, true], [false, true, false]]);
});

test('hạn mức xưởng nhiều người: đặt cùng số lượt (ô ảnh/video trống = giữ số riêng), kiểm số; bỏ hạn mức riêng', async () => {
  const { removeQuotaPeople, setQuotas } = await import('./views/studio-quota.js');
  const d = { quota: '3', image: '5', video: '1', people: [
    { uid: A, name: 'An', quota: '2', image: '4', video: '' }, { uid: B, name: 'Bình', quota: '1', image: '', video: '' }, { uid: C, name: 'Chi', quota: '0', image: '', video: '' },
  ] };
  const r = setQuotas(d, [A, B], { quota: ' 7 ', image: '', video: '2' });
  assert.deepEqual(r.draft.people.map((p) => [p.quota, p.image, p.video]), [['7', '4', '2'], ['7', '', '2'], ['0', '', '']]);
  assert.match(setQuotas(d, [A], { quota: '' }).error, /Số lượt/);
  assert.match(setQuotas(d, [A], { quota: '99' }).error, /Số lượt/);
  assert.match(setQuotas(d, [A], { quota: '3', image: 'x' }).error, /Ảnh\/video AI/);
  assert.deepEqual(removeQuotaPeople(d, [A, C]).people.map((p) => p.uid), [B]);
});

test('lời mời kết bạn hàng loạt: gọi lần lượt, nghỉ giữa hai lần, báo tiến độ; lỗi một mục không dừng mục sau; câu tóm tắt', async () => {
  const { BULK_DELAY_MS, bulkSummary, runSequential } = await import('./views/contacts.js');
  const calls = [];
  const sleeps = [];
  const progress = [];
  const items = [{ uid: A, name: 'An' }, { uid: B, name: 'Bình' }, { uid: C, name: '' }];
  const res = await runSequential(items, async (r) => { calls.push(r.uid); if (r.uid !== A) throw new Error('Zalo bận'); },
    { sleep: async (ms) => { sleeps.push(ms); }, onProgress: (i, n) => progress.push(`${i}/${n}`) });
  assert.deepEqual(calls, [A, B, C]);
  assert.deepEqual(sleeps, [BULK_DELAY_MS, BULK_DELAY_MS], 'nghỉ giữa các lần, không nghỉ trước lần đầu');
  assert.ok(BULK_DELAY_MS >= 300);
  assert.deepEqual(progress, ['1/3', '2/3', '3/3']);
  assert.deepEqual(res.done.map((r) => r.uid), [A]);
  assert.deepEqual(bulkSummary(res, true), { ok: 'Đã đồng ý 1 lời mời.', error: '2 lời mời chưa xử lý được: Bình (Zalo bận); Chưa rõ tên (Zalo bận)' });
  assert.deepEqual(bulkSummary({ done: items, failed: [] }, false), { ok: 'Đã từ chối 3 lời mời.', error: '' });
});

test('lời chào nhiều nhóm: ghép kết quả lưu vào danh sách, giữ tên đang hiện, hết "chưa lưu"', async () => {
  const { mergeWelcome } = await import('./views/settings.js');
  const groups = [{ id: '200', name: 'Tổ Hoá', enabled: false, message: '', dirty: true }, { id: '300', name: 'Tổ Lý', enabled: false, message: 'cũ', dirty: true }];
  const out = mergeWelcome(groups, [{ id: '200', name: 'tên cũ', enabled: true, message: 'Chào!', batchSize: 3, maxWaitMinutes: 10 }]);
  assert.deepEqual(out[0], { id: '200', name: 'Tổ Hoá', enabled: true, message: 'Chào!', batchSize: 3, maxWaitMinutes: 10, dirty: false });
  assert.equal(out[1], groups[1]);
});

test('câu báo lệnh hàng loạt: số đã xong + tên mục lỗi kèm lý do', async () => {
  const { bulkMessage } = await import('./views/multi-pick.js');
  assert.deepEqual(bulkMessage({ done: [1, 2], failed: [] }), { ok: 'Đã xoá 2 mục.', error: '' });
  assert.deepEqual(bulkMessage({ done: [], failed: [{ id: 'x', error: 'Zalo bận' }, { id: 'y', error: 'Lỗi' }] }, { unit: 'lời nhắc', name: (f) => (f.id === 'x' ? 'Họp tổ' : '') }),
    { ok: '', error: '2 lời nhắc chưa xử lý được: Họp tổ (Zalo bận); Chưa rõ tên (Lỗi)' });
});

test('bộ nhớ trợ lý: mục đã tích → [{ index, old }] để máy chủ kiểm từng mục', async () => {
  const { pickedEntries } = await import('./views/agent-memory.js');
  assert.deepEqual(pickedEntries(['a', 'b', 'c'], new Set([2, 0])), [{ index: 0, old: 'a' }, { index: 2, old: 'c' }]);
  assert.deepEqual(pickedEntries(['a'], new Set([5])), []);
});

test('lịch hẹn hàng loạt: câu báo theo thao tác, tên việc lỗi lấy từ danh sách', async () => {
  const { jobsBulkMessage } = await import('./views/schedules.js');
  const jobs = [{ id: 'aa11bb', name: 'Nhắc nộp bài' }, { id: 'cc22dd', name: 'Báo cáo tuần' }];
  assert.deepEqual(jobsBulkMessage({ done: [{ id: 'aa11bb' }], failed: [{ id: 'cc22dd', error: 'Trợ lý bận' }] }, 'pause', jobs),
    { ok: 'Đã tạm dừng 1 việc.', error: '1 việc chưa xử lý được: Báo cáo tuần (Trợ lý bận)' });
  assert.equal(jobsBulkMessage({ done: [{ id: 'aa11bb' }] }, 'resume', jobs).ok, 'Đã chạy lại 1 việc.');
});

test('sổ người quen: thân xoá nhiều người kèm mốc sửa đã thấy', async () => {
  const { peopleDeletePayload } = await import('./views/memory.js');
  const people = [{ uid: A, updatedAt: 5 }, { uid: B }, { uid: C, updatedAt: 7 }];
  assert.deepEqual(peopleDeletePayload(people, [A, B]), { people: [{ uid: A, updatedAt: 5 }, { uid: B, updatedAt: null }] });
});

test('công cụ: bật/tắt tất cả chỉ đổi công cụ công khai, không sửa nháp cũ', async () => {
  const { setOffMany } = await import('./views/tools.js');
  const tools = [{ name: 'a', toolset: 'zalo_public' }, { name: 'b', toolset: 'zalo_owner' }, { name: 'c', toolset: 'zalo_public' }];
  const draft = new Set(['c']);
  assert.deepEqual([...setOffMany(draft, tools, false)].sort(), ['a', 'c']);
  assert.deepEqual([...setOffMany(draft, tools, true)], []);
  assert.deepEqual([...draft], ['c']);
});

test('MCP: có nút "Bật hết công cụ" khi kết nối đang tắt bớt hoặc chỉ dùng một số công cụ', async () => {
  const { someToolsOff } = await import('./views/mcp.js');
  assert.equal(someToolsOff({ toolsOff: 0, toolsOnly: null }), false);
  assert.equal(someToolsOff({ toolsOff: 2, toolsOnly: null }), true);
  assert.equal(someToolsOff({ toolsOff: 0, toolsOnly: 3 }), true);
});

test('skill hàng loạt: chỉ gửi skill đã chọn cần đổi, bỏ skill lõi', async () => {
  const { skillsToToggle } = await import('./views/skills.js');
  const list = [{ name: 'a', enabled: true }, { name: 'b', enabled: false }, { name: 'core', enabled: true, essential: true }, { name: 'd', enabled: true }];
  assert.deepEqual(skillsToToggle(list, ['a', 'b', 'core'], false).map((s) => s.name), ['a']);
  assert.deepEqual(skillsToToggle(list, ['a', 'b', 'core'], true).map((s) => s.name), ['b']);
});
