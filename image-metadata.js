/**
 * Đọc metadata ảnh (width/height/size) từ byte header — không thêm dependency.
 *
 * Vì sao cần: zca-js gọi options.imageMetadataGetter khi upload ảnh
 * (utils.js getImageMetaData/getGifMetaData). Thiếu getter này thì mọi lệnh
 * gửi ảnh chết ngay với ZaloApiMissingImageMetadataGetter, chưa kịp gọi API
 * Zalo. auth.js và server.js truyền nó vào qua zaloOptions().
 *
 * Hỗ trợ: PNG, JPEG, GIF, BMP, WebP (VP8/VP8L/VP8X). Định dạng khác (vd. JPEG
 * XL) trả null để zca-js báo lỗi rõ ràng thay vì giả kích thước.
 */
import { readFile } from 'node:fs/promises';

function pngSize(buf) {
  // 8-byte signature + 4-byte length + "IHDR" + width(4) + height(4)
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.length < 10) return null;
  const sig = buf.toString('latin1', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function bmpSize(buf) {
  if (buf.length < 26) return null;
  if (buf.readUInt16LE(0) !== 0x424d) return null; // "BM"
  return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const fmt = buf.toString('latin1', 12, 16);
  if (fmt === 'VP8X') return { width: (buf.readUIntLE(24, 3) + 1), height: (buf.readUIntLE(27, 3) + 1) };
  if (fmt === 'VP8 ') {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fmt === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const marker = buf[pos + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 mang frame header.
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) };
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    pos += 2 + len;
  }
  return null;
}

function sizeOf(buf) {
  return pngSize(buf) || jpegSize(buf) || gifSize(buf) || bmpSize(buf) || webpSize(buf);
}

export async function imageMetadataGetter(filePath) {
  try {
    const buf = await readFile(filePath);
    const dims = sizeOf(buf);
    if (!dims?.width || !dims?.height) return null;
    return { width: dims.width, height: dims.height, size: buf.length };
  } catch {
    return null;
  }
}
