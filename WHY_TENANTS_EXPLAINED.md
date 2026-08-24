# Why Tenants Are Critical in PAL System

## What is a Tenant?

A **tenant** is an organizational boundary that isolates data for different groups of users. Think of it like separate "accounts" or "workspaces" in the same application.

### In Your PAL System:

```
Tenant = A healthcare organization, clinic, or individual deployment
```

Currently you have **ONE tenant** (the "Default" tenant for self-hosted mode), but the architecture supports multiple tenants for future growth.

---

## Why Tenants Matter for Medical Document Uploads

### 1. **Data Isolation & Privacy** 🔒

When you upload a lab report PDF:

```
User: sharma2003 (tejas@gmail.com)
↓
Uploads: blood-test-results.pdf
↓
Stored in: raw_sources table
↓
MUST be linked to: tenant_id = 00000000-0000-0000-0000-000000000001
```

**Why?**
- Each uploaded file MUST belong to a tenant
- This ensures data segregation between different organizations
- Prevents data leakage between tenants

### Without Tenant:
```sql
❌ INSERT INTO raw_sources (member_id, filename, storage_path)
   VALUES ('user-123', 'lab.pdf', '/uploads/lab.pdf')
```
**Problem**: Which organization does this file belong to?

### With Tenant:
```sql
✅ INSERT INTO raw_sources (tenant_id, member_id, filename, storage_path)
   VALUES ('tenant-1', 'user-123', 'lab.pdf', '/uploads/lab.pdf')
```
**Result**: Clear ownership and isolation!

---

## Multi-Tenancy Architecture in PAL

### Database Schema - Everything Links to Tenant

Almost EVERY table has a `tenant_id` foreign key:

```sql
raw_sources
├── tenant_id → tenants.id     ← Uploaded files
├── member_id                   ← Patient/user
└── storage_path               ← File location

health_facts
├── tenant_id → tenants.id     ← Extracted lab data
├── member_id                   ← Patient
└── fact_type                   ← "lab", "vitals", etc.

conversations
├── tenant_id → tenants.id     ← Chat history
├── member_id                   ← Patient
└── title                       ← "Blood test questions"

model_run_audits
├── tenant_id → tenants.id     ← AI usage tracking
├── requesting_user_id          ← Who made the request
└── input_tokens                ← Token usage
```

### Why This Design?

**1. Data Isolation**
```
Tenant A (Hospital Alpha)
├── Patient 1 → Lab tests, prescriptions, chats
├── Patient 2 → Lab tests, prescriptions, chats
└── Patient 3 → Lab tests, prescriptions, chats

Tenant B (Clinic Beta)
├── Patient 4 → Lab tests, prescriptions, chats
├── Patient 5 → Lab tests, prescriptions, chats
└── Patient 6 → Lab tests, prescriptions, chats
```

**Queries automatically filter by tenant:**
```sql
-- Get all lab tests for Tenant A only
SELECT * FROM lab_tests 
WHERE patient_id IN (
    SELECT id FROM patients WHERE tenant_id = 'tenant-a'
);
```

**2. Compliance & Security (HIPAA, GDPR)**
- Each tenant = separate "data silo"
- Patient data never crosses tenant boundaries
- Auditing: "Who in Tenant A accessed what data?"
- Data breach containment: If Tenant A is compromised, Tenant B is unaffected

**3. Billing & Resource Tracking**
```sql
-- How many AI tokens did Tenant A use this month?
SELECT SUM(input_tokens + output_tokens) 
FROM model_run_audits 
WHERE tenant_id = 'tenant-a' 
  AND created_at >= '2024-07-01';
```

**4. Feature Customization per Tenant**
```sql
-- Tenant configuration
SELECT * FROM tenants WHERE id = 'tenant-a';
```

```
Tenant A:
├── deployment_mode: institutional
├── multi_user: true
├── operator_key_configured: true (clinic provides AI key)
├── baa_signed: true (HIPAA agreement)
└── daily_token_budget: 100,000

Tenant B (Your self-hosted):
├── deployment_mode: self_hosted
├── multi_user: false
├── operator_key_configured: false (user brings own key)
├── baa_signed: false
└── daily_token_budget: null (unlimited)
```

---

## Current State: Single-Tenant (Self-Hosted Mode)

### Your Setup Now:

```
Tenant: Default (00000000-0000-0000-0000-000000000001)
├── deployment_mode: self_hosted
├── User: sharma2003 (tejas@gmail.com)
└── Patient: 1 profile linked to sharma2003
```

Even though you only have **one tenant**, the architecture requires it because:

1. **Database constraints**: Foreign keys validate data integrity
2. **Code consistency**: All queries filter by `tenant_id`
3. **Future-proofing**: Easy to add more tenants later
4. **Best practices**: Industry-standard multi-tenant SaaS design

---

## What Happens During PDF Upload (Step-by-Step)

### Step 1: Upload Request
```bash
POST /medical/upload
- file: blood-test.pdf
- tenant_id: 00000000-0000-0000-0000-000000000001  ← REQUIRED!
- member_id: fd950a6e-414c-4ca2-b46f-e3c753e4d295
```

### Step 2: Database Insert
```python
raw_source = RawSource(
    tenant_id=t_id,        # ← MUST exist in tenants table!
    member_id=m_id,
    source_type="upload",
    filename="blood-test.pdf",
    storage_path="uploads/abc123.pdf",
    # ...
)
db.add(raw_source)
await db.flush()  # ← This is where FK check happens!
```

### Step 3: Foreign Key Validation
```sql
-- PostgreSQL checks:
INSERT INTO raw_sources (tenant_id, member_id, ...)
VALUES ('00000000-0000-0000-0000-000000000001', 'user-id', ...)

-- Constraint check:
SELECT id FROM tenants 
WHERE id = '00000000-0000-0000-0000-000000000001';

-- If NOT EXISTS → ❌ ForeignKeyViolationError
-- If EXISTS → ✅ Insert succeeds
```

**This is why you got the error before!**
```
ForeignKeyViolationError: Key (tenant_id)=(00000000-0000-0000-0000-000000000001) 
is not present in table "tenants"
```

The database was protecting data integrity by rejecting orphaned records!

### Step 4: MDT Extraction
Once the `raw_source` record is saved (with valid tenant), then:
```python
# Send to MDT
fhir_bundle = await mdt_client.document_to_fhir(content, mime_type)

# Parse observations
observations = parse_fhir_bundle(fhir_bundle)

# Later, when user confirms:
health_fact = HealthFact(
    tenant_id=t_id,           # ← Same tenant as raw_source
    member_id=m_id,
    fact_type="lab",
    fact_key="LDL",
    fact_value="120 mg/dL",
    raw_source_id=rs_id,      # ← Links back to uploaded file
    # ...
)
```

**Everything stays within the same tenant boundary!**

---

## Real-World Tenant Examples

### Scenario 1: Hospital Deployment (Institutional)
```
Tenant: City General Hospital
├── deployment_mode: institutional
├── 10,000 patients
├── 50 doctors
├── Operator provides AI API key (centralized billing)
├── HIPAA BAA signed
└── Daily token budget: 1,000,000 tokens
```

All uploads by any patient at City General Hospital link to this tenant.

### Scenario 2: Clinic Chain (Multi-Tenant SaaS)
```
Tenant 1: Downtown Clinic
├── 500 patients
└── AI budget: 50,000 tokens/day

Tenant 2: Suburban Clinic
├── 800 patients
└── AI budget: 100,000 tokens/day

Tenant 3: Rural Clinic
├── 200 patients
└── AI budget: 20,000 tokens/day
```

Each clinic's data is completely isolated from the others.

### Scenario 3: Individual Self-Hosted (Your Current Setup)
```
Tenant: Default (self-hosted)
├── deployment_mode: self_hosted
├── 1 user (sharma2003)
├── 1 patient profile
├── User brings own AI API key
└── No token budget (unlimited)
```

You're the only user, but still need a tenant for the architecture to work.

---

## Why Not Just Use `user_id` Instead of `tenant_id`?

### Problem with User-Based Isolation:

```sql
-- ❌ Bad: Filter by user
SELECT * FROM lab_tests WHERE user_id = 'sharma2003';

-- What if you want to:
-- • Share data with family members?
-- • Allow a doctor to see multiple patients?
-- • Migrate data between users?
-- • Track organization-level analytics?
```

### Solution with Tenant-Based Isolation:

```sql
-- ✅ Good: Filter by tenant, then user
SELECT * FROM lab_tests 
WHERE tenant_id = 'default-tenant'
  AND patient_id IN (
    SELECT id FROM patients 
    WHERE tenant_id = 'default-tenant'
      AND (id = 'sharma-patient' OR shared_with_user_id = 'sharma2003')
  );
```

**Benefits:**
- Multi-user support within a tenant
- Family account sharing
- Provider access to multiple patients
- Organization-wide analytics

---

## Tenant Configuration Table

```sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    name VARCHAR(255),                    -- "Default", "City Hospital", etc.
    slug VARCHAR(100) UNIQUE,             -- "default", "city-hospital"
    
    -- Deployment type
    deployment_mode VARCHAR(20),          -- "self_hosted" | "institutional"
    privacy_mode VARCHAR(20),             -- "strict" | "permissive"
    
    -- Compliance
    baa_signed BOOLEAN,                   -- HIPAA Business Associate Agreement
    baa_signed_at TIMESTAMPTZ,
    baa_counterparty VARCHAR(255),
    
    -- AI configuration
    operator_key_config JSONB,            -- Encrypted AI keys for institutional
    operator_key_configured BOOLEAN,
    daily_token_budget INTEGER,           -- Limit AI usage
    per_user_daily_token_budget INTEGER,
    
    -- Other settings
    age_of_majority_days INTEGER,         -- Legal age for consent
    active BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

### Current Values (Your Default Tenant):
```sql
SELECT * FROM tenants WHERE slug = 'default';

id:                00000000-0000-0000-0000-000000000001
name:              Default
slug:              default
deployment_mode:   self_hosted         ← Single user, BYO AI key
privacy_mode:      strict              ← Strong privacy defaults
baa_signed:        false               ← Not needed for self-hosted
operator_key_conf: false               ← User provides own key
daily_token_budget: null               ← Unlimited usage
active:            true
```

---

## How Other Tables Reference Tenant

### Direct Tenant References:
```sql
raw_sources.tenant_id → tenants.id
health_facts.tenant_id → tenants.id
conversations.tenant_id → tenants.id
model_run_audits.tenant_id → tenants.id
```

### Indirect References (via patient):
```sql
lab_tests.patient_id → patients.id
                      → patients.tenant_id → tenants.id
```

### Query Pattern:
```sql
-- Get all data for a tenant
WITH tenant_patients AS (
    SELECT id FROM patients WHERE tenant_id = 'tenant-1'
)
SELECT 
    lt.id,
    lt.report_name,
    p.full_name
FROM lab_tests lt
JOIN tenant_patients tp ON lt.patient_id = tp.id
JOIN patients p ON tp.id = p.id;
```

---

## Benefits of Multi-Tenancy in PAL

### 1. **Scalability**
- One codebase, multiple organizations
- Shared infrastructure
- Economies of scale

### 2. **Data Isolation**
- Legal compliance (HIPAA, GDPR)
- Security boundaries
- Breach containment

### 3. **Customization**
- Per-tenant feature flags
- Custom branding
- Different AI models per tenant

### 4. **Business Model Flexibility**
```
Pricing Tiers:
├── Free Tier (self-hosted)
│   └── 1 tenant, unlimited users, BYO AI key
├── Pro Tier (institutional)
│   └── 1 tenant, 100 users, 100k tokens/day
└── Enterprise Tier
    └── Multiple tenants, unlimited users, custom budget
```

### 5. **Operational Efficiency**
- One database, multiple tenants
- Shared monitoring/backups
- Centralized updates

---

## Why the Error Happened (Foreign Key Violation)

### The Error:
```
ForeignKeyViolationError: insert or update on table "raw_sources" 
violates foreign key constraint "raw_sources_tenant_id_fkey"
DETAIL: Key (tenant_id)=(00000000-0000-0000-0000-000000000001) 
is not present in table "tenants"
```

### The Root Cause:

```
Code assumes tenant exists:
├── Hardcoded: tenant_id = "00000000-0000-0000-0000-000000000001"
├── This ID is used throughout the codebase
└── Expected to be created by migration 0001_initial.py

Reality:
├── Migrations never ran
├── Tables created by SQLAlchemy auto-create
├── Tenants table was EMPTY ❌
└── Foreign key check failed
```

### The Fix:
```sql
-- Manually inserted the default tenant
INSERT INTO tenants (id, name, slug, ...)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default', ...);

-- Now FK check passes ✅
```

---

## Summary

### Why Tenant is Essential:

1. ✅ **Database Integrity**: Foreign key constraints ensure data validity
2. ✅ **Data Isolation**: Separates data between organizations
3. ✅ **Security**: HIPAA/GDPR compliance through data segregation
4. ✅ **Scalability**: Supports multi-organization deployments
5. ✅ **Flexibility**: Different configs per tenant
6. ✅ **Auditing**: Track usage/access per organization
7. ✅ **Business Model**: Enables SaaS pricing tiers

### Even for Single User:

Your self-hosted PAL deployment has **one user**, but still needs a tenant because:
- The architecture is built for it
- All tables reference `tenant_id`
- Future-proof for adding family members or users
- Industry best practice

### Analogy:

```
Think of tenant as a "house":

Without Tenant:
├── You upload a file... where does it go?
└── ❌ No house address = orphaned data

With Tenant:
├── You upload a file to your house (tenant)
├── Files are stored at "123 Main St" (tenant_id)
└── ✅ Clear ownership and location
```

---

## Your Current Setup

```
Tenant: Default (00000000-0000-0000-0000-000000000001)
├── Mode: self_hosted
├── Users: 1 (sharma2003)
├── Patients: 1
└── Purpose: Personal health record

When you upload a PDF:
├── File linked to: Default tenant
├── User: sharma2003
├── Patient: Your profile
└── Result: Organized, secure, compliant data storage ✅
```

---

**Bottom Line**: The tenant is the foundation of data organization in PAL. It's like the "container" that holds all your health data in an isolated, secure, and compliant way. Even though you only have one tenant now, it's essential for the system to function correctly!
