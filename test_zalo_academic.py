"""Test tra cứu học thuật (academic.py + công cụ zalo_academic_search). Không gọi mạng.

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
from plugins.zalo_tools import academic, tools  # noqa: E402

ESEARCH = json.dumps({"esearchresult": {"idlist": ["111", "222"]}}).encode()
ESUMMARY = json.dumps({"result": {
    "111": {"title": "Vaping and lung health", "authors": [{"name": "Nguyen A"}], "fulljournalname": "Chest",
            "pubdate": "2025 Jan", "articleids": [{"idtype": "doi", "value": "10.1/abc"}]},
    "222": {"title": "E-cigarette use in teens", "authors": [], "source": "JAMA", "pubdate": "2024",
            "articleids": []},
}}).encode()
EFETCH = b"""<PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>111</PMID><Article><Abstract>
<AbstractText Label="BACKGROUND">Vaping is common.</AbstractText><AbstractText Label="RESULTS">Lungs hurt.</AbstractText>
</Abstract></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>"""
CROSSREF = json.dumps({"message": {"items": [{
    "DOI": "10.2/xyz", "title": ["Flipped classroom"], "author": [{"given": "Lan", "family": "Tran"}],
    "container-title": ["Computers & Education"], "issued": {"date-parts": [[2021, 3]]},
    "type": "journal-article", "is-referenced-by-count": 42}]}}).encode()


OPENALEX_WORK = {
    "id": "https://openalex.org/W1", "doi": "https://doi.org/10.3/bio", "title": "Biochar removes cadmium",
    "authorships": [{"author": {"display_name": "Mai Le"}}], "publication_year": 2023, "cited_by_count": 7,
    "primary_location": {"source": {"display_name": "Water"}},
    "open_access": {"oa_status": "gold"},
    "best_oa_location": {"pdf_url": "https://mdpi.com/bio.pdf", "landing_page_url": "https://mdpi.com/bio"},
    "abstract_inverted_index": {"removes": [1], "Biochar": [0], "cadmium.": [2]},
    "locations": [
        {"is_oa": True, "pdf_url": "https://mdpi.com/bio.pdf", "version": "publishedVersion",
         "source": {"display_name": "Water"}},
        {"is_oa": False, "landing_page_url": "https://paywalled.example/bio"},
    ],
}
CORE_HITS = json.dumps({"results": [{
    "id": 99, "doi": "10.3/bio", "title": "Biochar removes cadmium", "authors": [{"name": "Le, Mai"}],
    "publisher": "MDPI", "yearPublished": 2023, "downloadUrl": "https://core.ac.uk/download/99.pdf",
    "abstract": "Biochar works."}]}).encode()
DOAJ_HIT = json.dumps({"results": [{"created_date": "2009-03-02T00:00:00Z", "admin": {"ticked": True}, "bibjson": {
    "title": "Energies", "eissn": "1996-1073", "publisher": {"name": "MDPI AG"},
    "editorial": {"review_process": ["Single anonymous peer review"]},
    "apc": {"has_apc": True, "max": [{"price": 2600, "currency": "CHF"}]},
    "license": [{"type": "CC BY"}], "ref": {"journal": "http://www.mdpi.com/journal/energies"}}}]}).encode()
PMC_SEARCH = json.dumps({"esearchresult": {"idlist": ["7792979"]}}).encode()
PMC_XML = b"""<pmc-articleset><article><front><article-meta><title-group>
<article-title>Biochar <italic>in</italic> soil</article-title></title-group></article-meta></front>
<body><sec><title>Introduction</title><p>Cadmium is   toxic.</p></sec></body></article></pmc-articleset>"""
SEEN_HEADERS = []


def fake_get(url, accept="application/json", headers=None):
    SEEN_HEADERS.append((url, headers))
    if "esearch" in url and "db=pmc" in url:
        return PMC_SEARCH
    if "efetch" in url and "db=pmc" in url:
        return PMC_XML
    if "api.openalex.org/works/doi:" in url:
        return json.dumps(OPENALEX_WORK).encode()
    if "api.openalex.org/works" in url:
        return json.dumps({"results": [OPENALEX_WORK]}).encode()
    if "api.core.ac.uk" in url:
        return CORE_HITS
    if "doaj.org" in url:
        return DOAJ_HIT
    if "esearch" in url:
        return ESEARCH
    if "esummary" in url:
        return ESUMMARY
    if "efetch" in url:
        return EFETCH
    if "api.crossref.org" in url:
        return CROSSREF
    if url.startswith("https://doi.org/"):
        return f"Tran, L. (2021). Flipped classroom. [{accept}]".encode()
    raise AssertionError(url)


class AcademicTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(academic, "_get", side_effect=fake_get)
        self.get = patcher.start()
        self.addCleanup(patcher.stop)
        sleeper = mock.patch.object(academic.time, "sleep")
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_pubmed_parses_summary_doi_and_structured_abstract(self):
        got = academic.pubmed("vaping", 2)
        self.assertEqual([g["pmid"] for g in got], ["111", "222"])
        self.assertEqual(got[0]["doi"], "10.1/abc")
        self.assertEqual(got[0]["journal"], "Chest")
        self.assertEqual(got[0]["abstract"], "BACKGROUND: Vaping is common.\nRESULTS: Lungs hurt.")
        self.assertEqual(got[1]["journal"], "JAMA")
        self.assertEqual(got[1]["abstract"], "")
        self.assertEqual(got[0]["url"], "https://pubmed.ncbi.nlm.nih.gov/111/")

    def test_pubmed_limit_is_clamped_and_calls_are_paced(self):
        academic.pubmed("x", 999)
        esearch_url = self.get.call_args_list[0].args[0]
        self.assertIn("retmax=10", esearch_url)
        self.assertIn("tool=2anh-zalo-bot", esearch_url)
        # 3 lời gọi NCBI liền nhau: nhịp chung buộc chờ giữa chúng.
        self.assertGreaterEqual(self.sleep.call_count, 2)

    def test_crossref(self):
        got = academic.crossref("flipped classroom", 1)
        self.assertEqual(got[0], {
            "doi": "10.2/xyz", "title": "Flipped classroom", "authors": ["Lan Tran"],
            "venue": "Computers & Education", "year": 2021, "type": "journal-article",
            "cited_by": 42, "url": "https://doi.org/10.2/xyz"})

    def test_cite_normalises_doi_and_checks_style(self):
        text = academic.cite("https://doi.org/10.2/xyz", "vancouver")
        self.assertIn("style=elsevier-vancouver", text)
        self.assertIn("doi.org/10.2/xyz", self.get.call_args.args[0])
        for bad_doi in ("abc", "http://127.0.0.1/x", ""):
            with self.assertRaises(academic.AcademicError):
                academic.cite(bad_doi)
        with self.assertRaises(academic.AcademicError):
            academic.cite("10.2/xyz", "made-up")

    def test_openalex_rebuilds_abstract_and_oa_links(self):
        got = academic.openalex("biochar", 1, api_key="oa-key")[0]
        self.assertEqual(got["doi"], "10.3/bio")
        self.assertEqual(got["venue"], "Water")
        self.assertEqual(got["pdf"], "https://mdpi.com/bio.pdf")
        self.assertEqual(got["abstract"], "Biochar removes cadmium.")
        self.assertIn("api_key=oa-key", self.get.call_args.args[0])

    def test_core_sends_key_as_bearer_only_when_set(self):
        SEEN_HEADERS.clear()
        got = academic.core("biochar", 1, api_key="core-key")[0]
        self.assertEqual(got["pdf"], "https://core.ac.uk/download/99.pdf")
        self.assertEqual(SEEN_HEADERS[-1][1], {"Authorization": "Bearer core-key"})
        academic.core("biochar", 1)
        self.assertIsNone(SEEN_HEADERS[-1][1])

    def test_find_pdf_merges_openalex_and_core_skipping_closed_copies(self):
        got = academic.find_pdf("https://doi.org/10.3/bio")
        self.assertEqual(got["open_access"], "gold")
        self.assertEqual([link["url"] for link in got["links"]],
                         ["https://mdpi.com/bio.pdf", "https://core.ac.uk/download/99.pdf"])
        self.assertIn('doi%3A%2210.3%2Fbio%22', SEEN_HEADERS[-1][0])

    def test_find_pdf_survives_one_source_failing(self):
        def openalex_down(url, accept="application/json", headers=None):
            if "openalex" in url:
                raise academic.AcademicError("down")
            return fake_get(url, accept, headers)

        with mock.patch.object(academic, "_get", side_effect=openalex_down):
            got = academic.find_pdf("10.3/bio")
        self.assertEqual(got["title"], "Biochar removes cadmium")
        self.assertEqual(len(got["links"]), 1)

    def test_pmc_fulltext_by_doi_and_pmcid(self):
        got = academic.pmc_fulltext("10.3/bio")
        self.assertEqual(got["pmcid"], "PMC7792979")
        self.assertEqual(got["title"], "Biochar in soil")
        self.assertEqual(got["text"], "## Introduction\nCadmium is toxic.")
        self.assertIn("%22%5BDOI%5D", self.get.call_args_list[-2].args[0])
        self.assertEqual(academic.pmc_fulltext("PMC7792979")["pmcid"], "PMC7792979")

    def test_pmc_fulltext_explains_when_missing(self):
        empty = json.dumps({"esearchresult": {"idlist": []}}).encode()
        with mock.patch.object(academic, "_get", return_value=empty):
            with self.assertRaisesRegex(academic.AcademicError, "find_pdf"):
                academic.pmc_fulltext("10.3/bio")

    def test_journal_by_issn_and_by_name(self):
        got = academic.journal("1996-1073")
        self.assertTrue(got["in_doaj"])
        self.assertEqual(got["journals"][0]["apc"], ["2600 CHF"])
        self.assertIn("issn%3A1996-1073", self.get.call_args.args[0])
        self.assertTrue(academic.journal("energies")["journals"][0]["exact_title"])
        self.assertIn("bibjson.title%3A%22energies%22", self.get.call_args.args[0])
        # Tên gần giống không tính là có trong DOAJ.
        self.assertFalse(academic.journal("Water")["in_doaj"])
        with self.assertRaises(academic.AcademicError):
            academic.journal(" ")


class ZaloAcademicToolTest(unittest.TestCase):
    def call(self, **args):
        with mock.patch.object(academic, "_get", side_effect=fake_get), mock.patch.object(academic.time, "sleep"):
            return json.loads(asyncio.run(tools.zalo_academic_search(args)))

    def test_defaults_to_pubmed(self):
        res = self.call(query="vaping teens")
        self.assertEqual(res["result"]["source"], "pubmed")
        self.assertEqual(len(res["result"]["results"]), 2)

    def test_crossref_and_cite(self):
        self.assertEqual(self.call(query="x", source="crossref")["result"]["results"][0]["doi"], "10.2/xyz")
        self.assertIn("Tran", self.call(action="cite", doi="10.2/xyz")["result"]["citation"])

    def test_new_sources_and_actions_read_keys_from_env(self):
        with mock.patch.dict(os.environ, {"CORE_API_KEY": "k1", "OPENALEX_API_KEY": "k2"}):
            SEEN_HEADERS.clear()
            self.assertEqual(self.call(query="biochar", source="core")["result"]["source"], "core")
            self.assertEqual(SEEN_HEADERS[-1][1], {"Authorization": "Bearer k1"})
            self.assertEqual(self.call(query="biochar", source="openalex")["result"]["results"][0]["year"], 2023)
            self.assertIn("api_key=k2", SEEN_HEADERS[-1][0])
        self.assertEqual(len(self.call(action="find_pdf", doi="10.3/bio")["result"]["links"]), 2)
        self.assertEqual(self.call(action="fulltext", doi="10.3/bio")["result"]["pmcid"], "PMC7792979")
        self.assertTrue(self.call(action="journal", query="1996-1073")["result"]["in_doaj"])

    def test_empty_query_and_service_errors(self):
        self.assertFalse(self.call(query=" ")["success"])
        with mock.patch.object(academic, "_get", side_effect=academic.AcademicError("dịch vụ lỗi")):
            res = json.loads(asyncio.run(tools.zalo_academic_search({"query": "x"})))
        self.assertEqual(res["error"], "dịch vụ lỗi")

    def test_no_per_user_quota(self):
        for _ in range(40):
            self.assertTrue(self.call(query="x", source="crossref")["success"])

    def test_is_public(self):
        self.assertIn("zalo_academic_search", tools._PUBLIC_TOOL_NAMES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
