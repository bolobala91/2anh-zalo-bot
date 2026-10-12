"""Dữ liệu mở không cần khoá cho người trong nhóm: thời tiết (Open-Meteo), tỷ giá (Frankfurter, Currency-api),
từ điển (Free Dictionary, Wiktionary), tra loài sinh vật (iNaturalist, GBIF).

Chỉ đọc, chỉ gọi các địa chỉ cố định dưới đây — người dùng không đưa được URL nào vào; tham số đi qua urlencode/quote.
Dashboard liệt kê các nguồn này (kèm trang web) ở Khoá API & Model › API miễn phí (dashboard/public/views/free-apis.js).
"""

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

UA = "2anh-zalo-bot/open-data (+https://github.com/luonghaianh1208/2anh-zalo-bot)"
GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"
FRANKFURTER = "https://api.frankfurter.dev/v1"
CURRENCY_API = ("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies",
                "https://latest.currency-api.pages.dev/v1/currencies")
FREE_DICT = "https://api.dictionaryapi.dev/api/v2/entries/en"
WIKTIONARY = "https://en.wiktionary.org/api/rest_v1/page/definition"
INATURALIST = "https://api.inaturalist.org/v1/taxa/autocomplete"
GBIF = "https://api.gbif.org/v1/species/match"
TIMEOUT = 20
MAX_DAYS = 7

# Tiền tệ Frankfurter có (ngân hàng trung ương châu Âu) — không có VND, nên cặp nào có VND đi Currency-api.
FRANKFURTER_CODES = frozenset("AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD "
                              "PHP PLN RON SEK SGD THB TRY USD ZAR".split())
_CODE = re.compile(r"^[A-Za-z]{3}$")
_WORD = re.compile(r"^[^\x00-\x1f/\\?#]{1,60}$")

# Mã thời tiết WMO (Open-Meteo trả về) → mô tả tiếng Việt.
WMO_VI = {
    0: "trời quang", 1: "ít mây", 2: "có mây", 3: "nhiều mây, u ám", 45: "sương mù", 48: "sương mù đóng băng",
    51: "mưa phùn nhẹ", 53: "mưa phùn", 55: "mưa phùn dày", 56: "mưa phùn lạnh", 57: "mưa phùn lạnh dày",
    61: "mưa nhỏ", 63: "mưa vừa", 65: "mưa to", 66: "mưa lạnh", 67: "mưa lạnh to",
    71: "tuyết nhẹ", 73: "tuyết", 75: "tuyết dày", 77: "hạt tuyết", 80: "mưa rào nhẹ", 81: "mưa rào", 82: "mưa rào rất to",
    85: "mưa tuyết", 86: "mưa tuyết dày", 95: "dông", 96: "dông kèm mưa đá", 99: "dông mạnh kèm mưa đá",
}

class OpenDataError(Exception):
    """Lỗi nói được thẳng cho người dùng."""


def _get_json(url: str, *, not_found: str = "không tìm thấy") -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read(3_000_000))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise OpenDataError(not_found)
        if exc.code == 429:
            raise OpenDataError("dịch vụ đang giới hạn lượt gọi, thử lại sau ít phút")
        raise OpenDataError(f"dịch vụ trả lỗi HTTP {exc.code}, thử lại sau")
    except (urllib.error.URLError, TimeoutError):
        raise OpenDataError("không kết nối được dịch vụ, thử lại sau")
    except ValueError:
        raise OpenDataError("dịch vụ trả dữ liệu hỏng, thử lại sau")


def _q(params: Dict[str, Any]) -> str:
    return urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})


# -- Thời tiết ------------------------------------------------------------------
def weather(place: str, days: int = 3) -> Dict[str, Any]:
    """Thời tiết hiện tại + dự báo ``days`` ngày (1–7) của một địa danh, giờ Việt Nam."""
    place = " ".join(str(place or "").split())[:80]
    if not place:
        raise OpenDataError("cần tên địa điểm, vd. 'Hà Nội' hoặc 'Đà Lạt'")
    days = max(1, min(int(days or 3), MAX_DAYS))
    found = (_get_json(f"{GEOCODE}?{_q({'name': place, 'count': 5, 'language': 'vi'})}").get("results") or [])
    if not found:
        raise OpenDataError(f"không tìm thấy địa điểm '{place}' — thử tên tỉnh/thành phố, không dấu cũng được")
    # Ưu tiên địa điểm ở Việt Nam khi trùng tên.
    loc = next((r for r in found if r.get("country_code") == "VN"), found[0])
    data = _get_json(f"{FORECAST}?{_q({'latitude': loc['latitude'], 'longitude': loc['longitude'], 'timezone': 'Asia/Ho_Chi_Minh', 'forecast_days': days, 'current': 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m', 'daily': 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max'})}")
    cur = data.get("current") or {}
    daily = data.get("daily") or {}
    forecast = []
    for i, day in enumerate(daily.get("time") or []):
        pick = lambda key: (daily.get(key) or [None] * (i + 1))[i]
        forecast.append({"date": day, "sky": WMO_VI.get(pick("weather_code"), "không rõ"),
                         "min_c": pick("temperature_2m_min"), "max_c": pick("temperature_2m_max"),
                         "rain_chance_pct": pick("precipitation_probability_max"), "rain_mm": pick("precipitation_sum"),
                         "uv_max": pick("uv_index_max")})
    return {
        "place": ", ".join(x for x in (loc.get("name"), loc.get("admin1"), loc.get("country")) if x),
        "now": {"time": cur.get("time"), "sky": WMO_VI.get(cur.get("weather_code"), "không rõ"),
                "temp_c": cur.get("temperature_2m"), "feels_like_c": cur.get("apparent_temperature"),
                "humidity_pct": cur.get("relative_humidity_2m"), "rain_mm": cur.get("precipitation"),
                "wind_kmh": cur.get("wind_speed_10m")},
        "forecast": forecast,
        "source": "Open-Meteo (open-meteo.com)",
    }


# -- Tỷ giá ---------------------------------------------------------------------
def exchange_rate(base: str, target: str, amount: float = 1) -> Dict[str, Any]:
    """Quy đổi ``amount`` ``base`` sang ``target`` (mã ISO 3 chữ, vd. USD, VND, EUR, JPY)."""
    base, target = str(base or "").strip().upper(), str(target or "").strip().upper()
    if not (_CODE.match(base) and _CODE.match(target)):
        raise OpenDataError("mã tiền tệ là 3 chữ cái, vd. USD, VND, EUR, JPY, CNY, KRW")
    try:
        amount = float(amount if amount not in (None, "") else 1)
    except (TypeError, ValueError):
        raise OpenDataError("số tiền không hợp lệ")
    if not (0 < amount < 1e15):
        raise OpenDataError("số tiền phải lớn hơn 0")
    if base == target:
        return {"base": base, "target": target, "amount": amount, "rate": 1.0, "result": amount, "date": None, "source": "—"}
    if base in FRANKFURTER_CODES and target in FRANKFURTER_CODES:
        data = _get_json(f"{FRANKFURTER}/latest?{_q({'base': base, 'symbols': target})}")
        rate = (data.get("rates") or {}).get(target)
        if rate is not None:
            return {"base": base, "target": target, "amount": amount, "rate": rate, "result": round(amount * rate, 6),
                    "date": data.get("date"), "source": "Frankfurter (frankfurter.dev, tỷ giá tham chiếu ECB)"}
    last: Optional[OpenDataError] = None
    for root in CURRENCY_API:
        try:
            data = _get_json(f"{root}/{base.lower()}.json", not_found=f"không có tỷ giá cho {base}")
        except OpenDataError as exc:
            last = exc
            continue
        rate = (data.get(base.lower()) or {}).get(target.lower())
        if rate is None:
            raise OpenDataError(f"không có tỷ giá {base} → {target}")
        return {"base": base, "target": target, "amount": amount, "rate": rate, "result": round(amount * rate, 6),
                "date": data.get("date"), "source": "Currency-api (github.com/fawazahmed0/exchange-api)"}
    raise last or OpenDataError("không lấy được tỷ giá, thử lại sau")


# -- Từ điển --------------------------------------------------------------------
_TAG = re.compile(r"<[^>]+>")


def _plain(text: Any) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", str(text or ""))).split())


def dictionary(word: str, lang: str = "en") -> Dict[str, Any]:
    """Tra từ: tiếng Anh qua Free Dictionary (phiên âm, nghĩa, ví dụ, đồng nghĩa); thứ tiếng khác qua Wiktionary."""
    word = " ".join(str(word or "").split())
    lang = str(lang or "en").strip().lower()[:8]
    if not word or not _WORD.match(word):
        raise OpenDataError("cần một từ hoặc cụm từ ngắn (≤ 60 ký tự)")
    if lang == "en":
        try:
            entries = _get_json(f"{FREE_DICT}/{urllib.parse.quote(word)}", not_found="nf")
            meanings, phonetics, audio = [], [], None
            for e in entries[:2]:
                phonetics += [p.get("text") for p in e.get("phonetics", []) if p.get("text")]
                audio = audio or next((p.get("audio") for p in e.get("phonetics", []) if p.get("audio")), None)
                for m in e.get("meanings", []):
                    meanings.append({"part_of_speech": m.get("partOfSpeech"),
                                     "definitions": [{"definition": d.get("definition"), "example": d.get("example")}
                                                     for d in m.get("definitions", [])[:3]],
                                     "synonyms": (m.get("synonyms") or [])[:6], "antonyms": (m.get("antonyms") or [])[:6]})
            return {"word": word, "lang": "en", "phonetic": list(dict.fromkeys(phonetics))[:3], "audio": audio,
                    "meanings": meanings[:6], "source": "Free Dictionary (dictionaryapi.dev)"}
        except OpenDataError as exc:
            if str(exc) != "nf":
                raise
    data = _get_json(f"{WIKTIONARY}/{urllib.parse.quote(word)}", not_found=f"không tìm thấy từ '{word}'")
    groups = data.get(lang) or ([] if lang != "en" else [])
    if not groups:
        have = sorted(k for k in data if k != "other")[:10]
        raise OpenDataError(f"Wiktionary không có nghĩa '{lang}' cho '{word}'" + (f" (có: {', '.join(have)})" if have else ""))
    meanings = [{"part_of_speech": g.get("partOfSpeech"),
                 "definitions": [{"definition": _plain(d.get("definition")),
                                  "example": _plain((d.get("examples") or [""])[0]) or None}
                                 for d in g.get("definitions", [])[:4] if _plain(d.get("definition"))]}
                for g in groups[:5]]
    return {"word": word, "lang": lang, "meanings": meanings,
            "url": f"https://en.wiktionary.org/wiki/{urllib.parse.quote(word)}", "source": "Wiktionary (wiktionary.org)"}


# -- Tra loài sinh vật ----------------------------------------------------------
def species(name: str) -> Dict[str, Any]:
    """Tra loài theo tên khoa học hoặc tên tiếng Anh: tên thường gọi, ảnh, phân loại (iNaturalist + GBIF).

    iNaturalist gần như không hiểu tên tiếng Việt (đo 12/10/2026: "hoa sen" không ra gì, "sen" ra họ Cúc) — mô hình
    phải đổi tên tiếng Việt sang tên khoa học/tiếng Anh trước khi gọi (mô tả công cụ dặn điều này)."""
    name = " ".join(str(name or "").split())[:80]
    if not name:
        raise OpenDataError("cần tên loài, vd. 'sen', 'lotus', 'Nelumbo nucifera'")
    results = _get_json(f"{INATURALIST}?{_q({'q': name, 'locale': 'vi', 'per_page': 5})}").get("results") or []
    if not results:
        raise OpenDataError(f"không tìm thấy loài '{name}' — đổi sang tên khoa học (vd. Nelumbo nucifera) hoặc tên tiếng Anh rồi tra lại")
    t = results[0]
    photo = t.get("default_photo") or {}
    out = {
        "scientific_name": t.get("name"),
        "common_name_vi_or_en": t.get("preferred_common_name") or t.get("english_common_name"),
        "rank": t.get("rank"),
        "observations": t.get("observations_count"),
        "extinct": t.get("extinct"),
        "photo": photo.get("medium_url") or photo.get("url"),
        "photo_credit": photo.get("attribution"),
        "wikipedia": t.get("wikipedia_url"),
        "url": f"https://www.inaturalist.org/taxa/{t.get('id')}" if t.get("id") else None,
        "other_matches": [f"{r.get('name')} ({r.get('preferred_common_name') or r.get('rank')})" for r in results[1:4]],
        "source": "iNaturalist (inaturalist.org)",
    }
    try:
        g = _get_json(f"{GBIF}?{_q({'name': t.get('name') or name})}")
        if g.get("matchType") not in (None, "NONE"):
            out["classification"] = {k: g.get(k) for k in ("kingdom", "phylum", "class", "order", "family", "genus", "species") if g.get(k)}
            out["gbif"] = f"https://www.gbif.org/species/{g['usageKey']}" if g.get("usageKey") else None
            out["source"] += " · GBIF (gbif.org)"
    except OpenDataError:
        pass  # phân loại là phần thêm — thiếu thì vẫn trả phần iNaturalist
    return out
