"""
The drug route, from the patient's sentence to the card.

The fixtures below are not invented. Both sites were read live on 2026-09-15
and these reproduce the shapes that were actually returned, including the two
that cost real debugging:

  - 1mg's search page is not server-rendered, so its JSON endpoint is the only
    way to get product links, and that endpoint needs the city as a header.
  - Both engines return SUBSTITUTES for a brand query. 1mg answers "glycomet"
    with Biciphase; PharmEasy answers it with Glidum MF. Those are different
    medicines by different manufacturers, and putting one on a card headed
    with the patient's own brand name would be the brand substitution this
    entire route exists to refuse. `test_a_substitute_is_never_returned` is
    the test that holds that line.

`scripts/verify_pharmacy_live.py` checks the same things against the live
sites. This file needs no network.
"""
import asyncio
import json

import pytest

from services.clinical.citation_guard import validate_citations
from services.clinical.drug_route import (
    extract_brand_candidates,
    looks_like_a_medicine_question,
    lookup_drug_cards,
)
from services.clinical.pharmacy_label import DISCLAIMER
from services.clinical.pharmacy_search import (
    brand_matches,
    find_product_url,
    parse_onemg_search,
    parse_pharmeasy_search,
)
from services.hermes.safety_triage import detect_prescribing_intent


# --- fixtures, transcribed from the live sites ------------------------------

PHARMEASY_SEARCH = """
<html><body>
  <a href="/online-medicine-order/glycomet-gp-1mg-strip-of-15-tablets-49203">x</a>
  <a href="/online-medicine-order/glidum-mf-1mg-strip-of-10-tablets-4029494">x</a>
  <a href="/online-medicine-order/glycomet-sr-500mg-strip-of-20-tablets-28535">x</a>
  <a href="/online-medicine-order/glycomet-500mg-strip-of-10-tablets-49207">x</a>
</body></html>
"""

ONEMG_SEARCH = json.dumps({
    "is_success": True,
    "data": {"search_results": [
        {"id": "1049886", "name": "Biciphase 500mg Tablet SR", "type": "drug",
         "url": "/drugs/biciphase-500mg-tablet-sr-1049886"},
        {"id": "0", "name": "Diabetes Screening Package", "type": "diagnostic",
         "url": "/labs/diabetes-screening-0"},
        {"id": "117725", "name": "Glycomet 500 SR Tablet", "type": "drug",
         "url": "/drugs/glycomet-500-sr-tablet-117725"},
    ]},
})

ONEMG_PRODUCT = """
<html><head><style>.Manufacturer-module__separator___P-NBE{width:100%}</style></head><body>
<div>Glycomet 500 SR Tablet</div><div>20 tablet sr</div>
<div><span>Composition</span><span>:</span><span>Metformin (500mg)</span></div>
<div><span>Marketer details</span><span>:</span><span>USV Private Limited</span></div>
<div>Prescription Required</div>
<h2>Uses of Glycomet Tablet SR</h2><ul><li>Treatment of Type 2 diabetes mellitus</li></ul>
<h2>Benefits of Glycomet Tablet SR</h2><p>Lowering blood glucose levels is an essential
part of managing diabetes.</p>
<h2>Side effects of Glycomet Tablet SR</h2>
<p>Most side effects do not require any medical attention and disappear as your body
adjusts. The common side effects of this medicine include diarrhea, nausea, vomiting,
abdominal discomfort, headache, and loss of appetite.</p>
<h2>Safety advice</h2><p>Consult your doctor.</p>
</body></html>
"""

_PE_NEXT = {"props": {"pageProps": {"productDetails": {
    "name": "Glycomet 500Mg Strip Of 10 Tablets", "isRxRequired": True,
    "consumerBrandName": "GLYCOMET", "manufacturer": "USV PVT LTD",
    "packform": "STRIP", "drugStrengthValue": "500.0", "drugStrengthUnit": "mg",
    "dosageForm": "TABLET",
    "compositions": [{"name": "Metformin Hydrochloride(500.0 Mg)"}],
}}}}

PHARMEASY_PRODUCT = (
    "<html><body><h1>Glycomet</h1>"
    "<h2>What are the uses of Glycomet 500 tablet?</h2>"
    "<p>Treatment of type 2 diabetes mellitus; Lowering high blood glucose levels</p>"
    "<h2>Side effects of Glycomet 500 tablet</h2>"
    "<p>Common side effects include nausea, vomiting, diarrhoea, and stomach pain.</p>"
    '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(_PE_NEXT)
    + "</script></body></html>"
)


def fake_fetch(routes: dict, *, fail: set = frozenset()):
    async def fetch(url, headers=None):
        if url in fail:
            raise ConnectionError("boom")
        for prefix, body in routes.items():
            if url.startswith(prefix):
                return body
        raise LookupError(f"no route for {url}")
    return fetch


BOTH = {
    "https://pharmeasy.in/search/all": PHARMEASY_SEARCH,
    "https://pharmeasy.in/online-medicine-order/": PHARMEASY_PRODUCT,
    "https://www.1mg.com/pwa-dweb-api": ONEMG_SEARCH,
    "https://www.1mg.com/drugs/": ONEMG_PRODUCT,
}


# --- the one-way rule -------------------------------------------------------

class TestTheRouteRunsOneWay:
    def test_a_named_brand_is_a_question(self):
        assert looks_like_a_medicine_question("What is Glycomet 500 used for?")
        assert extract_brand_candidates("What is Glycomet 500 used for?") == ["Glycomet 500"]

    def test_a_condition_never_becomes_a_brand(self):
        # The whole point. Nothing may turn "what do I take for X" into a name.
        assert extract_brand_candidates("what should I take for diabetes") == []
        assert extract_brand_candidates("a good medicine for hypertension") == []

    def test_a_short_indian_brand_is_not_dropped(self):
        # Pan 40 and Dolo 650 are among the most dispensed medicines in India.
        assert extract_brand_candidates("side effects of Pan 40 tablet") == ["Pan 40"]
        assert extract_brand_candidates("uses of Dolo 650") == ["Dolo 650"]

    def test_an_ordinary_turn_starts_nothing(self):
        assert not looks_like_a_medicine_question("book me an appointment next tuesday")
        assert asyncio.run(lookup_drug_cards("book me an appointment next tuesday")) == []

    def test_a_question_asked_in_hindi_still_reaches_the_route(self):
        q = "Glycomet के बारे में बताइए"
        assert looks_like_a_medicine_question(q)
        assert extract_brand_candidates(q) == ["Glycomet"]

    @pytest.mark.parametrize("query", [
        "Is Glycomet better than Glucophage?",
        "can I switch from Glycomet to Glucophage",
        "can I replace Glycomet with Glucophage",
        "is Glycomet the same as Glucophage",
        "which medicine should I take for diabetes",
    ])
    def test_a_comparison_leaves_the_pipeline_before_the_route(self, query):
        # Stage 1b in the orchestrator. If this ever returns False the route
        # would answer a brand comparison with two cards side by side.
        assert detect_prescribing_intent(query) is True


# --- finding the right product ----------------------------------------------

class TestFindingTheProduct:
    def test_pharmeasy_search_is_parsed_from_rendered_html(self):
        url, _ = parse_pharmeasy_search(PHARMEASY_SEARCH, "Glycomet 500")
        assert url.endswith("/glycomet-500mg-strip-of-10-tablets-49207")

    def test_onemg_search_is_parsed_from_its_json(self):
        url, name = parse_onemg_search(ONEMG_SEARCH, "Glycomet 500")
        assert url == "https://www.1mg.com/drugs/glycomet-500-sr-tablet-117725"
        assert name == "Glycomet 500 SR Tablet"

    def test_a_substitute_is_never_returned(self):
        # Both engines rank these above nothing; both are different medicines.
        assert brand_matches("Glycomet", "Biciphase 500mg Tablet SR") == 0
        assert brand_matches("Glycomet", "Glidum MF 1mg Strip Of 10 Tablets") == 0
        assert parse_pharmeasy_search(
            '<a href="/online-medicine-order/glidum-mf-1mg-strip-of-10-tablets-4029494">x</a>',
            "Glycomet",
        ) is None

    def test_a_more_specific_brand_wins(self):
        _, name = parse_onemg_search(json.dumps({"data": {"search_results": [
            {"name": "Glycomet 500 SR Tablet", "type": "drug", "url": "/drugs/a-1"},
            {"name": "Glycomet GP 2 Tablet PR", "type": "drug", "url": "/drugs/b-2"},
        ]}}), "Glycomet GP 2")
        assert name == "Glycomet GP 2 Tablet PR"

    def test_non_medicines_in_the_same_results_are_ignored(self):
        url, _ = parse_onemg_search(ONEMG_SEARCH, "Glycomet")
        assert "/drugs/" in url and "/labs/" not in url

    def test_malformed_json_is_not_an_exception(self):
        assert parse_onemg_search("<html>not json</html>", "Glycomet") is None

    def test_an_off_allowlist_host_is_discarded(self):
        body = json.dumps({"data": {"search_results": [
            {"name": "Glycomet 500", "type": "drug", "url": "/drugs/glycomet-1"}]}})
        hit = asyncio.run(find_product_url("Glycomet", fake_fetch({
            "https://pharmeasy.in/search/all": "<html></html>",
            "https://www.1mg.com/pwa-dweb-api": body,
        })))
        assert hit is not None and hit.url.startswith("https://www.1mg.com/")


# --- the card ---------------------------------------------------------------

class TestTheCard:
    def _cards(self, routes=None, **kw):
        return asyncio.run(lookup_drug_cards(
            "What is Glycomet 500 used for?", fetch=fake_fetch(routes or BOTH), **kw
        ))

    def test_the_patient_gets_what_they_asked_for(self):
        card = self._cards()[0]
        assert "metformin" in (card["composition"] or "").lower()
        assert card["strength"] == "500mg"
        assert card["manufacturer"]
        assert card["uses"] and card["side_effects"]
        assert card["prescription_required"] is True
        assert card["badge"] == "Prescription only"

    def test_every_card_carries_the_disclaimer_and_its_source(self):
        card = self._cards()[0]
        assert card["disclaimer"] == DISCLAIMER
        assert card["url"] in card["attribution"]
        assert card["required_display_fields"] == ["disclaimer", "attribution"]

    def test_the_card_says_what_was_searched_and_what_was_found(self):
        # So a patient can see the listing is the medicine they meant.
        card = self._cards()[0]
        assert card["searched_as"] == "Glycomet 500"
        assert card["listed_as"]

    def test_a_card_can_never_support_a_clinical_claim(self):
        # Display is allowed, citation is not. The card is `commercial`, so the
        # guard refuses it as backing for a dosing or efficacy statement in the
        # prose above it — exactly as it refuses any other pharmacy page.
        card = self._cards()[0]
        assert card["provenance_class"] == "commercial"
        result = validate_citations("Metformin reduces HbA1c by about 1%[1].", [card])
        assert not result.ok
        assert result.violations[0].kind == "unsupported_clinical_claim"

    def test_1mg_side_effects_are_read_out_of_prose_not_truncated(self):
        # The live page writes these as "...include a, b, c and d.", inside a
        # sentence that itself contains the words "side effects". Getting this
        # wrong put the single word "Most" on the card.
        card = asyncio.run(lookup_drug_cards(
            "What is Glycomet 500 used for?",
            fetch=fake_fetch({k: v for k, v in BOTH.items() if "1mg" in k}),
        ))[0]
        assert "nausea" in [s.lower() for s in card["side_effects"]]
        assert len(card["side_effects"]) >= 4

    def test_pharmeasys_structured_fields_are_used_over_its_prose(self):
        card = asyncio.run(lookup_drug_cards(
            "What is Glycomet 500 used for?",
            fetch=fake_fetch({k: v for k, v in BOTH.items() if "pharmeasy" in k}),
        ))[0]
        assert card["composition"] == "Metformin Hydrochloride(500 Mg)"
        assert card["manufacturer"] == "USV PVT LTD"
        assert card["brand"] == "Glycomet"  # not the shouted GLYCOMET


# --- failure is silence -----------------------------------------------------

class TestFailureIsSilence:
    """
    Every one of these produced an answer before the route existed, and must
    still produce one. A pharmacy being slow, blocked or redesigned is not a
    reason for a patient to see an error.
    """

    def test_a_dead_network_yields_no_cards_and_no_exception(self):
        async def fetch(url, headers=None):
            raise ConnectionError("no route to host")
        assert asyncio.run(lookup_drug_cards("What is Glycomet 500?", fetch=fetch)) == []

    def test_a_redesigned_page_yields_no_card_rather_than_an_empty_one(self):
        routes = dict(BOTH)
        routes["https://pharmeasy.in/online-medicine-order/"] = "<html><body>" + "x" * 400 + "</body></html>"
        routes["https://www.1mg.com/drugs/"] = "<html><body>" + "x" * 400 + "</body></html>"
        assert asyncio.run(lookup_drug_cards("What is Glycomet 500?", fetch=fake_fetch(routes))) == []

    def test_a_slow_pharmacy_does_not_hold_up_the_answer(self):
        async def fetch(url, headers=None):
            await asyncio.sleep(5)
            return PHARMEASY_SEARCH
        cards = asyncio.run(lookup_drug_cards(
            "What is Glycomet 500?", fetch=fetch, budget_seconds=0.1
        ))
        assert cards == []

    def test_a_brand_with_no_listing_yields_nothing(self):
        routes = {"https://pharmeasy.in/search/all": "<html></html>",
                  "https://www.1mg.com/pwa-dweb-api": json.dumps({"data": {"search_results": []}})}
        assert asyncio.run(lookup_drug_cards(
            "What is Zzzqqx 500 used for?", fetch=fake_fetch(routes))) == []

    def test_the_second_source_covers_for_the_first(self):
        routes = {k: v for k, v in BOTH.items() if "1mg" in k}
        cards = asyncio.run(lookup_drug_cards(
            "What is Glycomet 500 used for?",
            fetch=fake_fetch(routes, fail={"https://pharmeasy.in/search/all?name=Glycomet+500"}),
        ))
        assert len(cards) == 1
        assert cards[0]["url"].startswith("https://www.1mg.com/")


class TestTheFetchPathIsNotAnOpenDoor:
    """
    Found in review, not in an incident.

    The product URL comes back from a pharmacy's own search response, so it is
    not ours. Checking the allowlist before the request is the obvious half.
    The half that is easy to miss: redirects were followed, so an open redirect
    on a pharmacy domain would have let the body PAL parses — and attributes
    to that pharmacy on the card — come from anywhere the server pointed at,
    including an address inside our own network.
    """

    def test_a_url_outside_the_allowlist_is_never_requested(self):
        from services.clinical.drug_route import httpx_fetch

        with pytest.raises(ValueError, match="allowlist"):
            asyncio.run(httpx_fetch("https://evil.example/drugs/x"))

    def test_a_lookalike_host_does_not_pass(self):
        from services.clinical.drug_route import httpx_fetch

        for url in (
            "https://pharmeasy.in.evil.example/x",
            "https://not1mg.com/drugs/x",
            "http://169.254.169.254/latest/meta-data/",
        ):
            with pytest.raises(ValueError, match="allowlist"):
                asyncio.run(httpx_fetch(url))

    def test_the_page_body_is_capped(self):
        from services.clinical import drug_route

        # A pharmacy page is a few hundred KB; the cap is an order of
        # magnitude above that, so it can only fire on something abnormal.
        assert drug_route.MAX_PAGE_BYTES >= 1_000_000

    def test_an_enormous_turn_is_not_walked_end_to_end(self):
        from services.clinical.drug_route import MAX_QUERY_CHARS

        from services.clinical.drug_route import MAX_CANDIDATES

        pasted = "What is Glycomet 500? " + ("filler text " * 200_000)
        assert len(pasted) > MAX_QUERY_CHARS * 10

        candidates = extract_brand_candidates(pasted)
        # Bounded, and the brand the patient actually asked about is found.
        # The other candidate is a guess, and a guess costs nothing: no
        # pharmacy returns a product whose name carries it, so no card.
        assert candidates[0] == "Glycomet 500"
        assert len(candidates) <= MAX_CANDIDATES
