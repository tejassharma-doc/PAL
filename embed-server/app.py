"""EmbeddingGemma embedding microservice (CPU, keep-warm) for PAL PubMed RAG.

Loads the embedding model ONCE at startup and serves:
  GET  /health            -> readiness + model id + vector dim
  POST /embed/query       -> {"text": "..."}          -> {"embedding": [...]}  (SearchQuery)
  POST /embed/documents   -> {"texts": ["...", ...]}  -> {"embeddings": [[...]]} (SearchDocument)

Vectors are L2-normalized, matching how the PubMed corpus was embedded, so they are
directly comparable with cosine distance in pgvector. CPU/fp32 by design (no GPU).
"""
import os
from contextlib import asynccontextmanager
from typing import List

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_ID = os.getenv("EMBED_MODEL_ID", "google/embeddinggemma-300m")
QUERY_PROMPT = os.getenv("EMBED_QUERY_PROMPT", "SearchQuery")
DOC_PROMPT = os.getenv("EMBED_DOC_PROMPT", "SearchDocument")
THREADS = int(os.getenv("OMP_NUM_THREADS", "4"))
BATCH = int(os.getenv("EMBED_BATCH", "32"))

# Use all cores for the single worker; fp16/bf16 are slower on CPU, so stay fp32.
torch.set_num_threads(THREADS)

_state: dict = {"model": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    _state["model"] = SentenceTransformer(
        MODEL_ID, device="cpu", model_kwargs={"torch_dtype": torch.float32}
    )
    yield
    _state["model"] = None


app = FastAPI(title="PAL EmbeddingGemma (CPU)", lifespan=lifespan)


class QueryIn(BaseModel):
    text: str


class DocsIn(BaseModel):
    texts: List[str]


def _encode(texts: List[str], kind: str) -> List[List[float]]:
    """kind = 'query' or 'document'. Prefer the model's built-in query/document
    prompts (EmbeddingGemma defines them); fall back to a configurable prompt_name."""
    m = _state["model"]
    if kind == "query" and hasattr(m, "encode_query"):
        vecs = m.encode_query(texts, normalize_embeddings=True, batch_size=BATCH, convert_to_numpy=True)
    elif kind == "document" and hasattr(m, "encode_document"):
        vecs = m.encode_document(texts, normalize_embeddings=True, batch_size=BATCH, convert_to_numpy=True)
    else:
        prompt = QUERY_PROMPT if kind == "query" else DOC_PROMPT
        vecs = m.encode(texts, prompt_name=prompt, normalize_embeddings=True,
                        batch_size=BATCH, convert_to_numpy=True)
    return [v.tolist() for v in vecs]


@app.get("/health")
def health():
    m = _state["model"]
    return {
        "ready": m is not None,
        "model": MODEL_ID,
        "dim": m.get_sentence_embedding_dimension() if m is not None else None,
    }


@app.post("/embed/query")
def embed_query(body: QueryIn):
    return {"embedding": _encode([body.text], "query")[0]}


@app.post("/embed/documents")
def embed_documents(body: DocsIn):
    return {"embeddings": _encode(body.texts, "document")}
