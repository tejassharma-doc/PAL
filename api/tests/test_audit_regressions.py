"""
One test per defect found in the adversarial review of 16 September 2026.

These are here to stop specific things coming back, so each one names the
defect rather than the function. Ordered by how much harm the defect could do
to a patient, not by module.
"""
import asyncio
import json
import time

import pytest

from services.clinical import pubmed
from services.clinical.drug_name_guard import normalise_name
from services.clinical.drug_route import extract_brand_candidates, httpx_fetch
from services.clinical.pharmacy_label import _text_of, extract_generic, extract_label
from services.clinical.pharmacy_search import _best, brand_matches
from services.clinical.pubmed import _parse_articles
from services.clinical.sources import is_pharmacy_url


@pytest.fixture(autouse=True)
def clean_config():
    pubmed.reset_config()
    yield
    pubmed.reset_config()


class TestASubstituteCanNeverWearThePatientsBrandName:
    """
    The worst defect found. `brand_matches` checked only the FIRST word of the
    brand, so "Glycomet" matched "Glycomet GP 1" with an identical score, and
    the tie was broken by the pharmacy's own relevance ranking — the very
    thing the module exists to distrust.

    Glycomet is metformin. Glycomet GP adds glimepiride, a sulfonylurea that
    causes hypoglycaemia. A patient reading a card headed "Glycomet" would
    have been reading the label of a drug that can put them in an ambulance.
    """

    @pytest.mark.parametrize("brand,listing", [
        ("Glycomet", "Glycomet GP 1 Tablet"),        # + glimepiride
        ("Glycomet 500", "Glycomet GP 1 Tablet"),
        ("Ecosprin 75", "Ecosprin AV 75 Capsule"),   # + atorvastatin
        ("Ecosprin 75", "Ecosprin Gold 75 Capsule"),
        ("Pan 40", "Pan D Tablet"),                  # + domperidone
        ("Glycomet 500", "glycomet gp 1mg strip of 15 tablets 49203"),
    ])
    def test_an_extra_ingredient_is_a_different_medicine(self, brand, listing):
        assert brand_matches(brand, listing) == 0

    @pytest.mark.parametrize("brand,listing", [
        ("Pan D", "Pan 40 Tablet"),                  # missing the domperidone
        ("Glycomet GP 2", "Glycomet 500 SR Tablet"),
    ])
    def test_a_missing_ingredient_is_also_a_different_medicine(self, brand, listing):
        assert brand_matches(brand, listing) == 0

    @pytest.mark.parametrize("brand,listing", [
        ("Glycomet", "Glycomet 500 Tablet"),
        ("Glycomet 500", "glycomet 500mg strip of 10 tablets 49207"),
        ("Glycomet 500", "Glycomet 500 SR Tablet"),   # formulation, not molecule
        ("Glycomet GP 2", "Glycomet GP 2 Tablet PR"),
    ])
    def test_the_right_medicine_still_matches(self, brand, listing):
        assert brand_matches(brand, listing) > 0

    def test_the_tie_is_no_longer_broken_by_the_pharmacys_ranking(self):
        found = _best("Glycomet", [
            ("u/gp", "Glycomet GP 1 Tablet"),        # ranked first by 1mg
            ("u/500", "Glycomet 500 Tablet"),
        ])
        assert found == ("u/500", "Glycomet 500 Tablet")

    def test_an_unnamed_listing_is_rejected_not_matched_against_its_url(self):
        # Scoring fell back to the URL, so "1mg" matched every product on
        # 1mg.com because the host is in the path.
        assert _best("1mg", [("https://www.1mg.com/drugs/anything-1", "")]) is None

    def test_a_brand_written_in_devanagari_digits_still_matches(self):
        # Python's \\d is Unicode-aware, so "५००" shared no digit run with
        # "500" and scored zero — a silent miss in the languages this serves.
        assert normalise_name("Glycomet ५००") == "glycomet 500"
        assert brand_matches("Glycomet ५००", "Glycomet 500 Tablet") > 0


class TestTheYearOnACitationIsThePublicationYear:
    """
    `_parse_articles` took the first <Year> in the record. In the NLM DTD that
    is DateCompleted, or DateRevised on an ahead-of-print record — an indexing
    date, never the publication date.

    A 1997 paper with DateRevised 2021 was read as 2021: it passed the year
    floor, was shown to the patient dated 2021, and `filter_by_year` — the
    check that exists to catch exactly this — waved it through, because it was
    reading the wrong element.
    """

    def _one(self, xml):
        return _parse_articles(
            "<PubmedArticleSet><PubmedArticle><MedlineCitation>" + xml
            + "</MedlineCitation></PubmedArticle></PubmedArticleSet>"
        )[0]

    def test_daterevised_is_not_mistaken_for_publication(self):
        article = self._one(
            "<PMID>1</PMID><DateRevised><Year>2021</Year></DateRevised>"
            "<Article><Journal><JournalIssue><PubDate><Year>1997</Year></PubDate>"
            "</JournalIssue></Journal><Abstract><AbstractText>x</AbstractText>"
            "</Abstract></Article>"
        )
        assert article.year == "1997"
        assert article.published_since(2000) is False

    def test_datecompleted_is_not_mistaken_for_publication(self):
        article = self._one(
            "<PMID>2</PMID><DateCompleted><Year>2020</Year></DateCompleted>"
            "<Article><Journal><JournalIssue><PubDate><Year>2019</Year>"
            "<Month>Dec</Month></PubDate></JournalIssue></Journal>"
            "<Abstract><AbstractText>x</AbstractText></Abstract></Article>"
        )
        assert article.year == "2019"

    def test_a_date_range_is_read(self):
        article = self._one(
            "<PMID>3</PMID><DateRevised><Year>2018</Year></DateRevised>"
            "<Article><Journal><JournalIssue><PubDate>"
            "<MedlineDate>2003 Jan-Feb</MedlineDate></PubDate></JournalIssue>"
            "</Journal><Abstract><AbstractText>x</AbstractText></Abstract></Article>"
        )
        assert article.year == "2003"

    def test_a_requested_floor_reaches_the_search_not_just_the_local_filter(self):
        assert pubmed.date_window(min_year=2015)["mindate"] == "2015/01/01"


class TestTheFetcherCannotBeWalkedOffTheAllowlist:
    """
    `follow_redirects=True` validates nothing: httpx walks the whole chain
    internally, so checking the final URL meant every intermediate hop had
    already been requested. An open redirect on a pharmacy host — and the
    starting URL comes from a pharmacy's own search results — was enough to
    make PAL issue a GET against any address reachable from our network.
    """

    def test_an_intermediate_hop_is_checked_before_it_is_requested(self):
        import httpx

        issued = []

        def handler(request):
            url = str(request.url)
            issued.append(url)
            if url.startswith("https://pharmeasy.in/online-medicine-order/"):
                return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
            if "169.254" in url:
                return httpx.Response(302, headers={"location": "https://pharmeasy.in/final"})
            return httpx.Response(200, text="<html>" + "x" * 400 + "</html>")

        real = httpx.AsyncClient

        class Patched(real):
            def __init__(self, *a, **k):
                k["transport"] = httpx.MockTransport(handler)
                super().__init__(*a, **k)

        httpx.AsyncClient = Patched
        try:
            with pytest.raises(ValueError, match="allowlist"):
                asyncio.run(httpx_fetch("https://pharmeasy.in/online-medicine-order/glycomet-500-123"))
        finally:
            httpx.AsyncClient = real

        assert not any("169.254" in u for u in issued), issued

    @pytest.mark.parametrize("url", [
        "file://1mg.com/etc/passwd",
        "gopher://1mg.com:6379/_FLUSHALL",
    ])
    def test_only_http_schemes_satisfy_the_allowlist(self, url):
        assert is_pharmacy_url(url) is False


class TestOnePageCannotStallEveryOtherRequest:
    """
    `<(script|style)\\b[^>]*>.*?</\\1>` rescans to end-of-document from every
    unclosed opening tag: 11 s at 8,000 stray tags, 26 s at 16,000, and a 4 MB
    page never finished. It is synchronous work on the event loop, so the
    12-second budget could not interrupt it and every other request in the
    process waited behind it.
    """

    def test_a_page_full_of_unclosed_script_tags_is_fast(self):
        page = "<script>" * 16000 + ("body text " * 20000)
        started = time.monotonic()
        _text_of(page)
        assert time.monotonic() - started < 1.0

    def test_script_contents_still_never_reach_the_card(self):
        assert "secret" not in _text_of("<p>ok</p><script>var secret=1</script>")
        # Unclosed: the remainder is dropped rather than parsed.
        assert "secret" not in _text_of("<p>ok</p><script>var secret=1")


class TestTheCardSaysWhatThePageSaid:
    """
    Every one of these put wrong text on a patient's card.
    """

    def _label(self, html, brand="Glycomet 850"):
        return extract_generic(html, brand=brand, url="https://pharmeasy.in/x", source_name="s")

    def test_a_strength_is_taken_from_the_composition_not_from_an_advert(self):
        label = self._label(
            "<div>Extra 15% off</div><div>Free gift: 100 g sanitiser</div>"
            "<h1>Dolo 650</h1><div>Composition : Paracetamol (650mg)</div>",
            brand="Dolo 650",
        )
        assert label.strength == "650mg"

    def test_a_similar_products_link_cannot_contradict_the_composition(self):
        # The dangerous one: the card stated a strength its own composition
        # line disagreed with, and the patient had no way to tell which was right.
        label = self._label(
            "<nav>Similar: Metformin 500mg Tablet</nav><h1>Glycomet 850</h1>"
            "<div>Composition : Metformin (850mg)</div>"
        )
        assert label.composition == "Metformin (850mg)"
        assert label.strength == "850mg"

    def test_small_print_does_not_become_the_manufacturer(self):
        label = self._label(
            "<p>The manufacturer and the marketplace are not liable for any misuse "
            "of this product.</p><div>Marketer details : USV Private Limited</div>"
        )
        assert label.manufacturer == "USV Private Limited"

    def test_the_word_decomposition_does_not_become_the_composition(self):
        label = self._label(
            "<p>Store below 25C to avoid decomposition of the active ingredient</p>"
            "<div>Composition : Paracetamol (650mg)</div>"
        )
        assert label.composition == "Paracetamol (650mg)"

    def test_misuses_of_is_not_a_uses_heading(self):
        # Produced uses = ['ependence'] — a mid-word fragment, from a sentence
        # that was not a uses section at all.
        label = self._label(
            "<h2>Overview</h2><p>The misuses of this medicine include recreational "
            "sedation, euphoria and dependence.</p>"
            "<div>Composition : Alprazolam (0.5mg)</div>"
        )
        assert label.uses == []

    def test_entities_are_decoded_once_and_completely(self):
        # The hand-rolled table replaced &amp; first, so it decoded
        # recursively: "&amp;lt;b&amp;gt;" came back as real markup.
        text = _text_of("<p>&amp;lt;b&amp;gt; caf&#233; &rsquo;s</p>")
        assert "<b>" not in text
        assert "café" in text and "’" in text


class TestAFailureCostsTheCardNotTheTurn:
    def test_hostile_json_does_not_raise(self):
        payload = {"props": {"pageProps": {"productDetails": {
            "compositions": [{"name": 5}], "consumerBrandName": 123,
            "manufacturer": 7, "isRxRequired": True,
        }}}}
        html = '<script id="__NEXT_DATA__">' + json.dumps(payload) + "</script>" + "<p>x</p>" * 50
        label = extract_label(html, brand="Glycomet", url="https://pharmeasy.in/x", source_name="PharmEasy")
        assert label.brand == "Glycomet"          # not the integer 123

    def test_an_ncbi_holding_page_is_a_retrieval_failure_not_an_absence(self):
        async def boom(client, term, retmax, recent_years, min_year=None):
            raise pubmed.PubmedUnavailable("esearch did not return JSON")

        original = pubmed._esearch
        pubmed._esearch = boom
        try:
            found, ok = asyncio.run(pubmed.search_pubmed_many(["metformin safety"]))
        finally:
            pubmed._esearch = original
        assert found == [] and ok is False       # ok=False is the whole point

    def test_an_unbalanced_query_cannot_produce_a_term_ncbi_rejects(self):
        term = pubmed.build_term("aspirin (ASA) dosing)")
        assert term.count("(") == term.count(")")
        assert "humans[MeSH Terms]" in term

    def test_a_zero_setting_cannot_silently_switch_retrieval_off(self):
        assert pubmed.configure(min_year=0).min_year == 2000
        assert pubmed.configure(max_results=-4).max_results == 8

    def test_a_string_setting_is_coerced_rather_than_stored(self):
        config = pubmed.configure(min_year="2010")
        assert config.min_year == 2010 and isinstance(config.min_year, int)


class TestTheRightMedicineIsActuallyLookedUp:
    @pytest.mark.parametrize("query,expected", [
        ("Hello sir, tell me about Glycomet 500", "Glycomet 500"),
        ("Namaste doctor ji, what is Ecosprin 75 tablet", "Ecosprin 75"),
        ("hi, kindly tell me what is Shelcal 500 used for", "Shelcal 500"),
    ])
    def test_a_greeting_does_not_consume_the_lookup_budget(self, query, expected):
        # "Hello" and "sir" took both slots and the medicine was never looked
        # up — a silent miss, and a likely one in the target cohort.
        assert extract_brand_candidates(query)[0] == expected

    @pytest.mark.parametrize("query", [
        "what tablet is used for treating asthma",
        "what is the medicine for the treatment of hypertension",
        "tell me about the drug used in treating depression",
    ])
    def test_a_condition_is_never_sent_to_a_pharmacy(self, query):
        # Two harms, not one: it inverts the one-way rule, and it puts the
        # patient's condition into a third party's URL.
        assert extract_brand_candidates(query) == []

    @pytest.mark.parametrize("query,expected", [
        ("I was given Augmentin 3 times a day", "Augmentin"),
        ("I take Dolo 4 times daily", "Dolo"),
    ])
    def test_a_dose_schedule_is_not_glued_on_as_a_strength(self, query, expected):
        # "Augmentin 3" matches no listing, so a correctly named medicine
        # silently produced no card.
        assert extract_brand_candidates(query) == [expected]

    @pytest.mark.parametrize("query,expected", [
        ("side effects of Pan 40 tablet", "Pan 40"),
        ("uses of Dolo 650", "Dolo 650"),
    ])
    def test_a_real_strength_is_still_kept(self, query, expected):
        assert extract_brand_candidates(query) == [expected]

    @pytest.mark.parametrize("query", [
        "what are the risks of surgery",
        "tell me about my next appointment",
    ])
    def test_everyday_nouns_are_not_searched_on_a_pharmacy(self, query):
        assert extract_brand_candidates(query) == []


class TestALabelStatementIsNotAClinicalClaim:
    """
    Found by role-playing a patient conversation through the shipped code,
    which is a different exercise from reading it.

    The drug route exists to state what a label says. The guard refused
    exactly that: "Glycomet 500 contains metformin hydrochloride 500mg[1]"
    tripped the dose-units cue, and there is no human study behind a
    composition because a composition is not a finding — it is what is printed
    on the strip. Left alone, the synthesiser could never state the contents
    of the card sitting beside it, and the display-versus-cite distinction the
    whole design rests on would have collapsed the first time a patient asked
    about a medicine.

    The exemption is narrow by construction, so the tests that matter most
    here are the ones asserting what it still refuses.
    """

    CARD = {"url": "https://pharmeasy.in/x", "provenance_class": "commercial", "phi": False}
    STUDY = {"url": "https://pubmed.ncbi.nlm.nih.gov/1/",
             "provenance_class": "peer-reviewed-human", "phi": False}

    @pytest.mark.parametrize("sentence", [
        "Glycomet 500 contains metformin hydrochloride 500mg[1].",
        "Its composition is pantoprazole 40mg[1].",
        "Each tablet contains 500mg of calcium carbonate[1].",
        "It is marketed by USV Private Limited[1].",
        "It is available as a strip of 10 tablets[1].",
    ])
    def test_what_is_printed_on_the_pack_may_cite_the_pack(self, sentence):
        from services.clinical.citation_guard import validate_citations

        assert validate_citations(sentence, [self.CARD]).ok

    @pytest.mark.parametrize("sentence", [
        "Take 500 mg twice daily[1].",                                  # instruction
        "The usual dose is 500mg[1].",                                  # dosing
        "Metformin reduces HbA1c by about 1%[1].",                      # efficacy
        "It contains 500mg and reduces HbA1c by 1%[1].",                # smuggled in
        "It contains 500mg and is safe in pregnancy[1].",               # safety
        "It contains 500mg; common side effects include nausea[1].",    # harms
        "Glycomet 500 contains metformin 500mg and treats type 2 diabetes[1].",
    ])
    def test_a_clinical_claim_cannot_ride_along_with_one(self, sentence):
        from services.clinical.citation_guard import validate_citations

        result = validate_citations(sentence, [self.CARD])
        assert not result.ok
        assert result.violations[0].kind == "unsupported_clinical_claim"

    def test_the_exemption_relaxes_which_source_not_whether_one_is_needed(self):
        from services.clinical.citation_guard import validate_citations

        assert not validate_citations("It contains 500mg.", [self.CARD]).ok
        assert not validate_citations("It contains 500mg[1].", []).ok

    def test_a_ranking_is_still_refused_whatever_it_cites(self):
        from services.clinical.citation_guard import validate_citations

        assert not validate_citations("Glycomet is better than Glucophage[1].", [self.STUDY]).ok
