"""Tra cứu học thuật cho người trong nhóm: PubMed (y sinh), Crossref, OpenAlex, CORE (mọi
ngành), tìm PDF mở theo DOI, toàn văn PMC, tra tạp chí trên DOAJ, và tạo trích dẫn.

Chỉ đọc, chỉ gọi các địa chỉ cố định (NCBI E-utilities, Crossref, doi.org, OpenAlex, CORE,
DOAJ) — người dùng không đưa được URL nào vào đây. Khoá CORE/OpenAlex là tuỳ chọn: không có
khoá vẫn chạy, chỉ ít lượt hơn.

NCBI cho tối đa ~3 yêu cầu/giây mỗi IP khi không có khoá; vượt là cả bot bị
chặn. Nên mọi lời gọi NCBI đi qua một nhịp chung (không phải giới hạn theo người).
"""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
CROSSREF = "https://api.crossref.org"
OPENALEX = "https://api.openalex.org"
CORE = "https://api.core.ac.uk/v3"
DOAJ = "https://doaj.org/api/v4"
# DOAJ chặn mọi User-Agent có chữ "bot" (403), kể cả trong link repo.
DOAJ_UA = "2anh-zalo/academic (+https://github.com/luonghaianh1208)"
FULLTEXT_MAX_CHARS = 15000
UA ="2anh-zalo-bot/academic (+https://github.com/luonghaianh1208/2anh-zalo-bot)"
MAX_RESULTS = 10
ABSTRACT_MAX_CHARS = 2500
STYLES = {"apa": "apa", "ieee": "ieee", "vancouver": "elsevier-vancouver", "harvard": "harvard-cite-them-right",
          "chicago": "chicago-author-date", "mla": "modern-language-association"}
_NCBI_INTERVAL_S = 0.4
_ncbi_lock = threading.Lock()
_ncbi_last = 0.0


class AcademicError(Exception):
    """Lỗi nói được thẳng cho người dùng."""


def _get(url: str, accept: str = "application/json", headers: Dict[str, str] = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read(5_000_000)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise AcademicError("không tìm thấy (mã DOI/ID sai?)")
        if exc.code == 429:
            raise AcademicError("dịch vụ tra cứu đang giới hạn lượt gọi, thử lại sau ít phút")
        raise AcademicError(f"dịch vụ tra cứu trả lỗi HTTP {exc.code}, thử lại sau")
    except (urllib.error.URLError, TimeoutError):
        raise AcademicError("không kết nối được dịch vụ tra cứu, thử lại sau")


def _ncbi(path: str, params: Dict[str, Any], accept: str = "application/json") -> bytes:
    global _ncbi_last
    with _ncbi_lock:
        wait = _NCBI_INTERVAL_S - (time.monotonic() - _ncbi_last)
        if wait > 0:
            time.sleep(wait)
        _ncbi_last = time.monotonic()
    query = urllib.parse.urlencode({**params, "tool": "2anh-zalo-bot"})
    return _get(f"{EUTILS}/{path}?{query}", accept)


def pubmed(query: str, limit: int = 5, abstracts: bool = True) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit or 5), MAX_RESULTS))
    ids = json.loads(_ncbi("esearch.fcgi", {"db": "pubmed", "term": query, "retmax": limit,
                                            "retmode": "json", "sort": "relevance"}))["esearchresult"]["idlist"]
    if not ids:
        return []
    summ = json.loads(_ncbi("esummary.fcgi", {"db": "pubmed", "id": ",".join(ids), "retmode": "json"}))["result"]
    texts: Dict[str, str] = {}
    if abstracts:
        xml = _ncbi("efetch.fcgi", {"db": "pubmed", "id": ",".join(ids), "retmode": "xml",
                                    "rettype": "abstract"}, "application/xml")
        for art in ET.fromstring(xml).iter("PubmedArticle"):
            parts = []
            for node in art.iter("AbstractText"):
                label, text = node.get("Label"), "".join(node.itertext()).strip()
                parts.append(f"{label}: {text}" if label else text)
            texts[art.findtext(".//PMID") or ""] = "\n".join(parts)[:ABSTRACT_MAX_CHARS]
    out = []
    for pmid in ids:
        s = summ.get(pmid) or {}
        item = {
            "pmid": pmid,
            "title": s.get("title"),
            "authors": [a.get("name") for a in s.get("authors", [])][:6],
            "journal": s.get("fulljournalname") or s.get("source"),
            "date": s.get("pubdate"),
            "doi": next((a.get("value") for a in s.get("articleids", []) if a.get("idtype") == "doi"), None),
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        }
        if abstracts:
            item["abstract"] = texts.get(pmid, "")
        out.append(item)
    return out


def crossref(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit or 5), MAX_RESULTS))
    q = urllib.parse.urlencode({"query.bibliographic": query, "rows": limit,
                                "select": "DOI,title,author,container-title,issued,type,is-referenced-by-count"})
    items = json.loads(_get(f"{CROSSREF}/works?{q}"))["message"]["items"]
    out = []
    for it in items:
        date = (it.get("issued") or {}).get("date-parts", [[None]])[0]
        out.append({
            "doi": it.get("DOI"),
            "title": (it.get("title") or [""])[0],
            "authors": [f"{a.get('given', '')} {a.get('family', '')}".strip() for a in it.get("author", [])][:6],
            "venue": (it.get("container-title") or [""])[0],
            "year": date[0] if date else None,
            "type": it.get("type"),
            "cited_by": it.get("is-referenced-by-count"),
            "url": f"https://doi.org/{it.get('DOI')}",
        })
    return out


def _doi(doi: str) -> str:
    doi = str(doi or "").strip()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:", "DOI:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    if not doi.startswith("10."):
        raise AcademicError("DOI phải có dạng 10.xxxx/…")
    return doi


def cite(doi: str, style: str = "apa") -> str:
    doi = _doi(doi)
    csl = STYLES.get(str(style or "apa").lower())
    if not csl:
        raise AcademicError(f"kiểu trích dẫn chỉ có: {', '.join(STYLES)}")
    return _get(f"https://doi.org/{urllib.parse.quote(doi)}",
                f"text/x-bibliography; style={csl}; locale=en-US").decode("utf-8", "replace").strip()


def _openalex_get(path: str, params: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    # Không khoá OpenAlex cho khoảng 100 lượt tìm/ngày; có khoá (miễn phí) thì nhiều hơn.
    if api_key:
        params = {**params, "api_key": api_key}
    return json.loads(_get(f"{OPENALEX}/{path}?{urllib.parse.urlencode(params)}"))


def _openalex_abstract(index: Dict[str, List[int]]) -> str:
    """OpenAlex trả tóm tắt dạng chỉ mục từ → vị trí; ghép lại thành câu."""
    words = sorted((pos, word) for word, positions in (index or {}).items() for pos in positions)
    return " ".join(word for _pos, word in words)[:ABSTRACT_MAX_CHARS]


def _openalex_work(it: Dict[str, Any]) -> Dict[str, Any]:
    best = it.get("best_oa_location") or {}
    source = ((it.get("primary_location") or {}).get("source") or {})
    return {
        "doi": (it.get("doi") or "").replace("https://doi.org/", "") or None,
        "title": it.get("title"),
        "authors": [(a.get("author") or {}).get("display_name") for a in it.get("authorships", [])][:6],
        "venue": source.get("display_name"),
        "year": it.get("publication_year"),
        "cited_by": it.get("cited_by_count"),
        "open_access": (it.get("open_access") or {}).get("oa_status"),
        "pdf": best.get("pdf_url"),
        "free_link": best.get("landing_page_url") if best else None,
        "url": it.get("doi") or it.get("id"),
    }


def openalex(query: str, limit: int = 5, api_key: str = "", abstracts: bool = True) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit or 5), MAX_RESULTS))
    data = _openalex_get("works", {"search": query, "per-page": limit}, api_key)
    out = []
    for it in data.get("results", []):
        item = _openalex_work(it)
        if abstracts:
            item["abstract"] = _openalex_abstract(it.get("abstract_inverted_index"))
        out.append(item)
    return out


def _core_get(path: str, params: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
    return json.loads(_get(f"{CORE}/{path}/?{urllib.parse.urlencode(params)}", headers=headers))


def _core_work(it: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "doi": it.get("doi"),
        "title": it.get("title"),
        "authors": [a.get("name") for a in it.get("authors", [])][:6],
        "venue": it.get("publisher"),
        "year": it.get("yearPublished"),
        "pdf": it.get("downloadUrl") or None,
        "url": f"https://core.ac.uk/works/{it.get('id')}" if it.get("id") else None,
    }


def core(query: str, limit: int = 5, api_key: str = "", abstracts: bool = True) -> List[Dict[str, Any]]:
    """CORE: bài toàn văn từ kho lưu trữ của các trường đại học. Kết quả nào cũng nên có PDF."""
    limit = max(1, min(int(limit or 5), MAX_RESULTS))
    out = []
    for it in _core_get("search/works", {"q": query, "limit": limit}, api_key).get("results", []):
        item = _core_work(it)
        if abstracts:
            item["abstract"] = (it.get("abstract") or "")[:ABSTRACT_MAX_CHARS]
        out.append(item)
    return out


def find_pdf(doi: str, core_key: str = "", openalex_key: str = "") -> Dict[str, Any]:
    """Tìm bản PDF miễn phí hợp pháp của một DOI: OpenAlex (cùng dữ liệu Unpaywall) rồi CORE."""
    doi = _doi(doi)
    links: List[Dict[str, Any]] = []
    title, status = None, None
    try:
        work = _openalex_get(f"works/doi:{urllib.parse.quote(doi)}", {}, openalex_key)
        title = work.get("title")
        status = (work.get("open_access") or {}).get("oa_status")
        for loc in work.get("locations") or []:
            if not loc.get("is_oa"):
                continue
            url = loc.get("pdf_url") or loc.get("landing_page_url")
            if url and all(link["url"] != url for link in links):
                links.append({"url": url, "is_pdf": bool(loc.get("pdf_url")), "version": loc.get("version"),
                              "host": ((loc.get("source") or {}).get("display_name"))})
    except AcademicError:
        pass
    try:
        hits = _core_get("search/works", {"q": f'doi:"{doi}"', "limit": 3}, core_key).get("results", [])
        for it in hits:
            url = it.get("downloadUrl")
            if url and all(link["url"] != url for link in links):
                links.append({"url": url, "is_pdf": True, "version": None, "host": "CORE"})
            title = title or it.get("title")
    except AcademicError:
        pass
    return {"doi": doi, "title": title, "open_access": status, "links": links[:6]}


def pmc_fulltext(ident: str) -> Dict[str, Any]:
    """Toàn văn một bài trên PubMed Central, theo PMCID (PMC1234567) hoặc DOI."""
    ident = str(ident or "").strip()
    if ident.upper().startswith("PMC") and ident[3:].isdigit():
        uid = ident[3:]
    else:
        doi = _doi(ident)
        ids = json.loads(_ncbi("esearch.fcgi", {"db": "pmc", "term": f'"{doi}"[DOI]',
                                                "retmode": "json"}))["esearchresult"]["idlist"]
        if not ids:
            raise AcademicError("bài này không có toàn văn trên PubMed Central — thử action=find_pdf")
        uid = ids[0]
    root = ET.fromstring(_ncbi("efetch.fcgi", {"db": "pmc", "id": uid, "retmode": "xml"}, "application/xml"))
    body = root.find(".//body")
    if body is None:
        raise AcademicError("PubMed Central không cho tải toàn văn bài này (nhà xuất bản giới hạn)")
    paragraphs = []
    for node in body.iter():
        if node.tag in ("title", "p"):
            text = " ".join("".join(node.itertext()).split())
            if text:
                paragraphs.append(f"## {text}" if node.tag == "title" else text)
    text = "\n".join(paragraphs)
    return {
        "pmcid": f"PMC{uid}",
        "title": " ".join("".join(root.find(".//article-title").itertext()).split())
        if root.find(".//article-title") is not None else None,
        "url": f"https://pmc.ncbi.nlm.nih.gov/articles/PMC{uid}/",
        "text": text[:FULLTEXT_MAX_CHARS],
        "truncated": len(text) > FULLTEXT_MAX_CHARS,
    }


def journal(query: str) -> Dict[str, Any]:
    """Tra tạp chí trên DOAJ (danh mục tạp chí truy cập mở có bình duyệt), theo ISSN hoặc tên."""
    query = str(query or "").strip()
    if not query:
        raise AcademicError("cần ISSN (vd. 1996-1073) hoặc tên tạp chí")
    is_issn = len(query) == 9 and query[4] == "-" and query.replace("-", "")[:7].isdigit()
    q = f"issn:{query.upper()}" if is_issn else f'bibjson.title:"{query}"'
    data = json.loads(_get(f"{DOAJ}/search/journals/{urllib.parse.quote(q)}?pageSize=5",
                           headers={"User-Agent": DOAJ_UA}))
    out = []
    for r in data.get("results", []):
        b = r.get("bibjson") or {}
        apc = b.get("apc") or {}
        out.append({
            "title": b.get("title"),
            "exact_title": str(b.get("title") or "").strip().lower() == query.lower(),
            "issn": [x for x in (b.get("pissn"), b.get("eissn")) if x],
            "publisher": (b.get("publisher") or {}).get("name"),
            "peer_review": (b.get("editorial") or {}).get("review_process"),
            "apc": [f"{m.get('price')} {m.get('currency')}" for m in apc.get("max", [])] if apc.get("has_apc") else "không thu phí",
            "license": [lic.get("type") for lic in b.get("license", [])],
            "doaj_reviewed_after_2015": bool((r.get("admin") or {}).get("ticked")),
            "in_doaj_since": (r.get("created_date") or "")[:10],
            "url": (b.get("ref") or {}).get("journal"),
        })
    if not is_issn:
        out.sort(key=lambda j: not j["exact_title"])
    in_doaj = any(j["exact_title"] for j in out) if not is_issn else bool(out)
    return {"query": query, "in_doaj": in_doaj, "journals": out}
