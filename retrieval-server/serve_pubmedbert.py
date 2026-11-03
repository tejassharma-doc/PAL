#!/usr/bin/env python3
"""FAISS retrieval service for the PubMedBERT corpus (APP05).

Serves a prebuilt IVF index (pubmed.index, IP metric) + id_map.parquet (FAISS
position -> PMID). The index is memory-mapped so the ~GB file isn't loaded into
RAM (APP05 is small). PAL embeds the query (PubMedBERT on APP07) and POSTs the
768-d vector here; we return the matching PMIDs (abstract text is fetched by PAL).

  GET  /health
  POST /search  {"embedding":[...768], "k":8, "nprobe":32}
                -> {"results":[{"score":..,"pos":..,"pmid":"..","PMID":".."}]}
"""
import os
from contextlib import asynccontextmanager
from typing import List, Optional

import faiss
import numpy as np
import pyarrow.parquet as pq
from fastapi import FastAPI
from pydantic import BaseModel

INDEX_PATH = os.getenv("INDEX_PATH", "/data/apps/pubmedBert_embedding/pubmed.index")
IDMAP_PATH = os.getenv("IDMAP_PATH", "/data/apps/pubmedBert_embedding/id_map.parquet")
NPROBE = int(os.getenv("NPROBE", "32"))

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # mmap: map the inverted lists from disk instead of loading them into RAM.
    idx = faiss.read_index(INDEX_PATH, faiss.IO_FLAG_MMAP)
    idx.nprobe = NPROBE
    t = pq.read_table(IDMAP_PATH, columns=["PMID", "row_index"])
    ri = t.column("row_index").to_numpy()
    pm = t.column("PMID").to_pylist()
    pmids: List[Optional[str]] = [None] * (int(ri.max()) + 1)
    for i, r in enumerate(ri):
        pmids[int(r)] = pm[i]
    _state.update(index=idx, pmids=pmids, dim=idx.d, ntotal=idx.ntotal)
    yield
    _state.clear()


app = FastAPI(title="PAL retrieval (PubMedBERT/FAISS)", lifespan=lifespan)


class SearchIn(BaseModel):
    embedding: List[float]
    k: int = 8
    nprobe: Optional[int] = None


@app.get("/health")
def health():
    return {"ready": "index" in _state, "count": _state.get("ntotal"), "dim": _state.get("dim")}


@app.post("/search")
def search(body: SearchIn):
    idx = _state["index"]
    if body.nprobe:
        idx.nprobe = body.nprobe
    q = np.asarray([body.embedding], dtype="float32")
    faiss.normalize_L2(q)                      # corpus is normalized + IP metric => cosine
    scores, ids = idx.search(q, body.k)
    pmids = _state["pmids"]
    out = []
    for score, pos in zip(scores[0].tolist(), ids[0].tolist()):
        if pos < 0:
            continue
        pmid = pmids[pos] if 0 <= pos < len(pmids) else None
        out.append({"score": score, "pos": pos, "pmid": pmid, "PMID": pmid})
    return {"results": out}
