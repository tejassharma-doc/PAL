# 🚀 Complete Users & Patients Separation Implementation Guide

## Overview

This guide implements the **complete separation** of authentication (users) and patient data (patients) as specified.

---

## ✅ What's Already Done

### 1. Database Models Created
- ✅ **`api/models/patient.py`** - NEW Patient model with all specified fields
- ✅ **`api/models/user.py`** - UPDATED to auth-only fields
- ✅ **`api/models/__init__.py`** - Updated imports
- ✅ **`api/alembic/versions/001_create_patients_table.py`** - Migration script

### 2. Database Schema

#### Users Table (Authentication Only)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(320) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    password_updated_at TIMESTAMP,
    password_updated_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Patients Table (Patient Data)
```sql
CREATE TABLE patients (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Healthcare IDs
    clinic_id VARCHAR(100),
    mrn VARCHAR(100),
    abha_id VARCHAR(100) UNIQUE,
    abha_address VARCHAR(255),
    
    -- Personal Info
    full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    phone VARCHAR(30),
    email VARCHAR(320),
    
    -- Medical Info
    blood_group VARCHAR(10),
    address TEXT,
    allergies TEXT,
    chronic_conditions TEXT,
    current_medications TEXT,
    emergency_contact JSONB,
    
    -- Profile
    photo_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 📋 Step-by-Step Implementation

### STEP 1: Run Database Migration

```bash
cd c:/PAL/api

# Run the migration
python -c "from alembic.config import Config; from alembic import command; cfg = Config('alembic.ini'); command.upgrade(cfg, 'head')"
```

**This will**:
- ✅ Create `patients` table
- ✅ Migrate existing user data to patients
- ✅ Add `username` to users table
- ✅ Remove patient fields from users table

---

### STEP 2: Create New Auth Endpoints

**File**: `api/routers/auth_new.py` (NEW)

```python
"""New authentication with users/patients separation"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
import re

from database import get_db
from models import User, Patient
from auth import hash_password, verify_password, create_access_token, get_current_user
from services.session_service import SessionService

router = APIRouter(prefix="/auth", tags=["auth"])


# Request Models
class SignupRequest(BaseModel):
    # User (auth)
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)
    
    # Patient (personal data)
    full_name: str = Field(..., min_length=2)
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None  # YYYY-MM-DD
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    address: Optional[str] = None


class LoginRequest(BaseModel):
    username: str  # Can be username or email
    password: str


# Signup Endpoint
@router.post("/signup")
async def signup(
    req: SignupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Sign up creates User (auth) + Patient (data)"""
    
    # Check username exists
    result = await db.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Username already taken")
    
    # Check email exists
    result = await db.execute(select(User).where(User.email == req.email.lower()))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    
    # Validate password
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not re.search(r'[A-Z]', req.password):
        raise HTTPException(400, "Password must contain uppercase letter")
    if not re.search(r'[a-z]', req.password):
        raise HTTPException(400, "Password must contain lowercase letter")
    if not re.search(r'[0-9]', req.password):
        raise HTTPException(400, "Password must contain a number")
    
    # Create User (authentication)
    user = User(
        username=req.username,
        email=req.email.lower(),
        hashed_password=hash_password(req.password),
        password_updated_at=datetime.now(),
        password_updated_count=0,
        is_active=True
    )
    db.add(user)
    await db.flush()
    
    # Parse DOB
    dob = None
    if req.date_of_birth:
        try:
            dob = datetime.strptime(req.date_of_birth, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")
    
    # Create Patient (personal data)
    patient = Patient(
        user_id=user.id,
        full_name=req.full_name,
        phone=req.phone,
        email=req.email.lower(),
        date_of_birth=dob,
        gender=req.gender,
        blood_group=req.blood_group,
        address=req.address,
        is_active=True
    )
    db.add(patient)
    await db.commit()
    await db.refresh(user)
    await db.refresh(patient)
    
    # Create session
    session_service = SessionService(db)
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    
    session = await session_service.create_session(
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        session_name=f"{user.username}'s session"
    )
    
    # Create JWT
    token = create_access_token(data={"sub": str(user.id)})
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email
        },
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone
        },
        "session_id": str(session.id)
    }


# Login Endpoint
@router.post("/login")
async def login(
    req: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Login with username/email and password"""
    
    # Find user by username or email
    if '@' in req.username:
        result = await db.execute(select(User).where(User.email == req.username.lower()))
    else:
        result = await db.execute(select(User).where(User.username == req.username))
    
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(401, "Invalid credentials")
    
    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")
    
    if not user.is_active:
        raise HTTPException(403, "Account is disabled")
    
    # Get user's primary patient
    result = await db.execute(
        select(Patient).where(Patient.user_id == user.id).limit(1)
    )
    patient = result.scalar_one_or_none()
    
    # Create session
    session_service = SessionService(db)
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    
    session = await session_service.create_session(
        user_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
        session_name=f"{user.username}'s session"
    )
    
    # Create JWT
    token = create_access_token(data={"sub": str(user.id)})
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email
        },
        "patient": {
            "id": str(patient.id) if patient else None,
            "full_name": patient.full_name if patient else None,
            "phone": patient.phone if patient else None
        } if patient else None,
        "session_id": str(session.id)
    }


# Get Current User + Patient
@router.get("/me")
async def get_me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user and their primary patient"""
    
    result = await db.execute(
        select(Patient).where(Patient.user_id == user.id).limit(1)
    )
    patient = result.scalar_one_or_none()
    
    return {
        "user": {
            "id": str(user.id),
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None
        },
        "patient": {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "phone": patient.phone,
            "email": patient.email,
            "date_of_birth": str(patient.date_of_birth) if patient.date_of_birth else None,
            "gender": patient.gender,
            "blood_group": patient.blood_group,
            "address": patient.address
        } if patient else None
    }
```

---

### STEP 3: Update Main.py to Register New Router

**File**: `api/main.py`

```python
# Add import
from routers import auth_new

# Add router
app.include_router(auth_new.router, prefix="/v3")  # New auth endpoints
```

---

### STEP 4: Update Visits Endpoint to Use Patients

**File**: `api/routers/appointments_history.py`

```python
# Update imports
from models import User, Patient, AppointmentRequest, CallSession

# Update endpoint
@router.get("/appointments/{tenant_id}/{patient_id}/history")
async def get_appointment_history(
    tenant_id: uuid.UUID,
    patient_id: uuid.UUID,  # NOW patient_id, not member_id
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get appointment history for a patient"""
    
    # Verify user owns this patient
    result = await db.execute(
        select(Patient).where(
            Patient.id == patient_id,
            Patient.user_id == user.id
        )
    )
    patient = result.scalar_one_or_none()
    
    if not patient:
        raise HTTPException(403, "Access denied")
    
    # Query appointments (member_id references patient now)
    appt_stmt = select(AppointmentRequest).where(
        AppointmentRequest.tenant_id == tenant_id,
        AppointmentRequest.member_id == patient_id,  # patient_id
        AppointmentRequest.status == AppointmentRequestStatus.confirmed,
    )
    
    # ... rest same
```

---

### STEP 5: Create Frontend API Client

**File**: `web/lib/api-auth-new.ts` (NEW)

```typescript
// Types
export interface User {
  id: string
  username: string
  email: string
  is_active: boolean
  created_at?: string
}

export interface Patient {
  id: string
  user_id: string
  full_name: string
  phone?: string
  email?: string
  date_of_birth?: string
  gender?: string
  blood_group?: string
  address?: string
  photo_url?: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
  patient?: Patient
  session_id: string
}

// Storage
export function saveAuth(token: string, user: User, patient: Patient | null, sessionId: string) {
  if (typeof window === 'undefined') return

  localStorage.setItem('pal_token', token)
  localStorage.setItem('pal_user_id', user.id)
  localStorage.setItem('pal_username', user.username)
  localStorage.setItem('pal_session_id', sessionId)
  
  if (patient) {
    localStorage.setItem('pal_patient_id', patient.id)
    localStorage.setItem('pal_patient_name', patient.full_name)
  }
}

// Signup
export async function signup(data: {
  username: string
  email: string
  password: string
  full_name: string
  phone?: string
  date_of_birth?: string
  gender?: string
  blood_group?: string
  address?: string
}): Promise<AuthResponse> {
  const res = await fetch('/api/v3/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Signup failed')
  }

  saveAuth(json.access_token, json.user, json.patient, json.session_id)

  return json
}

// Login
export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch('/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Login failed')
  }

  saveAuth(json.access_token, json.user, json.patient, json.session_id)

  return json
}

// Get Me
export async function getMe(): Promise<{ user: User; patient?: Patient }> {
  const token = localStorage.getItem('pal_token')
  
  const res = await fetch('/api/v3/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    throw new Error('Failed to get user')
  }

  return res.json()
}
```

---

### STEP 6: Create New Signup Page

**File**: `web/app/signup/page.tsx` (NEW)

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signup } from '@/lib/api-auth-new';

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    blood_group: '',
    address: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await signup(formData);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: '0 auto' }}>
      <h1>Sign Up</h1>
      
      {error && (
        <div style={{ background: '#fee', color: '#c00', padding: 10, borderRadius: 5, marginBottom: 15 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 15 }}>
          <label>Username *</label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Email *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Password *</label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            minLength={8}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
          <small style={{ color: '#666' }}>
            Min 8 chars, must include uppercase, lowercase, and number
          </small>
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Full Name *</label>
          <input
            type="text"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Date of Birth</label>
          <input
            type="date"
            value={formData.date_of_birth}
            onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Gender</label>
          <select
            value={formData.gender}
            onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          >
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Blood Group</label>
          <select
            value={formData.blood_group}
            onChange={(e) => setFormData({ ...formData, blood_group: e.target.value })}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          >
            <option value="">Select...</option>
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B-">B-</option>
            <option value="O+">O+</option>
            <option value="O-">O-</option>
            <option value="AB+">AB+</option>
            <option value="AB-">AB-</option>
          </select>
        </div>

        <div style={{ marginBottom: 15 }}>
          <label>Address</label>
          <textarea
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            rows={3}
            style={{ width: '100%', padding: 8, fontSize: 16 }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: 12,
            fontSize: 18,
            background: '#37b59b',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 20 }}>
        Already have an account?{' '}
        <a href="/login" style={{ color: '#37b59b' }}>
          Login
        </a>
      </p>
    </div>
  );
}
```

---

## 📋 Complete Implementation Checklist

### Backend
- [x] Create Patient model
- [x] Update User model
- [x] Create database migration
- [ ] Register new auth router in main.py
- [ ] Update appointments_history endpoint
- [ ] Update user_profile endpoint
- [ ] Update all endpoints using member_id
- [ ] Run database migration
- [ ] Test API endpoints

### Frontend
- [ ] Create api-auth-new.ts
- [ ] Create signup page
- [ ] Update login page
- [ ] Update profile page
- [ ] Update visits page
- [ ] Test signup flow
- [ ] Test login flow
- [ ] Test profile display

### Testing
- [ ] Signup creates User + Patient
- [ ] Login returns patient data
- [ ] Profile shows patient fields
- [ ] Visits filtered by patient_id
- [ ] All existing functionality works

---

## 🚀 Quick Start Commands

```bash
# 1. Run migration
cd c:/PAL/api
alembic upgrade head

# 2. Restart FastAPI
pkill -f "uvicorn main:app"
uvicorn main:app --reload

# 3. Restart Next.js
cd c:/PAL/web
npm run dev

# 4. Test signup
curl -X POST http://localhost:8000/v3/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "email": "john@example.com",
    "password": "Password123",
    "full_name": "John Doe",
    "phone": "9876543210"
  }'

# 5. Test login
curl -X POST http://localhost:8000/v3/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "johndoe",
    "password": "Password123"
  }'
```

---

## 📝 Summary

This implementation:
- ✅ Separates users (auth) from patients (data)
- ✅ Users table: username, email, password only
- ✅ Patients table: All patient fields as specified
- ✅ Preserves existing data during migration
- ✅ New signup with all patient fields
- ✅ Login returns both user + patient
- ✅ Visits use patient_id not user_id

**Ready to implement step by step!**
