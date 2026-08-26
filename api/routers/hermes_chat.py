"""
Hermes Chat Router - AI-powered chat with patient data grounding
Uses Vertex AI (Gemma 4) + MCP + Hindsight
"""
import uuid
import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from auth import get_current_user
from models import User, Conversation, ConversationTurn
from services.llm_vertex import get_vertex_client
from services.mcp_client import get_mcp_client
from services.fastmcp_client import get_fastmcp_client
from services.hindsight import Hindsight
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/hermes", tags=["hermes-chat"])


async def store_conversation(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    user: User,
    patient_id: uuid.UUID,
    query: str,
    answer: str
):
    """Store conversation and turns in database"""
    from sqlalchemy import select

    # Tenant ID is optional - set to None for now
    tenant_id = None

    # Check if conversation exists
    stmt = select(Conversation).where(Conversation.id == conversation_id)
    result = await db.execute(stmt)
    conversation = result.scalar_one_or_none()

    # Create conversation if it doesn't exist
    if not conversation:
        conversation = Conversation(
            id=conversation_id,
            tenant_id=tenant_id,
            member_id=patient_id,
            title=query[:100],  # First 100 chars of first query
            scope_tag="personal",
            active=True
        )
        db.add(conversation)
        await db.flush()

    # Store user query (user turn)
    user_turn = ConversationTurn(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        member_id=patient_id,
        role="user",
        content=query,
        scope="personal",
        contains_phi=True  # Assume patient queries contain PHI
    )
    db.add(user_turn)

    # Store AI answer (assistant turn)
    assistant_turn = ConversationTurn(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        member_id=patient_id,
        role="assistant",
        content=answer,
        scope="personal",
        contains_phi=True  # AI responses about patient data contain PHI
    )
    db.add(assistant_turn)

    await db.commit()
    logger.info(f"Stored conversation {conversation_id} with 2 turns")


class ChatRequest(BaseModel):
    """Chat request from frontend"""
    query: str
    patient_id: str
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    """Chat response to frontend"""
    answer: str
    conversation_id: str
    sources: list[dict] = []


def build_system_prompt(patient_data: dict) -> str:
    """Build grounded system prompt with patient data"""

    patient = patient_data.get("patient", {})
    appointments = patient_data.get("appointments", []) or []
    prescriptions = patient_data.get("prescriptions", []) or []
    lab_tests = patient_data.get("labTests", []) or []

    # Ensure lists
    if not isinstance(appointments, list):
        appointments = []
    if not isinstance(prescriptions, list):
        prescriptions = []
    if not isinstance(lab_tests, list):
        lab_tests = []

    # Extract key information
    patient_name = patient.get("full_name", "Patient")
    patient_age = patient.get("age", "Unknown")
    patient_gender = patient.get("gender", "Unknown")

    # Latest prescription
    medications = []
    if prescriptions and len(prescriptions) > 0:
        latest_rx = prescriptions[0]
        if latest_rx and isinstance(latest_rx.get("items"), list):
            for med in latest_rx["items"][:5]:
                med_name = med.get("name", "Unknown")
                med_dose = med.get("dosage", "")
                medications.append(f"{med_name} {med_dose}")

    # Recent lab tests
    recent_labs = []
    for lab in lab_tests[:3]:
        if not isinstance(lab, dict):
            continue
        lab_name = lab.get("report_name", "Unknown Test")
        report_type = lab.get("report_type", "")
        status = lab.get("status", "unknown")
        abnormal = lab.get("has_abnormal_values", False)
        results = lab.get("results", [])
        if not isinstance(results, list):
            results = []
        recent_labs.append({
            "name": lab_name,
            "type": report_type,
            "status": status,
            "abnormal": abnormal,
            "results": results[:3]  # First 3 parameters
        })

    # Recent appointments
    recent_appts = []
    for appt in appointments[:3]:
        if not isinstance(appt, dict):
            continue
        reason = appt.get("reason_for_visit", "General")
        date = appt.get("date", "Unknown")
        soap = appt.get("soap_note", "")
        summary = appt.get("patient_summary", "")
        appt_summary = ""
        if summary:
            appt_summary = summary[:200]
        elif soap:
            appt_summary = soap[:200]
        recent_appts.append({
            "date": date,
            "reason": reason,
            "summary": appt_summary
        })

    system_prompt = f"""You are PAL Health Assistant, a medical AI that helps patients understand their health records.

IMPORTANT RULES:
1. Answer ONLY using the patient data provided below
2. If information is not in the data, say "I don't have that information in your records"
3. Be conversational and empathetic
4. Explain medical terms in simple language
5. Never make up or assume information

PATIENT DATA:

**Patient Profile:**
- Name: {patient_name}
- Age: {patient_age}
- Gender: {patient_gender}

**Current Medications:** {len(medications)} active
{chr(10).join(f"- {med}" for med in medications) if medications else "- None on record"}

**Recent Lab Tests:** {len(recent_labs)} tests
{json.dumps(recent_labs, indent=2) if recent_labs else "- No recent lab tests"}

**Recent Appointments:** {len(recent_appts)} appointments
{json.dumps(recent_appts, indent=2) if recent_appts else "- No recent appointments"}

**Full Patient Data (for reference):**
{json.dumps(patient_data, indent=2, default=str)[:3000]}  # Limit to first 3000 chars

Remember: Be helpful, accurate, and only use the data provided above.
"""

    return system_prompt


@router.post("/chat", response_model=ChatResponse)
async def chat_with_hermes(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Chat with Hermes AI assistant with FastMCP tool calling
    - Gemma calls FastMCP tools to fetch patient data dynamically
    - Uses function calling for grounded responses
    """
    try:
        logger.info(f"Hermes chat request from user {user.id}: {request.query[:100]}")

        # Get or create conversation ID
        conversation_id = request.conversation_id or str(uuid.uuid4())
        conversation_uuid = uuid.UUID(conversation_id)
        patient_uuid = uuid.UUID(request.patient_id)

        # Get conversation history from Hindsight
        tenant_id = None  # Tenant concept removed
        hindsight = Hindsight(db, tenant_id, patient_uuid)
        conversation_history = await hindsight.get_summary(conversation_uuid)

        # Get FastMCP client with tool definitions
        fastmcp_client = get_fastmcp_client()

        # Get tools from FastMCP server (includes external MCP tools)
        tools = await fastmcp_client.get_tool_definitions()

        # Build conversation context section
        history_context = ""
        if conversation_history:
            history_context = f"""

**PREVIOUS CONVERSATION:**
{conversation_history}

Use this context to understand what the patient is referring to. If they say "that", "it", or "what I asked before", refer to the conversation above.
"""

        # Build system prompt
        system_prompt = f"""You are PAL Health Assistant, an AI medical assistant with access to patient data and external doctor/appointment systems.{history_context}

AVAILABLE TOOLS:

PATIENT DATA TOOLS (Local):
- get_patient_info: Get patient demographics and profile
- get_patient_records: Get complete medical records (appointments, prescriptions, lab tests)
- get_latest_prescription: Get most recent prescription
- get_lab_results: Get lab test results

DOCTOR & APPOINTMENT TOOLS (MCP-DocEHR):
- Tools for checking doctor availability and booking appointments
- Use these when user asks about doctors, appointments, or availability
- ALWAYS confirm booking details with user before making a reservation

IMPORTANT RULES:
1. When asked about patient medical data, use patient data tools with patient_id: {request.patient_id}
2. When asked about doctor availability or booking appointments, use the MCP-DocEHR tools
3. BEFORE booking any appointment, ALWAYS confirm: doctor name, date, time, and reason with the user
4. Use tool results to answer - never make up information
5. Be concise and helpful

Patient ID for this conversation: {request.patient_id}
"""

        # Build messages
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.query}
        ]

        # Call Gemma with tools
        vertex_client = get_vertex_client()

        try:
            response = await vertex_client.generate_with_tools(messages, tools)

            # Check if Gemma wants to call tools
            message = response.choices[0].message

            if message.tool_calls:
                logger.info(f"Gemma requested {len(message.tool_calls)} tool calls")

                # Execute tool calls
                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    tool_args = json.loads(tool_call.function.arguments)

                    # Call FastMCP for patient data operations
                    logger.info(f"Calling MCP tool: {tool_name} with args: {tool_args}")
                    tool_result = await fastmcp_client.call_tool(tool_name, tool_args, db)

                    # Add tool result to conversation
                    messages.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [tool_call.dict()]
                    })
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(tool_result)
                    })

                # Call Gemma again with tool results
                response = await vertex_client.generate_with_tools(messages, tools)
                answer = response.choices[0].message.content
            else:
                # No tool calls, use direct response
                answer = message.content

        except Exception as e:
            logger.error(f"Error calling Vertex AI with tools: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"AI service error: {str(e)}"
            )

        # Store conversation in database
        await store_conversation(
            db=db,
            conversation_id=conversation_uuid,
            user=user,
            patient_id=patient_uuid,
            query=request.query,
            answer=answer
        )

        # Update Hindsight summary with this Q&A
        await hindsight.update_summary(
            query=request.query,
            answer=answer,
            conversation_id=conversation_uuid,
        )

        logger.info(f"Hermes chat response generated: {len(answer)} chars")

        return ChatResponse(
            answer=answer,
            conversation_id=conversation_id,
            sources=[]  # Will be populated from tool usage
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in Hermes chat: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    vertex_client = get_vertex_client()
    mcp_client = get_mcp_client()

    return {
        "status": "ok",
        "vertex_ai": {
            "model": vertex_client.model,
            "configured": bool(vertex_client.api_key)
        },
        "mcp": {
            "url": mcp_client.base_url,
            "configured": bool(mcp_client.api_key)
        }
    }
