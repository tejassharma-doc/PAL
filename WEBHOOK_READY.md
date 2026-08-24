# ✅ Webhook Endpoint - Ready for Production

## Status: WORKING WITHOUT AUTHENTICATION

The webhook endpoint is now publicly accessible and logs all incoming data.

## Endpoint Details

**URL:** `http://34.14.174.141:3003/api/v1/webhook`

**Method:** POST

**Authentication:** ❌ NONE REQUIRED (public endpoint)

**Content-Type:** application/json

**Response Format:**
```json
{
  "success": true,
  "message": "Webhook received successfully",
  "timestamp": "2026-07-31T11:03:52.521Z",
  "dataReceived": true
}
```

## Usage Example

### From cURL
```bash
curl -X POST http://34.14.174.141:3003/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "lab_result_ready",
    "patient_id": "12345",
    "data": {
      "test_name": "Blood Test",
      "result": "Normal"
    }
  }'
```

### From JavaScript
```javascript
fetch('http://34.14.174.141:3003/api/v1/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    event: 'lab_result_ready',
    patient_id: '12345',
    data: {
      test_name: 'Blood Test',
      result: 'Normal'
    }
  })
})
.then(response => response.json())
.then(data => console.log('Success:', data))
.catch(error => console.error('Error:', error));
```

### From Python
```python
import requests
import json

url = "http://34.14.174.141:3003/api/v1/webhook"
payload = {
    "event": "lab_result_ready",
    "patient_id": "12345",
    "data": {
        "test_name": "Blood Test",
        "result": "Normal"
    }
}

response = requests.post(url, json=payload)
print(response.json())
```

## Viewing Logs in Real-Time

### SSH into the server
```bash
ssh ubuntu@34.14.174.141
```

### Watch logs live (updates every second)
```bash
docker logs pal-prod-mcp-api -f
```

### Filter for webhook data only
```bash
docker logs pal-prod-mcp-api -f | grep -A10 "WEBHOOK RECEIVED"
```

## What Gets Logged

Every webhook request logs:
- ✅ Timestamp
- ✅ All HTTP headers
- ✅ Complete JSON payload
- ✅ Request origin (IP/host)

**Example log output:**
```
========== WEBHOOK RECEIVED ==========
Timestamp: 2026-07-31T11:03:52.521Z
Headers: {
  "host": "34.14.174.141:3003",
  "user-agent": "curl/8.18.0",
  "accept": "*/*",
  "content-type": "application/json",
  "content-length": "109"
}
Payload: {
  "source": "external_system",
  "event": "test",
  "data": {
    "patient_id": "12345",
    "action": "lab_result_ready"
  }
}
======================================
```

## Firewall Status

✅ Port 3003 is OPEN and accessible from the internet

## Other Endpoints (Require API Key)

All other MCP endpoints require `X-API-Key: pal-secret-key-12345` header:

- GET /api/v1/patients
- POST /api/v1/appointments
- GET /api/v1/patients/:id/prescriptions
- etc.

Only `/health` and `/api/v1/webhook` are public.

## Testing

Send test data:
```bash
curl -X POST http://34.14.174.141:3003/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "hello world", "timestamp": "'$(date -Iseconds)'"}'
```

Then check logs:
```bash
docker logs pal-prod-mcp-api --tail=20
```

## Important Notes

1. **No authentication required** - any system can send data
2. **JSON format only** - must be valid JSON or you'll get parse errors
3. **Logs persist** - all webhook data is logged to Docker logs
4. **Real-time viewing** - use `docker logs -f` to watch live

## Server Info

- Container: `pal-prod-mcp-api`
- Internal port: 3001
- External port: 3003
- Server IP: 34.14.174.141
- Status: Running and healthy
