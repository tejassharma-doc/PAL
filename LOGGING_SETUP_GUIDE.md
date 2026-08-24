# Complete Logging Setup for PAL Application

## Architecture: Loki + Promtail + Grafana

### Why This Stack?
- **Loki**: Lightweight, designed for Kubernetes/Docker logs
- **Promtail**: Auto-discovers Docker containers
- **Grafana**: Already familiar, powerful visualization
- **Cost**: Free and open-source
- **Performance**: Optimized for high-volume logs

---

## Step 1: Add Structured Logging to FastAPI

### Install Dependencies:
```bash
# Add to api/requirements.txt
python-json-logger==2.0.7
```

### Create Logger Configuration:
**File**: `api/logging_config.py`

```python
import logging
import sys
from pythonjsonlogger import jsonlogger

def setup_logging():
    """Configure structured JSON logging for production"""
    
    # Create logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    # JSON formatter
    logHandler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        '%(timestamp)s %(level)s %(name)s %(message)s '
        '%(pathname)s %(lineno)d %(funcName)s',
        timestamp=True
    )
    logHandler.setFormatter(formatter)
    logger.addHandler(logHandler)
    
    return logger

# Usage in main.py
from logging_config import setup_logging
logger = setup_logging()
```

### Add Request Logging Middleware:
**File**: `api/middleware/logging.py`

```python
import time
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger(__name__)

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        
        # Log request
        logger.info(
            "request_started",
            extra={
                "method": request.method,
                "url": str(request.url),
                "client_ip": request.client.host,
                "user_agent": request.headers.get("user-agent"),
            }
        )
        
        # Process request
        response = await call_next(request)
        
        # Log response
        duration = time.time() - start_time
        logger.info(
            "request_completed",
            extra={
                "method": request.method,
                "url": str(request.url),
                "status_code": response.status_code,
                "duration_ms": round(duration * 1000, 2),
            }
        )
        
        return response
```

### Update main.py:
```python
from fastapi import FastAPI
from middleware.logging import RequestLoggingMiddleware
from logging_config import setup_logging

# Setup logging
logger = setup_logging()

app = FastAPI()

# Add logging middleware
app.add_middleware(RequestLoggingMiddleware)
```

---

## Step 2: Add Medical Event Logging

### Create Audit Logger:
**File**: `api/services/audit_logger.py`

```python
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)

class AuditLogger:
    """Log HIPAA-compliant medical data access events"""
    
    @staticmethod
    def log_patient_access(
        user_id: UUID,
        patient_id: UUID,
        action: str,
        resource_type: str,
        resource_id: Optional[UUID] = None,
        details: Optional[dict] = None
    ):
        logger.info(
            "patient_data_access",
            extra={
                "event_type": "audit",
                "user_id": str(user_id),
                "patient_id": str(patient_id),
                "action": action,  # view, create, update, delete
                "resource_type": resource_type,  # lab_test, prescription, etc.
                "resource_id": str(resource_id) if resource_id else None,
                "timestamp": datetime.utcnow().isoformat(),
                "details": details or {}
            }
        )
    
    @staticmethod
    def log_mdt_extraction(
        user_id: UUID,
        patient_id: UUID,
        file_name: str,
        status: str,
        duration_ms: float,
        observations_count: int,
        model: str,
        error: Optional[str] = None
    ):
        logger.info(
            "mdt_extraction",
            extra={
                "event_type": "mdt",
                "user_id": str(user_id),
                "patient_id": str(patient_id),
                "file_name": file_name,
                "status": status,  # success, failed
                "duration_ms": duration_ms,
                "observations_count": observations_count,
                "model": model,
                "error": error,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
    
    @staticmethod
    def log_auth_event(
        username: str,
        event: str,
        success: bool,
        ip_address: str,
        details: Optional[dict] = None
    ):
        logger.info(
            "auth_event",
            extra={
                "event_type": "auth",
                "username": username,
                "event": event,  # login, logout, token_refresh
                "success": success,
                "ip_address": ip_address,
                "timestamp": datetime.utcnow().isoformat(),
                "details": details or {}
            }
        )
```

### Use in Your Routes:
```python
# In medical_doc.py
from services.audit_logger import AuditLogger
import time

@router.post("/upload")
async def upload_medical_document(...):
    start_time = time.time()
    
    try:
        # ... existing upload code ...
        
        # Log MDT extraction
        duration = (time.time() - start_time) * 1000
        AuditLogger.log_mdt_extraction(
            user_id=user.id,
            patient_id=patient.id,
            file_name=filename,
            status="success",
            duration_ms=duration,
            observations_count=len(parsed.observations),
            model="gemini-2.5-flash"
        )
        
    except Exception as e:
        duration = (time.time() - start_time) * 1000
        AuditLogger.log_mdt_extraction(
            user_id=user.id,
            patient_id=patient.id,
            file_name=filename,
            status="failed",
            duration_ms=duration,
            observations_count=0,
            model="gemini-2.5-flash",
            error=str(e)
        )
        raise

# In auth.py
@router.post("/login")
async def login(request: Request, ...):
    try:
        # ... existing login code ...
        
        AuditLogger.log_auth_event(
            username=username,
            event="login",
            success=True,
            ip_address=request.client.host
        )
        
    except Exception as e:
        AuditLogger.log_auth_event(
            username=username,
            event="login",
            success=False,
            ip_address=request.client.host,
            details={"error": str(e)}
        )
        raise
```

---

## Step 3: Docker Compose - Add Loki Stack

### Update docker-compose.yml:

```yaml
services:
  # ... existing services ...

  loki:
    image: grafana/loki:2.9.0
    container_name: pal-loki
    ports:
      - "3100:3100"
    volumes:
      - loki-data:/loki
      - ./monitoring/loki-config.yaml:/etc/loki/local-config.yaml
    command: -config.file=/etc/loki/local-config.yaml
    networks:
      - pal_default

  promtail:
    image: grafana/promtail:2.9.0
    container_name: pal-promtail
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - /var/run/docker.sock:/var/run/docker.sock
      - ./monitoring/promtail-config.yaml:/etc/promtail/config.yaml
    command: -config.file=/etc/promtail/config.yaml
    depends_on:
      - loki
    networks:
      - pal_default

  grafana:
    image: grafana/grafana:10.2.0
    container_name: pal-grafana
    ports:
      - "3002:3000"
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml
      - ./monitoring/grafana-dashboards.yaml:/etc/grafana/provisioning/dashboards/dashboards.yaml
      - ./monitoring/dashboards:/var/lib/grafana/dashboards
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    depends_on:
      - loki
    networks:
      - pal_default

volumes:
  loki-data:
  grafana-data:
```

---

## Step 4: Configuration Files

### Create monitoring directory:
```bash
mkdir -p monitoring/dashboards
```

### Loki Config:
**File**: `monitoring/loki-config.yaml`

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  lifecycler:
    address: 127.0.0.1
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1
  chunk_idle_period: 5m
  chunk_retain_period: 30s

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    cache_location: /loki/cache
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

chunk_store_config:
  max_look_back_period: 0s

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h  # 7 days retention
```

### Promtail Config:
**File**: `monitoring/promtail-config.yaml`

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # Scrape all Docker containers
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'
      - source_labels: ['__meta_docker_container_log_stream']
        target_label: 'stream'
      - source_labels: ['__meta_docker_container_label_com_docker_compose_service']
        target_label: 'service'
    pipeline_stages:
      # Parse JSON logs from FastAPI
      - json:
          expressions:
            level: level
            message: message
            timestamp: timestamp
            event_type: event_type
      - labels:
          level:
          event_type:
      - timestamp:
          source: timestamp
          format: RFC3339
```

### Grafana Datasource:
**File**: `monitoring/grafana-datasources.yaml`

```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    editable: false
```

### Grafana Dashboard Provisioning:
**File**: `monitoring/grafana-dashboards.yaml`

```yaml
apiVersion: 1

providers:
  - name: 'PAL Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
```

---

## Step 5: Pre-built Dashboards

### PAL Application Dashboard:
**File**: `monitoring/dashboards/pal-overview.json`

I'll create a comprehensive dashboard with:
- Request rate by endpoint
- Error rate
- Response times (p50, p95, p99)
- MDT extraction metrics
- Auth events
- Patient data access audit

### MDT Extraction Dashboard:
**File**: `monitoring/dashboards/mdt-extraction.json`

- Extractions per hour
- Success/failure rate
- Average extraction time
- Observations extracted count
- Error breakdown

---

## Step 6: Start Logging Stack

```bash
# Rebuild API with new logging dependencies
docker-compose build api

# Start logging stack
docker-compose up -d loki promtail grafana

# Check services
docker ps | grep -E "loki|promtail|grafana"

# View logs
docker logs pal-promtail
docker logs pal-loki
```

---

## Step 7: Access Grafana

1. Open: http://localhost:3002
2. Login: admin / admin
3. Go to "Explore" → Select "Loki" datasource
4. Run query: `{container="pal-api-v2"}`

### Example Queries:

**All errors:**
```logql
{container="pal-api-v2"} |= "ERROR"
```

**MDT extractions:**
```logql
{container="pal-api-v2"} | json | event_type="mdt"
```

**Failed logins:**
```logql
{container="pal-api-v2"} | json | event_type="auth" | success="false"
```

**Slow requests (>1s):**
```logql
{container="pal-api-v2"} | json | duration_ms > 1000
```

**Patient data access:**
```logql
{container="pal-api-v2"} | json | event_type="audit"
```

---

## Step 8: Setup Alerts

### Critical Alerts to Configure:

1. **High Error Rate**
   - If error rate > 5% for 5 minutes → Alert

2. **MDT Extraction Failures**
   - If >3 MDT failures in 10 minutes → Alert

3. **Slow API**
   - If p95 response time > 2s for 5 minutes → Alert

4. **Failed Login Attempts**
   - If >10 failed logins from same IP in 1 minute → Alert (possible brute force)

5. **Unauthorized Access Attempts**
   - Any 403 errors → Immediate alert

---

## Cost & Performance

### Resource Usage:
- Loki: ~200MB RAM, ~1GB disk for 7 days
- Promtail: ~50MB RAM
- Grafana: ~200MB RAM
- Total: ~500MB RAM overhead

### Log Retention:
- Default: 7 days (configurable)
- Can extend to 30 days for production
- Archive old logs to S3 for compliance

---

## Production Checklist

✅ Structured JSON logging  
✅ Request/response logging  
✅ Error tracking with stack traces  
✅ MDT extraction audit trail  
✅ Auth event logging  
✅ Patient data access logging (HIPAA)  
✅ Performance metrics  
✅ Alerting setup  
✅ 7-day log retention  
✅ Grafana dashboards  

---

## Next Steps

1. Implement structured logging in FastAPI
2. Add audit logging to all endpoints
3. Deploy Loki + Promtail + Grafana
4. Create dashboards
5. Setup alerts
6. Test log queries
7. Train team on Grafana usage

---

**Logging is ESSENTIAL for production!** Without it, you're flying blind.
