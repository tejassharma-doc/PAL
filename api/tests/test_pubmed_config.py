"""
PubMed configuration and the publication-year floor.

Two things are being held here.

The first is that configuring PubMed should not require reading the source.
Before this, the API key was fetched with `os.getenv` inside the request
builder, and the `pubmed_email` / `pubmed_tool` settings PAL already defined
were never sent to NCBI at all — they existed and did nothing. One config
object now feeds every request, and every value can come from .env, from the
environment, or from a call, with defaults that work unconfigured.

The second is the year floor. Nothing before 2000 is retrieved, and — the part
that matters — that is enforced twice: once as a date window in the request,
and once on the records that come back. Same reasoning as the Humans MeSH
check. The window is a request; the record is a fact. A silently changed date
parameter at NCBI drops old articles locally instead of putting a 1974 paper
in front of a patient as though it were current.
"""
import asyncio
import os

import pytest

from services.clinical import pubmed
from services.clinical.pubmed import (
    DEFAULT_MIN_YEAR,
    PubmedArticle,
    PubmedConfig,
    build_term,
    date_window,
    filter_by_year,
    search_pubmed,
)


@pytest.fixture(autouse=True)
def clean_config():
    pubmed.reset_config()
    yield
    pubmed.reset_config()


def article(pmid: str, year: str, *, abstract: str = "an abstract", mesh=("Humans",)):
    return PubmedArticle(
        pmid=pmid, title=f"Study {pmid}", abstract=abstract,
        journal="J Test", year=year, mesh_terms=list(mesh),
    )


class TestConfiguringIsOneThing:
    def test_it_works_with_nothing_set(self):
        config = pubmed.get_config()
        assert config.tool == "PAL"
        assert config.min_year == DEFAULT_MIN_YEAR == 2000
        assert config.max_results == 8

    def test_every_request_identifies_the_client_to_ncbi(self):
        # NCBI policy. These settings existed in PAL and were never sent.
        params = PubmedConfig(tool="PAL", email="ops@docmode.com").request_params()
        assert params["tool"] == "PAL"
        assert params["email"] == "ops@docmode.com"

    def test_no_api_key_means_no_api_key_parameter(self):
        assert "api_key" not in PubmedConfig().request_params()

    def test_the_environment_configures_it(self, monkeypatch):
        monkeypatch.setenv("PUBMED_MIN_YEAR", "2015")
        monkeypatch.setenv("PUBMED_EMAIL", "ops@docmode.com")
        pubmed.reset_config()
        config = pubmed.get_config()
        assert config.min_year == 2015
        assert config.email == "ops@docmode.com"

    def test_a_nonsense_value_falls_back_instead_of_crashing(self, monkeypatch):
        # A typo'd .env must not take the API down on import.
        monkeypatch.setenv("PUBMED_MIN_YEAR", "two thousand")
        pubmed.reset_config()
        assert pubmed.get_config().min_year == DEFAULT_MIN_YEAR

    def test_code_can_override_at_runtime(self):
        assert pubmed.configure(min_year=2010, max_results=3).min_year == 2010
        assert pubmed.get_config().max_results == 3

    def test_describe_never_prints_the_key(self):
        # This line is meant to be pasteable into a support ticket.
        fake = "not-a-real-key-000000"
        text = PubmedConfig(api_key=fake).describe()
        assert fake not in text
        assert f"set, {len(fake)} chars" in text


class TestTheYearFloor:
    def test_the_default_window_starts_in_2000(self):
        window = date_window()
        assert window["mindate"] == "2000/01/01"
        assert window["datetype"] == "pdat"

    def test_a_recency_request_tightens_the_window(self):
        assert date_window(3)["mindate"] > "2020/01/01"

    def test_a_recency_request_can_never_loosen_it(self):
        # 200 years back still must not reach before the floor.
        assert date_window(200)["mindate"] == "2000/01/01"

    @pytest.mark.parametrize("raw,expected", [
        ("2021", 2021),
        ("2003 Jan-Feb", 2003),          # MedlineDate shape
        ("", None),
        ("in press", None),
    ])
    def test_the_year_is_read_off_the_record(self, raw, expected):
        assert article("1", raw).year_int == expected

    def test_old_articles_are_dropped_from_the_results(self):
        kept = filter_by_year([article("a", "1998"), article("b", "2021")], 2000)
        assert [x.pmid for x in kept] == ["b"]

    def test_an_undated_record_is_not_assumed_recent(self):
        # Not being able to date a paper is not evidence that it is recent.
        assert filter_by_year([article("a", "")], 2000) == []

    def test_the_boundary_year_is_included(self):
        assert len(filter_by_year([article("a", "2000")], 2000)) == 1

    def test_the_floor_is_enforced_on_records_not_just_on_the_query(self):
        # The point of the whole design. Pretend NCBI ignored the date window
        # and returned a 1974 paper anyway: it must not reach the patient.
        async def fake_esearch(client, term, retmax, recent_years, min_year=None):
            return ["1", "2"]

        async def fake_efetch(client, pmids):
            return [article("1", "1974"), article("2", "2021")]

        pubmed._esearch, pubmed._efetch = fake_esearch, fake_efetch
        try:
            found = asyncio.run(search_pubmed("anything"))
        finally:
            pubmed.reset_config()
        assert [a.pmid for a in found] == ["2"]


class TestNothingElseChanged:
    def test_the_human_studies_filter_is_still_the_load_bearing_clause(self):
        assert "humans[MeSH Terms]" in build_term("x")
        assert "humans[MeSH Terms]" not in build_term("x", "none")

    def test_provenance_is_still_read_per_record(self):
        human = article("1", "2021", mesh=("Humans", "Metformin"))
        mouse = article("2", "2021", mesh=("Animals", "Mice"))
        assert human.to_citation()["provenance_class"] == "peer-reviewed-human"
        assert mouse.to_citation()["provenance_class"] == "peer-reviewed-other"

    def test_the_citation_carries_the_year_as_a_number(self):
        # So a renderer can sort or badge on it without re-parsing prose.
        assert article("1", "2021").to_citation()["year_int"] == 2021


class TestTheKeyNeverReachesTheLog:
    """
    httpx puts the full request URL in its exception messages, and the NCBI
    API key travels as a query parameter. So `logger.warning(..., exc)` on a
    failed request was writing a live credential into the application log, and
    from there into wherever logs are aggregated. Found in review.
    """

    def test_an_httpx_error_message_is_scrubbed(self):
        pubmed.configure(api_key="LIVEKEY1234567890")
        message = (
            "Client error '429 Too Many Requests' for url "
            "'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
            "?term=x&api_key=LIVEKEY1234567890&tool=PAL'"
        )
        cleaned = pubmed.scrub(message)
        assert "LIVEKEY1234567890" not in cleaned
        assert "api_key=***" in cleaned
        # The useful part survives — a scrub that destroys the diagnosis just
        # gets turned off by the next person debugging a 429.
        assert "429" in cleaned and "esearch.fcgi" in cleaned

    def test_a_key_shaped_parameter_is_scrubbed_even_if_it_is_not_ours(self):
        pubmed.configure(api_key="")
        assert "***" in pubmed.scrub("api_key=somebodyelseskey&db=pubmed")
