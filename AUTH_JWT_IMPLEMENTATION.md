# 🔐 Authentication & JWT Implementation

## ✅ **New JWT Structure**

### **JWT Payload** (Clean & Minimal):
```json
{
  "sub": "sharma182003",           // username (not user_id!)
  "roles": ["patient"],            // user roles
  "exp": 1234567890                // expiration timestamp
}
```

### **What Changed**:
- ❌ **OLD**: JWT contained `user_id` (UUID)
- ✅ **NEW**: JWT contains `username` and `roles`

---

## 📊 **Database Structure**

### **Users Table** (Updated):
```sql
users
├─ id (uuid)
├─ username (varchar) UNIQUE     ← Used in JWT
├─ email (varchar) UNIQUE
├─ hashed_password (varchar)
├─ roles (text[])                 ← NEW! Array of roles
└─ is_active (boolean)
```

### **Default Role**:
```sql
roles = ['patient']  -- Default for all users
```

---

## 🔄 **Authentication Flow**

### **1. Login (OTP Verification)**:
```
User enters phone + OTP
    ↓
Backend verifies OTP
    ↓
Backend finds/creates user
    ↓
Backend creates JWT with:
    - sub: user.username
    - roles: user.roles (default: ['patient'])
    ↓
Backend checks if patient profile exists:
    - Query: Patient.phone = user.phone OR Patient.email = user.email
    ↓
Returns:
{
    "access_token": "eyJ...",
    "patient_id": "uuid" or null,
    "requires_onboarding": true/false,
    "user": { "id", "username", "email" }
}
```

### **2. Token Validation** (Every Request):
```
Client sends: Authorization: Bearer <token>
    ↓
Backend decodes JWT
    ↓
Extracts username from payload.sub
    ↓
Queries: SELECT * FROM users WHERE username = <username>
    ↓
Returns User object
```

### **3. Fetching Patient Profile**:
```
Frontend has: username (from JWT)
    ↓
Backend uses username to find patient:
    SELECT * FROM patients 
    WHERE email = user.email 
       OR email = user.username
       OR phone = user.phone
    ↓
Returns patient_id
    ↓
Frontend saves to localStorage: 'pal_patient_id'
```

---

## 🔑 **JWT Functions**

### **Create Token** ([api/auth.py](c:\PAL\api\auth.py)):
```python
def create_access_token(
    username: str, 
    roles: list[str] = None, 
    expires_delta: Optional[timedelta] = None
) -> str:
    """Create JWT with username and roles"""
    payload = {
        "sub": username,              # Subject = username
        "roles": roles or ["patient"],
        "exp": expire_time
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")
```

**Usage**:
```python
token = create_access_token(
    username="sharma182003",
    roles=["patient"]
)
```

### **Validate Token** ([api/auth.py](c:\PAL\api\auth.py)):
```python
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Get user from JWT token"""
    payload = jwt.decode(token, SECRET_KEY)
    username = payload.get("sub")
    
    # Fetch user by username (not ID!)
    user = await db.execute(
        select(User).where(User.username == username)
    )
    return user.scalar_one_or_none()
```

---

## 🎯 **Profile Loading Logic**

### **After Login** ([api/routers/auth_v2.py](c:\PAL\api\routers\auth_v2.py)):
```python
# In create_auth_response():
patient_result = await db.execute(
    select(Patient).where(
        (Patient.email == user.email) | 
        (Patient.email == user.username) |
        (Patient.phone == user.phone),
        Patient.is_active == True
    )
)
patient = patient_result.scalar_one_or_none()

return {
    "access_token": token,
    "patient_id": str(patient.id) if patient else None,
    "requires_onboarding": patient is None,
    ...
}
```

### **Frontend** ([web/lib/api-auth.ts](c:\PAL\web\lib\api-auth.ts)):
```typescript
function saveAuth(token: string, user: any, sessionId: string, patientId?: string) {
    localStorage.setItem('pal_token', token)
    localStorage.setItem('pal_user_id', user.id)
    localStorage.setItem('pal_session_id', sessionId)
    
    if (patientId) {
        localStorage.setItem('pal_patient_id', patientId)  // ← Key!
    }
}
```

### **Login Page** ([web/app/login/page.tsx](c:\PAL\web\app\login\page.tsx)):
```typescript
const response = await verifyLoginOTP(phone, code)

if (response.patient_id) {
    // Patient profile exists → Main app
    router.push('/')
} else {
    // No patient profile → Create profile
    router.push('/profile/create')
}
```

---

## 📋 **Complete Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                    USER LOGS IN                             │
│  Phone: sharma182003, OTP: 123456                           │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              BACKEND: Verify OTP                            │
│  1. Check OTP valid                                         │
│  2. Find/Create user                                        │
│  3. Create JWT: { sub: "sharma182003", roles: ["patient"] }│
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│           BACKEND: Check Patient Exists                     │
│  SELECT * FROM patients                                     │
│  WHERE email = 'tejash@gmail.com'                           │
│     OR email = 'sharma182003'                               │
│     OR phone = '+1234567890'                                │
└────────────────────────┬────────────────────────────────────┘
                         ↓
         ┌───────────────┴───────────────┐
         ↓                               ↓
┌──────────────────┐          ┌──────────────────┐
│ Patient EXISTS   │          │ Patient NOT FOUND│
│ patient_id: "xx" │          │ patient_id: null │
└────────┬─────────┘          └────────┬─────────┘
         ↓                               ↓
┌──────────────────┐          ┌──────────────────┐
│ FRONTEND:        │          │ FRONTEND:        │
│ Save patient_id  │          │ No patient_id    │
│ Go to: /         │          │ Go to: /profile/ │
│ (Main App)       │          │       create     │
└──────────────────┘          └──────────────────┘
```

---

## ✅ **Key Benefits**

1. **JWT is Lightweight**:
   - Only contains username and roles
   - No sensitive data (no email, no user_id)

2. **Username-Based Lookup**:
   - Fast database lookup by username
   - Username is unique and indexed

3. **Patient Profile Separation**:
   - User (authentication) ≠ Patient (health data)
   - One user can manage multiple patients (future)

4. **Role-Based Access**:
   - Roles stored in JWT
   - Easy to check permissions
   - Default: `["patient"]`

---

## 🔒 **Security**

- JWT signed with `SECRET_KEY` (HS256)
- Token expires in 7 days
- Username is public (not sensitive)
- Roles define access level
- Patient data requires patient_id (not in JWT)

---

## 📝 **Files Modified**

1. **Database**:
   - ✅ `users.roles` column added (TEXT[])

2. **Backend**:
   - ✅ [api/models/user.py](c:\PAL\api\models\user.py) - Added `roles` field
   - ✅ [api/auth.py](c:\PAL\api\auth.py) - Updated JWT creation/validation
   - ✅ [api/routers/auth_v2.py](c:\PAL\api\routers\auth_v2.py) - Patient check on login

3. **Frontend**:
   - ✅ [web/lib/api-auth.ts](c:\PAL\web\lib\api-auth.ts) - Save patient_id
   - ✅ [web/app/login/page.tsx](c:\PAL\web\app\login\page.tsx) - Route based on patient_id

---

## 🧪 **Testing**

### **Test Case 1: Existing User with Profile**
```
1. Login with: sharma182003
2. Backend finds: patient_id = "4a6ebef6-0e47-42f9-94f4-e907c8ed845d"
3. Frontend redirects to: / (main app)
4. Profile page shows: Completed profile
```

### **Test Case 2: New User (No Profile)**
```
1. Login with new phone
2. Backend finds: patient_id = null
3. Frontend redirects to: /profile/create
4. Shows: "Create Your Profile" form
```

### **Test Case 3: JWT Decoding**
```javascript
// Decode JWT in browser console:
const token = localStorage.getItem('pal_token')
const payload = JSON.parse(atob(token.split('.')[1]))
console.log(payload)
// Output: { sub: "sharma182003", roles: ["patient"], exp: 1234567890 }
```

---

## ✅ **Summary**

The authentication system now:
- ✅ Uses **username** in JWT (not user_id)
- ✅ Includes **roles** in JWT
- ✅ Checks for **patient profile** on login
- ✅ Redirects to **main app** if profile exists
- ✅ Redirects to **profile creation** if no profile

**Refresh your browser and login again to test!** 🎉
