# PAL — Patient Health Record + Universal Health Search

PAL is a patient-owned health record and universal health search, built for institutional (clinic/hospital OPD) and self-hosted deployment. One search box routes natural-language health questions to specialist AI agents, synthesizes a single evidence-backed answer, and keeps the patient in control at every step.

## Quick start

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, SECRET_KEY, and ANTHROPIC_API_KEY (BYO mode)

docker compose up -d
# API:  http://localhost:8000
# Web:  http://localhost:3000
# Docs: http://localhost:8000/docs
```

## Architecture

```
web/ (Next.js)  →  api/ (FastAPI)  →  Postgres + pgvector + Redis
                        ↓
                   phi/ (PHI module — single enforcement perimeter)
                        ↓
                   services/hermes/ (Hermes orchestrator)
                        ↓
              ┌─────────────────────────┐
              records  medication  diet  evidence  appointment
                        ↓
                   Claude cloud (all clinical reasoning)
                   PubMed / bioRxiv (Evidence agent)
                   iNutriMon MCP (Diet agent, future)
```

## Feature flags (all default-off — safe to deploy to existing installs)

| Flag | Purpose |
|---|---|
| `UNIVERSAL_SEARCH=true` | Enable the search pipeline |
| `MULTI_USER=true` | Enable institutional multi-user mode |
| `ADMIN_DASHBOARD=true` | Enable `/admin` operator dashboard |
| `FAMILY_RELATIONSHIPS=true` | Enable Spouse/Parent/Child record sharing |
| `DEPLOYMENT_MODE=institutional` | Use operator AI key instead of BYO |

## Phase roadmap (build order)

1. **Phase 1** — Foundation: institutional tenancy + family roles + PHI module (`CLAUDE_CODE_TASK.md`)
2. **Phase 2** — Operator surfaces: admin dashboard + staff roles (`CLAUDE_CODE_ADMIN_DASHBOARD.md`, `CLAUDE_CODE_OPERATOR_STAFF_ROLES.md`)
3. **Phase 3** — Universal Health Search (`CLAUDE_CODE_UNIVERSAL_SEARCH.md`) ← **this build**
4. **Phase 4** — Pre-visit interview module (`CLAUDE_CODE_PREVISIT_INTERVIEW.md`)
5. **Phase 5** — Public marketing website (`CLAUDE_CODE_WEBSITE.md`)

## Running tests

```bash
cd api
pip install -r requirements.txt
pytest tests/ -v
```

## Documentation

- [`user-docs/INSTITUTIONAL.md`](user-docs/INSTITUTIONAL.md) — Tenancy, roles, PHI module
- [`user-docs/UNIVERSAL_SEARCH.md`](user-docs/UNIVERSAL_SEARCH.md) — Search pipeline, policy table, agent contracts
- [`PHILOSOPHY.md`](PHILOSOPHY.md) — Design principles
- [`SECURITY.md`](SECURITY.md) — Security model
- [`PRIVACY.md`](PRIVACY.md) — Privacy and consent model
