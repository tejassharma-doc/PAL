# PAL Health Platform - Usage Guide

## ✅ System Status

All services are running and connected:
- ✅ Frontend (Next.js): http://localhost:3000
- ✅ Backend (FastAPI): http://localhost:8000
- ✅ Database (PostgreSQL): Connected
- ✅ Redis: Connected

## 🔐 Test Account

**Username**: `sharma182003`  
**Password**: `Password123`  
**Patient Name**: Tejash Sharma

## 📱 How to Use

### 1. Access the Application

Open your browser and go to: **http://localhost:3000**

### 2. Login

- Click on "Email & Password" tab
- Enter username: `sharma182003`
- Enter password: `Password123`
- Click "Login"

### 3. View Your Profile

After login, you'll see the welcome page with your name:
- **Welcome message**: Shows "Good [morning/afternoon/evening], Tejash"
- **Profile button**: Click to view full profile details

### 4. Available Sections

#### 📊 Your Record (Dashboard)
- View your health vitals
- See recent test results
- Check medical history

#### 🏥 Visits
- View upcoming appointments
- See past visit history
- Check SOAP notes from doctors
- View lab test results

#### 💬 Ask (AI Assistant)
- Ask health-related questions
- Get AI-powered responses
- Search your medical records

#### 👤 Profile
- View complete profile information
- See personal details
- Check medical information
- View emergency contact
- See credit balance

## 🔄 Profile Flow

### If Profile Exists:
1. Login → Automatically loads your profile
2. Shows welcome message with your name
3. All sections show your actual data from database

### If No Profile:
1. Login → Redirects to "Create Profile" page
2. Fill in your details
3. Submit → Profile created
4. Redirects to main app

## 📋 Key Features Fixed

### ✅ Real Database Integration
- ❌ **Before**: Showing hardcoded names like "Anil", "Priya"
- ✅ **After**: Shows your actual name from database ("Tejash")

### ✅ Profile Page
- New profile view page created at `/profile`
- Shows all patient information:
  - Personal details (name, DOB, gender, blood group)
  - Contact information
  - Medical information (allergies, conditions, medications)
  - Emergency contact
  - Account details
  - Credit balance

### ✅ Welcome Message
- ✅ Fetches your name from database
- ✅ Shows personalized greeting
- ✅ Updates automatically when profile changes

### ✅ Visits Section
- ✅ Shows real appointments from database
- ✅ Displays actual SOAP notes
- ✅ Shows lab test results
- ✅ No hardcoded data

### ✅ Records Section
- ✅ Fetches actual health data
- ✅ Shows real vitals
- ✅ Displays your medical history

## 🗄️ Database Contents

### User Account
- **ID**: `5e44a95d-d09c-4f46-b92c-9bc4c08ecdae`
- **Username**: `sharma182003`
- **Email**: `tejash@gmail.com`

### Patient Profile
- **Patient ID**: `5e44a95d-d09c-4f46-b92c-9bc4c08ecdae`
- **Name**: Tejash Sharma
- **Age**: 23 years
- **Phone**: +91 7892828182

### Appointments
- **Date**: July 20, 2026
- **Reason**: General Checkup
- **Doctor**: Dr. Rao
- **Time**: 10:00 AM

### Clinical Records (SOAP Notes)
- ✅ Subjective findings
- ✅ Objective measurements
- ✅ Assessment
- ✅ Plan

### Lab Tests
1. **Complete Blood Count (CBC)** - All parameters normal
2. **Lipid Panel** - LDL slightly elevated (110 mg/dL)
3. **Comprehensive Metabolic Panel** - All normal

## 🔧 API Endpoints Used

### Authentication
- `POST /v3/auth/login` - Login with username/password
- `GET /user/profile` - Get complete user profile

### Patient Data
- `GET /patients/{patient_id}` - Get patient details
- `GET /visits/patient/{patient_id}` - Get visit history

### Health Records
- `GET /clinical-outputs` - Get SOAP notes
- `GET /lab-tests` - Get lab test results

## 🎯 Next Steps

### To Add More Data:
1. **New Appointment**: Use the booking feature
2. **Medical Records**: Upload documents
3. **Lab Results**: Add through visits section

### To Test Different Users:
Create a new user account and patient profile through the signup flow.

## ⚠️ Important Notes

1. **Authentication Required**: All pages check for authentication
2. **Profile Required**: Must have patient profile to see data
3. **Data Privacy**: All data is user-specific and isolated
4. **Real-time Updates**: Changes reflect immediately

## 🐛 Troubleshooting

### "Backend unavailable" Error
- **Cause**: API container not running or proxy issue
- **Fix**: Run `docker-compose restart web api`

### Name Shows as "Anil"
- **Cause**: Not logged in or profile not loaded
- **Fix**: 
  1. Logout and login again
  2. Check browser localStorage for `pal_user_name`
  3. Check patient profile exists in database

### Profile Not Loading
- **Cause**: No patient profile linked to user
- **Fix**: Create profile at `/profile/create`

### "Invalid credentials"
- **Cause**: Wrong username or password
- **Fix**: Use the correct credentials above

## 📊 System Architecture

```
Browser (http://localhost:3000)
    ↓
Next.js Frontend
    ↓
API Proxy (/api/*)
    ↓
FastAPI Backend (http://api:8000)
    ↓
PostgreSQL Database
```

## 🔒 Security Notes

- JWT tokens expire after 30 minutes
- Passwords are hashed with bcrypt
- Patient data is isolated per user
- All API calls require authentication

## 📞 Support

If you encounter issues:
1. Check docker containers: `docker-compose ps`
2. Check logs: `docker-compose logs -f`
3. Restart services: `docker-compose restart`
4. Full restart: `docker-compose down && docker-compose up -d`
