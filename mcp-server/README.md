# PAL MCP API Server

REST API server for PAL Health Platform mobile applications and ABDM integration.

## Features

- **Patient Management** - Search, view, and update patient records
- **Appointments** - Book and manage appointments with SOAP notes
- **Prescriptions** - Create and retrieve prescriptions with medications
- **Lab Tests** - Store and retrieve lab test results
- **Vitals** - Push vitals data from mobile apps
- **Medical Records** - Complete patient health records in one endpoint
- **ABDM Integration** - Reserved endpoints for ABDM health ID and consent

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with pg driver
- **Authentication**: API Key (X-API-Key header)

## Installation

```bash
cd mcp-server
npm install
```

## Configuration

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
PORT=3001
PAL_API_KEY=your-secret-key
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=pal
POSTGRES_PASSWORD=pal123
POSTGRES_DB=pal
```

## Usage

### Development (with auto-reload)
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

### Health Check
```
GET /health
```
No authentication required.

### Patient Endpoints

#### Search Patients
```
GET /api/v1/patients?phone=XXX&email=XXX&patientId=XXX
Headers: X-API-Key: your-api-key
```

#### Get Patient Details
```
GET /api/v1/patients/:id
Headers: X-API-Key: your-api-key
```

#### Update Patient
```
PUT /api/v1/patients/:id
Headers: X-API-Key: your-api-key
Content-Type: application/json

{
  "phone": "+91XXXXXXXXXX",
  "address": "New address",
  "height_cm": 175,
  "weight_kg": 72
}
```

#### Push Vitals
```
POST /api/v1/patients/:id/vitals
Headers: X-API-Key: your-api-key
Content-Type: application/json

{
  "heightCm": 175,
  "weightKg": 72,
  "bpSystolic": 120,
  "bpDiastolic": 80,
  "pulseRate": 75,
  "temperature": 98.6
}
```

#### Get Complete Records
```
GET /api/v1/patients/:id/records
Headers: X-API-Key: your-api-key
```

Returns patient info + appointments + prescriptions + lab tests.

### Appointment Endpoints

#### List Appointments
```
GET /api/v1/appointments?patientId=XXX&date=2026-07-21&status=scheduled
Headers: X-API-Key: your-api-key
```

#### Get Appointment with SOAP Notes
```
GET /api/v1/appointments/:id
Headers: X-API-Key: your-api-key
```

#### Book Appointment
```
POST /api/v1/appointments
Headers: X-API-Key: your-api-key
Content-Type: application/json

{
  "patientId": "uuid",
  "slotTime": "2026-07-25T10:00:00Z",
  "durationMinutes": 30,
  "reasonForVisit": "General Checkup",
  "status": "scheduled",
  "notes": "First visit"
}
```

### Prescription Endpoints

#### Get Patient Prescriptions
```
GET /api/v1/patients/:id/prescriptions
Headers: X-API-Key: your-api-key
```

#### Get Latest Prescription with SOAP Notes
```
GET /api/v1/patients/:id/prescriptions/latest
Headers: X-API-Key: your-api-key
```

#### Create Prescription
```
POST /api/v1/patients/:id/prescriptions
Headers: X-API-Key: your-api-key
Content-Type: application/json

{
  "consultationId": "uuid",
  "items": [
    {
      "name": "Paracetamol",
      "dosage": "500mg",
      "frequency": "Twice daily",
      "duration": "5 days"
    }
  ],
  "notes": "Take after meals",
  "refillable": true,
  "refillsRemaining": 2
}
```

### Lab Test Endpoints

#### Get Patient Lab Tests
```
GET /api/v1/patients/:id/lab-tests
Headers: X-API-Key: your-api-key
```

#### Create Lab Test Result
```
POST /api/v1/patients/:id/lab-tests
Headers: X-API-Key: your-api-key
Content-Type: application/json

{
  "testName": "Complete Blood Count",
  "testCategory": "Hematology",
  "orderedDate": "2026-07-21",
  "resultDate": "2026-07-22",
  "status": "completed",
  "results": [
    {
      "parameter": "WBC",
      "value": "7500",
      "unit": "cells/μL",
      "referenceRange": "4000-11000",
      "abnormalFlag": false
    }
  ],
  "abnormalFlag": false,
  "interpretation": "All values within normal range",
  "orderedBy": "Dr. Rao",
  "labName": "City Diagnostics"
}
```

### ABDM Integration (Reserved)

```
POST /api/v1/abdm/verify-health-id
POST /api/v1/abdm/consent-request
```

Currently return 501 Not Implemented.

## Authentication

All endpoints (except `/health`) require the `X-API-Key` header:

```
X-API-Key: your-secret-api-key
```

Set the API key in `.env`:
```
PAL_API_KEY=your-secret-api-key
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing required field: patientId"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid or missing X-API-Key"
}
```

### 404 Not Found
```json
{
  "error": "Patient not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Database connection failed"
}
```

## Database Schema

The API uses the following PAL database tables:

- **patients** - Patient demographics and medical info
- **appointments** - Appointment scheduling
- **clinical_outputs** - SOAP notes and clinical documentation
- **prescriptions** - Medication prescriptions
- **lab_tests** - Laboratory test results
- **users** - User authentication (for mobile app login)

## Development

### Watch Mode
```bash
npm run dev
```

Automatically restarts server on file changes (Node 18+ required).

### Testing with curl

#### Health Check
```bash
curl http://localhost:3001/health
```

#### Search Patient
```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3001/api/v1/patients?phone=+917892828182"
```

#### Get Patient Records
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records
```

## Deployment

### Docker (Recommended)

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t pal-mcp-api .
docker run -p 3001:3001 --env-file .env pal-mcp-api
```

### PM2 (Process Manager)
```bash
npm install -g pm2
pm2 start server.js --name pal-mcp-api
pm2 save
pm2 startup
```

## Security Considerations

1. **Always use HTTPS** in production
2. **Rotate API keys** regularly
3. **Use environment variables** for secrets (never commit `.env`)
4. **Implement rate limiting** for production (use `express-rate-limit`)
5. **Enable CORS** only for trusted domains
6. **Validate all input** before database queries
7. **Use prepared statements** (pg library handles this automatically)

## Future Enhancements

- [ ] Rate limiting with `express-rate-limit`
- [ ] Request logging with `morgan`
- [ ] CORS configuration for mobile apps
- [ ] JWT authentication for user endpoints
- [ ] ABDM health ID integration
- [ ] ABDM consent management
- [ ] File upload for documents
- [ ] WebSocket support for real-time updates
- [ ] Vitals history tracking (separate table)
- [ ] Medication reminders
- [ ] Appointment reminders

## License

MIT

## Support

For issues or questions, contact: support@pal.health
