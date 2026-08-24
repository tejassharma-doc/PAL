# 🏗️ Users & Patients Table Separation - Implementation Plan

## Current Problem

Right now the `users` table contains **BOTH**:
- ✅ Authentication data (email, password)
- ✅ Patient personal data (full_name, phone, date_of_birth)

This means you can't have:
- One user managing multiple patients (caregiver scenario)
- Clean separation between authentication and patient records

## New Architecture Design

### 📊 NEW: Two-Table Structure

#### `users` table (Authentication Only)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(320) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE,  -- NEW: explicit username
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Purpose**: Authentication and authorization ONLY

**Fields**:
- `id` - User identity for auth
- `email` - Login identifier
- `username` - NEW: Additional login option
- `hashed_password` - Password hash
- `active` - Account enabled/disabled

---

#### `patients` table (Patient Data)
```sql
CREATE TABLE patients (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- Who owns this record
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(30) UNIQUE,
    phone_verified BOOLEAN DEFAULT FALSE,
    date_of_birth DATE,
    preferred_language VARCHAR(10) DEFAULT 'en',
    
    -- Additional patient fields
    gender VARCHAR(20),
    blood_type VARCHAR(10),
    allergies TEXT,
    
    -- Consent & privacy
    standing_personalize_consent BOOLEAN DEFAULT FALSE,
    standing_consent_granted_at TIMESTAMP,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, phone)  -- One user can have multiple patients
);
```

**Purpose**: Patient personal and medical information

**Relationship**: `user_id` → `users.id` (one-to-many)

---

## 🔄 Migration Strategy

### Phase 1: Create Patients Table

**File**: `api/models/patient.py` (NEW)

```python
from sqlalchemy import String, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import date, datetime
from typing import Optional

from .base import Base, TimestampMixin, UUIDMixin


class Patient(Base, UUIDMixin, TimestampMixin):
    """Patient health record - separate from authentication User"""
    __tablename__ = "patients"

    # Link to user who owns/manages this patient record
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), 
        ForeignKey("users.id", ondelete="CASCADE"), 
        nullable=False, 
        index=True
    )

    # Personal information
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(30), unique=True, nullable=True, index=True)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(10), nullable=False, default='en')
    
    # Medical information
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    blood_type: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    
    # Consent & privacy
    standing_personalize_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    standing_consent_granted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    
    # Relationship
    user: Mapped["User"] = relationship(back_populates="patients")
```

---

### Phase 2: Update Users Table

**Simplify `users` table** - remove patient-specific fields

**File**: `api/models/user.py` (MODIFY)

```python
class User(Base, UUIDMixin, TimestampMixin):
    """Authentication identity ONLY - not patient data"""
    __tablename__ = "users"

    # Authentication fields
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # Account status
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # Relationships
    patients: Mapped[list["Patient"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    memberships: Mapped[list["TenantMembership"]] = relationship(back_populates="user")
```

---

### Phase 3: Database Migration

**File**: `api/alembic/versions/XXX_split_users_patients.py`

```python
"""Split users and patients tables

Revision ID: XXX
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


def upgrade():
    # 1. Create patients table
    op.create_table(
        'patients',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(30), nullable=True),
        sa.Column('phone_verified', sa.Boolean(), default=False),
        sa.Column('date_of_birth', sa.Date(), nullable=True),
        sa.Column('preferred_language', sa.String(10), default='en'),
        sa.Column('gender', sa.String(20), nullable=True),
        sa.Column('blood_type', sa.String(10), nullable=True),
        sa.Column('standing_personalize_consent', sa.Boolean(), default=False),
        sa.Column('standing_consent_granted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('phone')
    )
    
    op.create_index('ix_patients_user_id', 'patients', ['user_id'])
    op.create_index('ix_patients_phone', 'patients', ['phone'])
    
    # 2. Migrate existing user data to patients
    # For each user, create a corresponding patient record
    op.execute("""
        INSERT INTO patients (id, user_id, full_name, phone, phone_verified, date_of_birth, 
                             preferred_language, standing_personalize_consent, 
                             standing_consent_granted_at, created_at, updated_at)
        SELECT 
            id as id,  -- Keep same ID for FK compatibility
            id as user_id,  -- Each user becomes owner of their own patient record
            COALESCE(full_name, 'Unknown') as full_name,
            phone,
            phone_verified,
            date_of_birth,
            COALESCE(preferred_language, 'en') as preferred_language,
            standing_personalize_consent,
            standing_consent_granted_at,
            created_at,
            updated_at
        FROM users
        WHERE full_name IS NOT NULL OR phone IS NOT NULL
    """)
    
    # 3. Add username column to users (for new signup)
    op.add_column('users', sa.Column('username', sa.String(100), nullable=True))
    op.create_unique_constraint('uq_users_username', 'users', ['username'])
    op.create_index('ix_users_username', 'users', ['username'])
    
    # 4. Make email NOT NULL in users (was nullable before)
    op.execute("UPDATE users SET email = 'user_' || id || '@example.com' WHERE email IS NULL")
    op.alter_column('users', 'email', nullable=False)
    
    # 5. Make hashed_password NOT NULL (auth required)
    op.execute("UPDATE users SET hashed_password = 'disabled' WHERE hashed_password IS NULL")
    op.alter_column('users', 'hashed_password', nullable=False)
    
    # 6. Drop patient-related columns from users (move to patients table)
    op.drop_column('users', 'full_name')
    op.drop_column('users', 'phone')
    op.drop_column('users', 'phone_verified')
    op.drop_column('users', 'date_of_birth')
    op.drop_column('users', 'preferred_language')
    op.drop_column('users', 'byo_key_configured')
    op.drop_column('users', 'standing_personalize_consent')
    op.drop_column('users', 'standing_consent_granted_at')
    op.drop_column('users', 'email_verified')


def downgrade():
    # Reverse migration
    # Add columns back to users
    op.add_column('users', sa.Column('full_name', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(30), nullable=True))
    op.add_column('users', sa.Column('phone_verified', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('preferred_language', sa.String(10), default='en'))
    
    # Copy data back from patients to users
    op.execute("""
        UPDATE users u
        SET full_name = p.full_name,
            phone = p.phone,
            phone_verified = p.phone_verified,
            date_of_birth = p.date_of_birth,
            preferred_language = p.preferred_language
        FROM patients p
        WHERE u.id = p.user_id
    """)
    
    # Drop patients table
    op.drop_table('patients')
    
    # Drop username from users
    op.drop_index('ix_users_username', 'users')
    op.drop_constraint('uq_users_username', 'users')
    op.drop_column('users', 'username')
```

---

### Phase 4: Update Foreign Keys

**Tables to update** (change `member_id` to reference `patients.id`):

1. **`appointment_requests`**
   - Change `member_id` FK from `users.id` → `patients.id`

2. **`call_sessions`**
   - Change `member_id` FK from `users.id` → `patients.id`

3. **`conversations`**
   - Change `member_id` FK from `users.id` → `patients.id`

4. **`health_facts`**
   - Change `member_id` FK from `users.id` → `patients.id`

5. **`raw_sources`**
   - Change `member_id` FK from `users.id` → `patients.id`

**Migration snippet**:
```python
# Example: Update appointment_requests FK
def upgrade():
    # Drop old FK
    op.drop_constraint('appointment_requests_member_id_fkey', 'appointment_requests')
    
    # Add new FK to patients
    op.create_foreign_key(
        'appointment_requests_patient_id_fkey',
        'appointment_requests',
        'patients',
        ['member_id'],  # Column name stays same
        ['id'],
        ondelete='CASCADE'
    )
```

**Note**: Since we're keeping the same IDs during migration (patient.id = user.id initially), the FK values don't need to change!

---

### Phase 5: Update Backend Code

#### Update Authentication

**File**: `api/routers/auth_v2.py`

```python
# NEW: Signup creates User + Patient
@router.post("/signup")
async def signup(
    req: SignupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Sign up creates User (auth) + Patient (personal data)"""
    
    # Create user (authentication)
    user = User(
        email=req.email.lower(),
        username=req.username,  # NEW
        hashed_password=hash_password(req.password),
        active=True
    )
    db.add(user)
    await db.flush()
    
    # Create patient (personal data)
    patient = Patient(
        user_id=user.id,
        full_name=req.full_name,
        phone=req.phone,
        date_of_birth=req.date_of_birth,
        preferred_language=req.preferred_language or 'en'
    )
    db.add(patient)
    await db.commit()
    
    # Return auth response
    return await create_auth_response(db, user, request, patient_id=patient.id)
```

#### Update Profile Endpoint

**File**: `api/routers/user_profile.py`

```python
@router.get("/profile")
async def get_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user + patient profile"""
    
    # Get user's primary patient record
    result = await db.execute(
        select(Patient).where(Patient.user_id == user.id).limit(1)
    )
    patient = result.scalar_one_or_none()
    
    if not patient:
        raise HTTPException(404, "Patient record not found")
    
    # Get credits
    credits_result = await db.execute(
        select(UserLLMCredits).where(UserLLMCredits.user_id == user.id)
    )
    credits = credits_result.scalar_one_or_none()
    
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "username": user.username,
            "active": user.active
        },
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
            "preferred_language": patient.preferred_language
        },
        "credits": {
            "balance": credits.balance if credits else 0
        }
    }
```

#### Update Visits Endpoint

**File**: `api/routers/appointments_history.py`

```python
@router.get("/appointments/{tenant_id}/{patient_id}/history")
async def get_appointment_history(
    tenant_id: uuid.UUID,
    patient_id: uuid.UUID,  # NOW references patients.id
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get appointments for a patient"""
    
    # Verify user owns this patient record
    result = await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.user_id == user.id  # Authorization check
        )
    )
    patient = result.scalar_one_or_none()
    
    if not patient:
        raise HTTPException(403, "You don't have access to this patient's records")
    
    # Query appointments (member_id now references patients.id)
    appt_stmt = select(AppointmentRequest).where(
        AppointmentRequest.tenant_id == tenant_id,
        AppointmentRequest.member_id == patient_id,  # References patients.id
        AppointmentRequest.status == AppointmentRequestStatus.confirmed,
    )
    
    # ... rest of query logic same as before
```

---

### Phase 6: Update Frontend

**File**: `web/lib/api-auth.ts`

```typescript
// Updated types
export interface User {
  id: string
  email: string
  username?: string
  active: boolean
}

export interface Patient {
  id: string
  user_id: string
  full_name: string
  phone?: string
  date_of_birth?: string
  preferred_language: string
}

export interface UserProfile {
  user: User
  patient: Patient
  credits: {
    balance: number
  }
}

// Updated signup function
export async function signup(data: {
  email: string
  username?: string
  password: string
  full_name: string
  phone: string
  date_of_birth?: string
  preferred_language?: string
}): Promise<AuthResponse> {
  const res = await fetch('/api/v2/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  
  const json = await res.json()
  
  if (!res.ok) {
    throw new Error(json.detail || 'Signup failed')
  }
  
  // Save auth data
  saveAuth(json.access_token, json.user, json.session_id, json.patient_id)
  
  return json
}
```

---

## 🎯 Benefits of This Architecture

### ✅ Advantages

1. **Clean Separation**
   - Authentication logic separate from patient data
   - Users table only handles login/security
   - Patients table only handles health records

2. **Multi-Patient Support**
   - One user can manage multiple patients (caregiver scenario)
   - Parent managing children's records
   - Healthcare proxy managing elderly parent

3. **Better Security**
   - Auth data isolated from PHI (Protected Health Information)
   - Easier to secure authentication independently
   - Clear audit trail of who accesses whose records

4. **Scalability**
   - Add patients without creating users
   - Import patient records from other systems
   - Support institutional accounts (hospital with many patients)

5. **Flexibility**
   - Different patients can have different consent settings
   - Share specific patient records with providers
   - Transfer patient ownership (change user_id)

---

## 📋 Implementation Checklist

### Backend
- [ ] Create `api/models/patient.py`
- [ ] Update `api/models/user.py` (simplify)
- [ ] Create Alembic migration for patients table
- [ ] Create FK update migrations
- [ ] Update `api/routers/auth_v2.py` (signup)
- [ ] Update `api/routers/user_profile.py`
- [ ] Update `api/routers/appointments_history.py`
- [ ] Update `api/auth.py` (JWT payload to include patient_id)
- [ ] Update all endpoints that reference `member_id`

### Frontend
- [ ] Update `web/lib/api-auth.ts` types
- [ ] Update signup page (if re-enabled)
- [ ] Update profile page to show user + patient
- [ ] Update visits page to use patient_id
- [ ] Update localStorage to store patient_id

### Database
- [ ] Run migration: Create patients table
- [ ] Run migration: Migrate data users → patients
- [ ] Run migration: Update FK constraints
- [ ] Verify data integrity
- [ ] Test rollback procedure

### Testing
- [ ] Test signup creates User + Patient
- [ ] Test login returns patient_id
- [ ] Test profile shows both user + patient
- [ ] Test visits filtered by patient_id
- [ ] Test multi-patient scenario (one user, many patients)

---

## 🔄 Migration Example

**Before**:
```
users:
  id: 123
  email: john@example.com
  hashed_password: $2b$...
  full_name: John Doe
  phone: 9876543210

appointment_requests:
  member_id: 123  → references users.id
```

**After**:
```
users:
  id: 123
  email: john@example.com
  username: johndoe
  hashed_password: $2b$...

patients:
  id: 123  (same ID during migration)
  user_id: 123  → references users.id
  full_name: John Doe
  phone: 9876543210

appointment_requests:
  member_id: 123  → NOW references patients.id
```

**No FK value changes needed!** Just constraint updates.

---

## 📝 Summary

### Current State:
- ❌ `users` table = Auth + Patient data mixed
- ❌ `member_id` references `users.id`

### Target State:
- ✅ `users` table = Auth only (email, password, username)
- ✅ `patients` table = Patient data (full_name, phone, DOB, etc.)
- ✅ `user_id` → `users.id` (ownership)
- ✅ `member_id` → `patients.id` (patient records)

### Result:
- Clean separation of concerns
- Support for caregivers (one user, many patients)
- Better security and compliance
- Scalable architecture

---

*Ready to implement when you approve the design!*
