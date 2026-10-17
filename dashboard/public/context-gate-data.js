export const REASONS = {
  tag_bot: 'Tag đúng bot', call_word: 'Chủ nhân gọi bot', reply_bot: 'Reply trực tiếp bot',
  self: 'Tin do bot gửi', empty: 'Không có nội dung cần xử lý', ignored_sender: 'Người gửi thuộc danh sách bỏ qua',
  group_disabled: 'Nhóm đang tắt bot', owner_only: 'Nhóm chỉ nhận yêu cầu từ chủ nhân',
  no_context: 'Luật đã bỏ: chưa có cuộc trao đổi đang mở với bot', expired: 'Luật đã bỏ: cuộc trao đổi đã quá 5 phút',
  other_sender: 'Luật đã bỏ: khác người đang trao đổi với bot', other_target: 'Luật đã bỏ: tag hoặc reply người khác',
  missing_bot_context: 'Luật đã bỏ: câu trả lời của bot đã ngoài cửa sổ ngữ cảnh',
  probability: 'Model đánh giá ngữ cảnh', unavailable: 'Không phân loại được — bỏ qua',
  direct_address_fallback: 'Model lỗi — cho qua vì tag đúng UID hoặc reply trực tiếp bot',
};
export const MODELS = {
  'gemini/gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (high)',
  'openrouter/typesafe/jev-1.13': 'Jev 1.13', 'typesafe/jev-1.13': 'Jev 1.13', 'typesafe/jev-1.14': 'Jev 1.14',
  'google/gemma-4-26b-a4b-it:free': 'Gemma 26B', 'google/gemma-4-31b-it:free': 'Gemma 31B', custom: 'Model tùy chỉnh',
};
export const STATUSES = { ok: 'Thành công', timeout: 'Hết thời gian', http_error: 'Lỗi HTTP', invalid_response: 'Dữ liệu không hợp lệ', error: 'Không khả dụng' };
export const PROVIDERS = { '9router': '9router', openrouter: 'OpenRouter', cli: 'CLI proxy', custom: 'Dịch vụ tùy chỉnh' };
