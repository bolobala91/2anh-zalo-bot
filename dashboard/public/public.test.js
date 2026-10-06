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

test('index.html không tải tài nguyên từ Internet', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)=["']https?:/);
});
