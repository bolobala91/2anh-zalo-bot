"""Dùng chung cho test Python: cho Hermes nhận "zalo" là nền tảng hợp lệ khi chạy test.

Lúc chạy thật, Hermes nạp plugin `platforms/zalo` (ở <HERMES_HOME>/plugins/) và đăng ký nền tảng vào platform_registry.
Test import thẳng adapter từ repo nên không đi qua bước đó; trước đây test vẫn chạy được chỉ vì máy dev có bản cài nằm
trong mã Hermes (Hermes quét `plugins/platforms/`). Từ v2.37.0 plugin cài ra ngoài mã Hermes, nên test tự khai báo.
"""


def allow_zalo_platform() -> None:
    try:
        from gateway import config as gw_config
    except ImportError:
        return
    current = getattr(gw_config, "_Platform__bundled_plugin_names", None)
    if current is None:
        current = gw_config.Platform._scan_bundled_plugin_platforms()
    gw_config._Platform__bundled_plugin_names = set(current) | {"zalo"}


allow_zalo_platform()
