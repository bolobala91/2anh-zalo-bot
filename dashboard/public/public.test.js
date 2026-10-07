import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

test('mọi import tương đối trong giao diện đều trỏ tới tệp có thật', () => {
  for (const f of files(root).filter((x) => /\.m?js$/.test(x) && !x.endsWith('.test.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      assert.ok(existsSync(resolve(dirname(f), m[1])), `${f} → ${m[1]}`);
    }
  }
});

test('dải trạng thái và thẻ Zalo: listener đứt → vàng "Đang nối lại", mất phiên/chưa đăng nhập → đỏ', async () => {
  const { statusLevel } = await import('./views/shell.js');
  const { zaloCard } = await import('./views/overview.js');
  const st = (zalo) => ({ sidecar: 'up', assistant: 'connected', zalo: { status: 'logged-in', listener: 'connected', needsRelogin: false, ...zalo } });
  assert.equal(statusLevel(st({})).kind, 'ok');
  assert.equal(zaloCard(st({})).kind, 'ok');
  for (const listener of ['reconnecting', 'closed', 'starting']) {
    const lv = statusLevel(st({ listener }));
    assert.equal(lv.kind, 'warn');
    assert.match(lv.text, /Đang nối lại/);
    assert.equal(zaloCard(st({ listener })).kind, 'warn');
  }
  assert.equal(statusLevel(st({ listener: null })).kind, 'ok');
  for (const bad of [{ needsRelogin: true, listener: 'reconnecting' }, { status: 'idle', listener: null }]) {
    assert.equal(statusLevel(st(bad)).kind, 'danger');
    assert.equal(zaloCard(st(bad)).kind, 'danger');
  }
});

test('tin nhắn: ảnh/tệp hiện nhãn + link https; chữ giữ nguyên, không bao giờ thành HTML hay link lạ', async () => {
  const { messageView, mergeMessages, preview } = await import('./views/chats.js');
  assert.deepEqual(messageView({ msgType: 'chat.photo', text: 'https://photo-stal-1.zdn.vn/a.jpg' }), { label: 'Ảnh', text: '', link: 'https://photo-stal-1.zdn.vn/a.jpg' });
  assert.deepEqual(messageView({ msgType: 'chat.sticker', text: '[Nhãn dán]' }), { label: 'Nhãn dán', text: '', link: null });
  assert.deepEqual(messageView({ msgType: 'webchat', text: '<img src=x onerror=alert(1)>' }), { label: null, text: '<img src=x onerror=alert(1)>', link: null });
  for (const text of ['javascript:alert(1)', 'http://evil.vn', 'data:text/html,x', 'https://a.vn có chữ']) {
    assert.equal(messageView({ msgType: 'webchat', text }).link, null, text);
  }
  assert.deepEqual(mergeMessages([{ id: 2, ts: 5 }, { id: 1, ts: 5 }], [{ id: 2, ts: 5 }, { id: 3, ts: 4 }]).map((m) => m.id), [3, 1, 2]);
  assert.equal(preview({ lastMsgType: 'chat.photo', lastText: 'https://x.zdn.vn/a.jpg', lastIsSelf: true }), 'Bot: [Ảnh]');
  assert.equal(preview({ lastMsgType: 'webchat', lastText: 'Chào', lastIsSelf: false }), 'Chào');
});

test('tô sáng kết quả tìm: tách chữ thành đoạn, không phân biệt hoa thường, giữ nguyên chữ gốc kể cả thẻ HTML', async () => {
  const { markMatches } = await import('./views/chats.js');
  assert.deepEqual(markMatches('Họp lúc 8h, HỌP lại chiều', 'họp'), [
    { text: 'Họp', hit: true }, { text: ' lúc 8h, ', hit: false }, { text: 'HỌP', hit: true }, { text: ' lại chiều', hit: false },
  ]);
  assert.deepEqual(markMatches('<b>x</b> họp', 'họp'), [{ text: '<b>x</b> ', hit: false }, { text: 'họp', hit: true }]);
  assert.deepEqual(markMatches('không có', 'họp'), [{ text: 'không có', hit: false }]);
  assert.deepEqual(markMatches('abc', ''), [{ text: 'abc', hit: false }]);
  // Từ khoá có ký tự đặc biệt của regex/LIKE được so nguyên văn.
  assert.deepEqual(markMatches('a.b axb', 'a.b'), [{ text: 'a.b', hit: true }, { text: ' axb', hit: false }]);
  assert.deepEqual(markMatches('f(x) = (1)', '('), [
    { text: 'f', hit: false }, { text: '(', hit: true }, { text: 'x) = ', hit: false }, { text: '(', hit: true }, { text: '1)', hit: false },
  ]);
  assert.deepEqual(markMatches('giảm 50% hôm nay', '%'), [{ text: 'giảm 50', hit: false }, { text: '%', hit: true }, { text: ' hôm nay', hit: false }]);
  assert.deepEqual(markMatches('abc', '%'), [{ text: 'abc', hit: false }]);
});

test('gấp chữ: không phân biệt dấu, đ → d; tô sáng đúng chữ gốc có dấu dù độ dài khác nhau', async () => {
  const { fold, markMatches, indexOfFolded } = await import('./fold.js');
  assert.equal(fold('Hòa HOÀ hoà'), 'hoa hoa hoa');
  assert.equal(fold('Đoàn Thanh niên'), 'doan thanh nien');
  assert.equal(fold('Học sinh'), fold('hoc sinh'));
  assert.equal(fold('hòa'), 'hoa'); // dấu rời (NFD)
  assert.deepEqual(markMatches('Lớp học sinh giỏi', 'hoc sinh'), [
    { text: 'Lớp ', hit: false }, { text: 'học sinh', hit: true }, { text: ' giỏi', hit: false },
  ]);
  assert.deepEqual(markMatches('ĐOÀN trường', 'doan'), [{ text: 'ĐOÀN', hit: true }, { text: ' trường', hit: false }]);
  assert.deepEqual(markMatches('hoà và hòa', 'hòa'), [
    { text: 'hoà', hit: true }, { text: ' và ', hit: false }, { text: 'hòa', hit: true },
  ]);
  // Chữ gốc dạng tổ hợp (dài hơn chữ gấp): đoạn tô gồm cả dấu rời, ghép lại đúng chữ gốc.
  const nfd = 'xin chào bạn';
  const parts = markMatches(nfd, 'chao');
  assert.deepEqual(parts, [{ text: 'xin ', hit: false }, { text: 'chào', hit: true }, { text: ' bạn', hit: false }]);
  assert.equal(parts.map((p) => p.text).join(''), nfd);
  assert.equal(indexOfFolded('abc Học sinh', 'hoc'), 4);
  assert.equal(indexOfFolded('abc', 'x'), -1);
});

test('Nhật ký: mã kỹ thuật cho Quản trị gọn một dòng, bỏ trường rỗng', async () => {
  const { codeText } = await import('./views/audit.js');
  assert.equal(codeText({ action: 'send', category: 'send', actorUid: '555', threadId: '', error: null }), 'action=send · category=send · actorUid=555');
  assert.equal(codeText(undefined), '');
});

test('giao diện không dùng innerHTML và không có style nội tuyến (CSP)', () => {
  for (const f of files(root).filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/, f);
    assert.doesNotMatch(src, /\sstyle=/, f);
  }
});

test('index.html không tải tài nguyên từ Internet; nạp brand.css sau style.css để màu thương hiệu đè lên', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
  assert.ok(html.indexOf('href="brand.css"') > html.indexOf('href="style.css"'));
  assert.match(html, /id="brand-css"/);
});

test('phân quyền: gộp nhóm của bot với tệp, so thay đổi, nhãn trong danh sách', async () => {
  const { mergeGroups, sameSettings, groupBadge } = await import('./views/permissions.js');
  const on = { web: true, kb: true };
  const perms = {
    defaults: { active: true, replyOnlyTagged: true, features: on },
    groups: {
      '300': { name: 'Tổ Hoá', custom: true, active: true, replyOnlyTagged: false, features: { web: false, kb: true } },
      '400': { name: '', custom: true, active: false, replyOnlyTagged: true, features: on },
    },
  };
  const list = mergeGroups([{ id: '200', name: 'Đoàn trường', members: 40 }, { id: '300', name: 'Tổ Hoá mới', members: 12 }], perms);
  assert.deepEqual(list.map((g) => [g.id, g.name, g.members, g.custom]), [
    ['200', 'Đoàn trường', 40, false], ['300', 'Tổ Hoá mới', 12, true], ['400', 'Nhóm …400', null, true],
  ]);
  assert.deepEqual(list[0].features, on);
  assert.equal(list[1].replyOnlyTagged, false);
  list[0].features.web = false;
  assert.equal(perms.defaults.features.web, true, 'không sửa nhầm vào mặc định');
  assert.equal(sameSettings(perms.defaults, { active: true, replyOnlyTagged: true, features: { kb: true, web: true } }), true);
  assert.equal(sameSettings(perms.defaults, { active: true, replyOnlyTagged: true, features: { kb: true, web: false } }), false);
  assert.deepEqual(groupBadge(list[2]), { kind: 'danger', text: 'Đang tắt' });
  assert.deepEqual(groupBadge(list[1]), { kind: 'warn', text: 'Tắt 1 tính năng' });
  assert.equal(groupBadge({ active: true, custom: false, features: on }), null);
  assert.deepEqual(groupBadge({ active: true, custom: true, features: on }), { kind: 'idle', text: 'Chỉnh riêng' });
  const same = mergeGroups([], { defaults: perms.defaults, groups: { '500': { name: 'Tổ Văn', custom: true, ...perms.defaults } } });
  assert.equal(same[0].custom, false, 'mục trong tệp trùng hẳn mặc định thì không hiện "Chỉnh riêng"');
});

test('phân quyền: hỏi trước khi bỏ thay đổi chưa lưu; nhóm chỉ còn trong tệp về mặc định thì rời danh sách', async () => {
  const { mayLeave, staysListed, LEAVE_MSG, DEFAULTS_KEY } = await import('./views/permissions.js');
  const asked = [];
  const ask = (answer) => (m) => { asked.push(m); return answer; };
  assert.equal(mayLeave(false, ask(false)), true);
  assert.deepEqual(asked, [], 'không có thay đổi thì không hỏi');
  assert.equal(mayLeave(true, ask(false)), false);
  assert.equal(mayLeave(true, ask(true)), true);
  assert.deepEqual(asked, [LEAVE_MSG, LEAVE_MSG]);
  assert.equal(LEAVE_MSG, 'Bạn có thay đổi chưa lưu ở nhóm này. Bỏ thay đổi và chuyển nhóm?');
  const perms = { groups: { '300': {} } };
  assert.equal(staysListed(DEFAULTS_KEY, perms, []), true);
  assert.equal(staysListed('300', perms, []), true, 'còn mục trong tệp');
  assert.equal(staysListed('200', perms, [{ id: '200' }]), true, 'bot còn thấy nhóm');
  assert.equal(staysListed('400', perms, []), false, 'chỉ có trong tệp, vừa về mặc định');
});

test('thương hiệu: thu nhỏ logo giữ tỉ lệ, kiểm loại tệp, câu tương phản', async () => {
  const { fitSize, checkLogoFile, contrastInfo } = await import('./views/brand.js');
  assert.deepEqual(fitSize(1024, 512), { width: 256, height: 128 });
  assert.deepEqual(fitSize(100, 3000), { width: 9, height: 256 });
  assert.deepEqual(fitSize(64, 64), { width: 64, height: 64 }, 'ảnh nhỏ giữ nguyên');
  assert.deepEqual(fitSize(5000, 1), { width: 256, height: 1 });
  assert.equal(checkLogoFile({ type: 'image/png', size: 1000 }), '');
  assert.equal(checkLogoFile({ type: 'image/webp', size: 5 * 1024 * 1024 }), '');
  assert.match(checkLogoFile({ type: 'image/svg+xml', size: 100 }), /không nhận SVG/);
  assert.match(checkLogoFile({ type: 'image/gif', size: 100 }), /PNG, JPG hoặc WebP/);
  assert.match(checkLogoFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.match(checkLogoFile(undefined), /—/);
  assert.deepEqual(contrastInfo('#0F766E'), { hex: '#0f766e', ok: true, text: 'Chữ trắng trên màu này: 5,47 : 1 — dễ đọc.' });
  assert.equal(contrastInfo('#777777').ok, false);
  assert.match(contrastInfo('#777777').text, /4,48 : 1 — dưới 4,5 : 1/);
  assert.deepEqual(contrastInfo('xanh'), { hex: null, ok: false, text: 'Mã màu chưa đúng — nhập dạng #0f766e hoặc chọn một màu gợi ý.' });
});

test('chủ nhân: kiểm UID trước khi gửi, nhãn tên dễ hiểu', async () => {
  const { uidProblem, ownerLabel } = await import('./views/owners.js');
  const A = '1234567890123456';
  assert.equal(uidProblem('2234567890123456', [A]), '');
  assert.match(uidProblem('0912345678', [A]), /không phải số điện thoại/);
  assert.match(uidProblem(A, [A]), /đã là chủ nhân/);
  assert.match(uidProblem('2234567890123456', Array.from({ length: 20 }, (_, i) => String(i))), /Tối đa 20/);
  assert.equal(ownerLabel({ name: 'Cô Hà', dashboardUsers: ['ha'] }), 'Cô Hà · tài khoản dashboard: ha');
  assert.equal(ownerLabel({ name: '', dashboardUsers: ['anh'] }), 'Tài khoản dashboard: anh');
  assert.equal(ownerLabel({ name: '', dashboardUsers: [] }), 'Chưa rõ tên — người này chưa nhắn cho bot');
});

test('thanh bên: đủ mục spec §9 theo đúng nhóm, mục Quản trị chỉ hiện cho Quản trị', async () => {
  const src = readFileSync(join(root, 'views', 'shell.js'), 'utf8');
  const order = ['Tài khoản Zalo', 'Nhật ký', 'Thương hiệu', 'Người dùng', 'Chủ nhân bot', 'Cảnh báo Telegram'].map((t) => src.indexOf(`'${t}'`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), order.join(','));
  assert.match(src, /'\/owners': \{ view: Owners, admin: true \}/);
  assert.match(src, /'\/brand': \{ view: Brand \}/);
});
