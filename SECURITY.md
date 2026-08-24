# PAL — Security

## Secrets (write-only rule)
API keys, operator keys, connector secrets: accepted on write; **never returned, logged, echoed, or stored in plaintext in the DB**. Surfaced only as "configured / last-4 / test result."

## PHI isolation
- All PHI access routes through `api/phi/` — the single enforcement layer.
- Default deny: no user reads another's PHI without a live, revocable consent grant.
- Tenant isolation enforced at query level (every query scoped by tenant_id).
- PHI audit log is append-only; no updates or deletes.

## Auth
- JWT (HS256); keys in env only.
- Passwords hashed with bcrypt.
- Token expiry: access 60m, refresh 30d.

## Action gates
All side-effectful actions (booking, messaging) require an authenticated confirm/sign token. Never auto-execute.

## Upload safety
MIME type + header inspection on every upload. Imaging (DICOM, image/*) declined for interpretation.

## Dependency policy
Pin all dependencies. Review before upgrade. No unvetted third-party packages with PHI access.
