"""
Evidence Agent — PubMed retrieval with a human-studies filter.
Returns grounded, cited answers. Says "no good evidence found" — never confabulates.

Retrieval moved to services.clinical.pubmed. The previous inline
implementation had no study filter (so a rodent study could ground a clinical
answer) and fetched summaries only (so "answer from the retrieved literature"
meant answering from titles). Both are fixed there; this file consumes it.
"""
import json
import logging
from typing import Optional

from services.ai_provider import model_for_agent, multilingual_suffix
from services.clinical.pubmed import search_pubmed_many

logger = logging.getLogger(__name__)


EVIDENCE_SYSTEM = """You are a medical evidence specialist in PAL.
You answer health questions grounded ONLY in the literature retrieved.

Rules:
- Use only the retrieved PubMed results below. Every result shown to you passed
  a humans[MeSH Terms] filter, so it is human research — say so plainly rather
  than overstating it as proof.
- Quote the abstract's own numbers where they exist. Never round, generalise or
  invent a figure the abstract does not contain.
- Classify evidence strength for each claim.
- Include full citations (title, authors, journal, year, PMID/DOI).
- If retrieved evidence does not support a claim, say "no good evidence found for this claim."
- If retrieval failed rather than returning nothing, say you could not check the
  literature. Those are different statements and must not be conflated.
- Never confabulate references. Never make up PMIDs or DOIs.
- Never rank one medicine against another, and never say which one to take.
- Non-diagnostic: explain, don't diagnose.
- Format: JSON response."""


class EvidenceAgent:
    name = "evidence"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self, query: str, record_context: Optional[dict] = None,
        conversation_history:str = "", is_second_opinion: bool = False, multilingual_lang: Optional[str] = None,
    ) -> dict:
        # Retrieve literature — wider pull on second opinion.
        # high_evidence on a second opinion: trials, meta-analyses, systematic
        # reviews and guidelines only, since that is when it is worth the
        # narrower recall.
        found, retrieval_ok = await search_pubmed_many(
            [query],
            study_filter="high_evidence" if is_second_opinion else "humans",
            max_results=8 if is_second_opinion else 5,
        )
        articles = [a.to_citation() for a in found]

        if articles:
            evidence_section = "\nRetrieved literature (human studies):\n" + json.dumps(
                articles, indent=2
            )
        elif not retrieval_ok:
            # Distinct from "no evidence exists". Conflating the two is how a
            # system ends up answering confidently from nothing.
            logger.warning("PubMed retrieval failed for query: %s", query[:120])
            evidence_section = (
                "\nPubMed could not be reached for this query. "
                "State that you were unable to check the literature — do NOT say "
                "no evidence was found."
            )
        else:
            evidence_section = "\nNo human studies matched this query on PubMed."

        history_section = ""
        if conversation_history:
            history_section = f"\n**Previous conversation:**\n{conversation_history}\n\nUse this context to understand what the patient is asking about.\n"

        system = EVIDENCE_SYSTEM + multilingual_suffix(multilingual_lang)
        response = await self.ai_client.messages.create(
            model=model_for_agent("evidence", is_second_opinion),
            max_tokens=1024,
            system=system,
            messages=[{
                "role": "user",
                "content": f"{history_section} Query:{query}{evidence_section}\n\nRespond with JSON: {{\"summary\": \"...\", \"evidence_found\": true|false, \"citations\": [], \"evidence_class\": \"source_backed|statistical|inferred|unknown\"}}",
            }],
        )
        raw = response.content[0].text if response.content else "{}"
        try:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
        except Exception:
            parsed = {"summary": raw, "evidence_found": bool(articles), "citations": articles, "evidence_class": "unknown"}

        return {
            "agent": self.name,
            "output": parsed,
            "raw_articles": articles,
            "retrieval_ok": retrieval_ok,
        }
