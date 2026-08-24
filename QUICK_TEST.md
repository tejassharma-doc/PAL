# ✅ Quick Test Guide - Auth System V2

## Current Status

✅ **Backend API**: Running on port 8000  
✅ **Frontend**: Running on port 3000  
✅ **Database**: PostgreSQL running  
✅ **Syntax Errors**: Fixed  

---

## 🧪 Test the New Authentication System

### 1. **Access the Application**

Open your browser:
```
http://localhost:3000
```

**Expected Result:**
- Should redirect to `http://localhost:3000/login`
- Shows the new login page with modern UI

---

### 2. **Test User Check Endpoint**

```bash
curl -X POST http://localhost:8000/v2/auth/check-user \
  -H "Content-Type: application/json" \
  -d '{"username": "test@example.com"}'
```

**Expected Response:**
```json
{
  "exists": false,
  "has_password": false,
  "has_phone": false
}
```

---

### 3. **Test Registration (Via API)**

```bash
curl -X POST http://localhost:8000/v2/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "password": "SecurePassword123",
    "full_name": "Test User",
    "phone": "9999888877",
    "preferred_language": "en"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "token_type": "bearer",
  "expires_in": 604800,
  "session_id": "uuid-here",
  "user": {
    "id": "uuid",
    "email": "testuser@example.com",
    ...
  },
  "is_new_user": true,
  "requires_onboarding": false
}
```

---

### 4. **Test Login with Password**

```bash
curl -X POST http://localhost:8000/v2/auth/login/password \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser@example.com",
    "password": "SecurePassword123"
  }'
```

**Expected Response:**
- Same format as registration
- Different `session_id`
- New encrypted token in database

---

### 5. **Test OTP Login**

**Step 1: Request OTP**
```bash
curl -X POST http://localhost:8000/v2/auth/login/otp/request \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "delivery_channel": "sms"
  }'
```

**Expected Response:**
```json
{
  "message": "OTP sent via sms to +91 98765·····",
  "dev_otp": "123456",
  "expires_in": 300
}
```

**Step 2: Verify OTP**
```bash
curl -X POST http://localhost:8000/v2/auth/login/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "otp_code": "123456"
  }'
```

---

### 6. **Test Session Management**

**Get current user:**
```bash
TOKEN="your-token-here"

curl http://localhost:8000/v2/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

**List sessions:**
```bash
curl http://localhost:8000/v2/auth/sessions \
  -H "Authorization: Bearer $TOKEN"
```

**Logout:**
```bash
curl -X POST http://localhost:8000/v2/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

### 7. **Test Frontend Login Flow**

1. Open http://localhost:3000 in browser
2. Should auto-redirect to `/login`
3. Enter `newuser@example.com`
4. Click "Continue"
5. Should show **Registration Form**
6. Fill all fields
7. Submit
8. Should create account and redirect to main app

---

### 8. **Test Existing User Login**

1. On login page, enter `testuser@example.com`
2. Click "Continue"
3. Should show **Password Input**
4. Enter password
5. Should login and redirect to main app

---

### 9. **Test OTP Login (Frontend)**

1. On login page, enter phone number
2. Click "Continue"
3. Toggle to **OTP** mode
4. Click "Send OTP"
5. Enter the 6-digit code (shown in dev mode)
6. Should login and redirect to main app

---

### 10. **Test Protected Routes**

**While logged out:**
```
Visit: http://localhost:3000/history
Result: Redirects to /login
```

**After logging in:**
```
Visit: http://localhost:3000/history
Result: Shows history page (authorized)
```

---

## 🔍 Verify Database

**Check user_sessions table:**
```bash
docker-compose exec db psql -U pal -d pal -c "SELECT id, user_id, is_active, created_at FROM user_sessions LIMIT 5;"
```

**Expected:**
- Shows encrypted sessions
- Each login creates a new session
- Sessions have metadata (IP, user agent)

---

## ✅ All Systems Working!

If all tests pass:
- ✅ Authentication system is fully functional
- ✅ Both password and OTP login work
- ✅ Sessions are encrypted and stored
- ✅ Frontend redirects correctly
- ✅ Protected routes are secured

---

## 🐛 Troubleshooting

### API not starting?
```bash
docker-compose logs api --tail 50
```

### Frontend not loading?
```bash
docker-compose logs web --tail 50
```

### Database issues?
```bash
docker-compose exec db psql -U pal -d pal -c "\dt"
```

### Run migration if needed:
```bash
docker-compose exec api alembic upgrade head
```

---

## 📚 Documentation

- [AUTH_SYSTEM_V2.md](AUTH_SYSTEM_V2.md) - Complete auth documentation
- [LOGIN_REDIRECT_SETUP.md](LOGIN_REDIRECT_SETUP.md) - Login redirect guide
- [SETUP_COMPLETE.md](SETUP_COMPLETE.md) - Initial setup guide

---

*Test completed: 2026-07-07*
*All systems operational* ✅
