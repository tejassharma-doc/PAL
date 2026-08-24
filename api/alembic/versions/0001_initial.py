"""Initial schema: tenants, users, memberships, consent, health records, conversations, audit

Revision ID: 0001
Revises:
Create Date: 2026-06-22

All migrations are additive and reversible (downgrade() drops only what upgrade() created).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = """
-- Extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    deployment_mode VARCHAR(20) NOT NULL DEFAULT 'self_hosted',
    privacy_mode VARCHAR(20) NOT NULL DEFAULT 'strict',
    baa_signed BOOLEAN NOT NULL DEFAULT FALSE,
    baa_signed_at TIMESTAMPTZ,
    baa_counterparty VARCHAR(255),
    operator_key_config JSONB,
    operator_key_configured BOOLEAN NOT NULL DEFAULT FALSE,
    daily_token_budget INTEGER,
    per_user_daily_token_budget INTEGER,
    age_of_majority_days INTEGER NOT NULL DEFAULT 6570,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill: single-user default tenant
INSERT INTO tenants (id, name, slug, deployment_mode, privacy_mode)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default', 'self_hosted', 'strict')
ON CONFLICT (slug) DO NOTHING;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(30),
    date_of_birth DATE,
    byo_key_configured BOOLEAN NOT NULL DEFAULT FALSE,
    standing_personalize_consent BOOLEAN NOT NULL DEFAULT FALSE,
    standing_consent_granted_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);

-- Tenant memberships
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    member_record_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS ix_memberships_tenant ON tenant_memberships(tenant_id);

-- Member relationships
CREATE TABLE IF NOT EXISTS member_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_member_id UUID NOT NULL,
    to_member_id UUID NOT NULL,
    relationship_type VARCHAR(20) NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    requires_reconsent_at_majority BOOLEAN NOT NULL DEFAULT TRUE,
    majority_reconsent_completed BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_relationships_from ON member_relationships(from_member_id);
CREATE INDEX IF NOT EXISTS ix_relationships_to ON member_relationships(to_member_id);
CREATE INDEX IF NOT EXISTS ix_relationships_tenant ON member_relationships(tenant_id);

-- Consent grants (nothing hard-deleted — full history kept)
CREATE TABLE IF NOT EXISTS consent_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    subject_member_id UUID NOT NULL,
    grantee_user_id UUID NOT NULL REFERENCES users(id),
    granted_by_user_id UUID NOT NULL REFERENCES users(id),
    scope VARCHAR(30) NOT NULL,
    basis VARCHAR(30) NOT NULL,
    dossier_types JSONB,
    granted_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by_user_id UUID REFERENCES users(id),
    revocation_reason TEXT,
    session_id VARCHAR(128),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_grants_tenant ON consent_grants(tenant_id);
CREATE INDEX IF NOT EXISTS ix_grants_subject ON consent_grants(subject_member_id);
CREATE INDEX IF NOT EXISTS ix_grants_grantee ON consent_grants(grantee_user_id);
CREATE INDEX IF NOT EXISTS ix_grants_session ON consent_grants(session_id);

-- Raw sources (immutable)
CREATE TABLE IF NOT EXISTS raw_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    member_id UUID NOT NULL,
    source_type VARCHAR(30) NOT NULL,
    filename VARCHAR(512),
    mime_type VARCHAR(128),
    storage_path VARCHAR(512) NOT NULL,
    content_hash VARCHAR(128) NOT NULL,
    file_size_bytes BIGINT,
    is_imaging BOOLEAN NOT NULL DEFAULT FALSE,
    is_document BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_sources_content_hash ON raw_sources(content_hash);
CREATE INDEX IF NOT EXISTS ix_sources_member ON raw_sources(member_id);

-- Health facts
CREATE TABLE IF NOT EXISTS health_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    member_id UUID NOT NULL,
    fact_type VARCHAR(100) NOT NULL,
    fact_key VARCHAR(255) NOT NULL,
    fact_value TEXT,
    unit VARCHAR(50),
    recorded_at TIMESTAMPTZ,
    evidence_class VARCHAR(20) NOT NULL DEFAULT 'unknown',
    raw_source_id UUID REFERENCES raw_sources(id),
    derivation_notes TEXT,
    provenance_chain JSONB,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_facts_member ON health_facts(tenant_id, member_id);
CREATE INDEX IF NOT EXISTS ix_facts_type ON health_facts(fact_type);
CREATE INDEX IF NOT EXISTS ix_facts_key ON health_facts(fact_key);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    member_id UUID NOT NULL,
    title VARCHAR(512),
    scope_tag VARCHAR(50),
    consent_basis VARCHAR(50),
    consent_grant_id UUID,
    hindsight_summary TEXT,
    hindsight_updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_conversations_member ON conversations(tenant_id, member_id);

-- Conversation turns
CREATE TABLE IF NOT EXISTS conversation_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    member_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    scope VARCHAR(20),
    safety_category VARCHAR(50),
    provenance JSONB,
    citations JSONB,
    contains_phi BOOLEAN NOT NULL DEFAULT FALSE,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_turns_conversation ON conversation_turns(conversation_id);

-- Model run audit (append-only; no updates, no deletes)
CREATE TABLE IF NOT EXISTS model_run_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    requesting_user_id UUID,
    target_member_id UUID,
    conversation_id UUID,
    model_provider VARCHAR(50) NOT NULL,
    model_id VARCHAR(100) NOT NULL,
    prompt_version VARCHAR(50),
    agent_name VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    phi_involved BOOLEAN NOT NULL DEFAULT FALSE,
    consent_basis VARCHAR(50),
    egress_allowed BOOLEAN,
    latency_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_model_audit_tenant ON model_run_audits(tenant_id);
CREATE INDEX IF NOT EXISTS ix_model_audit_user ON model_run_audits(requesting_user_id);

-- PHI audit log (append-only; operator_security reads only)
CREATE TABLE IF NOT EXISTS phi_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    tenant_id UUID NOT NULL,
    actor_user_id UUID,
    subject_member_id UUID,
    conversation_id UUID,
    detail JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_phi_audit_tenant ON phi_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS ix_phi_audit_subject ON phi_audit_log(subject_member_id);
CREATE INDEX IF NOT EXISTS ix_phi_audit_event ON phi_audit_log(event_type);
CREATE INDEX IF NOT EXISTS ix_phi_audit_occurred ON phi_audit_log(occurred_at);
"""

TEARDOWN = """
DROP TABLE IF EXISTS phi_audit_log CASCADE;
DROP TABLE IF EXISTS model_run_audits CASCADE;
DROP TABLE IF EXISTS conversation_turns CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS health_facts CASCADE;
DROP TABLE IF EXISTS raw_sources CASCADE;
DROP TABLE IF EXISTS consent_grants CASCADE;
DROP TABLE IF EXISTS member_relationships CASCADE;
DROP TABLE IF EXISTS tenant_memberships CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
"""


def upgrade():
    op.execute(SCHEMA)


def downgrade():
    op.execute(TEARDOWN)
