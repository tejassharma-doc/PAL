# PAL — Institutional Tenancy, Family Roles & PHI Module

## Overview

PAL evolves OwnChart from single-self-hosted into a provider-operated, multi-user deployment
**without breaking single-user mode**. All new behavior is behind feature flags; defaults
reproduce current behavior exactly.

## Feature Flags

| Flag | Default | Effect |
|---|---|---|
| `DEPLOYMENT_MODE` | `self_hosted` | `institutional` enables operator-key tenancy |
| `AI_KEY_MODE` | `byo` | `operator` routes AI calls through the tenant's key |
| `MULTI_USER` | `false` | `true` enables tenant memberships and roles |
| `FAMILY_RELATIONSHIPS` | `false` | `true` enables Spouse/Parent/Child relationship edges |

## New Tables (all additive, reversible migrations)

- **tenants** — one institution or self-hosted install. Default tenant (UUID `00000000-0000-0000-0000-000000000001`) backfills existing single-user installs.
- **tenant_memberships** — user↔tenant↔role links. Existing users are backfilled as `member` in the default tenant.
- **member_relationships** — typed, directional consent-gated edges (SPOUSE, PARENT_OF, CHILD_OF).
- **consent_grants** — full lifecycle; nothing is hard-deleted. `is_live` enforced at query time.
- **phi_audit_log** — append-only; no updates or deletes ever.

## Role Planes

**Patient plane:** `member`, `caregiver`, `provider`
**Operator plane:** `operator_admin`, `operator_developer`, `operator_support`, `operator_security`, `operator_billing`

Operator roles do **not** get automatic PHI access. The PHI guard (`phi/guard.py`) enforces this unconditionally.

## PHI Module

The `phi/` package is the single enforcement perimeter. Every PHI-touching route must:
1. Call `phi_guard(ctx, db)` as a FastAPI dependency.
2. Route PHI-to-cloud decisions through `EgressControl.check(...)`.
3. Log access events via `PHIAudit.log(...)`.

The CI guard (`tests/test_phi_ci_guard.py`) fails the build if a PHI route bypasses this.

## Secrets Rule

Operator API keys and connector client secrets are **write-only at the API boundary**:
- Accepted on write (stored in env/secrets manager).
- Never returned, logged, or audited.
- Surfaced only as "configured / last-4 / test result."

## DocEHR / iNutriMon Seams

Clean interface boundaries exist for future MCP connectors:
- `phi/egress.py` — any external caller inherits the same consent + audit guarantees.
- `phi/consent.py` — consent registry is the single source of truth for all access grants.
- `services/agents/diet_agent.py` — iNutriMon attaches here via MCP (stub present).
- `services/agents/records_agent.py` — DocEHR FHIR import attaches via `raw_sources` table.

## Single-User Regression

With all flags at default, the app behaves byte-for-byte as the original OwnChart:
- One tenant, one user, self-access only.
- BYO AI key path.
- No multi-user UI surfaces.
- PHI guard is transparent for self-access (always allowed).
