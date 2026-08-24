# PAL Authentication System V2

## Overview

**Complete microservices-ready authentication system with JWT session management, encrypted token storage, and dual login modes (Password + OTP).**

---

## 🎯 Features

### ✅ Dual Authentication Modes
- **Password Login**: Traditional email/password authentication
- **OTP Login**: Phone-based OTP (SMS) authentication
- **Seamless Switching**: Users can choose their preferred method

### ✅ Secure Session Management
- JWT tokens encrypted and stored in PostgreSQL
- Session metadata (IP, user agent, device info)
- Multi-device session tracking
- Individual session revocation
- Automatic session expiration (7 days)

### ✅ Complete User Journey
1. **Check User**: Determine if user exists
2. **Login**: Password or OTP based
3. **Register**: New user with complete profile
4. **Onboarding**: First-time user setup

### ✅ Security Features
- Bcrypt password hashing with 72-byte limit handling
- Fernet encryption for JWT tokens in database
- Session validation on every request
- Automatic session cleanup
- Rate limiting via OTP attempts

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                              │
│  - /login page (new)                                             │
│  - /onboarding page (existing)                                   │
│  - lib/api-auth.ts (new auth API client)                        │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP/JSON
┌────────────────────▼────────────────────────────────────────────┐
│  Next.js API Proxy                                               │
│  /api/v2/auth/* → http://api:8000/v2/auth/*                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ Docker Network
┌────────────────────▼────────────────────────────────────────────┐
│  FastAPI Backend                                                 │
│  - routers/auth_v2.py (new enhanced auth)                       │
│  - routers/auth.py (legacy - kept for compatibility)            │
│  - services/encryption.py (token encryption)                    │
│  - services/session_service.py (session CRUD)                   │
│  - models/session.py (UserSession table)                        │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│  PostgreSQL Database                                             │
│  - users table (existing)                                        │
│  - user_sessions table (new)                                    │
│  - otp_sessions table (existing)                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Schema

### New Table: `user_sessions`

```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Encrypted JWT token
    encrypted_token TEXT NOT NULL,
    
    -- Session metadata
    session_name VARCHAR(100),      -- e.g., "Chrome on Windows"
    ip_address VARCHAR(45),          -- IPv4 or IPv6
    user_agent VARCHAR(500),
    
    -- Session lifecycle
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_activity TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active, expires_at) WHERE is_active = TRUE;
```

---

## 🔐 Authentication Flows

### Flow 1: New User Registration (Password-based)

```
User → Frontend
  1. Enter email on /login
  2. System checks: User doesn't exist
  3. Show registration form
  4. Fill: email, password, full_name, phone, DOB
  5. Submit registration

Frontend → Backend
  POST /api/v2/auth/register
  {
    "email": "user@example.com",
    "password": "SecurePass123",
    "full_name": "John Doe",
    "phone": "9876543210",
    "date_of_birth": "1990-01-01",
    "preferred_language": "en"
  }

Backend Processing
  1. Check email/phone uniqueness
  2. Hash password (bcrypt)
  3. Create user record
  4. Generate JWT token (7-day expiry)
  5. Encrypt token with Fernet
  6. Store encrypted token in user_sessions
  7. Return auth response

Response
  {
    "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "token_type": "bearer",
    "expires_in": 604800,
    "session_id": "uuid-of-session",
    "user": { ... },
    "is_new_user": true,
    "requires_onboarding": false
  }

Frontend
  1. Save token, user_id, session_id to localStorage
  2. Redirect to / or /onboarding if needed
```

### Flow 2: Existing User Login (Password)

```
User → Frontend
  1. Enter email/phone on /login
  2. System checks: User exists with password
  3. Show password input
  4. Enter password
  5. Click "Login"

Frontend → Backend
  POST /api/v2/auth/login/password
  {
    "username": "user@example.com",  // or phone number
    "password": "SecurePass123"
  }

Backend Processing
  1. Find user by email or phone
  2. Verify password (bcrypt)
  3. Check user is active
  4. Generate JWT token
  5. Encrypt and store in user_sessions
  6. Return auth response

Frontend
  1. Save auth data
  2. Redirect to main app
```

### Flow 3: OTP-based Login

```
Step 1: Request OTP

Frontend → Backend
  POST /api/v2/auth/login/otp/request
  {
    "phone": "9876543210",
    "delivery_channel": "sms"
  }

Backend
  1. Check user exists
  2. Generate 6-digit OTP
  3. Hash OTP (bcrypt)
  4. Store in otp_sessions
  5. Send OTP via SMS (mock in dev)
  
Response
  {
    "message": "OTP sent via sms to +91 98765·····",
    "dev_otp": "123456",  // Only in development
    "expires_in": 300
  }

Step 2: Verify OTP

Frontend → Backend
  POST /api/v2/auth/login/otp/verify
  {
    "phone": "9876543210",
    "otp_code": "123456"
  }

Backend
  1. Find OTP session
  2. Check attempts < 3
  3. Verify OTP hash
  4. Mark OTP as verified
  5. Find or create user
  6. Generate JWT + session
  7. Return auth response

Frontend
  1. Save auth data
  2. Redirect based on requires_onboarding
```

---

## 🔑 API Endpoints

### V2 Endpoints (New)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v2/auth/check-user` | Check if user exists |
| `POST` | `/v2/auth/register` | Register new user with password |
| `POST` | `/v2/auth/login/password` | Login with email/phone + password |
| `POST` | `/v2/auth/login/otp/request` | Request OTP for phone |
| `POST` | `/v2/auth/login/otp/verify` | Verify OTP and login |
| `GET` | `/v2/auth/me` | Get current user profile |
| `PATCH` | `/v2/auth/profile` | Update user profile |
| `GET` | `/v2/auth/sessions` | List all active sessions |
| `DELETE` | `/v2/auth/sessions/{id}` | Revoke specific session |
| `POST` | `/v2/auth/logout` | Logout from all sessions |
| `GET` | `/v2/auth/permissions` | Get user permissions |

### Legacy Endpoints (Kept for backward compatibility)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Old registration endpoint |
| `POST` | `/auth/token` | OAuth2 password flow |
| `POST` | `/auth/request-otp` | Old OTP request |
| `POST` | `/auth/verify-otp` | Old OTP verify |
| `GET` | `/auth/me` | Get current user |
| `PATCH` | `/auth/profile` | Update profile |

---

## 💾 Frontend Implementation

### New Files

#### 1. `web/lib/api-auth.ts`
Complete auth API client with:
- `checkUserExists()` - Check if user exists
- `registerUser()` - Register new user
- `loginWithPassword()` - Password login
- `requestLoginOTP()` - Request OTP
- `verifyLoginOTP()` - Verify OTP
- `getCurrentUser()` - Get profile
- `updateProfile()` - Update user
- `getUserSessions()` - List sessions
- `revokeSession()` - Revoke session
- `logout()` - Logout all
- `saveAuth()` / `clearAuth()` - Storage helpers

#### 2. `web/app/login/page.tsx`
Modern login page with:
- User existence check
- Dynamic flow (login vs register)
- Password/OTP mode toggle
- Complete registration form
- 6-digit OTP input
- Resend OTP functionality
- Error handling
- Loading states

### localStorage Keys

```javascript
pal_token           // JWT access token
pal_user_id         // User UUID
pal_session_id      // Session UUID (new)
pal_preferred_lang  // User's language preference
pal_user_name       // User's full name (optional)
```

---

## 🔧 Backend Implementation

### New Files

#### 1. `api/models/session.py`
`UserSession` model with encrypted token storage

#### 2. `api/services/encryption.py`
Token encryption/decryption using Fernet cipher

#### 3. `api/services/session_service.py`
Session CRUD operations:
- `create_session()` - Create new session
- `get_active_session()` - Find session by token
- `validate_and_update_session()` - Update last activity
- `revoke_session()` - Revoke single session
- `revoke_all_user_sessions()` - Revoke all
- `cleanup_expired_sessions()` - Cleanup job

#### 4. `api/routers/auth_v2.py`
Complete auth router (800+ lines):
- Registration with full profile
- Password login
- OTP login (request + verify)
- User check endpoint
- Profile management
- Session management
- Permissions

#### 5. `api/alembic/versions/0009_user_sessions.py`
Database migration for user_sessions table

### Updated Files

- `api/models/__init__.py` - Export UserSession
- `api/main.py` - Include auth_v2 router at `/v2/auth`
- `api/requirements.txt` - Add cryptography>=43.0.0

---

## 🧪 Testing

### 1. Start Docker Services

```bash
docker-compose up -d
```

### 2. Run Migration

```bash
docker-compose exec api alembic upgrade head
```

### 3. Test New User Registration

```bash
# Check user doesn't exist
curl -X POST http://localhost:3000/api/v2/auth/check-user \
  -H "Content-Type: application/json" \
  -d '{"username": "test@example.com"}'

# Should return: {"exists": false, "has_password": false, "has_phone": false}

# Register new user
curl -X POST http://localhost:3000/api/v2/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456",
    "full_name": "Test User",
    "phone": "9999999999",
    "preferred_language": "en"
  }'

# Should return: auth response with access_token and session_id
```

### 4. Test Password Login

```bash
curl -X POST http://localhost:3000/api/v2/auth/login/password \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test@example.com",
    "password": "Test123456"
  }'
```

### 5. Test OTP Login

```bash
# Request OTP
curl -X POST http://localhost:3000/api/v2/auth/login/otp/request \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "delivery_channel": "sms"
  }'

# Get OTP from response (dev_otp field in development)

# Verify OTP
curl -X POST http://localhost:3000/api/v2/auth/login/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "otp_code": "123456"
  }'
```

### 6. Test Session Management

```bash
TOKEN="your-jwt-token-here"

# Get current user
curl http://localhost:3000/api/v2/auth/me \
  -H "Authorization: Bearer $TOKEN"

# List sessions
curl http://localhost:3000/api/v2/auth/sessions \
  -H "Authorization: Bearer $TOKEN"

# Logout
curl -X POST http://localhost:3000/api/v2/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🎨 Frontend Usage

### Using the new login page

1. **Navigate to** `/login`
2. **Enter email or phone** → System checks if user exists
3. **If new user** → Show registration form
4. **If existing user**:
   - With password → Show password login
   - Without password → Show OTP login
5. **After auth** → Redirect to main app or onboarding

### Example: Protecting a page

```typescript
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isAuthenticated } from '@/lib/api-auth'

export default function ProtectedPage() {
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login')
    }
  }, [router])

  return <div>Protected content</div>
}
```

### Example: Logout button

```typescript
import { logout } from '@/lib/api-auth'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  return <button onClick={handleLogout}>Logout</button>
}
```

---

## 🔒 Security Considerations

### Token Encryption
- JWT tokens encrypted with Fernet (AES-128 CBC)
- Encryption key derived from SECRET_KEY
- Tokens never stored in plaintext

### Password Security
- Bcrypt hashing with salt
- 72-byte limit handling for bcrypt
- Passwords never logged or exposed

### Session Security
- 7-day expiration
- IP and user agent tracking
- Individual session revocation
- Automatic cleanup of expired sessions

### OTP Security
- 6-digit random codes
- 5-minute expiration
- Max 3 verification attempts
- Hashed storage (bcrypt)

---

## 🚀 Migration Path

### For Existing Users

**Old OTP-only users** can continue using OTP login OR set a password:

1. Login via OTP (existing flow works)
2. Go to profile settings
3. Set password for future logins
4. Can now use either method

### For New Deployment

1. Run migration: `alembic upgrade head`
2. Update frontend to use `/login` instead of `/onboarding` as entry point
3. Both flows work simultaneously
4. Gradually migrate users to password-based auth

### Backward Compatibility

- Old `/auth/*` endpoints still work
- Existing OTP flow unchanged
- Legacy tokens still valid
- No breaking changes

---

## 🚪 Default Login Page

**The application now opens at `/login` by default for unauthenticated users.**

### Redirect Flow

```
User visits any route (/, /onboarding, etc.)
          ↓
Check authentication state
          ↓
┌─────────┴─────────┐
│                   │
No token        Has token
│                   │
↓                   ↓
/login          Check language preference
                    │
              ┌─────┴─────┐
              │           │
          Has lang    No lang
              │           │
              ↓           ↓
         Main app    /onboarding
            (/)
```

### Implementation

**Main Page** ([app/page.tsx](c:\PAL\web\app\page.tsx)):
```typescript
useEffect(() => {
  const token = localStorage.getItem('pal_token');
  const lang = localStorage.getItem('pal_preferred_lang');

  if (!token) {
    window.location.replace('/login');  // Redirect to login
  } else if (!lang) {
    window.location.replace('/onboarding');  // Complete profile
  }
  // Otherwise stay on main app
}, []);
```

**Onboarding Page** ([app/onboarding/page.tsx](c:\PAL\web\app\onboarding\page.tsx)):
```typescript
useEffect(() => {
  const token = localStorage.getItem('pal_token');
  const lang = localStorage.getItem('pal_preferred_lang');

  if (!token) {
    window.location.replace('/login');  // Should login first
  } else if (token && lang) {
    window.location.replace('/');  // Already complete
  }
  // If token but no lang, stay for onboarding
}, []);
```

**Sign Out**:
```typescript
function handleSignOut() {
  clearAuth();  // Clear localStorage
  window.location.replace('/login');  // Back to login
}
```

---

## 📝 Environment Variables

No new environment variables required! Uses existing:

```bash
SECRET_KEY=your-secret-key-here          # For JWT and encryption
ACCESS_TOKEN_EXPIRE_MINUTES=10080        # 7 days (default)
ALGORITHM=HS256                          # JWT algorithm
```

---

## ✨ Benefits

### For Users
- ✅ Choose preferred login method (password or OTP)
- ✅ Faster login with saved passwords
- ✅ Multi-device session management
- ✅ Better security with encrypted sessions
- ✅ Seamless onboarding experience

### For Developers
- ✅ Microservices-ready architecture
- ✅ Clean separation of concerns
- ✅ Reusable session service
- ✅ Type-safe frontend API
- ✅ Comprehensive error handling
- ✅ Easy to extend and customize

### For Operations
- ✅ Session monitoring and analytics
- ✅ Security audit trail (IP, device)
- ✅ Easy session revocation
- ✅ Automatic cleanup
- ✅ Backward compatible

---

## 🎯 Next Steps

1. **Test the complete flow** end-to-end
2. **Add password reset** functionality
3. **Implement email verification**
4. **Add 2FA support**
5. **Session analytics dashboard**
6. **Rate limiting** on login attempts
7. **Suspicious activity detection**

---

## 📚 Related Documentation

- [FRONTEND_BACKEND_MAPPING.md](FRONTEND_BACKEND_MAPPING.md) - API endpoint mapping
- [SETUP_COMPLETE.md](SETUP_COMPLETE.md) - Initial setup guide
- [PAL_BUILD_DOCUMENT.md](PAL_BUILD_DOCUMENT.md) - Complete architecture

---

*Created: 2026-07-07*
*Version: 2.0*
*Status: ✅ Complete and Ready for Testing*
