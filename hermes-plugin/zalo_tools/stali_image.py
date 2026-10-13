"""Nguồn vẽ ảnh Stali API cho công cụ ``image_generate`` của Hermes.

Stali (https://api.stali.vn/docs) nói chuẩn OpenAI Images, ``req/gpt-image-2`` giá 1.000đ/ảnh:

    POST /v1/images/generations   {"model", "prompt", "size", "n"}
    POST /v1/images/edits         như trên + "image": URL https / data URL (ảnh tham chiếu)

Khoá ``STALI_API_KEY`` đặt ở dashboard (Khoá API & Model) → .env + kho khoá (``key_pool`` đồng bộ vào môi trường
trước mỗi lời gọi công cụ, nên đổi khoá có hiệu lực ngay). Dashboard đặt khoá thì cũng chọn ``image_gen.provider: stali``.
Tuỳ chọn: ``STALI_BASE_URL`` (mặc định https://api.stali.vn/v1), ``STALI_IMAGE_MODEL`` (mặc định req/gpt-image-2).
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

NAME = "stali"
DEFAULT_BASE_URL = "https://api.stali.vn/v1"
DEFAULT_MODEL = "req/gpt-image-2"
TIMEOUT = 300
MAX_REFS = 4
MAX_REF_BYTES = 20 * 1024 * 1024
SIZES = {"landscape": "1536x1024", "square": "1024x1024", "portrait": "1024x1536"}
HINTS = {401: "khoá Stali sai hoặc đã bị thu hồi", 402: "hết số dư ví Stali — nạp thêm tại api.stali.vn",
         404: "sai địa chỉ Stali", 429: "Stali đang giới hạn lượt — thử lại sau"}


def _setting(name: str) -> str:
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret
        try:
            return str(get_secret(name, "") or "").strip()
        except UnscopedSecretError:
            return os.getenv(name, "").strip()
    except Exception:
        return os.getenv(name, "").strip()


def base_url() -> str:
    return (_setting("STALI_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def model() -> str:
    return _setting("STALI_IMAGE_MODEL") or DEFAULT_MODEL


def image_field(ref: str) -> str:
    """URL http(s) và data URL gửi nguyên; tệp trong máy → data URL base64 (qua chốt chặn đọc tệp của Hermes)."""
    ref = ref.strip()
    if ref.lower().startswith(("https://", "http://", "data:")):
        return ref
    from agent.file_safety import raise_if_read_blocked

    raise_if_read_blocked(ref)
    if os.path.getsize(ref) > MAX_REF_BYTES:
        raise ValueError("ảnh tham chiếu quá lớn (tối đa 20 MB)")
    with open(ref, "rb") as fh:
        data = fh.read()
    mime = mimetypes.guess_type(ref)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def build_request(prompt: str, aspect: str, sources: List[str]) -> tuple:
    """(đường dẫn, thân JSON) cho một lần vẽ: có ảnh tham chiếu → /images/edits, không thì /images/generations."""
    body: Dict[str, Any] = {"model": model(), "prompt": prompt, "size": SIZES.get(aspect, SIZES["square"]), "n": 1}
    if not sources:
        return "/images/generations", body
    images = [image_field(s) for s in sources[:MAX_REFS]]
    body["image"] = images[0] if len(images) == 1 else images
    return "/images/edits", body


def error_text(status: int, payload: Any, raw: str = "") -> str:
    """"Stali báo lỗi 402 (hết số dư…): <thông điệp>" — thông điệp cắt ngắn, không kèm khoá."""
    msg = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        msg = str(err.get("message") or err.get("type") or "") if isinstance(err, dict) else str(err or "")
    msg = (msg or raw or "").strip()[:300]
    hint = HINTS.get(status, "")
    return f"Stali báo lỗi {status}{f' ({hint})' if hint else ''}{f': {msg}' if msg else ''}"


def make_provider():
    """Tạo provider (lớp con ImageGenProvider của Hermes) — import muộn để test được mà không có Hermes."""
    from agent.image_gen_provider import (DEFAULT_ASPECT_RATIO, ImageGenProvider, error_response,
                                          normalize_reference_images, resolve_aspect_ratio, save_b64_image,
                                          save_url_image, success_response)

    class StaliImageGenProvider(ImageGenProvider):
        @property
        def name(self) -> str:
            return NAME

        @property
        def display_name(self) -> str:
            return "Stali API"

        def is_available(self) -> bool:
            return bool(_setting("STALI_API_KEY"))

        def list_models(self) -> List[Dict[str, Any]]:
            return [{"id": DEFAULT_MODEL, "display": "GPT Image 2 (Stali)", "speed": "~30-90s",
                     "strengths": "Tạo ảnh và sửa ảnh theo ảnh tham chiếu", "price": "1.000đ/ảnh"}]

        def default_model(self) -> Optional[str]:
            return DEFAULT_MODEL

        def get_setup_schema(self) -> Dict[str, Any]:
            return {"name": "Stali API", "badge": "paid", "tag": "req/gpt-image-2 — 1.000đ/ảnh",
                    "env_vars": [{"key": "STALI_API_KEY", "prompt": "Stali API key (sk-stali-...)", "url": "https://api.stali.vn"}]}

        def capabilities(self) -> Dict[str, Any]:
            return {"modalities": ["text", "image"], "max_reference_images": MAX_REFS}

        def generate(self, prompt: str, aspect_ratio: str = DEFAULT_ASPECT_RATIO, *, image_url: Optional[str] = None,
                     reference_image_urls: Optional[List[str]] = None, **kwargs: Any) -> Dict[str, Any]:
            prompt = (prompt or "").strip()
            aspect = resolve_aspect_ratio(aspect_ratio)
            meta = dict(provider=NAME, model=model(), prompt=prompt, aspect_ratio=aspect)
            if not prompt:
                return error_response(error="Cần mô tả ảnh", error_type="invalid_argument", **meta)
            key = _setting("STALI_API_KEY")
            if not key:
                return error_response(error="Chưa đặt khoá Stali — vào dashboard › Khoá API & Model.", error_type="auth_required", **meta)
            sources = ([image_url.strip()] if isinstance(image_url, str) and image_url.strip() else [])
            sources += normalize_reference_images(reference_image_urls) or []
            try:
                path, body = build_request(prompt, aspect, sources)
            except Exception as exc:
                return error_response(error=f"Không đọc được ảnh tham chiếu: {exc}", error_type="io_error", **meta)

            import requests

            try:
                resp = requests.post(base_url() + path, json=body, timeout=TIMEOUT,
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            except Exception as exc:
                logger.debug("Stali image request failed", exc_info=True)
                return error_response(error=f"Không gọi được Stali API ({type(exc).__name__})", error_type="api_error", **meta)
            try:
                payload = resp.json()
            except ValueError:
                payload = None
            if resp.status_code != 200:
                return error_response(error=error_text(resp.status_code, payload, (resp.text or "")[:300]),
                                      error_type="api_error", **meta)
            try:
                first = payload["data"][0]
            except (TypeError, KeyError, IndexError):
                return error_response(error="Stali không trả ảnh", error_type="empty_response", **meta)
            try:
                if first.get("b64_json"):
                    image = str(save_b64_image(first["b64_json"], prefix="stali_gpt-image-2"))
                elif first.get("url"):
                    image = str(save_url_image(first["url"], prefix="stali_gpt-image-2"))
                else:
                    return error_response(error="Stali không trả ảnh", error_type="empty_response", **meta)
            except Exception as exc:
                return error_response(error=f"Không lưu được ảnh: {exc}", error_type="io_error", **meta)
            extra: Dict[str, Any] = {"size": body["size"]}
            if first.get("revised_prompt"):
                extra["revised_prompt"] = first["revised_prompt"]
            return success_response(image=image, model=body["model"], prompt=prompt, aspect_ratio=aspect, provider=NAME,
                                    modality="image" if sources else "text", extra=extra)

    return StaliImageGenProvider()


def register(ctx) -> None:
    ctx.register_image_gen_provider(make_provider())
