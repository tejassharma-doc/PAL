"""
PAL Health API - FastMCP Server
Modern MCP server using FastMCP framework (Python)
"""
import os
import json
from datetime import datetime
from typing import Optional, List
from fastmcp import FastMCP
from pydantic import BaseModel, field_validator
import asyncpg

# Environment configuration
DATABASE_URL = os.getenv("DATABASE_URL")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_USER = os.getenv("POSTGRES_USER", "pal")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_DB = os.getenv("POSTGRES_DB", "pal")
PAL_API_KEY = os.getenv("PAL_API_KEY", "")

# Build connection string
if not DATABASE_URL:
    DATABASE_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Initialize FastMCP
mcp = FastMCP("PAL Health MCP Server")

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


# Helper function to convert UUIDs
def convert_row(row):
    """Convert UUID fields to strings in a row"""
    data = dict(row)
    for key, value in data.items():
        if hasattr(value, '__class__') and value.__class__.__name__ == 'UUID':
            data[key] = str(value)
    return data


# ============ MCP Tools ============

@mcp.tool()
async def get_patient_info(patient_id: str) -> dict:
    """
    Get patient demographics and profile information.

    Args:
        patient_id: UUID of the patient

    Returns:
        Patient profile with demographics, vitals, and medical history
    """
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
        raise ValueError(f"Patient {patient_id} not found")

    data = convert_row(row)
    return Patient(**data).model_dump()


@mcp.tool()
async def get_patient_records(patient_id: str) -> dict:
    """
    Get complete patient medical records including appointments, prescriptions, and lab tests.

    Args:
        patient_id: UUID of the patient

    Returns:
        Complete patient records bundle
    """
    db = await get_pool()

    # Get patient info
    patient_row = await db.fetchrow("SELECT * FROM patients WHERE id = $1", patient_id)
    if not patient_row:
        raise ValueError(f"Patient {patient_id} not found")

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

    records = PatientRecords(
        patient=Patient(**convert_row(patient_row)),
        appointments=[Appointment(**convert_row(r)) for r in appointments_rows],
        prescriptions=[Prescription(**convert_row(r)) for r in prescriptions_rows],
        labTests=[LabTest(**convert_row(r)) for r in lab_tests_rows]
    )

    return records.model_dump()


@mcp.tool()
async def get_latest_prescription(patient_id: str) -> Optional[dict]:
    """
    Get patient's most recent prescription with medication details.

    Args:
        patient_id: UUID of the patient

    Returns:
        Latest prescription or None if no prescriptions exist
    """
    db = await get_pool()

    row = await db.fetchrow("""
        SELECT * FROM prescriptions
        WHERE patient_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    """, patient_id)

    if not row:
        return None

    return Prescription(**convert_row(row)).model_dump()


@mcp.tool()
async def get_lab_results(patient_id: str, limit: int = 20) -> List[dict]:
    """
    Get patient's lab test results.

    Args:
        patient_id: UUID of the patient
        limit: Maximum number of results to return (default 20)

    Returns:
        List of lab test results ordered by date (newest first)
    """
    db = await get_pool()

    rows = await db.fetch("""
        SELECT * FROM lab_tests
        WHERE patient_id = $1
        ORDER BY ordered_date DESC
        LIMIT $2
    """, patient_id, limit)

    return [LabTest(**convert_row(r)).model_dump() for r in rows]


@mcp.tool()
async def search_patients(
    phone: Optional[str] = None,
    email: Optional[str] = None,
    patient_id: Optional[str] = None
) -> List[dict]:
    """
    Search for patients by phone, email, or patient ID.

    Args:
        phone: Phone number to search
        email: Email address to search
        patient_id: Patient UUID to search

    Returns:
        List of matching patients
    """
    if not phone and not email and not patient_id:
        raise ValueError("Provide at least one search parameter: phone, email, or patient_id")

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
    return [Patient(**convert_row(r)).model_dump() for r in rows]


# Add simple HTTP endpoints for bridge access using FastAPI
from fastapi import FastAPI, Request, HTTPException as FastAPIHTTPException
from pydantic import BaseModel as PydanticBaseModel

# Create FastAPI app to add custom endpoints
custom_app = FastAPI()

class ToolCallRequest(PydanticBaseModel):
    name: str
    arguments: dict

@custom_app.post("/tools/call")
async def http_call_tool(request: ToolCallRequest):
    """Simple HTTP endpoint to call tools"""
    tools_map = {
        "get_patient_info": get_patient_info,
        "get_patient_records": get_patient_records,
        "get_latest_prescription": get_latest_prescription,
        "get_lab_results": get_lab_results,
        "search_patients": search_patients
    }

    if request.name not in tools_map:
        raise FastAPIHTTPException(status_code=404, detail=f"Tool '{request.name}' not found")

    try:
        print(f"Calling tool: {request.name} with args: {request.arguments}")
        result = await tools_map[request.name](**request.arguments)
        print(f"Tool {request.name} completed successfully")
        return {"content": result}
    except Exception as e:
        import traceback
        print(f"ERROR calling tool {request.name}: {str(e)}")
        print(traceback.format_exc())
        raise FastAPIHTTPException(status_code=500, detail=str(e))


@custom_app.get("/tools/list")
async def http_list_tools():
    """Simple HTTP endpoint to list tools"""
    return {
        "tools": [
            {
                "name": "get_patient_info",
                "description": "Get patient demographics and profile information",
                "inputSchema": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}},
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_patient_records",
                "description": "Get complete patient medical records",
                "inputSchema": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}},
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_latest_prescription",
                "description": "Get patient's most recent prescription",
                "inputSchema": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}},
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_lab_results",
                "description": "Get patient's lab test results",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "patient_id": {"type": "string"},
                        "limit": {"type": "integer", "default": 20}
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


@custom_app.get("/health")
async def http_health():
    """Health check endpoint"""
    return {"status": "healthy", "framework": "FastMCP"}


@custom_app.on_event("startup")
async def startup():
    """Initialize database pool on startup"""
    await get_pool()
    print("Database pool initialized")


if __name__ == "__main__":
    # Run custom FastAPI app that wraps FastMCP tools
    import uvicorn
    print(f"FastMCP server starting...")
    print(f"Database: {POSTGRES_DB}@{POSTGRES_HOST}:{POSTGRES_PORT}")
    print(f"Running on http://0.0.0.0:8002")
    print(f"FastMCP tools defined with @mcp.tool() decorators")
    print(f"HTTP wrapper endpoints: /tools/call, /tools/list, /health")

    # Run the custom FastAPI app (which calls FastMCP tool functions)
    uvicorn.run(custom_app, host="0.0.0.0", port=8002)
