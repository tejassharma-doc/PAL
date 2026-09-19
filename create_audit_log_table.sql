-- Create audit_logs table
-- Run this manually: docker exec -i pal-db psql -U pal -d pal < create_audit_log_table.sql

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Event Classification
    event_type VARCHAR(50) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',

    -- Who/What/Where
    user_id UUID,
    tenant_id UUID,
    patient_id UUID,

    -- Request Context
    ip_address VARCHAR(45),
    user_agent VARCHAR(512),
    request_method VARCHAR(10),
    request_path VARCHAR(512),
    request_id VARCHAR(100),

    -- Performance Metrics
    duration_ms INTEGER,
    status_code INTEGER,

    -- Event Details
    message TEXT NOT NULL,
    details JSONB,

    -- Error Information
    error_type VARCHAR(100),
    error_message TEXT,
    stack_trace TEXT,

    -- PHI/Security Flags
    contains_phi BOOLEAN DEFAULT FALSE,
    success BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_name ON audit_logs(event_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_patient_id ON audit_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON audit_logs(success) WHERE success = FALSE;

-- Add comment
COMMENT ON TABLE audit_logs IS 'Centralized audit log for all application events';
