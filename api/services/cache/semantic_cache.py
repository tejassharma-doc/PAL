"""
Semantic cache for generic (non-PHI) health query responses.

Architecture:
  query → embed (sentence-transformers, CPU, <10 ms)
        → Redis scan (cosine similarity vs stored embeddings)
        → hit (similarity ≥ threshold) → return cached text
        → miss → call Claude → store embedding + text in Redis

Only caches:
  - Generic scope queries (no personal health records involved)
  - Agents: diet, evidence, medication  (appointment uses template engine)
  - TTL: 24 h  (medical facts are stable; diet guidance updates nightly at most)

Storage per entry (Redis hash):
  cache:{agent}:{lang}:{uuid}  →  { emb: JSON float array, text: str, query: str }
Index set:
  cache_keys:{agent}:{lang}    →  sorted set of entry keys, scored by creation time

Similarity is O(n_entries) numpy dot-product — fast up to ~5 000 entries per bucket.
Swap to Redis Stack HNSW index if the fleet exceeds that threshold.
"""
import asyncio
import json
import time
import uuid
from typing import Optional

import numpy as np

# Lazy-load sentence_transformers to avoid 2 s import cost at API startup.
_embed_model = None

def _get_model(model_name: str):
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _embed_model = SentenceTransformer(model_name)
    return _embed_model


async def _embed(text: str, model_name: str) -> np.ndarray:
    """Return a normalised L2 embedding vector (shape: [dim])."""
    model = await asyncio.to_thread(_get_model, model_name)
    vec = await asyncio.to_thread(model.encode, text, normalize_embeddings=True)
    return np.array(vec, dtype=np.float32)


_CACHEABLE_AGENTS = frozenset({"diet", "evidence", "medication"})

# Cosine similarity threshold.  0.92 ≈ paraphrase-level match.
_THRESHOLD = 0.92

# Redis key TTL in seconds.
_TTL = 86_400  # 24 h


class SemanticCache:
    """
    Usage (in orchestrator):
        cache = SemanticCache(redis_client, model="all-MiniLM-L6-v2")
        cached = await cache.lookup(query, agent="diet", lang="en")
        if cached:
            return cached_response_dict
        ...
        await cache.store(query, agent="diet", lang="en", response_text=answer_text)
    """

    def __init__(self, redis_client, model: str = "all-MiniLM-L6-v2"):
        self._r = redis_client
        self._model = model

    # ── Public API ────────────────────────────────────────────────────────────

    def is_cacheable(self, agent: str, scope: str) -> bool:
        return agent in _CACHEABLE_AGENTS and scope == "generic"

    async def lookup(
        self,
        query: str,
        agent: str,
        lang: str = "en",
    ) -> Optional[str]:
        """
        Return cached response text if a semantically similar query is found,
        otherwise None.  Never raises — cache miss is silent.
        """
        try:
            return await self._lookup(query, agent, lang)
        except Exception:
            return None

    async def store(
        self,
        query: str,
        agent: str,
        lang: str = "en",
        response_text: str = "",
    ) -> None:
        """Store query embedding + response in Redis.  Silently ignores errors."""
        try:
            await self._store(query, agent, lang, response_text)
        except Exception:
            pass

    # ── Internal ──────────────────────────────────────────────────────────────

    def _bucket(self, agent: str, lang: str) -> str:
        return f"cache_keys:{agent}:{lang}"

    def _entry_prefix(self, agent: str, lang: str) -> str:
        return f"cache:{agent}:{lang}:"

    async def _lookup(self, query: str, agent: str, lang: str) -> Optional[str]:
        bucket = self._bucket(agent, lang)
        prefix = self._entry_prefix(agent, lang)

        # Get all entry keys for this bucket (ZRANGE: oldest → newest)
        keys: list[bytes] = await self._r.zrange(bucket, 0, -1)
        if not keys:
            return None

        query_vec = await _embed(query, self._model)

        # Fetch embeddings in a pipeline for speed.
        pipe = self._r.pipeline()
        for k in keys:
            pipe.hget(k, "emb")
        raw_embs = await pipe.execute()

        best_sim = 0.0
        best_key: Optional[bytes] = None
        for k, raw_emb in zip(keys, raw_embs):
            if raw_emb is None:
                continue
            try:
                stored_vec = np.array(json.loads(raw_emb), dtype=np.float32)
            except Exception:
                continue
            # Both vectors are L2-normalised → cosine sim = dot product.
            sim = float(np.dot(query_vec, stored_vec))
            if sim > best_sim:
                best_sim = sim
                best_key = k

        if best_sim < _THRESHOLD or best_key is None:
            return None

        text: Optional[bytes] = await self._r.hget(best_key, "text")
        return text.decode() if text else None

    async def _store(self, query: str, agent: str, lang: str, response_text: str) -> None:
        if not response_text:
            return

        vec = await _embed(query, self._model)
        emb_json = json.dumps(vec.tolist())

        entry_id = str(uuid.uuid4())
        key = f"{self._entry_prefix(agent, lang)}{entry_id}"
        bucket = self._bucket(agent, lang)

        pipe = self._r.pipeline()
        pipe.hset(key, mapping={
            "emb":   emb_json,
            "text":  response_text,
            "query": query,
        })
        pipe.expire(key, _TTL)
        # Sorted set scored by insertion time — lets us cap bucket size later.
        pipe.zadd(bucket, {key: time.time()})
        pipe.expire(bucket, _TTL + 3600)  # bucket outlives its youngest entry
        # Keep bucket from growing unbounded: prune oldest beyond 2 000 entries.
        pipe.zremrangebyrank(bucket, 0, -2001)
        await pipe.execute()


# ── Singleton factory ─────────────────────────────────────────────────────────

_cache_instance: Optional[SemanticCache] = None


def get_semantic_cache(redis_url: str, model: Optional[str] = None) -> SemanticCache:
    """Return a process-level singleton cache (lazy-creates on first call)."""
    global _cache_instance
    if _cache_instance is None:
        import redis.asyncio as aioredis  # type: ignore
        client = aioredis.from_url(redis_url, decode_responses=False)
        model_name = model or "all-MiniLM-L6-v2"
        _cache_instance = SemanticCache(client, model=model_name)
    return _cache_instance
