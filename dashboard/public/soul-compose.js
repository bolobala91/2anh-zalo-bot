// Ghép SOUL.md từ phần riêng + các mẫu vai trò đã chọn. Dùng chung cho trình duyệt (xem trước) và máy chủ (ghép rồi lưu).
// Nội dung các mẫu nằm ở dashboard/lib/soul-presets.json (dữ liệu, không phải mã) — trình duyệt nhận qua API trang Agent.
// Tách khỏi mã vì Windows Defender từng nhận nhầm tệp .js chứa nhiều đoạn văn mẫu là "ObfusScript" và xoá mất.

export const MAX_PRESETS = 8;
export const MAX_CUSTOM = 6000;

const MULTI = 'Bạn đảm nhận {n} vai trò dưới đây. Mỗi lượt, nhìn nơi đang trò chuyện (tên nhóm, ai đang hỏi, nội dung câu hỏi) '
  + 'để dùng đúng vai trò; chưa rõ thì dùng giọng lịch sự, trung tính. Không đem giọng của vai trò này sang nơi của vai trò khác. '
  + 'Mục "Không làm" và "An toàn" của MỌI vai trò đã chọn luôn áp dụng.';
const ALWAYS = 'Trả lời bằng tiếng Việt tự nhiên (hoặc đúng thứ tiếng người hỏi dùng). Thông tin mới (tin tức, giá, quy định, '
  + '"mới nhất") phải tra cứu rồi mới trả lời, ghi nguồn; không chắc thì nói là chưa chắc, không bịa.';

/** `presets`: [{ id, label, body }]. Trả nội dung SOUL.md ('' khi không có gì). */
export function composeSoul(custom, ids, presets) {
  const picked = (presets || []).filter((p) => (ids || []).includes(p.id));
  const own = String(custom ?? '').replace(/\r\n/g, '\n').trim();
  const parts = [];
  if (own) parts.push(`# Bạn là ai\n${own}`);
  if (picked.length === 1) {
    parts.push(`# Vai trò\n${picked[0].body}`);
  } else if (picked.length > 1) {
    parts.push(`# Vai trò\n${MULTI.replace('{n}', String(picked.length))}`);
    for (const p of picked) parts.push(`## ${p.label}\n${p.body}`);
  }
  if (picked.length || own) parts.push(`# Luôn nhớ\n${ALWAYS}`);
  return parts.join('\n\n');
}
