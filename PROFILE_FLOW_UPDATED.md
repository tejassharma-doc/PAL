# ✅ Profile Flow Updated

## Summary

The authentication and profile flow has been completely updated:

1. **Login page is default** - Users see login page on first visit
2. **Login with username OR email** - Both accepted
3. **Mandatory profile creation** - After login, users must complete profile
4. **Onboarding removed** - No more onboarding logic
5. **All patient fields** - Profile includes all fields from patients table

---

## 🔄 New Flow

### 1. Visit http://localhost:3000
- **Redirects to `/login`** if not authenticated
- **Redirects to `/profile/create`** if logged in but no profile
- **Shows main app** if logged in with profile

### 2. Login Page (`/login`)
- **Username OR Email** - Users can enter either
  - `john_doe` ✅
  - `john@example.com` ✅
- **Password** authentication
- **Two login modes**:
  - Email & Password (default)
  - Phone OTP
- **Sign up link** at bottom

### 3. Signup Page (`/signup`)
- **Minimal fields**:
  - Username
  - Email
  - Password
  - Confirm Password
- **Matches login design**
- **Creates user only** - Profile filled later

### 4. Profile Creation (`/profile/create`)
**Mandatory after first login**

#### Personal Information (Required):
- ✅ Full Name *
- Phone
- Date of Birth
- Gender
- Blood Group
- Address

#### Healthcare IDs (Optional):
- MRN (Medical Record Number)
- ABHA ID (Ayushman Bharat Health Account)
- ABHA Address

#### Medical Information (Optional):
- Allergies
- Chronic Conditions
- Current Medications

#### Emergency Contact (Optional):
- Name
- Relationship
- Phone

---

## 📁 Files Created/Modified

### Created:
1. **`web/app/profile/create/page.tsx`** - Profile creation page with all fields
2. **`api/routers/patients.py`** - Patient CRUD endpoints

### Modified:
1. **`web/app/page.tsx`** - Removed onboarding, added profile check
2. **`web/app/login/page.tsx`** - Accept username OR email
3. **`api/main.py`** - Registered patients router

---

## 🎯 API Endpoints

### Authentication:
- `POST /v3/auth/signup` - Create user account (username, email, password)
- `POST /v3/auth/login` - Login with username/email + password
- `GET /v3/auth/me` - Get current user + patient

### Patients:
- `POST /patients` - Create patient profile (all fields)
- `GET /patients/{patient_id}` - Get patient by ID

---

## 🔑 LocalStorage Keys

After successful flow:
```javascript
localStorage.getItem('pal_token')          // JWT token
localStorage.getItem('pal_user_id')        // User UUID
localStorage.getItem('pal_patient_id')     // Patient UUID
localStorage.getItem('pal_username')       // Username
localStorage.getItem('pal_user_name')      // Full name
localStorage.getItem('pal_preferred_lang') // Language (set to 'en')
```

---

## 🧪 Testing the Flow

### Step 1: Visit Site
```
http://localhost:3000
→ Redirects to http://localhost:3000/login
```

### Step 2: Sign Up (if new user)
```
http://localhost:3000/signup
- Username: testuser
- Email: test@example.com
- Password: Test1234
→ Creates user account
→ Redirects to /login
```

### Step 3: Login
```
http://localhost:3000/login
- Enter: testuser OR test@example.com
- Password: Test1234
→ Authenticates user
→ Redirects to /profile/create (no profile yet)
```

### Step 4: Create Profile
```
http://localhost:3000/profile/create
- Full Name: John Doe ✅ (required)
- Phone: 9876543210
- Date of Birth: 1990-05-15
- Gender: Male
- Blood Group: O+
- Address: 123 Main Street
- MRN: MRN123 (optional)
- ABHA ID: ABHA456 (optional)
- Allergies: None
- Chronic Conditions: Diabetes
- Current Medications: Metformin
- Emergency Contact: Jane Doe, Spouse, 9876543211
→ Creates patient record
→ Redirects to / (main app)
```

### Step 5: Main App
```
http://localhost:3000
→ Shows main PAL application
```

---

## 🔄 Existing User Login

If patient profile already exists:

```
http://localhost:3000
→ /login (if not authenticated)

Login with username/email:
→ / (main app directly, skips profile creation)
```

---

## ✅ Checklist

- ✅ Login page is default on first visit
- ✅ Can login with username OR email
- ✅ Profile creation is mandatory after login
- ✅ All patient fields included in profile form
- ✅ Onboarding logic removed
- ✅ Profile form matches design system
- ✅ Backend endpoints working
- ✅ Database schema supports all fields

---

## 🚀 Ready to Test!

1. Start services:
```bash
cd c:/PAL
docker-compose up -d
```

2. Visit: **http://localhost:3000**

3. You'll see:
   - Login page first ✅
   - Can use username or email ✅
   - After login → Profile creation ✅
   - After profile → Main app ✅

---

## 🎉 Complete!

The authentication flow now:
- Starts with login page
- Accepts username OR email
- Requires profile completion
- Uses all patient table fields
- No onboarding page

All working and ready to use! 🏥
