// Mẫu tính cách (SOUL.md) tiếng Việt — dữ liệu ở soul-presets.json: 6 nhóm ngành, mỗi mẫu một khung
// (là ai · tính cách · làm được · cách trả lời · không làm · an toàn). Ghép bằng public/soul-compose.js.
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('./soul-presets.json', import.meta.url), 'utf8'));

export const SOUL_GROUPS = Object.freeze(data.groups);
export const SOUL_PRESETS = Object.freeze(data.presets);
export { MAX_CUSTOM, MAX_PRESETS } from '../public/soul-compose.js';
