# 📋 Records API Implementation

## ✅ Completed Backend Setup

### 1. **Database Tables**

All required tables are ready:
- ✅ `patients` - Patient personal/medical info
- ✅ `appointments` - Visits and consultations
- ✅ `prescriptions` - Medication records
- ✅ `lab_tests` - Lab test results (NEW - replaces health_facts)
- ✅ `patient_documents` - Uploaded files (PDFs, images)

### 2. **API Endpoint Created**

**GET `/records/patient/{patient_id}`**

Returns complete patient records:
```json
{
  "appointments": [
    {
      "id": "uuid",
      "date": "2026-07-10",
      "chief_complaint": "Fever and cough",
      "doctor_name": "Dr. Rao",
      "clinic_name": "City Clinic",
      "diagnosis": "Upper respiratory infection",
      "notes": "Prescribed antibiotics",
      "status": "completed"
    }
  ],
  "lab_tests": [
    {
      "id": "uuid",
      "test_name": "Lipid Panel",
      "test_category": "blood",
      "ordered_date": "2026-07-01",
      "result_date": "2026-07-03",
      "status": "completed",
      "results": {
        "ldl": {"value": 162, "unit": "mg/dL", "range": "<100", "abnormal": true},
        "hdl": {"value": 45, "unit": "mg/dL", "range": ">40"}
      },
      "abnormal_flag": true,
      "interpretation": "Elevated LDL",
      "ordered_by": "Dr. Rao",
      "lab_name": "City Lab"
    }
  ],
  "prescriptions": [
    {
      "id": "uuid",
      "date": "2026-07-10",
      "medications": [
        {"name": "Amoxicillin", "dosage": "500mg", "frequency": "3x daily"}
      ],
      "pdf_url": "https://..."
    }
  ],
  "documents": [
    {
      "id": "uuid",
      "title": "Blood Test Report",
      "kind": "lab_report",
      "date": "2026-07-03",
      "file_name": "lipid_panel.pdf",
      "mime_type": "application/pdf",
      "data_url": "https://...",
      "size_bytes": 245678
    }
  ]
}
```

---

## 🎨 Frontend Design Specification

### **Records Tab Layout**

```
┌─────────────────────────────────────────────────────────┐
│  Your Records                                           │
│  Complete medical history                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Fever and cough              📅 Jul 10, 2026   │   │
│  │ Dr. Rao • City Clinic                          │   │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Routine checkup              📅 Jun 15, 2026   │   │
│  │ Dr. Sharma • Health Center                     │   │
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### **Card Layout**

**Each record card shows:**

```
┌──────────────────────────────────────────────────────────┐
│ LEFT SIDE                         RIGHT SIDE             │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━   │
│ Chief Complaint                   📅 Date                │
│ "Fever and cough"                 "Jul 10, 2026"         │
│                                                          │
│ Doctor • Clinic                                          │
│ "Dr. Rao • City Clinic"                                  │
└──────────────────────────────────────────────────────────┘
```

### **Expanded Card (onClick)**

```
┌──────────────────────────────────────────────────────────┐
│ Chief Complaint                   📅 Jul 10, 2026        │
│ Fever and cough                                          │
├──────────────────────────────────────────────────────────┤
│ DIAGNOSIS                                                │
│ Upper respiratory infection                              │
├──────────────────────────────────────────────────────────┤
│ DOCTOR'S NOTES                                           │
│ Patient presented with fever (101°F) and dry cough       │
│ for 3 days. Prescribed antibiotics for 7 days.          │
├──────────────────────────────────────────────────────────┤
│ PRESCRIPTION                                             │
│ • Amoxicillin 500mg - 3x daily for 7 days               │
│ • Paracetamol 500mg - as needed for fever               │
├──────────────────────────────────────────────────────────┤
│ LAB TESTS                                                │
│ • Blood Test - Completed ✓                               │
│   View Results →                                         │
├──────────────────────────────────────────────────────────┤
│ DOCUMENTS                                                │
│ 📄 Prescription.pdf                                      │
│ 📄 Lab Report.pdf                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 📱 Frontend Implementation Guide

### **Step 1: Add State for Records**

```typescript
const [records, setRecords] = useState<any>(null)
const [recordsLoading, setRecordsLoading] = useState(false)
const [selectedRecord, setSelectedRecord] = useState<string | null>(null)
```

### **Step 2: Fetch Records**

```typescript
useEffect(() => {
  if (tab !== 'record') return

  async function loadRecords() {
    setRecordsLoading(true)
    try {
      const patientId = localStorage.getItem('pal_patient_id')
      const token = localStorage.getItem('pal_token')

      const response = await fetch(`/api/records/patient/${patientId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        setRecords(data)
      }
    } catch (err) {
      console.error('Failed to load records:', err)
    } finally {
      setRecordsLoading(false)
    }
  }

  loadRecords()
}, [tab])
```

### **Step 3: Render Records**

```typescript
{isRecord && (
  <div>
    {recordsLoading && <div>Loading records...</div>}

    {!recordsLoading && records && (
      <div>
        {/* Appointments Section */}
        <div style={sectionStyle}>
          <h3>Appointments</h3>
          {records.appointments.map((appt: any) => (
            <div
              key={appt.id}
              onClick={() => setSelectedRecord(appt.id)}
              style={cardStyle}
            >
              {/* LEFT: Chief Complaint */}
              <div style={leftStyle}>
                <div style={complaintStyle}>
                  {appt.chief_complaint}
                </div>
                <div style={doctorStyle}>
                  {appt.doctor_name} • {appt.clinic_name}
                </div>
              </div>

              {/* RIGHT: Date */}
              <div style={rightStyle}>
                📅 {formatDate(appt.date)}
              </div>
            </div>
          ))}
        </div>

        {/* Lab Tests Section */}
        <div style={sectionStyle}>
          <h3>Lab Tests</h3>
          {records.lab_tests.map((test: any) => (
            <div key={test.id} style={cardStyle}>
              <div style={leftStyle}>
                {test.test_name}
                {test.abnormal_flag && <span style={abnormalBadge}>⚠️ Abnormal</span>}
              </div>
              <div style={rightStyle}>
                📅 {formatDate(test.result_date || test.ordered_date)}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
```

---

## 🎯 Next Steps

### **Immediate:**
1. ✅ API is ready - endpoint `/records/patient/{patient_id}`
2. ⏳ Add frontend code to main app `page.tsx`
3. ⏳ Style the record cards
4. ⏳ Add expand/collapse functionality

### **Enhancement:**
1. Add filters (by date, by type)
2. Add search functionality
3. Add document upload
4. Add export to PDF

---

## 🧪 Testing

### **Test the API:**

```bash
# Get your patient ID
PATIENT_ID="4a6ebef6-0e47-42f9-94f4-e907c8ed845d"
TOKEN="your-jwt-token"

# Fetch records
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/records/patient/$PATIENT_ID
```

### **Expected Response:**
- ✅ List of appointments
- ✅ List of lab tests
- ✅ List of prescriptions
- ✅ List of documents
- ✅ All sorted by date (most recent first)

---

## 📊 Database Status

```sql
-- Check what data exists
SELECT COUNT(*) FROM appointments WHERE patient_id = '...';
SELECT COUNT(*) FROM lab_tests WHERE patient_id = '...';
SELECT COUNT(*) FROM prescriptions;
SELECT COUNT(*) FROM patient_documents WHERE patient_id = '...';
```

Currently: **Empty** - you'll need to add sample data for testing.

---

## ✅ Summary

**Backend:** ✅ Complete
- API endpoint created
- All tables ready
- Returns structured JSON

**Frontend:** ⏳ Ready to implement
- Design spec provided
- Card layout defined
- Expand/collapse behavior outlined

The Records API is ready to use! Now you just need to add the frontend implementation following the design above. 🚀
