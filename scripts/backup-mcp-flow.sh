#!/usr/bin/env bash
# Backup of the PubMed/bioRxiv MCP -> Gemma-4 answer flow.
# Run on the server (APP07) from the PAL root: bash scripts/backup-mcp-flow.sh
# Captures the config + code needed to restore the current flow if the embedding
# swap doesn't work. Does NOT change anything.
set -euo pipefail

cd "$(dirname "$0")/.."              # PAL root
TS=$(date +%Y%m%d-%H%M%S)
BK="backups/pubmed-biorxiv-flow-$TS"
mkdir -p "$BK/api/services/agents" "$BK/api/services/clinical" "$BK/api/services/hermes" "$BK/api/routers"

# --- config + env (the MCP containers + their URLs/keys) ---
cp docker-compose.prod.yml "$BK"/
cp .env.production          "$BK"/ 2>/dev/null || echo "WARN: .env.production not found — check its name"
cp api/config.py           "$BK/api/"

# --- code that wires pubmed/biorxiv into the Gemma answer flow ---
cp api/services/fastmcp_client.py        "$BK/api/services/"
cp -r api/services/clinical/.            "$BK/api/services/clinical/"
cp api/services/agents/evidence_agent.py "$BK/api/services/agents/"
cp api/services/hermes/orchestrator.py   "$BK/api/services/hermes/"
cp api/routers/search.py api/routers/hermes_chat.py "$BK/api/routers/"

# --- reference: current running MCP containers + their images (server only) ---
if command -v docker >/dev/null 2>&1; then
  docker ps -a --filter name=pubmed-mcp --filter name=biorxiv-mcp \
    --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$BK/running-mcp-containers.txt" || true
  docker images | grep -Ei 'pubmed|biorxiv' > "$BK/mcp-images.txt" || true
fi

# --- restore note ---
cat > "$BK/RESTORE.md" <<EOF
Backup of the PubMed/bioRxiv MCP -> Gemma-4 flow, taken $TS.

Restore:
  1. Copy these files back to the same paths under the PAL root.
  2. docker compose -f docker-compose.prod.yml up -d --build api pubmed-mcp biorxiv-mcp
  3. Images in use are listed in mcp-images.txt (re-pull if they were removed).

Optional image backup (run on the server):
  docker save ghcr.io/cyanheads/biorxiv-mcp-server:latest ghcr.io/cyanheads/pubmed-mcp-server:latest \\
    | gzip > "$BK/mcp-images.tar.gz"
  # restore: gunzip -c mcp-images.tar.gz | docker load
EOF

tar czf "pubmed-biorxiv-flow-$TS.tar.gz" -C backups "pubmed-biorxiv-flow-$TS"
echo "DONE -> $BK  and  pubmed-biorxiv-flow-$TS.tar.gz"
ls -la "$BK"
