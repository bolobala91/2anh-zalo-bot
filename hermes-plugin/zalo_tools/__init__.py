"""Bộ công cụ Zalo — đăng ký sớm để Hermes công nhận toolset.

Vì sao tách khỏi ``plugins/platforms/zalo``: Hermes nạp mọi plugin
``kind: platform`` theo kiểu lười (xem ``_register_deferred_platform``) để
``hermes chat`` không phải import cả hai chục nền tảng mỗi lần khởi động. Hệ
quả là công cụ do một platform plugin đăng ký chỉ vào registry khi gateway
chạm tới nền tảng đó — muộn hơn lúc Hermes lập danh sách khoá toolset, nên
``zalo`` và ``zalo_public`` bị coi là tên lạ và agent mất sạch công cụ.

Plugin ``standalone`` nạp ngay lúc khám phá, nên đặt công cụ ở đây là đủ.
Adapter nền tảng vẫn nằm bên ``platforms/zalo`` và import lại từ đây.
"""

import logging

from .group_permissions import publish_video_policy
from .tools import (define_cron_member_toolset, define_platform_composite,
                    guard_member_tool_call, register_tools, set_studio_context)

logger = logging.getLogger(__name__)

__all__ = ["register"]


def register(ctx) -> None:
    """Điểm vào plugin — Hermes gọi lúc khám phá."""
    register_tools(ctx)
    # Xưởng tạo sản phẩm gọi AI qua ctx.llm (không công cụ) — giữ ctx để lấy lúc cần.
    set_studio_context(ctx)
    # Dashboard đọc studio-policy.json để khoá nút video: ghi ngay lúc nạp, không đợi lời gọi zalo_studio đầu tiên.
    try:
        publish_video_policy()
    except Exception:  # cố hết sức — không được làm hỏng việc nạp plugin
        logger.warning("[zalo] không ghi được studio-policy.json lúc nạp plugin", exc_info=True)
    # Insight nhóm (spec §18.5): luồng nền nhận yêu cầu tóm tắt từ dashboard qua tệp, gọi ctx.llm không công cụ.
    try:
        from .insight_ai import start_insight_worker
        start_insight_worker(lambda: getattr(ctx, "llm", None))
    except Exception:  # cố hết sức — dashboard sẽ báo "trợ lý chưa trả lời"
        logger.warning("[zalo] không bật được luồng tóm tắt nhóm", exc_info=True)
    # Rào chắn tại điểm thực thi: Hermes cấp lại công cụ đã ghim của phiên nhóm
    # cho mọi lượt, kể cả lượt của người ngoài. Xem guard_member_tool_call().
    ctx.register_hook("pre_tool_call", guard_member_tool_call)
    # Bộ nhớ trợ lý sửa giữa chừng (dashboard / cuộc trò chuyện khác): phiên đang chạy dùng lại lời nhắc cũ đã lưu,
    # nên đính phần chênh vào tin của lượt — xem memory_drift.py.
    try:
        from . import memory_drift
        ctx.register_hook("pre_llm_call", memory_drift.pre_llm_call)
    except Exception:  # cố hết sức — thiếu thì phiên đang chạy chỉ thấy bộ nhớ mới khi bắt đầu phiên mới
        logger.warning("[zalo] không bật được báo bộ nhớ vừa cập nhật", exc_info=True)
    # Kho khoá dự phòng (trang Khoá API & Model): đồng bộ khoá đang dùng vào os.environ trước mỗi lời gọi công cụ,
    # và đổi sang khoá kế khi kết quả công cụ báo lỗi khoá / hết lượt — không cần khởi động lại.
    try:
        from . import key_pool
        key_pool.sync()
        ctx.register_hook("pre_tool_call", key_pool.before_tool_call)
        ctx.register_hook("transform_tool_result", key_pool.on_tool_result)
    except Exception:  # cố hết sức — thiếu kho khoá thì công cụ vẫn chạy với khoá trong .env
        logger.warning("[zalo] không bật được kho khoá dự phòng", exc_info=True)
    # Phải chạy sau register_tools: định nghĩa dựa trên bộ công cụ lõi và
    # cần dọn bộ nhớ đệm của resolve_toolset sau khi registry đã đổi.
    define_platform_composite()
    define_cron_member_toolset()
