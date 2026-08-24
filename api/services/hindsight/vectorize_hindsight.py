"""
Vectorize.io Hindsight adapter — optional enhanced memory backend.

When HINDSIGHT_ENABLED=true, replaces the pgvector Hindsight with a 4-strategy
recall system: semantic (vector) + keyword (BM25) + graph (entity/temporal) + temporal.
Results merged via reciprocal rank fusion + cross-encoder reranking.

Requires: pip install hindsight-all
Config:   HINDSIGHT_ENABLED, HINDSIGHT_LLM_PROVIDER, HINDSIGHT_LLM_MODEL, HINDSIGHT_LLM_API_KEY

Falls back to pgvector Hindsight automatically if:
  - hindsight-all not installed
  - HINDSIGHT_ENABLED=false
  - Embedded server fails to start

Bank layout:
  patient-{member_id}          — health facts, summaries, structured record context
  conversation-{conversation_id} — rolling turn-by-turn memory
"""
import uuid
import logging
from typing import Optional, Any

logger = logging.getLogger(__name__)

try:
    from hindsight import HindsightServer, HindsightClient  # type: ignore
    _AVAILABLE = True
except ImportError:
    _AVAILABLE = False
    HindsightServer = None  # type: ignore
    HindsightClient = None  # type: ignore

_server: Any = None
_client: Any = None


def start(
    llm_provider: str,
    llm_model: str,
    llm_api_key: str,
    llm_api_base: str = "",
) -> bool:
    """
    Start the embedded Hindsight server. Called from FastAPI lifespan.
    Returns True on success, False on failure (falls back to pgvector).
    """
    global _server, _client

    if not _AVAILABLE:
        logger.warning("[Hindsight] hindsight-all not installed — skipping.")
        return False

    if not llm_api_key:
        logger.warning("[Hindsight] HINDSIGHT_LLM_API_KEY not set — skipping.")
        return False

    try:
        server_kwargs = {
            "llm_provider": llm_provider,
            "llm_model": llm_model,
            "llm_api_key": llm_api_key,
        }
        if llm_api_base:
            server_kwargs["llm_base_url"] = llm_api_base

        _server = HindsightServer(**server_kwargs)
        _server.__enter__()
        _client = HindsightClient(base_url=_server.url)
        logger.info("[Hindsight] Embedded server started at %s", _server.url)
        return True
    except Exception as exc:
        logger.error("[Hindsight] Failed to start: %s — falling back to pgvector.", exc)
        _server = None
        _client = None
        return False


def stop() -> None:
    """Stop the embedded server. Called from FastAPI lifespan shutdown."""
    global _server, _client
    if _server:
        try:
            _server.__exit__(None, None, None)
            logger.info("[Hindsight] Embedded server stopped.")
        except Exception:
            pass
    _server = None
    _client = None


def is_running() -> bool:
    return _client is not None


class VectorizeHindsight:
    """
    Drop-in replacement for the pgvector Hindsight class.
    Same async interface — orchestrator.py picks this or the pgvector version
    based on the is_running() flag.
    """

    def __init__(self, tenant_id: uuid.UUID, member_id: uuid.UUID):
        self.tenant_id = tenant_id
        self.member_id = member_id
        self._patient_bank = f"patient-{member_id}"

    async def retrieve_relevant_slice(
        self,
        query: str,
        top_k: int = 8,
        query_embedding: Optional[list] = None,  # accepted but unused — Hindsight embeds internally
    ) -> dict:
        if not _client:
            return {"facts": [], "retrieval_method": "hindsight_unavailable"}

        try:
            results = _client.recall(bank_id=self._patient_bank, query=query)
            facts = _normalise_recall(results, top_k)
            return {"facts": facts, "retrieval_method": "vectorize_hindsight"}
        except Exception as exc:
            logger.warning("[Hindsight] recall failed: %s", exc)
            return {"facts": [], "retrieval_method": "hindsight_error"}

    async def update_summary(
        self,
        query: str,
        answer: str,
        conversation_id: Optional[uuid.UUID],
    ) -> None:
        if not _client:
            return
        bank = f"conversation-{conversation_id}" if conversation_id else self._patient_bank
        try:
            _client.retain(
                bank_id=bank,
                content=f"Patient asked: {query}\nAssistant answered: {answer}",
            )
        except Exception as exc:
            logger.warning("[Hindsight] retain failed: %s", exc)

    async def reflect(
        self,
        conversation_id: uuid.UUID,
        prompt: str = "Summarise this conversation in 2-3 sentences.",
    ) -> str:
        """Deep analysis of conversation history — uses Hindsight reflect()."""
        if not _client:
            return ""
        bank = f"conversation-{conversation_id}"
        try:
            result = _client.reflect(bank_id=bank, query=prompt)
            if isinstance(result, dict):
                return result.get("response", "")
            return str(result)
        except Exception as exc:
            logger.warning("[Hindsight] reflect failed: %s", exc)
            return ""

    async def get_summary(self, conversation_id: Optional[uuid.UUID]) -> str:
        """
        Return a compact thread summary for the Fugu Router.
        VectorizeHindsight stores turns as memory banks, not a rolling text summary —
        we return empty string here; the pgvector path returns the stored hindsight_summary.
        """
        return ""

    async def purge_thread(self, conversation_id: uuid.UUID) -> None:
        """Called when patient deletes a conversation. Clears the conversation bank."""
        if not _client:
            return
        bank = f"conversation-{conversation_id}"
        try:
            _client.clear(bank_id=bank)
        except Exception:
            pass  # bank may not exist; not an error


def _normalise_recall(raw: Any, top_k: int) -> list[dict]:
    """Normalise the Hindsight recall() response to PAL's internal fact shape."""
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = raw.get("results", raw.get("items", []))
    else:
        return []

    facts = []
    for item in items[:top_k]:
        if isinstance(item, str):
            facts.append({"type": "note", "content": item, "relevance": 1.0})
        elif isinstance(item, dict):
            facts.append({
                "type": item.get("type", "note"),
                "content": item.get("content", item.get("text", str(item))),
                "relevance": float(item.get("score", item.get("relevance", 0.5))),
                "fact_key": item.get("fact_key"),
                "fact_value": item.get("fact_value"),
                "recorded_at": item.get("recorded_at"),
            })
    return facts
