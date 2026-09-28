import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { imageMetadataGetter } from './image-metadata.js';
import { zaloOptions } from './auth.js';

const dir = mkdtempSync(join(tmpdir(), 'zalo-imgmeta-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function file(name, buf) {
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}

function png(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpeg(width, height) {
  // SOI, một đoạn APP0 cần nhảy qua, rồi SOF0 mang kích thước.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

function gif(width, height) {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'latin1');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function webpVp8x(width, height) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'latin1');
  buf.write('WEBP', 8, 'latin1');
  buf.write('VP8X', 12, 'latin1');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

test('đọc được kích thước PNG, JPEG, GIF, WebP kèm dung lượng tệp', async () => {
  const cases = [
    ['a.png', png(640, 480), 640, 480],
    ['a.jpg', jpeg(1280, 720), 1280, 720],
    ['a.gif', gif(32, 16), 32, 16],
    ['a.webp', webpVp8x(800, 600), 800, 600],
  ];
  for (const [name, buf, width, height] of cases) {
    assert.deepEqual(await imageMetadataGetter(file(name, buf)), { width, height, size: buf.length }, name);
  }
});

test('tệp không phải ảnh hoặc không tồn tại trả null để zca-js báo lỗi rõ', async () => {
  assert.equal(await imageMetadataGetter(file('x.txt', Buffer.from('không phải ảnh'))), null);
  assert.equal(await imageMetadataGetter(join(dir, 'khong-co.png')), null);
});

test('mọi new Zalo(...) đều nhận imageMetadataGetter, thiếu thì gửi ảnh nổ ZaloApiMissingImageMetadataGetter', () => {
  const options = zaloOptions();
  assert.equal(options.imageMetadataGetter, imageMetadataGetter);
  assert.equal(options.selfListen, true);
  assert.equal(options.logging, false);
});
