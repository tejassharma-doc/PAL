# MCP Server - Fully Restored ✅

## Status: WORKING

The MCP server has been fully restored with all original functionality PLUS the new webhook endpoint.

## What Was Fixed

1. **Problem**: The original `server.js` file was corrupted with syntax errors in console.log statements
2. **Solution**: Extracted clean code from before corruption, added webhook endpoint properly
3. **Result**: Full MCP server with all 17+ endpoints working + webhook endpoint

## Available Endpoints

### Patient Management
- `GET /api/v1/patients` - Search patients (requires phone, email, or patientId)
- `GET /api/v1/patients/:id` - Get patient details
- `PUT /api/v1/patients/:id` - Update patient
- `GET /api/v1/patients/:id/records` - Get all patient records

### Appointments
- `GET /api/v1/appointments` - List appointments
- `POST /api/v1/appointments` - Create appointment
- `GET /api/v1/appointments/:id` - Get appointment details

### Prescriptions
- `GET /api/v1/patients/:id/prescriptions` - Get patient prescriptions
- `GET /api/v1/patients/:id/prescriptions/latest` - Get latest prescription
- `POST /api/v1/patients/:id/prescriptions` - Create prescription

### Lab Tests
- `GET /api/v1/patients/:id/lab-tests` - Get patient lab tests
- `POST /api/v1/patients/:id/lab-tests` - Create lab test

### Vitals
- `POST /api/v1/patients/:id/vitals` - Push vitals data

### ABDM Integration (Placeholder)
- `POST /api/v1/abdm/verify-health-id` - Verify health ID (501 not implemented)
- `POST /api/v1/abdm/consent-request` - Request consent (501 not implemented)

### Webhook (NEW)
- `POST /api/v1/webhook` - Generic webhook endpoint
  - Accepts any JSON payload
  - Logs everything to console
  - Returns success confirmation

### Health Check
- `GET /health` - Server health status with database connection count

## Authentication

All endpoints (except `/health`) require `X-API-Key` header:

```bash
X-API-Key: PAL_API_KEY_VALUE
```

Get your API key from:
```bash
grep PAL_API_KEY ~/PAL/.env
```

## Testing

### Test Webhook
```bash
curl -X POST http://localhost:3003/api/v1/webhook \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"test": "data", "event": "test_event"}'
```

### Test Patients Endpoint
```bash
curl "http://localhost:3003/api/v1/patients?phone=1234567890" \
  -H "X-API-Key: YOUR_API_KEY"
```

## URLs

- **Internal (from server)**: `http://localhost:3003`
- **External (needs firewall)**: `http://34.14.174.141:3003`

## Webhook URL for External Systems

```
http://34.14.174.141:3003/api/v1/webhook
```

**Note**: Port 3003 needs to be opened in GCP firewall for external access.

## Logs

View webhook data and all requests:
```bash
docker logs pal-prod-mcp-api -f
```

## Files

- Server code: `~/PAL/mcp-server/server.js`
- Package config: `~/PAL/mcp-server/package.json`
- Environment: `~/PAL/.env`
- Docker config: `~/PAL/docker-compose.prod.yml`

## Container Info

- Container name: `pal-prod-mcp-api`
- Internal port: 3001
- External port: 3003
- Status: Running and healthy
