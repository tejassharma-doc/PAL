"""
PAL Health Tools API - Simple FastAPI Server
Exposes patient data tools via simple HTTP endpoints
"""

"""
import os
from datetime import datetime
from typing import Optional, List, Union
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator
import asyncpg
import uvicorn
import json

# Environment configuration
DATABASE_URL = os.getenv("DATABASE_URL")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_USER = os.getenv("POSTGRES_USER", "pal")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_DB = os.getenv("POSTGRES_DB", "pal")

# Build connection string
if not DATABASE_URL:
    DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Initialize FastAPI
app = FastAPI(title="PAL Health Tools API", version="1.0.0")

# Database connection pool
pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Get or create database connection pool"""
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return pool


# ============ Response Models ============

class Patient(BaseModel):
    id: str
    full_name: str
    email: Optional[str]
    phone: Optional[str]
    date_of_birth: Optional[datetime]
    gender: Optional[str]
    blood_group: Optional[str]
    address: Optional[str]
    allergies: Optional[str]
    chronic_conditions: Optional[str]
    current_medications: Optional[str]
    mrn: Optional[str]
    abha_id: Optional[str]
    emergency_contact: Optional[dict]

    @field_validator('emergency_contact', mode='before')
    @classmethod
    def parse_emergency_contact(cls, v):
        """Parse emergency_contact if it's a JSON string"""
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return None
        return v


class Appointment(BaseModel):
    id: str
    patient_id: str
    slot_time: datetime
    reason_for_visit: Optional[str]
    status: str
    soap_note: Optional[str]
    patient_summary: Optional[str]


class Prescription(BaseModel):
    id: str
    patient_id: str
    items: list
    notes: Optional[str]
    created_at: datetime


class LabTest(BaseModel):
    id: str
    patient_id: str
    test_name: str
    test_category: Optional[str]
    ordered_date: datetime
    result_date: Optional[datetime]
    status: str
    results: Optional[list]
    abnormal_flag: bool
    interpretation: Optional[str]


class PatientRecords(BaseModel):
    patient: Patient
    appointments: List[Appointment]
    prescriptions: List[Prescription]
    labTests: List[LabTest]


class ToolRequest(BaseModel):
    name: str
    arguments: dict


class ToolResponse(BaseModel):
    content: dict


# ============ API Endpoints ============

@app.on_event("startup")
async def startup():
    """Initialize database pool on startup"""
    await get_pool()
    print(f"Connected to database: {POSTGRES_DB}@{POSTGRES_HOST}:{POSTGRES_PORT}")


@app.get("/")
async def root():
    return {"status": "ok", "service": "PAL Health Tools API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/tools/call")
async def call_tool(request: ToolRequest):
    """Call a tool by name with arguments"""
    import traceback
    try:
        print(f"Calling tool: {request.name} with args: {request.arguments}")

        if request.name == "get_patient_info":
            result = await get_patient_info(**request.arguments)
            return {"content": result.dict()}

        elif request.name == "get_patient_records":
            result = await get_patient_records(**request.arguments)
            return {"content": result.dict()}

        elif request.name == "get_latest_prescription":
            result = await get_latest_prescription(**request.arguments)
            return {"content": result.dict() if result else None}

        elif request.name == "get_lab_results":
            result = await get_lab_results(**request.arguments)
            return {"content": [r.dict() for r in result]}

        elif request.name == "search_patients":
            result = await search_patients(**request.arguments)
            return {"content": [p.dict() for p in result]}

        else:
            raise HTTPException(status_code=404, detail=f"Tool '{request.name}' not found")

    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR calling tool {request.name}: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tools/list")
async def list_tools():
    """List all available tools"""
    return {
        "tools": [
            {
                "name": "get_patient_info",
                "description": "Get patient demographics and profile information",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "patient_id": {"type": "string", "description": "UUID of the patient"}
                    },
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_patient_records",
                "description": "Get complete patient medical records including appointments, prescriptions, and lab tests",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "patient_id": {"type": "string", "description": "UUID of the patient"}
                    },
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_latest_prescription",
                "description": "Get patient's most recent prescription",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "patient_id": {"type": "string", "description": "UUID of the patient"}
                    },
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_lab_results",
                "description": "Get patient's lab test results",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "patient_id": {"type": "string", "description": "UUID of the patient"},
                        "limit": {"type": "integer", "description": "Maximum number of results", "default": 20}
                    },
                    "required": ["patient_id"]
                }
            },
            {
                "name": "search_patients",
                "description": "Search for patients by phone, email, or patient ID",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "phone": {"type": "string"},
                        "email": {"type": "string"},
                        "patient_id": {"type": "string"}
                    }
                }
            }
        ]
    }


# ============ Tool Functions ============

async def get_patient_info(patient_id: str) -> Patient:
    """Get patient demographics and profile information"""
    db = await get_pool()

    row = await db.fetchrow("""
        SELECT
            id, full_name, email, phone, date_of_birth, gender, blood_group,
            address, allergies, chronic_conditions, current_medications,
            mrn, abha_id, emergency_contact
        FROM patients
        WHERE id = $1
    """, patient_id)

    if not row:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id} not found")

    # Convert database row to dict and fix types
    data = dict(row)
    data['id'] = str(data['id'])  # Convert UUID to string

    return Patient(**data)


async def get_patient_records(patient_id: str) -> PatientRecords:
    """Get complete patient medical records"""
    db = await get_pool()

    # Get patient info
    patient_row = await db.fetchrow("SELECT * FROM patients WHERE id = $1", patient_id)
    if not patient_row:
        raise HTTPException(status_code=404, detail=f"Patient {patient_id} not found")

    # Get appointments with SOAP notes
    appointments_rows = await db.fetch("""
        SELECT a.*, co.soap_note, co.management_plan, co.patient_summary
        FROM appointments a
        LEFT JOIN clinical_outputs co ON co.appointment_id = a.id
        WHERE a.patient_id = $1
        ORDER BY a.slot_time DESC
        LIMIT 20
    """, patient_id)

    # Get prescriptions
    prescriptions_rows = await db.fetch("""
        SELECT * FROM prescriptions
        WHERE patient_id = $1
        ORDER BY created_at DESC
        LIMIT 10
    """, patient_id)

    # Get lab tests
    lab_tests_rows = await db.fetch("""
        SELECT * FROM lab_tests
        WHERE patient_id = $1
        ORDER BY ordered_date DESC
        LIMIT 20
    """, patient_id)

    # Convert UUIDs to strings
    patient_data = dict(patient_row)
    patient_data['id'] = str(patient_data['id'])

    def convert_row(row):
        """Convert UUID fields to strings in a row"""
        data = dict(row)
        for key, value in data.items():
            if hasattr(value, '__class__') and value.__class__.__name__ == 'UUID':
                data[key] = str(value)
        return data

    return PatientRecords(
        patient=Patient(**patient_data),
        appointments=[Appointment(**convert_row(r)) for r in appointments_rows],
        prescriptions=[Prescription(**convert_row(r)) for r in prescriptions_rows],
        labTests=[LabTest(**convert_row(r)) for r in lab_tests_rows]
    )


async def get_latest_prescription(patient_id: str) -> Optional[Prescription]:
    """Get patient's most recent prescription"""
    db = await get_pool()

    row = await db.fetchrow("""
        SELECT * FROM prescriptions
        WHERE patient_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    """, patient_id)

    if not row:
        return None

    data = dict(row)
    data['id'] = str(data['id'])
    data['patient_id'] = str(data['patient_id'])
    return Prescription(**data)


async def get_lab_results(patient_id: str, limit: int = 20) -> List[LabTest]:
    """Get patient's lab test results"""
    db = await get_pool()

    rows = await db.fetch("""
        SELECT * FROM lab_tests
        WHERE patient_id = $1
        ORDER BY ordered_date DESC
        LIMIT $2
    """, patient_id, limit)

    results = []
    for r in rows:
        data = dict(r)
        data['id'] = str(data['id'])
        data['patient_id'] = str(data['patient_id'])
        results.append(LabTest(**data))
    return results


async def search_patients(
    phone: Optional[str] = None,
    email: Optional[str] = None,
    patient_id: Optional[str] = None
) -> List[Patient]:
    """Search for patients"""
    if not phone and not email and not patient_id:
        raise HTTPException(status_code=400, detail="Provide at least one search parameter")

    db = await get_pool()

    conditions = []
    params = []
    param_count = 1

    if phone:
        conditions.append(f"phone = ${param_count}")
        params.append(phone)
        param_count += 1

    if email:
        conditions.append(f"email = ${param_count}")
        params.append(email.lower())
        param_count += 1

    if patient_id:
        conditions.append(f"id = ${param_count}")
        params.append(patient_id)
        param_count += 1

    query = f"""
        SELECT * FROM patients
        WHERE ({' OR '.join(conditions)}) AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 50
    """

    rows = await db.fetch(query, *params)
    results = []
    for r in rows:
        data = dict(r)
        data['id'] = str(data['id'])
        results.append(Patient(**data))
    return results


if __name__ == "__main__":
    print(f"PAL Health Tools API starting...")
    print(f"Database: {POSTGRES_DB}@{POSTGRES_HOST}:{POSTGRES_PORT}")
    print(f"Running on http://0.0.0.0:8002")

    uvicorn.run(app, host="0.0.0.0", port=8002)


"""
