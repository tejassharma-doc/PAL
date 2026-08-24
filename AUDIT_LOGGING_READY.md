# ✅ Simple Database Audit Logging - READY!

## What Was Created:

### 1. Database Table: `audit_logs`
All logging stored in one centralized table!

### 2. Audit Logger Service
Helper functions to log common events

### 3. Integrated into Key Endpoints
- ✅ File uploads
- ✅ MDT extractions (success/failure)
- Ready to add: Auth, API requests, patient access

---

## Database Schema:

```sql
audit_logs table:
├── id (UUID)
├── event_type (varchar) - auth, api, mdt, patient_access, file, database
├── event_name (varchar) - login, upload, extraction_success, etc.
├── severity (varchar) - debug, info, warning, error, critical
├── user_id (UUID)
├── tenant_id (UUID)
├── patient_id (UUID)
├── ip_address (varchar)
├── user_agent (varchar)
├── request_method (varchar)
├── request_path (varchar)
├── request_id (varchar)
├── duration_ms (integer)
├── status_code (integer)
├── message (text) - Human-readable description
├── details (jsonb) - Additional structured data
├── error_type (varchar)
├── error_message (text)
├── stack_trace (text)
├── contains_phi (boolean)
├── success (boolean)
├── created_at (timestamp)
└── updated_at (timestamp)
```

---

## What's Already Logged:

### ✅ File Uploads
```python
await AuditLogger.log_file_operation(
    db=db,
    operation="upload",
    file_name=filename,
    file_size=len(content),
    user_id=user.id,
    patient_id=patient_id,
    success=True
)
```

**Example Log:**
```
event_type: "file"
event_name: "upload"
message: "File upload: sample-report.pdf (6908257 bytes)"
user_id: [user's UUID]
patient_id: [patient's UUID]
contains_phi: true
success: true
```

### ✅ MDT Extractions (Success)
```python
await AuditLogger.log_mdt_extraction(
    db=db,
    file_name=filename,
    status="success",
    duration_ms=95432,
    observations_count=30,
    model="gemini-2.5-flash",
    user_id=user.id,
    patient_id=patient_id
)
```

**Example Log:**
```
event_type: "mdt"
event_name: "extraction_success"
message: "MDT extraction success: sample-report.pdf - 30 observations"
duration_ms: 95432
details: {
  "file_name": "sample-report.pdf",
  "observations_count": 30,
  "model": "gemini-2.5-flash"
}
contains_phi: true
success: true
```

### ✅ MDT Extractions (Failed)
```python
await AuditLogger.log_mdt_extraction(
    db=db,
    file_name=filename,
    status="failed",
    duration_ms=5432,
    observations_count=0,
    model="gemini-2.5-flash",
    user_id=user.id,
    patient_id=patient_id,
    error_message=str(exception),
    stack_trace=None
)
```

**Example Log:**
```
event_type: "mdt"
event_name: "extraction_failed"
message: "MDT extraction failed: sample-report.pdf - 0 observations"
severity: "error"
duration_ms: 5432
error_message: "Connection timeout"
success: false
```

---

## Ready to Add (Examples):

### Authentication Events
```python
from services.audit_logger import AuditLogger

# In auth.py
await AuditLogger.log_auth(
    db=db,
    event_name="login",
    message=f"User {username} logged in",
    username=username,
    success=True,
    ip_address=request.client.host,
    user_agent=request.headers.get("user-agent")
)

# Failed login
await AuditLogger.log_auth(
    db=db,
    event_name="login",
    message=f"Failed login attempt for {username}",
    username=username,
    success=False,
    ip_address=request.client.host,
    details={"reason": "invalid_password"}
)
```

### Patient Data Access (HIPAA Compliance)
```python
# When viewing patient records
await AuditLogger.log_patient_access(
    db=db,
    action="view",
    resource_type="lab_test",
    user_id=user.id,
    patient_id=patient_id,
    resource_id=lab_test_id
)

# When updating patient data
await AuditLogger.log_patient_access(
    db=db,
    action="update",
    resource_type="prescription",
    user_id=user.id,
    patient_id=patient_id,
    resource_id=prescription_id,
    details={"fields_updated": ["dosage", "frequency"]}
)
```

### API Request Logging
```python
# In middleware
await AuditLogger.log_api_request(
    db=db,
    request_method="POST",
    request_path="/medical/upload",
    status_code=200,
    duration_ms=95432,
    user_id=user.id,
    ip_address=request.client.host,
    user_agent=request.headers.get("user-agent")
)
```

### Error Logging
```python
try:
    # ... some operation
except Exception as e:
    await AuditLogger.log_error(
        db=db,
        event_type="api",
        event_name="database_error",
        message="Failed to save lab test",
        exception=e,
        user_id=user.id,
        patient_id=patient_id,
        request_path="/medical/confirm"
    )
    raise
```

---

## Querying Audit Logs:

### View Recent Logs
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_type, 
  event_name, 
  severity, 
  message, 
  created_at 
FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 20;
"
```

### View MDT Extractions
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_name,
  message,
  duration_ms,
  success,
  created_at
FROM audit_logs
WHERE event_type = 'mdt'
ORDER BY created_at DESC
LIMIT 10;
"
```

### View Failed Events
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_type,
  event_name,
  severity,
  message,
  error_message,
  created_at
FROM audit_logs
WHERE success = FALSE
ORDER BY created_at DESC;
"
```

### View File Operations
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_name,
  message,
  user_id,
  patient_id,
  created_at
FROM audit_logs
WHERE event_type = 'file'
ORDER BY created_at DESC
LIMIT 10;
"
```

### View Patient Access (HIPAA Audit)
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_name as action,
  user_id,
  patient_id,
  details->>'resource_type' as resource,
  message,
  created_at
FROM audit_logs
WHERE event_type = 'patient_access'
ORDER BY created_at DESC
LIMIT 20;
"
```

### Slow Operations (>1 second)
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  event_type,
  event_name,
  duration_ms,
  message,
  created_at
FROM audit_logs
WHERE duration_ms > 1000
ORDER BY duration_ms DESC
LIMIT 10;
"
```

### Errors by Type
```bash
docker exec pal-db psql -U pal-d pal -c "
SELECT 
  error_type,
  COUNT(*) as count,
  MAX(created_at) as last_occurrence
FROM audit_logs
WHERE error_type IS NOT NULL
GROUP BY error_type
ORDER BY count DESC;
"
```

### Activity by User
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
  user_id,
  event_type,
  COUNT(*) as count
FROM audit_logs
WHERE user_id IS NOT NULL
GROUP BY user_id, event_type
ORDER BY count DESC;
"
```

---

## Log Retention:

### Default: Keep All Logs

### Optional: Auto-Delete Old Logs (90 days)
```sql
-- Create a function to delete old logs
CREATE OR REPLACE FUNCTION delete_old_audit_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM audit_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- Run daily (using pg_cron or external scheduler)
-- Or run manually when needed
```

### Archive Old Logs (Export to JSON)
```bash
# Export logs older than 30 days to JSON file
docker exec pal-db psql -U pal -d pal -c "
COPY (
  SELECT row_to_json(t)
  FROM audit_logs t
  WHERE created_at < NOW() - INTERVAL '30 days'
) TO STDOUT
" > audit_logs_archive_$(date +%Y%m%d).json

# Then delete archived logs
docker exec pal-db psql -U pal -d pal -c "
DELETE FROM audit_logs
WHERE created_at < NOW() - INTERVAL '30 days';
"
```

---

## Performance:

### Indexes Created:
- ✅ event_type
- ✅ event_name
- ✅ severity
- ✅ user_id
- ✅ tenant_id
- ✅ patient_id
- ✅ created_at
- ✅ success (partial index for failures)

**Fast queries on:**
- Filter by event type
- Filter by user
- Filter by patient
- Time range queries
- Failed events only

---

## Comparison: Database vs Loki/Grafana

| Feature | Database Audit Log | Loki + Grafana |
|---------|-------------------|----------------|
| **Setup Time** | 5 minutes ✅ | 2-3 hours |
| **Querying** | SQL (familiar) ✅ | LogQL (new) |
| **Storage** | PostgreSQL | Separate service |
| **Performance** | Good for 1M+ logs | Better for 100M+ logs |
| **Visualization** | Need to build | Beautiful dashboards |
| **Retention** | Manual cleanup | Auto-configured |
| **Cost** | Free ✅ | Free (self-hosted) |
| **HIPAA Compliance** | ✅ Already encrypted | ✅ With config |

**Recommendation:** Start with database logging (you have it now!), add Grafana later if needed.

---

## Test It Now:

### 1. Upload a file
The upload will be logged!

### 2. Check logs:
```bash
docker exec pal-db psql -U pal -d pal -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;"
```

### 3. You should see:
- File upload event
- MDT extraction event

---

## Production Checklist:

✅ **Database table created**  
✅ **Indexes created**  
✅ **Audit logger service**  
✅ **File uploads logged**  
✅ **MDT extractions logged**  
⏳ Add auth logging (optional)  
⏳ Add API request logging (optional)  
⏳ Add patient access logging (HIPAA - recommended!)  
⏳ Setup log retention policy (90 days recommended)  

---

**Status**: ✅ READY TO USE!  
**Next**: Upload a file and check `audit_logs` table!
