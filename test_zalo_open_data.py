"""Test dữ liệu mở (open_data.py: thời tiết, tỷ giá, từ điển, tra loài) và nguồn học thuật arXiv / Europe PMC.
Không gọi mạng — giả lập phản hồi theo đúng hình dạng đo được ngày 12/10/2026.

Chạy: npm run test:py
"""

import asyncio
import json
import os
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import plugins  # noqa: E402

plugins.__path__ = [os.path.join(ROOT, "hermes-plugin"), *list(plugins.__path__)]
from plugins.zalo_tools import academic, group_permissions, open_data, tools  # noqa: E402

GEO = {"results": [
    {"name": "Hải Phòng", "latitude": 39.0, "longitude": -76.0, "country_code": "US", "country": "Hoa Kỳ"},
    {"name": "Hải Phòng", "latitude": 20.86, "longitude": 106.68, "country_code": "VN", "admin1": "Hai Phong", "country": "Việt Nam"},
]}
FORECAST = {"current": {"time": "2026-10-12T09:00", "temperature_2m": 30.9, "apparent_temperature": 34.0,
                        "relative_humidity_2m": 70, "precipitation": 0.0, "weather_code": 0, "wind_speed_10m": 8.2},
            "daily": {"time": ["2026-10-12", "2026-10-13"], "weather_code": [0, 63],
                      "temperature_2m_max": [31.2, 29.0], "temperature_2m_min": [23.6, 24.0],
                      "precipitation_probability_max": [10, 80], "precipitation_sum": [0.0, 12.5], "uv_index_max": [7.5, 3.1]}}


class Router:
    """Giả `_get_json`: trả theo tiền tố URL, ghi lại URL đã gọi."""

    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def __call__(self, url, *, not_found="không tìm thấy"):
        self.calls.append(url)
        for prefix, value in self.routes:
            if url.startswith(prefix):
                if isinstance(value, Exception):
                    raise value
                return value
        raise open_data.OpenDataError(not_found)


class WeatherTest(unittest.TestCase):
    def test_prefers_vietnam_and_maps_wmo_codes_in_vietnam_time(self):
        r = Router([(open_data.GEOCODE, GEO), (open_data.FORECAST, FORECAST)])
        with mock.patch.object(open_data, "_get_json", r):
            w = open_data.weather("Hải Phòng", 2)
        self.assertEqual(w["place"], "Hải Phòng, Hai Phong, Việt Nam")
        self.assertIn("latitude=20.86", r.calls[1])
        self.assertIn("timezone=Asia%2FHo_Chi_Minh", r.calls[1])
        self.assertEqual(w["now"]["sky"], "trời quang")
        self.assertEqual(w["forecast"][1]["sky"], "mưa vừa")
        self.assertEqual(w["forecast"][1]["rain_chance_pct"], 80)

    def test_days_clamped_and_unknown_place_explained(self):
        r = Router([(open_data.GEOCODE, GEO), (open_data.FORECAST, FORECAST)])
        with mock.patch.object(open_data, "_get_json", r):
            open_data.weather("Hải Phòng", 99)
        self.assertIn("forecast_days=7", r.calls[1])
        with mock.patch.object(open_data, "_get_json", Router([(open_data.GEOCODE, {"results": []})])):
            with self.assertRaisesRegex(open_data.OpenDataError, "không tìm thấy địa điểm"):
                open_data.weather("xyz")
        with self.assertRaises(open_data.OpenDataError):
            open_data.weather("  ")


class ExchangeTest(unittest.TestCase):
    def test_vnd_goes_to_currency_api_majors_go_to_frankfurter(self):
        r = Router([(open_data.CURRENCY_API[0], {"date": "2026-10-11", "usd": {"vnd": 25868.45}}),
                    (open_data.FRANKFURTER, {"date": "2026-10-09", "rates": {"JPY": 177.34}})])
        with mock.patch.object(open_data, "_get_json", r):
            vnd = open_data.exchange_rate("usd", "VND", 100)
            jpy = open_data.exchange_rate("EUR", "JPY", 2)
        self.assertAlmostEqual(vnd["result"], 2586845.0, places=0)
        self.assertIn("Currency-api", vnd["source"])
        self.assertEqual(jpy["result"], 354.68)
        self.assertIn("Frankfurter", jpy["source"])
        self.assertTrue(r.calls[0].endswith("/usd.json"))

    def test_mirror_used_when_cdn_down_and_bad_input_refused(self):
        r = Router([(open_data.CURRENCY_API[0], open_data.OpenDataError("không kết nối được dịch vụ")),
                    (open_data.CURRENCY_API[1], {"date": "d", "usd": {"vnd": 25000}})])
        with mock.patch.object(open_data, "_get_json", r):
            self.assertEqual(open_data.exchange_rate("USD", "VND")["rate"], 25000)
        for base, target, amount in (("US", "VND", 1), ("USD", "V1D", 1), ("USD", "VND", -5), ("USD", "VND", "abc")):
            with self.assertRaises(open_data.OpenDataError):
                open_data.exchange_rate(base, target, amount)


class DictionaryTest(unittest.TestCase):
    def test_english_from_free_dictionary(self):
        entry = [{"phonetics": [{"text": "/rɪˈzɪliənt/", "audio": "https://x/a.mp3"}],
                  "meanings": [{"partOfSpeech": "adjective",
                                "definitions": [{"definition": "Returning quickly to shape.", "example": "a resilient ball"}],
                                "synonyms": ["elastic"], "antonyms": []}]}]
        with mock.patch.object(open_data, "_get_json", Router([(open_data.FREE_DICT, entry)])):
            d = open_data.dictionary("resilient")
        self.assertEqual(d["phonetic"], ["/rɪˈzɪliənt/"])
        self.assertEqual(d["meanings"][0]["definitions"][0]["example"], "a resilient ball")

    def test_other_language_via_wiktionary_strips_html(self):
        wik = {"vi": [{"partOfSpeech": "Noun", "definitions": [
            {"definition": '<a rel="mw:WikiLink" href="/wiki/cat">cat</a> &amp; kitten'}]}]}
        r = Router([(open_data.WIKTIONARY, wik)])
        with mock.patch.object(open_data, "_get_json", r):
            d = open_data.dictionary("mèo", "vi")
        self.assertEqual(d["meanings"][0]["definitions"][0]["definition"], "cat & kitten")
        self.assertIn("m%C3%A8o", r.calls[0])
        with mock.patch.object(open_data, "_get_json", Router([(open_data.WIKTIONARY, {"en": []})])):
            with self.assertRaisesRegex(open_data.OpenDataError, "không có nghĩa 'vi'"):
                open_data.dictionary("mèo", "vi")

    def test_path_characters_refused(self):
        for bad in ("../etc", "a/b", "x?y", ""):
            with self.assertRaises(open_data.OpenDataError):
                open_data.dictionary(bad)


class SpeciesTest(unittest.TestCase):
    def test_inaturalist_plus_gbif_and_gbif_optional(self):
        inat = {"results": [{"id": 1, "name": "Nelumbo nucifera", "preferred_common_name": "Sacred Lotus", "rank": "species",
                             "observations_count": 9, "default_photo": {"medium_url": "https://p/m.jpg"}}]}
        gbif = {"matchType": "EXACT", "usageKey": 2882449, "kingdom": "Plantae", "family": "Nelumbonaceae", "genus": "Nelumbo"}
        with mock.patch.object(open_data, "_get_json", Router([(open_data.INATURALIST, inat), (open_data.GBIF, gbif)])):
            s = open_data.species("Nelumbo nucifera")
        self.assertEqual(s["classification"]["family"], "Nelumbonaceae")
        self.assertEqual(s["url"], "https://www.inaturalist.org/taxa/1")
        with mock.patch.object(open_data, "_get_json", Router([(open_data.INATURALIST, inat),
                                                               (open_data.GBIF, open_data.OpenDataError("x"))])):
            self.assertNotIn("classification", open_data.species("Nelumbo nucifera"))
        with mock.patch.object(open_data, "_get_json", Router([(open_data.INATURALIST, {"results": []})])):
            with self.assertRaisesRegex(open_data.OpenDataError, "tên khoa học"):
                open_data.species("hoa sen")


ATOM = b"""<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/1205.0883v1</id><published>2012-05-04T00:00:00Z</published>
<title>Functional quantum
 biology</title><summary>Abstract here.</summary><author><name>Lambert N</name></author>
<link title="pdf" href="http://arxiv.org/pdf/1205.0883v1"/><arxiv:doi>10.1038/nphys2474</arxiv:doi></entry></feed>"""


class AcademicSourcesTest(unittest.TestCase):
    def test_arxiv_parses_atom(self):
        with mock.patch.object(academic, "_get", return_value=ATOM):
            r = academic.arxiv("quantum biology", 3)
        self.assertEqual(r[0]["title"], "Functional quantum biology")
        self.assertEqual(r[0]["pdf"], "http://arxiv.org/pdf/1205.0883v1")
        self.assertEqual((r[0]["year"], r[0]["doi"], r[0]["preprint"]), ("2012", "10.1038/nphys2474", True))

    def test_arxiv_rate_limited_falls_back_to_openalex_arxiv_index(self):
        calls = []

        def fake_get(url, accept="application/json", headers=None):
            calls.append(url)
            if url.startswith(academic.ARXIV):
                raise academic.AcademicError("dịch vụ tra cứu đang giới hạn lượt gọi")
            return json.dumps({"results": [{"title": "Q", "publication_year": 2012, "authorships": [],
                                            "best_oa_location": {"pdf_url": "https://arxiv.org/pdf/1205.0883"}}]}).encode()

        with mock.patch.object(academic, "_get", side_effect=fake_get):
            r = academic.arxiv("quantum biology", 2)
        self.assertIn("primary_location.source.id%3AS4306400194", calls[1])
        self.assertEqual(r[0]["pdf"], "https://arxiv.org/pdf/1205.0883")
        self.assertIn("OpenAlex", r[0]["via"])

    def test_europepmc_links_and_open_access_flag(self):
        body = json.dumps({"resultList": {"result": [
            {"title": "Biochar SiO&lt;sub&gt;2&lt;/sub&gt; ash", "authorString": "Le A, Tran B.", "pubYear": "2025",
             "pmcid": "PMC1", "isOpenAccess": "Y", "doi": "10.1/x",
             "abstractText": "<h4>Aim</h4>Cd <i>uptake</i>.", "journalTitle": "Chemosphere"},
            {"title": "Soil", "pmid": "42", "isOpenAccess": "N"}]}}).encode()
        with mock.patch.object(academic, "_get", return_value=body):
            r = academic.europepmc("biochar", 2)
        self.assertEqual(r[0]["url"], "https://europepmc.org/article/PMC/PMC1")
        self.assertTrue(r[0]["open_access"])
        self.assertEqual(r[0]["authors"], ["Le A", "Tran B."])
        self.assertEqual(r[0]["title"], "Biochar SiO2 ash")
        self.assertEqual(r[0]["abstract"], "Aim Cd uptake .")
        self.assertEqual(r[1]["url"], "https://europepmc.org/article/MED/42")


class OpenDataToolsTest(unittest.TestCase):
    def test_tools_registered_public_and_behind_feature_switches(self):
        names = {name: toolset for name, _e, _s, _h, toolset in tools.TOOLS}
        for name, feature in (("zalo_weather", "web"), ("zalo_exchange_rate", "web"),
                              ("zalo_dictionary", "academic"), ("zalo_species", "academic")):
            self.assertEqual(names[name], tools.TOOLSET_PUBLIC)
            self.assertIn(name, group_permissions.FEATURE_TOOLS[feature])
        schema = next(s for n, _e, s, _h, _t in tools.TOOLS if n == "zalo_academic_search")
        self.assertIn("arxiv", json.dumps(schema))
        self.assertIn("europepmc", json.dumps(schema))

    def test_tool_errors_come_back_as_plain_vietnamese(self):
        with mock.patch.object(open_data, "_get_json", side_effect=open_data.OpenDataError("dịch vụ trả lỗi HTTP 500, thử lại sau")):
            out = json.loads(asyncio.run(tools.zalo_weather({"place": "Huế"})))
        self.assertEqual(out, {"success": False, "error": "dịch vụ trả lỗi HTTP 500, thử lại sau"})
        with mock.patch.object(open_data, "exchange_rate", return_value={"rate": 1}) as fn:
            asyncio.run(tools.zalo_exchange_rate({"base": "USD", "target": "VND", "amount": 0}))
        fn.assert_called_once_with("USD", "VND", 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
