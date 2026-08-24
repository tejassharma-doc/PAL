# PAL MCP API - Usage Guide

## Quick Start

### 1. Install Dependencies
```bash
cd mcp-server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=3001
PAL_API_KEY=my-secret-api-key-12345
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=pal
POSTGRES_PASSWORD=pal123
POSTGRES_DB=pal
```

### 3. Start Server
```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm start
```

Server will start on http://localhost:3001

## Testing the API

### Health Check
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "pal-mcp-api",
  "database": 0
}
```

### Search for Patient (Tejash)
```bash
curl -H "X-API-Key: my-secret-api-key-12345" \
  "http://localhost:3001/api/v1/patients?phone=+917892828182"
```

Expected response:
```json
[
  {
    "id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "full_name": "Tejash Sharma",
    "email": "tejash@gmail.com",
    "phone": "+91 7892828182",
    "date_of_birth": "2003-01-20",
    "gender": "Male",
    ...
  }
]
```

### Get Patient Details
```bash
curl -H "X-API-Key: my-secret-api-key-12345" \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae
```

### Get Complete Patient Records
```bash
curl -H "X-API-Key: my-secret-api-key-12345" \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records | jq
```

Returns:
- Patient demographics
- All appointments with SOAP notes
- All prescriptions with medications
- All lab test results

### Get Latest Prescription with SOAP Notes
```bash
curl -H "X-API-Key: my-secret-api-key-12345" \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions/latest | jq
```

### List Appointments
```bash
# All appointments for patient
curl -H "X-API-Key: my-secret-api-key-12345" \
  "http://localhost:3001/api/v1/appointments?patientId=5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"

# Appointments on specific date
curl -H "X-API-Key: my-secret-api-key-12345" \
  "http://localhost:3001/api/v1/appointments?date=2026-07-20"
```

### Get Appointment with Clinical Notes
```bash
curl -H "X-API-Key: my-secret-api-key-12345" \
  http://localhost:3001/api/v1/appointments/YOUR_APPOINTMENT_ID | jq
```

### Push Vitals from Mobile App
```bash
curl -X POST \
  -H "X-API-Key: my-secret-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "heightCm": 175,
    "weightKg": 72,
    "bpSystolic": 120,
    "bpDiastolic": 80,
    "pulseRate": 75,
    "temperature": 98.6
  }' \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/vitals
```

### Book Appointment
```bash
curl -X POST \
  -H "X-API-Key: my-secret-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "slotTime": "2026-07-25T10:00:00Z",
    "durationMinutes": 30,
    "reasonForVisit": "Follow-up checkup",
    "status": "scheduled",
    "notes": "Regular checkup"
  }' \
  http://localhost:3001/api/v1/appointments
```

### Create Prescription
```bash
curl -X POST \
  -H "X-API-Key: my-secret-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "name": "Paracetamol",
        "generic_name": "Acetaminophen",
        "dosage": "500mg",
        "frequency": "Twice daily",
        "duration": "5 days",
        "quantity": 10,
        "instructions": "Take after meals",
        "reason": "Fever and headache",
        "type": "tablet"
      }
    ],
    "notes": "Complete the full course",
    "refillable": true,
    "refillsRemaining": 1
  }' \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions
```

### Add Lab Test Result
```bash
curl -X POST \
  -H "X-API-Key: my-secret-api-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "testName": "Hemoglobin A1C",
    "testCategory": "Diabetes",
    "orderedDate": "2026-07-21",
    "resultDate": "2026-07-22",
    "status": "completed",
    "results": [
      {
        "parameter": "HbA1c",
        "value": "5.4",
        "unit": "%",
        "referenceRange": "4.0-5.6",
        "abnormalFlag": false
      }
    ],
    "abnormalFlag": false,
    "interpretation": "Normal glucose control",
    "orderedBy": "Dr. Rao",
    "labName": "City Diagnostics"
  }' \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/lab-tests
```

## Mobile App Integration

### Android/iOS Setup

1. **Set Base URL**
   ```kotlin
   // Android (Kotlin)
   const val BASE_URL = "http://YOUR_SERVER_IP:3001"
   const val API_KEY = "your-api-key"
   ```

   ```swift
   // iOS (Swift)
   let BASE_URL = "http://YOUR_SERVER_IP:3001"
   let API_KEY = "your-api-key"
   ```

2. **Add API Key to Headers**
   ```kotlin
   // Android (Retrofit)
   @Headers("X-API-Key: your-api-key")
   @GET("/api/v1/patients")
   suspend fun searchPatients(@Query("phone") phone: String): List<Patient>
   ```

   ```swift
   // iOS (URLSession)
   var request = URLRequest(url: url)
   request.addValue("your-api-key", forHTTPHeaderField: "X-API-Key")
   ```

### Example: Fetch Patient Records

```kotlin
// Android Example
class PalApiService {
    private val retrofit = Retrofit.Builder()
        .baseUrl("http://192.168.1.100:3001")
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    private val api = retrofit.create(PalApi::interface)

    suspend fun getPatientRecords(patientId: String): PatientRecords {
        return api.getPatientRecords(patientId)
    }
}

interface PalApi {
    @Headers("X-API-Key: your-api-key")
    @GET("/api/v1/patients/{id}/records")
    suspend fun getPatientRecords(@Path("id") id: String): PatientRecords
}

data class PatientRecords(
    val patient: Patient,
    val appointments: List<Appointment>,
    val prescriptions: List<Prescription>,
    val labTests: List<LabTest>
)
```

## Production Deployment

### Using Docker

1. **Build image**
   ```bash
   cd mcp-server
   docker build -t pal-mcp-api .
   ```

2. **Run container**
   ```bash
   docker run -d \
     --name pal-mcp-api \
     -p 3001:3001 \
     -e PAL_API_KEY=your-production-key \
     -e POSTGRES_HOST=your-db-host \
     -e POSTGRES_PASSWORD=your-db-password \
     --restart unless-stopped \
     pal-mcp-api
   ```

### Using Docker Compose

1. **Update docker-compose.yml network**
   ```bash
   # Create network if not exists
   docker network create pal_default
   ```

2. **Start service**
   ```bash
   cd mcp-server
   docker-compose up -d
   ```

3. **Check logs**
   ```bash
   docker-compose logs -f mcp-api
   ```

### Using PM2

```bash
npm install -g pm2
pm2 start server.js --name pal-mcp-api
pm2 startup
pm2 save
```

## Security Best Practices

1. **Use HTTPS in Production**
   - Deploy behind nginx/Apache reverse proxy with SSL
   - Use Let's Encrypt for free SSL certificates

2. **Secure API Key**
   - Use strong, random API keys (32+ characters)
   - Rotate keys regularly
   - Never commit keys to git

3. **Environment Variables**
   - Use `.env` for local development
   - Use secrets management in production (AWS Secrets Manager, Azure Key Vault, etc.)

4. **Rate Limiting**
   - Add rate limiting middleware for production
   - Example: 100 requests per minute per IP

5. **CORS Configuration**
   - Only allow trusted mobile app domains
   - Don't use wildcard (*) in production

## Monitoring

### Health Checks
```bash
# Simple health check
curl http://localhost:3001/health

# With watch (every 5 seconds)
watch -n 5 curl -s http://localhost:3001/health
```

### Docker Health
```bash
docker ps
# Check HEALTH status column
```

### PM2 Monitoring
```bash
pm2 monit
pm2 logs pal-mcp-api
```

## Troubleshooting

### Connection Refused
- Check if server is running: `docker ps` or `pm2 list`
- Check firewall rules
- Verify port 3001 is not blocked

### Database Connection Error
- Check database credentials in `.env`
- Verify database is running: `docker ps | grep db`
- Test database connection: `psql -h localhost -U pal -d pal`

### Authentication Failed
- Verify API key matches in client and server
- Check `X-API-Key` header is being sent
- Case-sensitive key comparison

### Empty Results
- Verify patient exists in database
- Check patient ID format (UUID)
- Look at server logs for SQL errors

## Next Steps

1. ✅ MCP API server created
2. ⏳ Test all endpoints
3. ⏳ Deploy to production server
4. ⏳ Integrate with mobile app
5. ⏳ Add ABDM integration
6. ⏳ Implement rate limiting
7. ⏳ Setup monitoring and alerts

## Support

For issues or questions:
- Check server logs: `docker-compose logs -f mcp-api`
- Review [README.md](README.md) for detailed API docs
- Contact: support@pal.health
