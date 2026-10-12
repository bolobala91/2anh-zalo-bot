import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_APIS } from './views/free-apis.js';

test('API miễn phí: mỗi dịch vụ có tên riêng, trang web https và mô tả việc bot dùng', () => {
  const items = FREE_APIS.flatMap((g) => g.items);
  assert.ok(items.length >= 16);
  assert.equal(new Set(items.map((i) => i.name)).size, items.length);
  for (const it of items) {
    assert.match(it.url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//, it.name);
    assert.ok(it.use.length > 10, it.name);
  }
  for (const name of ['Open-Meteo', 'Frankfurter', 'Currency-api', 'Free Dictionary', 'Wiktionary', 'iNaturalist', 'GBIF', 'arXiv', 'Europe PMC', 'Iconify']) {
    assert.ok(items.some((i) => i.name === name), `thiếu ${name}`);
  }
});
