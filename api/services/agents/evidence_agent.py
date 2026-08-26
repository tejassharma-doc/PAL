"""
Evidence Agent — PubMed + bioRxiv MCP tool calls.
Returns grounded, cited answers. Says "no good evidence found" — never confabulates.
"""
import json
import httpx
from typing import Optional

from services.ai_provider import model_for_agent, multilingual_suffix


EVIDENCE_SYSTEM = """You are a medical evidence specialist in PAL.
You answer health questions grounded ONLY in the literature retrieved.

Rules:
- Use only the retrieved PubMed/bioRxiv results below.
- Classify evidence strength for each claim.
- Include full citations (title, authors, journal, year, PMID/DOI).
- If retrieved evidence does not support a claim, say "no good evidence found for this claim."
- Never confabulate references. Never make up PMIDs or DOIs.
- Non-diagnostic: explain, don't diagnose.
- Format: JSON response."""


async def _search_pubmed(query: str, max_results: int = 5) -> list[dict]:
    """Simple PubMed E-utilities search."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            search = await client.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                params={"db": "pubmed", "term": query, "retmax": max_results, "retmode": "json"},
            )
            ids = search.json().get("esearchresult", {}).get("idlist", [])
            if not ids:
                return []
            summary = await client.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                params={"db": "pubmed", "id": ",".join(ids), "retmode": "json"},
            )
            data = summary.json().get("result", {})
            results = []
            for pmid in ids:
                item = data.get(pmid, {})
                results.append({
                    "pmid": pmid,
                    "title": item.get("title", ""),
                    "authors": [a.get("name", "") for a in item.get("authors", [])[:3]],
                    "journal": item.get("source", ""),
                    "year": item.get("pubdate", "")[:4],
                    "doi": next((id_.get("value", "") for id_ in item.get("articleids", []) if id_.get("idtype") == "doi"), None),
                })
            return results
    except Exception:
        return []


class EvidenceAgent:
    name = "evidence"

    def __init__(self, ai_client):
        self.ai_client = ai_client

    async def run(
        self, query: str, record_context: Optional[dict] = None,
        conversation_history:str = "", is_second_opinion: bool = False, multilingual_lang: Optional[str] = None,
    ) -> dict:
        # Retrieve literature — wider pull on second opinion
        articles = await _search_pubmed(query, max_results=8 if is_second_opinion else 5)

        evidence_section = ""
        if articles:
            evidence_section = "\nRetrieved literature:\n" + json.dumps(articles, indent=2)
        else:
            evidence_section = "\nNo PubMed results retrieved for this query."

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

        return {"agent": self.name, "output": parsed, "raw_articles": articles}
