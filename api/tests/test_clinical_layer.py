"""
Tests for the clinical layer: provenance classes, source allowlist, the PubMed
term builder, the drug name-provenance guard and the citation guard.

Deliberately dependency-free — no database, no network, no SQLAlchemy. Rules
that are awkward to run stop being run.
"""
import pytest

from services.clinical.provenance import (
    ProvenanceClass,
    may_support_clinical_claim,
    context_contains_phi,
)
from services.clinical.sources import (
    classify_url,
    is_allowed_journal_url,
    is_pharmacy_url,
    journal_site_query,
)
from services.clinical.drug_name_guard import guard_names
from services.clinical.citation_guard import validate_citations, build_repair_instruction
from services.clinical.pubmed import build_term, _parse_articles


class TestProvenance:
    def test_only_two_classes_may_support_a_clinical_claim(self):
        assert may_support_clinical_claim("peer-reviewed-human")
        assert may_support_clinical_claim("clinician-canonical")
        assert not may_support_clinical_claim("commercial")
        assert not may_support_clinical_claim("editorial-clinical")
        assert not may_support_clinical_claim("peer-reviewed-other")

    def test_phi_detection_drives_model_selection(self):
        clean = [{"provenance_class": "peer-reviewed-human", "phi": False}]
        with_record = clean + [{"provenance_class": "patient-record", "phi": True}]
        assert context_contains_phi(clean) is False
        assert context_contains_phi(with_record) is True

    def test_patient_record_counts_even_without_an_explicit_flag(self):
        assert context_contains_phi([{"provenance_class": "patient-record"}]) is True


class TestSourceAllowlist:
    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://www.nejm.org/doi/full/10.1056/x", "peer-reviewed-other"),
            ("https://www.bmj.com/content/1", "peer-reviewed-other"),
            ("https://www.biorxiv.org/content/1", "peer-reviewed-other"),
            ("https://emedicine.medscape.com/article/1", "editorial-clinical"),
            ("https://www.mohfw.gov.in/guidance", "editorial-clinical"),
            ("https://www.tata1mg.com/drugs/glycomet", "commercial"),
            ("https://pharmeasy.in/online-medicine-order/x", "commercial"),
            ("https://healthblog.example.com/post", None),
        ],
    )
    def test_domain_to_provenance(self, url, expected):
        assert classify_url(url) == expected

    def test_journal_domains_are_not_promoted_to_human_studies(self):
        # A domain establishes peer review. It does not establish that the
        # study was in humans — only the filtered PubMed path can.
        assert classify_url("https://www.nature.com/articles/x") != "peer-reviewed-human"

    def test_host_filter_is_the_guarantee_not_the_site_operator(self):
        assert is_allowed_journal_url("https://www.bmj.com/content/1")
        assert not is_allowed_journal_url("https://healthblog.example.com/post")
        # A lookalike host must not slip through a naive endswith check.
        assert not is_allowed_journal_url("https://notbmj.com/content/1")
        assert not is_allowed_journal_url("https://bmj.com.evil.example/x")

    def test_pharmacy_detector(self):
        assert is_pharmacy_url("https://pharmeasy.in/x")
        assert not is_pharmacy_url("https://www.nejm.org/x")

    def test_site_query_carries_the_allowlist(self):
        q = journal_site_query("metformin prediabetes")
        assert "site:nejm.org" in q and "site:medscape.com" in q


class TestPubmedTerm:
    def test_humans_filter_is_present_by_default(self):
        assert build_term("metformin prediabetes") == (
            "(metformin prediabetes) AND humans[MeSH Terms]"
        )

    def test_high_evidence_adds_publication_types(self):
        term = build_term("x", "high_evidence")
        assert "humans[MeSH Terms]" in term
        assert "randomized controlled trial[pt]" in term
        assert "systematic review[pt]" in term

    def test_none_leaves_the_query_bare(self):
        assert build_term("x", "none") == "(x)"

    def test_abstract_parsing(self):
        xml = """
        <PubmedArticleSet><PubmedArticle>
          <MedlineCitation>
            <PMID Version="1">12345678</PMID>
            <Article>
              <ArticleTitle>Metformin in prediabetes</ArticleTitle>
              <Abstract><AbstractText>HbA1c fell by 0.4%.</AbstractText></Abstract>
              <Journal><ISOAbbreviation>Lancet</ISOAbbreviation>
                <JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue>
              </Journal>
              <PublicationTypeList>
                <PublicationType>Randomized Controlled Trial</PublicationType>
              </PublicationTypeList>
            </Article>
            <MeshHeadingList>
              <MeshHeading><DescriptorName UI="D006801">Humans</DescriptorName></MeshHeading>
              <MeshHeading><DescriptorName UI="D008687">Metformin</DescriptorName></MeshHeading>
            </MeshHeadingList>
          </MedlineCitation>
        </PubmedArticle></PubmedArticleSet>
        """
        articles = _parse_articles(xml)
        assert len(articles) == 1
        a = articles[0]
        assert a.pmid == "12345678"
        assert a.abstract == "HbA1c fell by 0.4%."
        assert a.year == "2024"
        assert "Randomized Controlled Trial" in a.publication_types
        assert "Humans" in a.mesh_terms
        assert a.is_human_study
        # Established by the RECORD, not assumed from the query or the journal.
        assert a.to_citation()["provenance_class"] == "peer-reviewed-human"

    def test_an_article_without_the_humans_descriptor_is_downgraded(self):
        """
        Failing quiet becomes failing safe.

        If the filter ever broke — a syntax change at NCBI, a bad refactor —
        animal work would come back under a query that claims to be human-only.
        Because provenance is read from each record's MeSH headings rather than
        inferred from the query, such an article drops to peer-reviewed-other
        and the citation guard then refuses it as support for a clinical claim.
        """
        from services.clinical.pubmed import PubmedArticle

        a = PubmedArticle(pmid="1", title="t", abstract="x", journal="j", year="2024",
                          mesh_terms=["Mice", "Metformin"])
        assert not a.is_human_study
        assert a.to_citation()["provenance_class"] == "peer-reviewed-other"

        a.mesh_terms.append("Humans")
        assert a.is_human_study
        assert a.to_citation()["provenance_class"] == "peer-reviewed-human"


class TestDrugNameGuard:
    def test_a_name_the_patient_typed_is_allowed(self):
        allowed, rejected = guard_names(["Glycomet"], "what is Glycomet 500 used for")
        assert allowed == ["Glycomet"] and rejected == []

    def test_casing_and_punctuation_are_ignored(self):
        allowed, _ = guard_names(["glycomet-500"], "What is GLYCOMET 500?")
        assert allowed == ["glycomet-500"]

    def test_a_name_derived_from_a_condition_is_rejected(self):
        # The failure this guard exists to prevent: the model inferring a drug
        # from a condition and passing it in as though the patient named it.
        allowed, rejected = guard_names(["metformin"], "what should I take for diabetes")
        assert allowed == [] and rejected == ["metformin"]

    def test_mixed_batch_splits_correctly(self):
        allowed, rejected = guard_names(
            ["Glycomet", "Januvia"], "is Glycomet ok for me"
        )
        assert allowed == ["Glycomet"] and rejected == ["Januvia"]

    def test_comparison_keeps_both_names_the_patient_typed(self):
        allowed, _ = guard_names(
            ["Glycomet", "Glucophage"], "is Glycomet better than Glucophage"
        )
        assert len(allowed) == 2

    def test_devanagari_name_survives_normalisation(self):
        allowed, _ = guard_names(["मेटफॉर्मिन"],
                                 "मेटफॉर्मिन क्या है")
        assert len(allowed) == 1


class TestCitationGuard:
    CITATIONS = [
        {"provenance_class": "peer-reviewed-human", "title": "trial"},
        {"provenance_class": "commercial", "title": "1mg listing"},
        {"provenance_class": "editorial-clinical", "title": "medscape"},
    ]

    def test_claim_citing_a_human_study_passes(self):
        r = validate_citations(
            "Metformin reduces progression to type 2 diabetes[1].", self.CITATIONS
        )
        assert r.ok

    def test_claim_citing_only_a_pharmacy_page_is_caught(self):
        r = validate_citations(
            "Metformin reduces progression to type 2 diabetes[2].", self.CITATIONS
        )
        assert not r.ok
        assert r.violations[0].kind == "unsupported_clinical_claim"

    def test_dose_citing_an_editorial_source_is_caught(self):
        r = validate_citations(
            "The usual starting dose is 500 mg twice daily[3].", self.CITATIONS
        )
        assert not r.ok

    def test_non_clinical_sentence_citing_commerce_is_fine(self):
        r = validate_citations(
            "A strip of ten tablets costs about 25 rupees[2].", self.CITATIONS
        )
        assert r.ok

    def test_ranking_is_caught_even_with_a_perfect_citation(self):
        r = validate_citations(
            "Glycomet is better than Glucophage for most people[1].", self.CITATIONS
        )
        assert not r.ok
        assert r.violations[0].kind == "ranking"

    def test_uncited_clinical_claim_is_caught(self):
        r = validate_citations("Metformin lowers blood sugar.", self.CITATIONS)
        assert not r.ok

    def test_repair_instruction_names_the_offending_sentences(self):
        r = validate_citations(
            "Metformin reduces progression to type 2 diabetes[2].", self.CITATIONS
        )
        instruction = build_repair_instruction(r)
        assert "peer-reviewed-human" in instruction
        assert "Metformin reduces progression" in instruction


class TestRetentionGate:
    """
    What may become durable memory. The failure this closes: the raw Q&A was
    retained every turn, and fell back to the PATIENT bank when there was no
    conversation id — so model output entered permanent patient memory, where
    Hindsight consolidates it into Observations and recalls it as fact.
    """

    CONV = "11111111-2222-3333-4444-555555555555"

    def test_normal_turn_retains_to_the_conversation_bank(self):
        from services.clinical.retention import gate_turn, RetentionClass

        d = gate_turn(query="what is metformin", answer_text="It is a medicine.",
                      conversation_id=self.CONV)
        assert d.retain
        assert d.bank_id == f"conversation-{self.CONV}"
        assert d.retention_class == RetentionClass.assistant_generated

    def test_answer_path_never_writes_to_the_patient_bank(self):
        from services.clinical.retention import gate_turn

        d = gate_turn(query="q", answer_text="a", conversation_id=None)
        assert not d.retain
        assert d.bank_id is None

    def test_flagged_answer_content_is_not_retained(self):
        # The ANSWER must not persist — retaining an unsupported clinical claim
        # would let it ground later turns. The turn marker still keeps the
        # thread grouped; see TestRetentionContinuity.
        from services.clinical.retention import gate_turn, RetentionClass, format_retention_record

        d = gate_turn(query="does it work", answer_text="it cures diabetes",
                      conversation_id=self.CONV, citation_guard_flagged=True)
        assert d.retention_class == RetentionClass.turn_marker
        record = format_retention_record(
            query="does it work", answer_text="it cures diabetes", decision=d
        )
        assert "cures diabetes" not in record

    @pytest.mark.parametrize("category", ["emergency", "crisis"])
    def test_safety_screen_content_is_not_retained(self, category):
        from services.clinical.retention import gate_turn, RetentionClass, format_retention_record

        query = "I want to die"
        d = gate_turn(query=query, answer_text="helpline",
                      conversation_id=self.CONV, safety_category=category)
        assert d.retention_class == RetentionClass.turn_marker
        record = format_retention_record(query=query, answer_text="helpline", decision=d)
        # Neither the disclosure nor the safety copy may resurface in recall.
        assert query not in record
        assert "helpline" not in record

    def test_prescribing_refusal_retains_no_answer(self):
        from services.clinical.retention import gate_turn, RetentionClass, format_retention_record

        d = gate_turn(query="what should I take", answer_text="see your doctor",
                      conversation_id=self.CONV, prescribing_intent=True)
        assert d.retention_class == RetentionClass.turn_marker
        record = format_retention_record(
            query="what should I take", answer_text="see your doctor", decision=d
        )
        assert "No clinical answer was given" in record

    def test_retained_record_is_labelled_as_assistant_output(self):
        # The labels are the insurance against the attribution error: an
        # Observation built from labelled text is far less likely to be
        # recalled as "the patient has X".
        from services.clinical.retention import gate_turn, format_retention_record

        d = gate_turn(query="my mother has diabetes", answer_text="Diabetes is...",
                      conversation_id=self.CONV)
        record = format_retention_record(
            query="my mother has diabetes", answer_text="Diabetes is...", decision=d
        )
        assert "assistant-generated" in record
        assert "NOT an established fact about the patient" in record


class TestDrugResolver:
    def test_default_resolver_returns_nothing_rather_than_guessing(self):
        from services.clinical.drug_resolver import get_resolver

        assert get_resolver().resolve("Glycomet") is None

    def test_table_resolver_exact_match_only(self):
        # No fuzzy matching by design: a near miss on a brand name is a
        # different medicine, and "close enough" is how a patient reads about
        # the wrong drug.
        from services.clinical.drug_resolver import TableResolver

        r = TableResolver.from_rows([
            {"brand": "Glycomet 500", "molecule": "Metformin hydrochloride 500mg",
             "manufacturer": "USV", "schedule": "H", "ceiling_price_inr": 24.5},
        ])
        assert r.resolve("glycomet 500") is not None
        assert r.resolve("GLYCOMET-500") is not None
        assert r.resolve("Glycomet 1000") is None

    def test_resolved_record_is_commercial_provenance(self):
        from services.clinical.drug_resolver import TableResolver

        r = TableResolver.from_rows([
            {"brand": "Glycomet 500", "molecule": "Metformin hydrochloride 500mg"},
        ])
        chunk = r.resolve("Glycomet 500").to_chunk()
        assert chunk["provenance_class"] == "commercial"
        assert chunk["phi"] is False

    def test_coverage_report_measures_before_you_buy(self):
        from services.clinical.drug_resolver import TableResolver, coverage_report

        r = TableResolver.from_rows([{"brand": "Glycomet 500", "molecule": "Metformin 500mg"}])
        report = coverage_report(r, ["Glycomet 500", "Januvia", "Istamet"])
        assert report.total == 3 and report.resolved == 1
        assert report.misses == ["Januvia", "Istamet"]


class TestPharmacyLabel:
    """
    Label information shown as a card, attributed, with a disclaimer — and
    still `commercial` provenance, so the citation guard keeps refusing it as
    support for a clinical claim in prose. That separation is the whole point:
    showing what the label says is fine; citing a pharmacy for a dose is not.
    """

    FIXTURE = """
    <html><body>
      <h1>Glycomet 500 Tablet</h1>
      <div>SALT COMPOSITION: Metformin (500mg)</div>
      <div>Manufacturer: USV Private Limited</div>
      <div>Prescription Required</div>
      <p>Glycomet 500 Tablet is used in the treatment of type 2 diabetes mellitus.
         It is prescribed alongside diet and exercise.</p>
      <h2>Uses of Glycomet</h2>
      <p>Treatment of type 2 diabetes mellitus; Control of blood sugar levels</p>
      <h2>Side effects of Glycomet</h2>
      <p>Nausea; Vomiting; Diarrhoea; Stomach pain; Loss of appetite</p>
    </body></html>
    """

    def _label(self):
        from services.clinical.pharmacy_label import extract_label

        return extract_label(
            self.FIXTURE,
            brand="Glycomet 500",
            url="https://www.tata1mg.com/drugs/glycomet-500-tablet-123",
            source_name="1mg",
        )

    def test_extracts_the_fields_a_patient_asked_for(self):
        label = self._label()
        assert label.composition and "metformin" in label.composition.lower()
        assert label.strength == "500mg"
        assert label.manufacturer and "USV" in label.manufacturer
        assert label.uses
        assert label.side_effects

    def test_prescription_only_is_detected(self):
        assert self._label().prescription_required is True

    def test_card_always_carries_the_disclaimer_and_attribution(self):
        from services.clinical.pharmacy_label import build_label_card, DISCLAIMER

        card = build_label_card(self._label())
        assert card["disclaimer"] == DISCLAIMER
        assert "1mg" in card["attribution"]
        assert card["required_display_fields"] == ["disclaimer", "attribution"]
        assert card["badge"] == "Prescription only"

    def test_disclaimer_sends_the_patient_to_their_doctor(self):
        from services.clinical.pharmacy_label import DISCLAIMER

        assert "not advice to take it" in DISCLAIMER
        assert "ask" in DISCLAIMER and "doctor" in DISCLAIMER

    def test_label_stays_commercial_provenance(self):
        from services.clinical.pharmacy_label import build_label_card

        assert build_label_card(self._label())["provenance_class"] == "commercial"

    def test_a_label_can_never_support_a_clinical_claim_in_prose(self):
        # The separation that makes the card safe: display is allowed,
        # citation is not. This is the test that would fail if someone
        # "helpfully" promoted pharmacy provenance later.
        from services.clinical.pharmacy_label import build_label_card

        card = build_label_card(self._label())
        r = validate_citations(
            "Metformin reduces HbA1c by about 1%[1].", [card]
        )
        assert not r.ok
        assert r.violations[0].kind == "unsupported_clinical_claim"

    def test_thin_page_yields_nothing_rather_than_an_empty_card(self):
        import asyncio
        from services.clinical.pharmacy_label import PharmacyLabelResolver

        async def fetch(url):
            return "<html><body><h1>Some Brand</h1></body></html>" + "x" * 300

        resolver = PharmacyLabelResolver(fetch)
        out = asyncio.run(resolver.resolve("Some Brand", "https://pharmeasy.in/x", "PharmEasy"))
        assert out is None

    def test_fetch_failure_is_not_an_exception(self):
        import asyncio
        from services.clinical.pharmacy_label import PharmacyLabelResolver

        async def fetch(url):
            raise ConnectionError("boom")

        resolver = PharmacyLabelResolver(fetch)
        assert asyncio.run(resolver.resolve("X", "https://pharmeasy.in/x", "PharmEasy")) is None


class TestRetentionContinuity:
    """
    Refused turns must not leave a hole in the thread.

    The grouped retention exists because the model was treating each turn as
    isolated context. A gate that drops refused turns entirely would reopen
    exactly that problem — a follow-up like "ok, then what is metformin" is
    unintelligible if the previous turn vanished.
    """

    CONV = "aaaa-bbbb-cccc"

    def test_prescribing_refusal_keeps_the_thread(self):
        from services.clinical.retention import gate_turn, RetentionClass

        d = gate_turn(query="what should I take for sugar", answer_text="",
                      conversation_id=self.CONV, prescribing_intent=True)
        assert d.retain
        assert d.retention_class == RetentionClass.turn_marker
        assert d.bank_id == f"conversation-{self.CONV}"

    def test_the_marker_keeps_the_question_but_not_an_answer(self):
        from services.clinical.retention import gate_turn, format_retention_record

        d = gate_turn(query="what should I take for sugar", answer_text="",
                      conversation_id=self.CONV, prescribing_intent=True)
        record = format_retention_record(
            query="what should I take for sugar", answer_text="", decision=d
        )
        assert "what should I take for sugar" in record
        assert "No clinical answer was given" in record

    def test_crisis_marker_carries_no_content(self):
        # Continuity, without a crisis disclosure resurfacing in an unrelated
        # later recall.
        from services.clinical.retention import gate_turn, format_retention_record

        query = "I want to end my life"
        d = gate_turn(query=query, answer_text="helpline",
                      conversation_id=self.CONV, safety_category="crisis")
        record = format_retention_record(query=query, answer_text="helpline", decision=d)
        assert d.retain
        assert query not in record
        assert "deliberately not recorded" in record

    def test_flagged_answer_keeps_the_question_drops_the_answer(self):
        from services.clinical.retention import gate_turn, format_retention_record

        d = gate_turn(query="does it work", answer_text="it cures diabetes",
                      conversation_id=self.CONV, citation_guard_flagged=True)
        record = format_retention_record(
            query="does it work", answer_text="it cures diabetes", decision=d
        )
        assert "does it work" in record
        assert "cures diabetes" not in record


class TestPubmedCanary:
    def test_unreachable_is_not_the_same_as_broken(self):
        # A network failure must not be reported as a broken filter — the agent
        # would then tell patients evidence is degraded when it is not.
        from services.clinical import pubmed

        pubmed._filter_state.update(checked=True, healthy=None, detail="unreachable")
        assert pubmed.filter_is_degraded() is False

    def test_a_failed_canary_is_reported(self):
        from services.clinical import pubmed

        pubmed._filter_state.update(checked=True, healthy=False, detail="filtered>=unfiltered")
        assert pubmed.filter_is_degraded() is True
        pubmed._filter_state.update(checked=False, healthy=None, detail="")
