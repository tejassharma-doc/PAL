# PAL — Privacy

## Data residency
Cloud provider (Anthropic API / Bedrock ap-south-1) is a tenant-level configuration decision.
For Indian health data, ap-south-1 (Mumbai) is the default when using Bedrock.

## PHI egress
PHI is only sent to cloud AI providers when:
1. The tenant privacy_mode allows it (not `strict`).
2. A valid session consent grant exists for this patient.
3. The egress decision is logged in phi_audit_log.

## Consent model
- Per-session consent (default): granted at the first personal query in a conversation; expires at session end.
- Standing consent ("always personalise"): opt-in only; never default; revocable at any time; logged.
- Per-query consent: strictest mode available for high-sensitivity tenants.

## Retention & deletion
- Patients can delete any conversation or all history at any time.
- Deletion is real: messages, embeddings, and Hindsight summary entries are purged. Audited.
- Raw sources (uploads) are immutable — deletion flag only; original bytes retained for provenance.
- Consent grants are never hard-deleted; revocation is recorded with timestamp and reason.

## Audit
PHI audit log answers: "who saw what, whose, when, under what consent." Never contains keys or PHI content.
