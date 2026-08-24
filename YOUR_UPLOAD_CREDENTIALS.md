# Your Upload Credentials - Ready to Use! ✅

## ✅ Patient Profile Created!

Your patient profile has been created and linked to your user account.

---

## Your Upload Parameters

### 1. **Tenant ID** (Organization)
```
00000000-0000-0000-0000-000000000001
```
✅ Fixed - Default tenant exists in database

### 2. **Patient ID** (Member ID)
```
d9ebd0f7-fc29-4347-b585-fd15be9d1853
```
✅ Created - Patient profile linked to sharma2003

### 3. **User ID** (for reference only - NOT used in uploads)
```
fd950a6e-414c-4ca2-b46f-e3c753e4d295
```
⚠️ DO NOT use this for uploads! Use patient_id instead.

---

## Upload Form Data Required

When uploading a PDF/JPEG/PNG lab report:

```bash
file:       [Your PDF/JPEG/PNG file] (max 20MB)
tenant_id:  00000000-0000-0000-0000-000000000001
member_id:  d9ebd0f7-fc29-4347-b585-fd15be9d1853
```

---

## Test Upload (curl)

### Step 1: Login
```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "sharma2003",
    "password": "YOUR_PASSWORD"
  }' \
  | jq -r '.access_token'
```

Save the token that's returned.

### Step 2: Upload Lab Report
```bash
curl -X POST http://localhost:8000/medical/upload \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -F "file=@/path/to/lab-report.pdf" \
  -F "tenant_id=00000000-0000-0000-0000-000000000001" \
  -F "member_id=d9ebd0f7-fc29-4347-b585-fd15be9d1853" \
  | jq
```

### Expected Response:
```json
{
  "type": "pending_verification",
  "raw_source_id": "<uuid>",
  "filename": "lab-report.pdf",
  "patient_name_on_doc": "Tejas Sharma",
  "patient_name_on_profile": "Tejas Sharma",
  "name_match_status": "match",
  "report_title": "Complete Blood Count",
  "report_date": "2024-07-20",
  "observations": [
    {
      "loinc_code": "6690-2",
      "display": "White Blood Cells",
      "value": "7.5",
      "unit": "10*3/uL",
      "reference_range": "4.0-11.0",
      "recorded_at": "2024-07-20T10:30:00"
    },
    // ... more observations
  ]
}
```

---

## Frontend Form Example (React/Next.js)

```javascript
const UploadLabReport = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  
  const handleUpload = async () => {
    setUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('tenant_id', '00000000-0000-0000-0000-000000000001');
    formData.append('member_id', 'd9ebd0f7-fc29-4347-b585-fd15be9d1853');
    
    try {
      const response = await fetch('http://localhost:8000/medical/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });
      
      const data = await response.json();
      
      if (data.type === 'pending_verification') {
        // Show verification UI with extracted observations
        showVerificationCard(data);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div>
      <input 
        type="file" 
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? 'Uploading...' : 'Upload Lab Report'}
      </button>
    </div>
  );
};
```

---

## Your Account Details

```
User Account:
├── Username: sharma2003
├── Email: tejas@gmail.com
└── User ID: fd950a6e-414c-4ca2-b46f-e3c753e4d295

Patient Profile:
├── Patient ID: d9ebd0f7-fc29-4347-b585-fd15be9d1853  ← USE THIS FOR UPLOADS!
├── Full Name: Tejas Sharma
├── Email: tejas@gmail.com (linked to user)
└── Phone: 9876543210

Tenant:
└── Tenant ID: 00000000-0000-0000-0000-000000000001
```

---

## Database Verification

Check your patient profile:
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT id, full_name, email, phone 
FROM patients 
WHERE email = 'tejas@gmail.com';
"
```

Expected output:
```
                  id                  |  full_name   |      email      |    phone    
--------------------------------------+--------------+-----------------+-------------
 d9ebd0f7-fc29-4347-b585-fd15be9d1853 | Tejas Sharma | tejas@gmail.com | 9876543210
```

---

## Upload Flow Summary

1. **User logs in** → Gets auth token
2. **Select file** → PDF/JPEG/PNG (max 20MB)
3. **POST /medical/upload** with:
   - `file`: Selected file
   - `tenant_id`: `00000000-0000-0000-0000-000000000001`
   - `member_id`: `d9ebd0f7-fc29-4347-b585-fd15be9d1853`
   - `Authorization`: Bearer token
4. **MDT extracts** → FHIR data using Gemma 4
5. **User verifies** → Check extracted observations
6. **POST /medical/confirm** → Save to database
7. **Done!** → Lab test stored in your record

---

## Important Notes

### ✅ What to Use:
- **tenant_id**: `00000000-0000-0000-0000-000000000001` (your organization)
- **member_id**: `d9ebd0f7-fc29-4347-b585-fd15be9d1853` (your patient ID)

### ❌ What NOT to Use:
- **user_id**: `fd950a6e-414c-4ca2-b46f-e3c753e4d295` (login account, not medical record)

### Why the difference?
- **User** = Login credentials (authentication)
- **Patient** = Medical records (health data)
- You upload medical data → use patient_id (member_id)

---

## Troubleshooting

### Error: "Invalid UUID"
Make sure you're using the exact UUIDs with dashes:
```
✅ d9ebd0f7-fc29-4347-b585-fd15be9d1853
❌ d9ebd0f7fc294347b585fd15be9d1853
```

### Error: "Patient not found"
Check your member_id matches the patient_id:
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT id FROM patients WHERE id = 'd9ebd0f7-fc29-4347-b585-fd15be9d1853';
"
```

### Error: "Tenant not found"
Already fixed! ✅ Default tenant exists

### Error: "File too large"
File must be < 20MB. Compress PDF or reduce image quality.

---

## Next Steps

1. ✅ Patient profile created
2. ✅ Tenant exists
3. ✅ All services running
4. 🟢 **Ready to test upload!**

Try uploading a sample lab report PDF and verify:
- MDT extraction works
- Observations are extracted correctly
- Data saves to lab_tests table

---

**You're all set! Use these exact credentials for your uploads!** 🎉

---

**Created**: 2024-07-27  
**Status**: ✅ READY FOR UPLOADS  
**Patient ID**: d9ebd0f7-fc29-4347-b585-fd15be9d1853  
**Tenant ID**: 00000000-0000-0000-0000-000000000001
