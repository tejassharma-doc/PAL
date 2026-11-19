"""
PAL Health API - FastMCP Server
Modern MCP server using FastMCP framework (Python)
"""
import os
import json
import uuid
from datetime import datetime
from typing import Optional, List
from fastmcp import FastMCP
from pydantic import BaseModel, field_validator
from jose import JWTError, jwt
import asyncpg

# Environment configuration
DATABASE_URL = os.getenv("DATABASE_URL")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_USER = os.getenv("POSTGRES_USER", "pal")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_DB = os.getenv("POSTGRES_DB", "pal")
PAL_API_KEY = os.getenv("PAL_API_KEY", "")

# ── MCP auth ───────────────────────────────────────────────────────────────
# This server returns PHI, so every /tools/call must carry a JWT that the PAL
# API minted (services/mcp_auth.py). It is signed with the SAME secret the API
# uses, scoped to the caller's own patient ids, and it expires in ~2 minutes.
# The server verifies signature + expiry + audience/type, then enforces that the
# requested patient_id is inside the token's `pids` scope.
# Default MUST equal the API's config.py `secret_key` default so that, whether
# or not .env.production defines SECRET_KEY, this server and the API agree on the
# signing key and the API-minted token verifies here.
SECRET_KEY = os.getenv("SECRET_KEY", "dev_secret_change_in_prod")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM") or os.getenv("ALGORITHM", "HS256")
MCP_JWT_AUD = os.getenv("MCP_JWT_AUD", "pal-mcp")
MCP_JWT_TYP = os.getenv("MCP_JWT_TYP", "mcp-access")
# Escape hatch for a temporary rollback ONLY. Leaving this false re-opens the
# PHI hole this file exists to close, so it must be "true" in production.
MCP_AUTH_REQUIRED = os.getenv("MCP_AUTH_REQUIRED", "true").strip().lower() != "false"

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

    def _pj(v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v

    return {
        "patient": Patient(**convert_row(patient_row)).model_dump(),
        "appointments": [
            {
                "id": str(r["id"]),
                "slot_time": r["slot_time"].isoformat() if r["slot_time"] else None,
                "reason_for_visit": r["reason_for_visit"],
                "status": r["status"],
                "doctor_name": r["doctor_name"],
                "soap_note": r["soap_note"],
                "management_plan": r["management_plan"],
                "patient_summary": r["patient_summary"],
            }
            for r in appointments_rows
        ],
        "prescriptions": [
            {
                "id": str(r["id"]),
                "patient_id": str(r["patient_id"]),
                "items": _pj(r["items"]) or [],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in prescriptions_rows
        ],
        "labTests": [
            {
                "id": str(r["id"]),
                "test_name": r["report_name"],
                "test_category": r["test_category"],
                "ordered_date": r["ordered_date"].isoformat() if r["ordered_date"] else None,
                "result_date": r["result_date"].isoformat() if r["result_date"] else None,
                "status": r["status"],
                "results": _pj(r["results"]),
                "abnormal_flag": bool(r["has_abnormal_values"]),
                "interpretation": r["interpretation"],
            }
            for r in lab_tests_rows
        ],
    }


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
        SELECT id, patient_id, items, created_at FROM prescriptions
        WHERE patient_id = $1::uuid
           OR patient_id IN (SELECT phone_user_id FROM patients WHERE id = $1::uuid)
           OR patient_id IN (SELECT id FROM patients WHERE phone_user_id = $1::uuid)
        ORDER BY created_at DESC
        LIMIT 1
    """, patient_id)

    if not row:
        return None

    items = row["items"]
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except Exception:
            items = []
    return {
        "id": str(row["id"]),
        "patient_id": str(row["patient_id"]),
        "items": items or [],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


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

    # Columns are report_name / has_abnormal_values (not test_name/abnormal_flag),
    # and uploaded reports may be keyed by the patient's phone_user_id — match both.
    rows = await db.fetch("""
        SELECT id, patient_id, report_name, test_category, ordered_date,
               result_date, status, results, has_abnormal_values, interpretation
        FROM lab_tests
        WHERE patient_id = $1::uuid
           OR patient_id IN (SELECT phone_user_id FROM patients WHERE id = $1::uuid)
           OR patient_id IN (SELECT id FROM patients WHERE phone_user_id = $1::uuid)
        ORDER BY ordered_date DESC
        LIMIT $2
    """, patient_id, limit)

    out = []
    for r in rows:
        results = r["results"]
        if isinstance(results, str):
            try:
                results = json.loads(results)
            except Exception:
                results = None
        out.append({
            "id": str(r["id"]),
            "patient_id": str(r["patient_id"]),
            "test_name": r["report_name"],
            "test_category": r["test_category"],
            "ordered_date": r["ordered_date"].isoformat() if r["ordered_date"] else None,
            "result_date": r["result_date"].isoformat() if r["result_date"] else None,
            "status": r["status"],
            "results": results,
            "abnormal_flag": bool(r["has_abnormal_values"]),
            "interpretation": r["interpretation"],
        })
    return out


@mcp.tool()
async def get_medication_schedule(patient_id: str) -> List[dict]:
    """
    Get the patient's active medication reminders: which medicines, the dosage,
    the times of day to take them, and on which days. Use this to answer questions
    like "when do I take my medication?" or "how should I take <medicine>?".

    Args:
        patient_id: UUID of the patient (patients.id or phone_user id)

    Returns:
        List of active medication schedules with medicine, dosage, times and days.
    """
    db = await get_pool()

    rows = await db.fetch("""
        SELECT medicine_name, dosage, times, days_of_week, start_date, end_date, notes
        FROM medication_schedules
        WHERE active = true AND (
            patient_id = $1::uuid
            OR phone_user_id = $1::uuid
            OR patient_id IN (SELECT id FROM patients WHERE phone_user_id = $1::uuid)
            OR phone_user_id IN (SELECT phone_user_id FROM patients WHERE id = $1::uuid)
        )
        ORDER BY medicine_name
    """, patient_id)

    DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    out = []
    for r in rows:
        times = r["times"]
        if isinstance(times, str):
            try:
                times = json.loads(times)
            except Exception:
                times = []
        dow = r["days_of_week"]
        if isinstance(dow, str):
            try:
                dow = json.loads(dow)
            except Exception:
                dow = []
        day_names = "Every day" if not dow else ", ".join(
            DAYS[d] for d in dow if isinstance(d, int) and 0 <= d < 7
        )
        out.append({
            "medicine_name": r["medicine_name"],
            "dosage": r["dosage"],
            "times": times or [],
            "days": day_names,
            "start_date": r["start_date"].isoformat() if r["start_date"] else None,
            "end_date": r["end_date"].isoformat() if r["end_date"] else None,
            "notes": r["notes"],
        })
    return out


@mcp.tool()
async def get_nutrition_plan(patient_id: str) -> dict:
    """
    Get the patient's current nutrition / diet plan prescribed by their dietitian:
    the goal, daily calorie/protein/carb/fat targets, BMI and measurements, the
    foods to eat and to avoid, dietary instructions, and the day-by-day meal plan
    with each dish's calories. Use this for ANY question about the patient's diet,
    meals, what they should or shouldn't eat, calories, macros, or nutrition goal.

    Args:
        patient_id: UUID of the patient

    Returns:
        The current nutrition plan, or {"has_plan": false} if none exists.
    """
    db = await get_pool()

    # Match the plan to this patient by resolved pal_patient_id, or by the
    # patient's phone (last 10 digits) — the webhook may not have resolved the id.
    presc = await db.fetchrow(r"""
        SELECT * FROM nutrition_prescriptions
        WHERE pal_patient_id = $1::uuid
           OR right(regexp_replace(coalesce(patient_phone, ''), '\D', '', 'g'), 10) = (
                SELECT right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
                FROM patients WHERE id = $1::uuid
           )
        ORDER BY is_current DESC NULLS LAST, coalesce(published_at, received_at) DESC
        LIMIT 1
    """, patient_id)

    if not presc:
        return {"has_plan": False}

    pid = presc["id"]
    menu = await db.fetch(
        "SELECT day_number, day_label, feed_time, recipe_name, servings, "
        "energy_kcal, protein_g, carb_g, fat_g FROM nutrition_menu_items "
        "WHERE prescription_id = $1 ORDER BY day_number, id", pid)
    totals = await db.fetch(
        "SELECT day_number, energy_kcal, protein_g FROM nutrition_day_totals "
        "WHERE prescription_id = $1 ORDER BY day_number", pid)
    guidance = await db.fetch(
        "SELECT kind, text FROM nutrition_guidance WHERE prescription_id = $1 ORDER BY id", pid)
    instructions = await db.fetch(
        "SELECT text FROM nutrition_instructions WHERE prescription_id = $1 ORDER BY id", pid)
    diagnoses = await db.fetch(
        "SELECT code, description FROM nutrition_diagnoses WHERE prescription_id = $1 ORDER BY id", pid)
    labs = await db.fetch(
        "SELECT display_name, analyte, result, numeric_value, unit, flag "
        "FROM nutrition_labs WHERE prescription_id = $1 ORDER BY id", pid)

    def numval(v):
        if v is None:
            return None
        try:
            f = float(v)
            return int(f) if f.is_integer() else round(f, 2)
        except (TypeError, ValueError):
            return None

    def _iso(v):
        return v.isoformat() if v is not None and hasattr(v, "isoformat") else v

    totals_by_day = {t["day_number"]: t for t in totals}
    days: dict = {}
    for r in menu:
        dn = r["day_number"]
        if dn not in days:
            t = totals_by_day.get(dn)
            days[dn] = {
                "day": dn,
                "label": r["day_label"],
                "day_total_kcal": numval(t["energy_kcal"]) if t else None,
                "meals": [],
            }
        days[dn]["meals"].append({
            "feed_time": r["feed_time"],
            "dish": r["recipe_name"],
            "servings": numval(r["servings"]),
            "energy_kcal": numval(r["energy_kcal"]),
            "protein_g": numval(r["protein_g"]),
        })

    def _kind(g):
        return (g["kind"] or "").upper()

    return {
        "has_plan": True,
        "dietitian": presc["dietitian_name"],
        "clinic": presc["clinic_name"],
        "issued_at": _iso(presc["published_at"]) or _iso(presc["created_at"]),
        "status": presc["status"],
        "goal": {"label": presc["goal_label"], "summary": presc["goal_summary"]},
        "diet_pattern": presc["diet_pattern"],
        "cuisine": presc["cuisine"],
        "daily_targets": {
            "energy_kcal_min": numval(presc["energy_kcal_min"]),
            "energy_kcal_max": numval(presc["energy_kcal_max"]),
            "protein_g": numval(presc["protein_g"]),
            "carb_g": numval(presc["carb_g"]),
            "fat_g": numval(presc["fat_g"]),
        },
        "anthropometry": {
            "bmi": numval(presc["bmi"]),
            "bmi_status": presc["bmi_status"],
            "height_cm": numval(presc["height_cm"]),
            "weight_kg": numval(presc["weight_kg"]),
        },
        "diagnoses": [d["description"] or d["code"] for d in diagnoses if (d["description"] or d["code"])],
        "foods_to_eat": [g["text"] for g in guidance if _kind(g) == "EAT" and g["text"]],
        "foods_to_avoid": [g["text"] for g in guidance if _kind(g) == "AVOID" and g["text"]],
        "other_guidance": [g["text"] for g in guidance if _kind(g) not in ("EAT", "AVOID") and g["text"]],
        "instructions": [i["text"] for i in instructions if i["text"]],
        "relevant_labs": [
            {
                "name": l["display_name"] or l["analyte"],
                "result": l["result"] or (f'{numval(l["numeric_value"])} {l["unit"] or ""}'.strip() if l["numeric_value"] is not None else None),
                "flag": l["flag"],
            }
            for l in labs
        ],
        "meal_plan_days": list(days.values()),
    }


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
from fastapi import FastAPI, Request, Header, HTTPException as FastAPIHTTPException
from pydantic import BaseModel as PydanticBaseModel

# Create FastAPI app to add custom endpoints
custom_app = FastAPI()

# Tools that read a single patient's record. Their `patient_id` argument must be
# inside the caller's token scope.
_PATIENT_ID_TOOLS = {
    "get_patient_info", "get_patient_records",
    "get_latest_prescription", "get_lab_results",
    "get_medication_schedule", "get_nutrition_plan",
}


def _norm_uuid(value) -> str:
    """Normalise an id so scope comparison is not defeated by case/formatting."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return str(value)


def _verify_mcp_token(authorization: Optional[str]) -> Optional[dict]:
    """Verify the API-minted MCP JWT and return its claims.

    Returns None when auth is disabled (rollback only). Raises 401 for a
    missing/invalid/expired/wrong-type token — never runs a tool without one.
    """
    if not MCP_AUTH_REQUIRED:
        return None
    if not SECRET_KEY:
        # Fail closed: a server told to require auth but given no key must not
        # silently accept everything.
        raise FastAPIHTTPException(status_code=500, detail="MCP auth misconfigured")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise FastAPIHTTPException(status_code=401, detail="Missing bearer token")
    raw = authorization[7:].strip()
    try:
        claims = jwt.decode(
            raw, SECRET_KEY, algorithms=[JWT_ALGORITHM], audience=MCP_JWT_AUD
        )
    except JWTError:
        raise FastAPIHTTPException(status_code=401, detail="Invalid or expired token")
    # python-jose 3.3.0 does NOT reject a token whose `aud` is simply absent even
    # when audience= is passed, so both claims are checked explicitly here.
    if claims.get("aud") != MCP_JWT_AUD or claims.get("typ") != MCP_JWT_TYP:
        raise FastAPIHTTPException(status_code=401, detail="Wrong token type")
    return claims


def _enforce_patient_scope(name: str, arguments: dict, claims: Optional[dict]) -> None:
    """Reject a tool call for a patient the token does not cover. 403 on breach."""
    if claims is None:  # auth disabled (rollback)
        return
    allowed = {_norm_uuid(p) for p in (claims.get("pids") or [])}

    if name in _PATIENT_ID_TOOLS:
        pid = arguments.get("patient_id")
        if not pid or _norm_uuid(pid) not in allowed:
            raise FastAPIHTTPException(
                status_code=403, detail="Not authorized for this patient",
            )
    elif name == "search_patients":
        # search_patients can otherwise enumerate strangers by phone/email. Pin
        # it to the caller's own records: require an owned patient_id and drop
        # the fishing parameters.
        pid = arguments.get("patient_id")
        if not pid or _norm_uuid(pid) not in allowed:
            raise FastAPIHTTPException(
                status_code=403, detail="Search restricted to your own records",
            )
        arguments.pop("phone", None)
        arguments.pop("email", None)


class ToolCallRequest(PydanticBaseModel):
    name: str
    arguments: dict

@custom_app.post("/tools/call")
async def http_call_tool(
    request: ToolCallRequest,
    authorization: Optional[str] = Header(default=None),
):
    """Simple HTTP endpoint to call tools"""
    tools_map = {
        "get_patient_info": get_patient_info,
        "get_patient_records": get_patient_records,
        "get_latest_prescription": get_latest_prescription,
        "get_lab_results": get_lab_results,
        "get_medication_schedule": get_medication_schedule,
        "get_nutrition_plan": get_nutrition_plan,
        "search_patients": search_patients
    }

    if request.name not in tools_map:
        raise FastAPIHTTPException(status_code=404, detail=f"Tool '{request.name}' not found")

    # Authenticate the caller and enforce patient scope BEFORE touching the DB.
    claims = _verify_mcp_token(authorization)
    _enforce_patient_scope(request.name, request.arguments, claims)

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
                "name": "get_medication_schedule",
                "description": "Get the patient's active medication reminders: which medicines, dosage, the times of day, and which days to take them. Use for questions like 'when do I take my medication?' or 'how do I take <medicine>?'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}},
                    "required": ["patient_id"]
                }
            },
            {
                "name": "get_nutrition_plan",
                "description": "Get the patient's current nutrition/diet plan from their dietitian: goal, daily calorie/protein/carb/fat targets, BMI, foods to eat and avoid, dietary instructions, and the day-by-day meal plan. Use for ANY question about the patient's diet, meals, what to eat/avoid, calories, macros, or nutrition goal.",
                "inputSchema": {
                    "type": "object",
                    "properties": {"patient_id": {"type": "string"}},
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
