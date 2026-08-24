# 🧪 Complete Testing Guide

## Test the Complete Flow

### Test 1: New User Without Profile

#### Step 1: Create New User
```bash
# Visit http://localhost:3000
# You'll be redirected to /login

# Click "Sign up"
# Fill:
- Username: testuser2026
- Email: test2026@example.com  
- Password: Test1234
- Confirm Password: Test1234

# Click "Create account"
# ✅ Should redirect to /login
```

#### Step 2: Login
```bash
# On login page, enter:
- Username: testuser2026 (or test2026@example.com)
- Password: Test1234

# Click "Login"
# ✅ Should check for profile
# ✅ No profile found
# ✅ Redirects to /profile/create
```

#### Step 3: Try to Access Profile Tab (Should Show Create Profile)
```bash
# If you somehow reach the main app without profile
# Click "Profile" tab
# ✅ Should show:
  - 👤 Icon
  - "Complete Your Profile" message
  - [Create Profile] button
```

#### Step 4: Create Profile
```bash
# On /profile/create page, fill:

Personal Information:
- Full Name: John Doe ✅ (required)
- Phone: 9876543210
- Date of Birth: 1990-05-15
- Gender: Male
- Blood Group: O+
- Address: 123 Main Street

Healthcare IDs:
- MRN: MRN12345
- ABHA ID: ABHA67890
- ABHA Address: john@abdm

Medical Information:
- Allergies: Peanuts, Shellfish
- Chronic Conditions: Hypertension
- Current Medications: Lisinopril 10mg

Emergency Contact:
- Name: Jane Doe
- Relationship: Spouse
- Phone: 9876543211

# Click "Complete Profile"
# ✅ Should create patient record
# ✅ Redirects to main app (/)
```

#### Step 5: View Profile
```bash
# In main app, click "Profile" tab
# ✅ Should load patient data from database
# ✅ Should display:

Personal Information:
  - Full Name: John Doe
  - Phone: 9876543210 | Email: test2026@example.com
  - Date of Birth: 1990-05-15 | Gender: Male
  - Blood Group: O+
  - Address: 123 Main Street

Healthcare IDs:
  - MRN: MRN12345
  - ABHA ID: ABHA67890
  - ABHA Address: john@abdm

Medical Information:
  - Allergies: Peanuts, Shellfish
  - Chronic Conditions: Hypertension
  - Current Medications: Lisinopril 10mg

Emergency Contact:
  - Name: Jane Doe
  - Relationship: Spouse
  - Phone: 9876543211

Actions:
  - [Edit Profile] button
  - ⚙️ Settings
  - 🚪 Sign Out
```

---

### Test 2: Existing User With Profile

#### Step 1: Sign Out
```bash
# Click "Profile" tab
# Click "🚪 Sign Out"
# ✅ Redirects to /login
```

#### Step 2: Login Again
```bash
# Enter:
- Username: testuser2026
- Password: Test1234

# Click "Login"
# ✅ Checks for profile
# ✅ Profile exists!
# ✅ Redirects directly to main app (/)
# ✅ SKIPS profile creation
```

#### Step 3: View Profile
```bash
# Click "Profile" tab
# ✅ Fetches data from database
# ✅ Displays all previously filled information
```

---

### Test 3: API Testing

#### Test Signup
```bash
curl -X POST http://localhost:8000/v3/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"apitest","email":"api@test.com","password":"Test1234"}'

# Expected Response:
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "apitest",
    "email": "api@test.com",
    "is_active": true
  },
  "message": "Account created successfully. Please login."
}
```

#### Test Login (No Profile)
```bash
curl -X POST http://localhost:8000/v3/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"apitest","password":"Test1234"}'

# Expected Response:
{
  "access_token": "jwt-token...",
  "token_type": "bearer",
  "user": {...},
  "patient": null,  ← No profile
  "session_id": "uuid"
}
```

#### Test Profile Endpoint (No Profile)
```bash
# Get token from login response
TOKEN="your-jwt-token"

curl http://localhost:8000/user/profile \
  -H "Authorization: Bearer $TOKEN"

# Expected Response:
{
  "user": {
    "id": "uuid",
    "username": "apitest",
    "email": "api@test.com",
    "is_active": true,
    "created_at": "2026-07-13..."
  },
  "patient": null,  ← No profile
  "credits": {
    "balance": 20,
    "total_purchased": 0,
    "total_used": 0
  }
}
```

#### Test Create Patient Profile
```bash
curl -X POST http://localhost:8000/patients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "full_name": "API Test User",
    "phone": "1234567890",
    "email": "api@test.com",
    "date_of_birth": "1995-01-01",
    "gender": "Male",
    "blood_group": "A+",
    "address": "API Street",
    "mrn": "MRN999",
    "allergies": "None",
    "chronic_conditions": "None",
    "current_medications": "None"
  }'

# Expected Response:
{
  "id": "patient-uuid",
  "full_name": "API Test User",
  "phone": "1234567890",
  ...
}
```

#### Test Profile Endpoint (With Profile)
```bash
curl http://localhost:8000/user/profile \
  -H "Authorization: Bearer $TOKEN"

# Expected Response:
{
  "user": {...},
  "patient": {
    "id": "uuid",
    "full_name": "API Test User",
    "phone": "1234567890",
    "email": "api@test.com",
    "date_of_birth": "1995-01-01",
    "gender": "Male",
    "blood_group": "A+",
    "address": "API Street",
    "mrn": "MRN999",
    "allergies": "None",
    "chronic_conditions": "None",
    "current_medications": "None",
    "emergency_contact": null
  },  ← Profile exists!
  "credits": {...}
}
```

---

### Test 4: Database Verification

#### Check User Created
```bash
docker exec pal-db-1 psql -U pal -d pal \
  -c "SELECT id, username, email FROM users WHERE username='testuser2026';"
```

#### Check Patient Created
```bash
docker exec pal-db-1 psql -U pal -d pal \
  -c "SELECT id, full_name, phone, blood_group FROM patients WHERE email='test2026@example.com';"
```

#### Check All Patient Fields
```bash
docker exec pal-db-1 psql -U pal -d pal \
  -c "SELECT * FROM patients WHERE email='test2026@example.com';"
```

---

## ✅ Expected Results

### For New User:
1. ✅ Signup → Redirects to login
2. ✅ Login → Checks profile → None found → Redirects to /profile/create
3. ✅ Fill profile → Creates patient record → Redirects to main app
4. ✅ Profile tab → Shows "Create Profile" if accessed before creating
5. ✅ Profile tab → Shows all patient data after creating

### For Existing User:
1. ✅ Login → Checks profile → Exists → Redirects to main app
2. ✅ Profile tab → Fetches from database → Displays all fields
3. ✅ Edit Profile → Goes to /profile/create with data

### API Responses:
1. ✅ `/v3/auth/signup` → Returns user (no patient)
2. ✅ `/v3/auth/login` → Returns user + patient (null if doesn't exist)
3. ✅ `/user/profile` → Returns user + patient + credits
4. ✅ `POST /patients` → Creates patient record
5. ✅ `GET /patients/{id}` → Returns patient details

---

## 🐛 Common Issues

### Issue: Profile tab shows nothing
**Solution:** Open browser console, check for API errors

### Issue: 404 on profile endpoint
**Solution:** Use `/user/profile` not `/api/user/profile` in direct API calls

### Issue: Profile doesn't load
**Solution:** 
- Check if patient exists in database
- Check browser localStorage for `pal_token`
- Verify token is valid

### Issue: Create Profile button doesn't work
**Solution:** 
- Check browser console for errors
- Verify router is imported in page.tsx
- Check if onClick handler is working

---

## 🎉 Success Criteria

All of these should work:

- ✅ New user signup flow
- ✅ Login redirects to profile creation if no profile
- ✅ Login redirects to main app if profile exists
- ✅ Profile tab shows "Create Profile" if no profile
- ✅ Profile tab fetches and displays all patient data
- ✅ All patient fields are shown in organized sections
- ✅ Only sections with data are displayed
- ✅ Edit Profile button works
- ✅ Data is fetched from PostgreSQL via FastAPI
- ✅ Everything updates dynamically

**Test URL:** http://localhost:3000

**Everything should be working now!** 🚀
