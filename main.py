"""
PAL MCP API - FastAPI Version
Webhook receiver for medical reports and external data
"""
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
import asyncpg
import os
import json
# Import SQLAlchemy dependencies for helper function
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from webhook_processor import process_webhook, WebhookProcessingError
from clinical_output_processor import process_clinical_output_webhook, ClinicalOutputProcessingError

# Configuration
PORT = int(os.getenv("PORT", "3001"))
API_KEY = os.getenv("PAL_API_KEY", "")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://pal:change_me_in_prod@pal-prod-db:5432/pal")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")  # Optional signature verification

# Convert PostgreSQL URL to async format for SQLAlchemy
ASYNC_DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

# Create FastAPI app
app = FastAPI(
    title="PAL MCP API",
    description="Webhook receiver for medical reports and external data",
    version="2.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection pool (asyncpg for raw queries)
db_pool = None

# SQLAlchemy engine and session maker (for ORM helper functions)
engine = None
SessionLocal = None


@app.on_event("startup")
async def startup():
    """Initialize database connection pool and SQLAlchemy engine"""
    global db_pool, engine, SessionLocal

    # asyncpg pool for raw queries
    db_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=2,
        max_size=10,
        command_timeout=60
    )
    print(f"✅ Database pool created: {DATABASE_URL}")

    # SQLAlchemy async engine for ORM
    engine = create_async_engine(
        ASYNC_DATABASE_URL,
        echo=False,
        pool_pre_ping=True
    )
    SessionLocal = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    print(f"✅ SQLAlchemy engine created")


@app.on_event("shutdown")
async def shutdown():
    """Close database connection pool and engine"""
    if db_pool:
        await db_pool.close()
        print("✅ Database pool closed")
    if engine:
        await engine.dispose()
        print("✅ SQLAlchemy engine disposed")


# Dependency for asyncpg connection (raw queries)
async def get_db():
    async with db_pool.acquire() as connection:
        yield connection


# Dependency for SQLAlchemy session (ORM operations)
async def get_db_session():
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Models
class WebhookPayload(BaseModel):
    """Generic webhook payload - accepts any JSON structure"""
    class Config:
        extra = "allow"  # Allow any additional fields


class WebhookResponse(BaseModel):
    success: bool
    message: str
    webhook_id: Optional[str] = None
    timestamp: Optional[str] = None
    event_type: Optional[str] = None
    dataReceived: bool = False


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    total_connections = db_pool._holders.__len__() if db_pool else 0
    return {
        "status": "ok",
        "service": "pal-mcp-api",
        "version": "2.0.0",
        "database": total_connections
    }


# Webhook endpoint - NO AUTH REQUIRED
@app.post("/api/v1/webhook", response_model=WebhookResponse)
async def receive_webhook(
    request: Request,
    db: asyncpg.Connection = Depends(get_db),
    db_session: AsyncSession = Depends(get_db_session)
):
    """
    Receive and store webhook data.
    Accepts any JSON structure and stores it in PostgreSQL JSONB.

    Flow:
    1. Store webhook in webhook_events table (raw storage)
    2. Call process_webhook helper to:
       - Verify signature (if configured)
       - Validate payload
       - Find/create phone user
       - Find/create patient
       - Upsert appointments
       - Mark webhook as processed
    """
    # Get request body as JSON
    try:
        payload = await request.json()
    except Exception as e:
        payload = {}

    # Get headers
    headers = dict(request.headers)

    # Current timestamp
    timestamp = datetime.utcnow()

    # Log to console
    print("========== WEBHOOK RECEIVED ==========")
    print(f"Timestamp: {timestamp.isoformat()}")
    print(f"Headers: {json.dumps(headers, indent=2)}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    print("======================================")

    webhook_id = None

    try:
        # Determine event type from payload structure
        event_type = payload.get("event", "unknown")  # Use explicit event field first

        # Fall back to structure detection
        if event_type == "unknown":
            if payload.get("lab_reports") and isinstance(payload.get("lab_reports"), list):
                event_type = "medical_report"
            elif payload.get("test"):
                event_type = "test"
            elif payload.get("appointment_id") or payload.get("appointments"):
                event_type = "appointment"

        # Extract source from headers or payload
        source = headers.get("x-webhook-source") or payload.get("source", "unknown")

        # STEP 1: Store webhook in database (raw storage)
        query = """
            INSERT INTO webhook_events
            (event_type, source, timestamp, payload, headers, processed)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, timestamp, event_type
        """

        row = await db.fetchrow(
            query,
            event_type,
            source,
            timestamp,
            json.dumps(payload),
            json.dumps(headers),
            False  # Not processed yet
        )

        webhook_id = str(row['id'])
        print(f"✅ Webhook saved to database: {webhook_id}")

        # STEP 2: Process webhook based on event type
        try:
            # Route to appropriate processor
            if event_type == "clinical_output_created":
                # Clinical output webhook - comprehensive processing
                processing_result = await process_clinical_output_webhook(
                    webhook_id=webhook_id,
                    payload=payload,
                    db=db_session
                )
            else:
                # Simple appointment/medical report webhook
                processing_result = await process_webhook(
                    webhook_id=webhook_id,
                    payload=payload,
                    headers=headers,
                    db=db_session,
                    signature_secret=WEBHOOK_SECRET if WEBHOOK_SECRET else None
                )

            print(f"✅ Webhook processed successfully:")
            print(f"   - Phone User: {processing_result.get('phone_user_id')}")
            print(f"   - Patient: {processing_result.get('patient_id')}")
            if 'appointments_processed' in processing_result:
                print(f"   - Appointments: {processing_result['appointments_processed']}")
            if 'consultation_id' in processing_result:
                print(f"   - Consultation: {processing_result['consultation_id']}")
            if 'prescription_ids' in processing_result:
                print(f"   - Prescriptions: {len(processing_result['prescription_ids'])}")
            if 'lab_test_ids' in processing_result:
                print(f"   - Lab Tests: {len(processing_result['lab_test_ids'])}")

            return WebhookResponse(
                success=True,
                message=f"Webhook received and processed successfully",
                webhook_id=webhook_id,
                timestamp=str(row['timestamp']),
                event_type=row['event_type'],
                dataReceived=len(payload) > 0
            )

        except (WebhookProcessingError, ClinicalOutputProcessingError) as process_error:
            # Processing failed, but webhook is still stored
            print(f"⚠️  Webhook stored but processing failed: {process_error}")

            return WebhookResponse(
                success=True,
                message=f"Webhook received but processing failed: {str(process_error)}",
                webhook_id=webhook_id,
                timestamp=str(row['timestamp']),
                event_type=row['event_type'],
                dataReceived=len(payload) > 0
            )

    except Exception as error:
        print(f"❌ Error saving webhook: {error}")
        import traceback
        traceback.print_exc()

        # Still return success to sender to avoid retries
        return WebhookResponse(
            success=True,
            message="Webhook received (storage pending)",
            webhook_id=webhook_id if webhook_id else None,
            dataReceived=len(payload) > 0
        )


# Get webhooks (optional - for debugging)
@app.get("/api/v1/webhooks")
async def get_webhooks(
    event_type: Optional[str] = None,
    processed: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: asyncpg.Connection = Depends(get_db)
):
    """Get stored webhooks with optional filters"""

    conditions = []
    params = []
    param_count = 1

    if event_type:
        conditions.append(f"event_type = ${param_count}")
        params.append(event_type)
        param_count += 1

    if processed is not None:
        conditions.append(f"processed = ${param_count}")
        params.append(processed)
        param_count += 1

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    query = f"""
        SELECT * FROM webhook_events
        WHERE {where_clause}
        ORDER BY timestamp DESC
        LIMIT ${param_count}
        OFFSET ${param_count + 1}
    """
    params.extend([limit, offset])

    rows = await db.fetch(query, *params)

    webhooks = []
    for row in rows:
        webhooks.append({
            "id": str(row['id']),
            "event_type": row['event_type'],
            "source": row['source'],
            "timestamp": str(row['timestamp']),
            "payload": json.loads(row['payload']) if row['payload'] else {},
            "processed": row['processed'],
            "created_at": str(row['created_at'])
        })

    return {
        "total": len(webhooks),
        "webhooks": webhooks
    }


# Get specific webhook by ID
@app.get("/api/v1/webhooks/{webhook_id}")
async def get_webhook_by_id(
    webhook_id: str,
    db: asyncpg.Connection = Depends(get_db)
):
    """Get a specific webhook by ID"""

    query = "SELECT * FROM webhook_events WHERE id = $1"
    row = await db.fetchrow(query, webhook_id)

    if not row:
        raise HTTPException(status_code=404, detail="Webhook not found")

    return {
        "id": str(row['id']),
        "event_type": row['event_type'],
        "source": row['source'],
        "timestamp": str(row['timestamp']),
        "payload": json.loads(row['payload']) if row['payload'] else {},
        "headers": json.loads(row['headers']) if row['headers'] else {},
        "processed": row['processed'],
        "processed_at": str(row['processed_at']) if row['processed_at'] else None,
        "patient_id": str(row['patient_id']) if row['patient_id'] else None,
        "created_at": str(row['created_at'])
    }


if __name__ == "__main__":
    import uvicorn
    print(f"🚀 Starting PAL MCP API on port {PORT}")
    print(f"📍 Webhook endpoint: http://localhost:{PORT}/api/v1/webhook")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
