"""Nguồn tạo ảnh và video (dashboard › Khoá API & Model › Tạo ảnh & video).

Ảnh: danh sách nguồn xếp ưu tiên — ``stali`` (Stali API, req/gpt-image-2), ``9router`` (cổng AI của bot, model tuỳ
chọn), ``codex`` (ChatGPT qua đăng nhập Codex của Hermes). Nguồn tắt hoặc chưa sẵn sàng (thiếu khoá) bị bỏ qua; nguồn
lỗi thì thử nguồn bật kế tiếp. Dùng chung cho công cụ ``image_generate`` (provider ``2anh``) và ảnh AI của 2Anh Studio.

Video: Stali ``/v1/videos`` (Seedance/Veo/Omni) — provider ``stali`` của ``video_generate``.

Cài đặt ở ``<HERMES_HOME>/zalo/media-engines.json`` (dashboard ghi, đọc lại theo mtime — đổi là áp dụng ngay):

    {"image": {"engines": [{"id": "stali", "enabled": true, "model": "req/gpt-image-2"}, ...]},
     "video": {"enabled": true, "model": "seedance-2.0-fast", "seconds": 5}}

Khoá: ``STALI_API_KEY`` (Stali), ``ANH_AI_KEY`` hoặc ``model.api_key`` (9router) — đọc qua kho khoá (đổi khoá có hiệu lực
ngay, khoá dự phòng tự đổi khi lỗi). Lỗi trả về không bao giờ chứa khoá.
"""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

IMAGE_ENGINES = ("stali", "9router", "codex")
ENGINE_LABELS = {"stali": "Stali", "9router": "9router", "codex": "ChatGPT"}
DEFAULT_MODELS = {"stali": "req/gpt-image-2", "9router": "ag/gemini-3.1-flash-image", "codex": "gpt-image-2-medium"}
STALI_URL = "https://api.stali.vn/v1"
NINEROUTER_URL = "http://127.0.0.1:20128/v1"
# Model video Stali → độ dài cho phép (giây). Giá xem dashboard.
VIDEO_MODELS: Dict[str, Tuple[int, ...]] = {
    "seedance-2.0-fast": (5, 10, 15),
    "seedance-2.5": (5, 10, 15, 20, 25, 30),
    "veo-3.1": (4, 6, 8),
    "google-omni-flash": (5, 10),
}
VIDEO_ASPECTS = ("9:16", "16:9", "1:1", "3:4", "4:3", "21:9")
# Stali nhận khung hình qua ``size`` (gửi ``aspect_ratio`` bị từ chối 400 "chưa phù hợp với model"). Veo/Omni chỉ có
# khung dọc/ngang; Seedance có thêm vuông, 3:4, 4:3, 21:9.
VIDEO_SIZES = {"9:16": "720x1280", "16:9": "1280x720", "1:1": "1024x1024", "3:4": "768x1024", "4:3": "1024x768",
               "21:9": "1680x720"}
SEEDANCE_ONLY_SIZES = {"1:1", "3:4", "4:3", "21:9"}


def video_size(model: str, aspect: str) -> Tuple[str, str]:
    """(tỉ lệ thực dùng, size gửi Stali). Tỉ lệ lạ → dọc 9:16; model không có tỉ lệ đó → dọc/ngang gần nhất."""
    aspect = aspect if aspect in VIDEO_SIZES else "9:16"
    if aspect in SEEDANCE_ONLY_SIZES and not model.startswith("seedance"):
        aspect = "16:9" if aspect in ("4:3", "21:9") else "9:16"
    return aspect, VIDEO_SIZES[aspect]
VIDEO_REFS = {"seedance-2.0-fast": 10, "seedance-2.5": 10, "veo-3.1": 3, "google-omni-flash": 3}
DEFAULT_VIDEO = {"enabled": True, "model": "seedance-2.0-fast", "seconds": 5}
SIZES = {"landscape": "1536x1024", "square": "1024x1024", "portrait": "1024x1536"}
IMAGE_TIMEOUT = 300
VIDEO_TIMEOUT = 15 * 60
VIDEO_POLL = 5
MAX_REFS = 4
MAX_REF_BYTES = 20 * 1024 * 1024
MAX_IMAGE_BYTES = 25 * 1024 * 1024
HINTS = {401: "khoá sai hoặc đã bị thu hồi", 402: "hết số dư ví — nạp thêm", 403: "khoá không có quyền",
         404: "sai địa chỉ hoặc model không có", 429: "đang bị giới hạn lượt — thử lại sau"}

_lock = threading.Lock()
_cache: Dict[str, Any] = {"mtime": None, "data": None}


class EngineError(Exception):
    """Một nguồn không tạo được (thông điệp ngắn, tiếng Việt, không chứa khoá)."""


# -- cài đặt -------------------------------------------------------------------------------------------------------

def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path(os.getenv("HERMES_HOME") or Path.home() / ".hermes")


def settings_file() -> Path:
    return _hermes_home() / "zalo" / "media-engines.json"


def status_file() -> Path:
    return _hermes_home() / "zalo" / "media-status.json"


def normalize(raw: Any) -> Dict[str, Any]:
    """Cài đặt hợp lệ: đủ 3 nguồn ảnh (thiếu thì thêm cuối, bật), model chuỗi ngắn; video model/độ dài hợp lệ."""
    src = raw if isinstance(raw, dict) else {}
    image = src.get("image") if isinstance(src.get("image"), dict) else {}
    engines: List[Dict[str, Any]] = []
    for e in image.get("engines") or []:
        if not isinstance(e, dict) or e.get("id") not in IMAGE_ENGINES or any(x["id"] == e["id"] for x in engines):
            continue
        model = str(e.get("model") or "").strip()[:120] or DEFAULT_MODELS[e["id"]]
        engines.append({"id": e["id"], "enabled": e.get("enabled") is not False, "model": model})
    for eid in IMAGE_ENGINES:
        if not any(x["id"] == eid for x in engines):
            engines.append({"id": eid, "enabled": True, "model": DEFAULT_MODELS[eid]})
    video = src.get("video") if isinstance(src.get("video"), dict) else {}
    vmodel = video.get("model") if video.get("model") in VIDEO_MODELS else DEFAULT_VIDEO["model"]
    try:
        seconds = int(video.get("seconds") or DEFAULT_VIDEO["seconds"])
    except (TypeError, ValueError):
        seconds = DEFAULT_VIDEO["seconds"]
    return {"image": {"engines": engines},
            "video": {"enabled": video.get("enabled") is not False, "model": vmodel, "seconds": fit_seconds(vmodel, seconds)}}


def fit_seconds(model: str, seconds: int) -> int:
    allowed = VIDEO_MODELS.get(model) or VIDEO_MODELS[DEFAULT_VIDEO["model"]]
    return min(allowed, key=lambda s: (abs(s - seconds), s))


def settings() -> Dict[str, Any]:
    path = settings_file()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = None
    with _lock:
        if _cache["data"] is not None and _cache["mtime"] == mtime:
            return _cache["data"]
        raw: Any = {}
        if mtime is not None:
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                logger.warning("[zalo] media-engines.json hỏng — dùng mặc định")
        data = normalize(raw)
        if mtime is None:   # chưa lưu lần nào: 9router dùng model ảnh đang cấu hình cho Studio
            env_model = _setting("ZALO_STUDIO_IMAGE_MODEL") or _setting("ANH_AI_MO_HINH")
            if env_model:
                next(e for e in data["image"]["engines"] if e["id"] == "9router")["model"] = env_model[:120]
        _cache.update(mtime=mtime, data=data)
        return data


# -- khoá / địa chỉ -----------------------------------------------------------------------------------------------

def _setting(name: str) -> str:
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret
        try:
            return str(get_secret(name, "") or "").strip()
        except UnscopedSecretError:
            return os.getenv(name, "").strip()
    except Exception:
        return os.getenv(name, "").strip()


def _model_conf() -> Dict[str, Any]:
    try:
        from hermes_cli.config import load_config
        m = (load_config() or {}).get("model")
        return m if isinstance(m, dict) else {}
    except Exception:
        return {}


def stali_target() -> Tuple[str, str]:
    return (_setting("STALI_BASE_URL") or STALI_URL).rstrip("/"), _setting("STALI_API_KEY")


def router_target() -> Tuple[str, str]:
    m = _model_conf()
    url = _setting("ZALO_STUDIO_IMAGE_URL") or _setting("ANH_AI_URL") or str(m.get("base_url") or "") or NINEROUTER_URL
    return url.rstrip("/"), _setting("ANH_AI_KEY") or str(m.get("api_key") or "")


def _codex():
    try:
        from agent.image_gen_registry import get_provider
        return get_provider("openai-codex")
    except Exception:
        return None


def codex_available() -> bool:
    p = _codex()
    try:
        ok = bool(p and p.is_available())
    except Exception:
        ok = False
    try:
        status_file().parent.mkdir(parents=True, exist_ok=True)
        status_file().write_text(json.dumps({"codex": ok, "at": int(time.time())}), encoding="utf-8")
    except OSError:
        pass
    return ok


def ready(engine_id: str) -> bool:
    if engine_id == "stali":
        return bool(stali_target()[1])
    if engine_id == "9router":
        return bool(router_target()[0])
    if engine_id == "codex":
        return codex_available()
    return False


def active_image_engines() -> List[Dict[str, Any]]:
    return [e for e in settings()["image"]["engines"] if e["enabled"] and ready(e["id"])]


# -- vẽ ảnh ---------------------------------------------------------------------------------------------------------

def sniff(data: bytes) -> Optional[str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def image_field(ref: str) -> str:
    """URL http(s) và data URL gửi nguyên; tệp trong máy → data URL base64 (qua chốt chặn đọc tệp của Hermes)."""
    ref = ref.strip()
    if ref.lower().startswith(("https://", "http://", "data:")):
        return ref
    from agent.file_safety import raise_if_read_blocked

    raise_if_read_blocked(ref)
    if os.path.getsize(ref) > MAX_REF_BYTES:
        raise EngineError("ảnh tham chiếu quá lớn (tối đa 20 MB)")
    with open(ref, "rb") as fh:
        data = fh.read()
    mime = mimetypes.guess_type(ref)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def http_error(status: int, payload: Any, raw: str = "") -> str:
    msg = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        msg = str(err.get("message") or err.get("type") or "") if isinstance(err, dict) else str(err or "")
    msg = " ".join((msg or raw or "").split())[:200]
    hint = HINTS.get(status, "")
    return f"lỗi {status}{f' ({hint})' if hint else ''}{f': {msg}' if msg else ''}"


def _openai_image(base: str, key: str, model: str, prompt: str, size: str, refs: List[str]) -> bytes:
    """Gọi chuẩn OpenAI Images (generations, hoặc edits khi có ảnh tham chiếu) → byte ảnh."""
    import requests

    body: Dict[str, Any] = {"model": model, "prompt": prompt, "size": size, "n": 1}
    path = "/images/generations"
    if refs:
        images = [image_field(r) for r in refs[:MAX_REFS]]
        body["image"] = images[0] if len(images) == 1 else images
        path = "/images/edits"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        resp = requests.post(base + path, json=body, headers=headers, timeout=IMAGE_TIMEOUT)
    except Exception as exc:
        raise EngineError(f"không gọi được ({type(exc).__name__})") from None
    try:
        payload = resp.json()
    except ValueError:
        payload = None
    if resp.status_code != 200:
        raise EngineError(http_error(resp.status_code, payload, (resp.text or "")[:200]))
    try:
        first = payload["data"][0]
    except (TypeError, KeyError, IndexError):
        raise EngineError("không trả ảnh") from None
    if first.get("b64_json"):
        try:
            data = base64.b64decode(first["b64_json"])
        except (ValueError, TypeError):
            raise EngineError("trả dữ liệu ảnh hỏng") from None
    elif first.get("url"):
        try:
            got = requests.get(first["url"], timeout=60)
            got.raise_for_status()
            data = got.content
        except Exception as exc:
            raise EngineError(f"không tải được ảnh ({type(exc).__name__})") from None
    else:
        raise EngineError("không trả ảnh")
    if len(data) > MAX_IMAGE_BYTES or not sniff(data):
        raise EngineError("dữ liệu nhận về không phải ảnh")
    return data


def _aspect_of(size: str) -> str:
    try:
        w, h = (int(x) for x in size.lower().split("x", 1))
    except ValueError:
        return "square"
    return "landscape" if w > h else "portrait" if h > w else "square"


def draw_with(engine: Dict[str, Any], prompt: str, size: str, refs: List[str]) -> bytes:
    eid, model = engine["id"], engine["model"]
    if eid == "stali":
        base, key = stali_target()
        if not key:
            raise EngineError("chưa đặt khoá Stali")
        return _openai_image(base, key, model, prompt, size, refs)
    if eid == "9router":
        base, key = router_target()
        return _openai_image(base, key, model, prompt, size, refs)
    if eid == "codex":
        p = _codex()
        if not p:
            raise EngineError("máy này chưa đăng nhập ChatGPT (Codex)")
        r = p.generate(prompt, _aspect_of(size), image_url=refs[0] if refs else None,
                       reference_image_urls=refs[1:] or None)
        if not isinstance(r, dict) or not r.get("success") or not r.get("image"):
            raise EngineError(str((r or {}).get("error") or "không trả ảnh")[:200])
        try:
            data = Path(str(r["image"])).read_bytes()
        except OSError:
            raise EngineError("không đọc được ảnh vừa vẽ") from None
        if not sniff(data):
            raise EngineError("dữ liệu nhận về không phải ảnh")
        return data
    raise EngineError("nguồn lạ")


def draw(prompt: str, *, size: Optional[str] = None, aspect: str = "square",
         refs: Optional[List[str]] = None) -> Dict[str, Any]:
    """Vẽ theo thứ tự ưu tiên: {data, engine, model, fallbacks: ["Stali: lỗi 402 …"]}. Hết nguồn thì EngineError."""
    text = " ".join(str(prompt or "").split())
    if not text:
        raise EngineError("cần mô tả ảnh")
    size = size or SIZES.get(aspect, SIZES["square"])
    refs = [r for r in (refs or []) if isinstance(r, str) and r.strip()]
    engines = active_image_engines()
    if not engines:
        raise EngineError("chưa có nguồn vẽ ảnh nào bật và sẵn sàng — vào dashboard › Khoá API & Model › Tạo ảnh & video")
    failed: List[str] = []
    for engine in engines:
        try:
            data = draw_with(engine, text, size, refs)
        except EngineError as exc:
            failed.append(f"{ENGINE_LABELS[engine['id']]}: {exc}")
            logger.info("[zalo] vẽ ảnh qua %s lỗi — %s", engine["id"], exc)
            continue
        except Exception as exc:  # nguồn ngoài (codex) ném lỗi lạ — vẫn thử nguồn kế
            failed.append(f"{ENGINE_LABELS[engine['id']]}: {type(exc).__name__}")
            logger.warning("[zalo] vẽ ảnh qua %s lỗi", engine["id"], exc_info=True)
            continue
        return {"data": data, "engine": engine["id"], "model": engine["model"], "fallbacks": failed}
    raise EngineError("không nguồn nào vẽ được — " + "; ".join(failed))


# -- video ----------------------------------------------------------------------------------------------------------

def _stali_call(method: str, path: str, **kw):
    import requests

    base, key = stali_target()
    try:
        return requests.request(method, base + path, timeout=120,
                                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, **kw)
    except Exception as exc:
        raise EngineError(f"không gọi được Stali ({type(exc).__name__})") from None


def _json(resp) -> Any:
    try:
        return resp.json()
    except ValueError:
        return None


def submit_video(prompt: str, *, model: Optional[str] = None, seconds: Optional[int] = None, aspect: str = "",
                 refs: Optional[List[str]] = None) -> Dict[str, Any]:
    """Gửi yêu cầu tạo video (Stali trừ tiền ở bước này) → {id, model, seconds, aspect, status, payload}."""
    conf = settings()["video"]
    if not conf["enabled"]:
        raise EngineError("tạo video đang tắt trong dashboard")
    if not stali_target()[1]:
        raise EngineError("chưa đặt khoá Stali")
    model = model if model in VIDEO_MODELS else conf["model"]
    seconds = fit_seconds(model, int(seconds or conf["seconds"]))
    aspect, size = video_size(model, aspect)
    # Chuẩn OpenAI Videos: ``seconds`` là CHUỖI — gửi số kèm ``size`` bị Stali từ chối 400.
    body: Dict[str, Any] = {"model": model, "prompt": " ".join(str(prompt or "").split()), "seconds": str(seconds), "size": size}
    if not body["prompt"]:
        raise EngineError("cần mô tả video")
    refs = [r for r in (refs or []) if isinstance(r, str) and r.strip()][:VIDEO_REFS.get(model, 3)]
    if refs:
        images = [image_field(r) for r in refs]
        body["input_reference"] = images[0] if len(images) == 1 else images
    resp = _stali_call("POST", "/videos", json=body)
    payload = _json(resp)
    if resp.status_code != 200 or not isinstance(payload, dict) or not payload.get("id"):
        raise EngineError(http_error(resp.status_code, payload, (resp.text or "")[:200]) if resp.status_code != 200
                          else "Stali không trả mã việc")
    return {"id": str(payload["id"]), "model": model, "seconds": seconds, "aspect": aspect,
            "status": str(payload.get("status") or ""), "payload": payload}


def wait_video(job: Dict[str, Any], *, timeout: int = VIDEO_TIMEOUT, sleep=time.sleep, clock=time.monotonic) -> bytes:
    """Chờ việc video xong rồi tải MP4 (không trừ thêm tiền)."""
    vid = job["id"]
    payload = job.get("payload") or {}
    status = job.get("status") or ""
    deadline = clock() + timeout
    while status != "completed":
        if status in ("failed", "cancelled", "canceled", "expired"):
            err = payload.get("error") if isinstance(payload, dict) else None
            msg = (err.get("message") if isinstance(err, dict) else err) or status
            raise EngineError(f"Stali không tạo được video: {str(msg)[:200]}")
        if clock() > deadline:
            raise EngineError(f"chờ video quá {timeout // 60} phút (mã việc {vid})")
        sleep(VIDEO_POLL)
        resp = _stali_call("GET", f"/videos/{vid}")
        payload = _json(resp) or {}
        if resp.status_code != 200:
            raise EngineError(http_error(resp.status_code, payload))
        status = str(payload.get("status") or "")
    resp = _stali_call("GET", f"/videos/{vid}/content")
    if resp.status_code != 200 or not resp.content:
        raise EngineError(http_error(resp.status_code, _json(resp)) if resp.status_code != 200 else "video rỗng")
    return resp.content


def make_video(prompt: str, *, model: Optional[str] = None, seconds: Optional[int] = None, aspect: str = "",
               refs: Optional[List[str]] = None, sleep=time.sleep, clock=time.monotonic) -> Dict[str, Any]:
    """Tạo video và chờ tới khi xong (ngoài Zalo: CLI, cron). Trả {data, model, seconds, id, aspect}."""
    job = submit_video(prompt, model=model, seconds=seconds, aspect=aspect, refs=refs)
    data = wait_video(job, sleep=sleep, clock=clock)
    return {"data": data, "model": job["model"], "seconds": job["seconds"], "id": job["id"], "aspect": job["aspect"]}


# -- video chạy nền trong Zalo: trả lời ngay, xong thì tự gửi vào đúng cuộc trò chuyện ----------------------------------

BACKGROUND_TIMEOUT = 60 * 60
MAX_BACKGROUND = 3
_background: Dict[str, Dict[str, Any]] = {}


def _zalo_turn() -> Dict[str, Any]:
    try:
        from .tools import _turn
        turn = _turn()
    except Exception:
        return {}
    return dict(turn) if turn and turn.get("thread_id") else {}


def _send_to_turn(turn: Dict[str, Any], payload: Dict[str, Any]) -> bool:
    """Gửi bằng danh tính của lượt đã nhờ (như xưởng Studio) — kết nối Zalo vẫn kiểm đúng hội thoại."""
    import asyncio

    from .tools import THREAD_GROUP, THREAD_USER, _TURN, _invoke

    async def run() -> str:
        token = _TURN.set(dict(turn))
        try:
            return await _invoke("sendMessage", [payload, str(turn.get("thread_id") or ""),
                                                 THREAD_GROUP if turn.get("is_group") else THREAD_USER])
        finally:
            _TURN.reset(token)

    try:
        return bool(json.loads(asyncio.run(run())).get("success"))
    except Exception:
        logger.warning("[zalo] gửi kết quả video vào Zalo lỗi", exc_info=True)
        return False


def _finish_in_background(turn: Dict[str, Any], job: Dict[str, Any], prompt: str, save, wait=wait_video, send=_send_to_turn) -> None:
    try:
        data = wait(job, timeout=BACKGROUND_TIMEOUT)
        path = save(data, prefix=f"stali_{job['model']}")
        caption = f"🎬 Video {job['seconds']} giây: {prompt[:150]}"
        if not send(turn, {"msg": caption, "attachments": [str(path)]}):
            send(turn, {"msg": "Video đã tạo xong nhưng chưa gửi được vào đây — chủ nhân xem lại kết nối Zalo giúp em nhé."})
        logger.info("[zalo] video %s đã xong và gửi vào %s", job["id"], turn.get("thread_id"))
    except EngineError as exc:
        logger.warning("[zalo] video %s lỗi — %s", job["id"], exc)
        send(turn, {"msg": f"Chưa tạo được video ({exc})."})
    except Exception:
        logger.warning("[zalo] video %s lỗi", job["id"], exc_info=True)
        send(turn, {"msg": "Chưa tạo được video do lỗi trong lúc chờ kết quả."})
    finally:
        _background.pop(job["id"], None)


def start_background(turn: Dict[str, Any], job: Dict[str, Any], prompt: str, save) -> None:
    _background[job["id"]] = {"thread_id": turn.get("thread_id"), "since": time.time()}
    threading.Thread(target=_finish_in_background, args=(turn, job, prompt, save), daemon=True,
                     name=f"zalo-video-{job['id'][-6:]}").start()


# -- provider cho Hermes ----------------------------------------------------------------------------------------------

def make_image_provider():
    from agent.image_gen_provider import (DEFAULT_ASPECT_RATIO, ImageGenProvider, error_response,
                                          normalize_reference_images, resolve_aspect_ratio, save_b64_image,
                                          success_response)

    class RouterImageGenProvider(ImageGenProvider):
        @property
        def name(self) -> str:
            return "2anh"

        @property
        def display_name(self) -> str:
            return "2Anh (Stali / 9router / ChatGPT)"

        def is_available(self) -> bool:
            return bool(active_image_engines())

        def list_models(self) -> List[Dict[str, Any]]:
            return [{"id": e["model"], "display": f"{ENGINE_LABELS[e['id']]} — {e['model']}", "speed": "", "strengths": "",
                     "price": ""} for e in settings()["image"]["engines"]]

        def default_model(self) -> Optional[str]:
            first = active_image_engines()
            return first[0]["model"] if first else None

        def capabilities(self) -> Dict[str, Any]:
            return {"modalities": ["text", "image"], "max_reference_images": MAX_REFS}

        def generate(self, prompt: str, aspect_ratio: str = DEFAULT_ASPECT_RATIO, *, image_url: Optional[str] = None,
                     reference_image_urls: Optional[List[str]] = None, **kwargs: Any) -> Dict[str, Any]:
            aspect = resolve_aspect_ratio(aspect_ratio)
            refs = ([image_url] if isinstance(image_url, str) and image_url.strip() else [])
            refs += normalize_reference_images(reference_image_urls) or []
            try:
                got = draw(prompt, aspect=aspect, refs=refs)
            except EngineError as exc:
                return error_response(error=f"Chưa vẽ được ảnh: {exc}", error_type="api_error", provider="2anh",
                                      prompt=prompt or "", aspect_ratio=aspect)
            path = save_b64_image(base64.b64encode(got["data"]).decode("ascii"), prefix=f"2anh_{got['engine']}",
                                  extension=sniff(got["data"]) or "png")
            extra: Dict[str, Any] = {"engine": ENGINE_LABELS[got["engine"]]}
            if got["fallbacks"]:
                extra["note"] = "Nguồn ưu tiên lỗi nên đã dùng nguồn dự phòng: " + "; ".join(got["fallbacks"])
            return success_response(image=str(path), model=got["model"], prompt=prompt, aspect_ratio=aspect,
                                    provider=f"2anh/{got['engine']}", modality="image" if refs else "text", extra=extra)

    return RouterImageGenProvider()


def make_video_provider():
    from agent.video_gen_provider import VideoGenProvider, error_response, save_bytes_video, success_response

    class StaliVideoGenProvider(VideoGenProvider):
        @property
        def name(self) -> str:
            return "stali"

        @property
        def display_name(self) -> str:
            return "Stali API"

        def is_available(self) -> bool:
            return settings()["video"]["enabled"] and bool(stali_target()[1])

        def list_models(self) -> List[Dict[str, Any]]:
            return [{"id": m, "display": m} for m in VIDEO_MODELS]

        def default_model(self) -> Optional[str]:
            return settings()["video"]["model"]

        def capabilities(self) -> Dict[str, Any]:
            return {"modalities": ["text", "image"], "aspect_ratios": list(VIDEO_ASPECTS),
                    "resolutions": ["720p"], "max_duration": 30, "min_duration": 4, "supports_audio": False,
                    "supports_negative_prompt": False, "max_reference_images": 3}

        def generate(self, prompt: str, *, model: Optional[str] = None, image_url: Optional[str] = None,
                     reference_image_urls: Optional[List[str]] = None, duration: Optional[int] = None,
                     aspect_ratio: str = "", **kwargs: Any) -> Dict[str, Any]:
            refs = ([image_url] if isinstance(image_url, str) and image_url.strip() else [])
            refs += [r for r in (reference_image_urls or []) if isinstance(r, str)]
            fail = lambda exc: error_response(error=f"Chưa tạo được video: {exc}", error_type="api_error",  # noqa: E731
                                              provider="stali", model=str(model or ""), prompt=prompt or "",
                                              aspect_ratio=aspect_ratio or "")
            turn = _zalo_turn()
            if turn:
                # Trên Zalo: gửi yêu cầu rồi trả lời ngay; video xong (thường 2–20 phút) luồng nền tự gửi vào đây.
                if len(_background) >= MAX_BACKGROUND:
                    return fail(f"đang có {len(_background)} video chờ — đợi xong rồi nhờ tiếp")
                try:
                    job = submit_video(prompt, model=model, seconds=duration, aspect=aspect_ratio, refs=refs)
                except EngineError as exc:
                    return fail(exc)
                start_background(turn, job, " ".join(str(prompt).split()), save_bytes_video)
                return {"success": True, "video": None, "status": "dang_tao", "provider": "stali", "model": job["model"],
                        "duration": job["seconds"], "aspect_ratio": job["aspect"], "prompt": prompt,
                        "message": (f"Đã gửi yêu cầu tạo video {job['seconds']} giây ({job['model']}). Video thường mất "
                                    "2–20 phút; khi xong hệ thống TỰ GỬI video vào cuộc trò chuyện này. Hãy báo người "
                                    "dùng như vậy. KHÔNG gọi lại video_generate, KHÔNG tự gửi tệp.")}
            try:
                got = make_video(prompt, model=model, seconds=duration, aspect=aspect_ratio, refs=refs)
            except EngineError as exc:
                return fail(exc)
            path = save_bytes_video(got["data"], prefix=f"stali_{got['model']}")
            return success_response(video=str(path), model=got["model"], prompt=prompt,
                                    modality="image" if refs else "text", aspect_ratio=got["aspect"],
                                    duration=got["seconds"], provider="stali", extra={"task_id": got["id"]})

    return StaliVideoGenProvider()


def register(ctx) -> None:
    ctx.register_image_gen_provider(make_image_provider())
    ctx.register_video_gen_provider(make_video_provider())
    # Dashboard chỉ hiện nguồn ChatGPT ở máy đã đăng nhập Codex: ghi trạng thái sau khi các backend lõi đã nạp xong.
    timer = threading.Timer(30, codex_available)
    timer.daemon = True
    timer.start()
