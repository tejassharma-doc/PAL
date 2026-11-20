"""
Hermes Chat Router - AI-powered chat with patient data grounding
Uses Vertex AI (Gemma 4) + MCP + Hindsight
"""
import uuid
import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from database import get_db
from auth import get_current_user
from models import User, Conversation, ConversationTurn
from services.llm_vertex import get_vertex_client
from services.mcp_client import get_mcp_client
from services.fastmcp_client import get_fastmcp_client
from services.mcp_auth import mint_mcp_token, owned_patient_ids, user_owns_patient
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


async def _build_chat_setup(request: "ChatRequest", user, db) -> dict:
    """Shared setup for /chat and /chat/stream: PAL-MCP auth gate, patient-scoped
    token, conversation history, tool definitions, system prompt and the initial
    messages. Raises HTTPException(403) if the user doesn't own the patient."""
    conversation_id = request.conversation_id or str(uuid.uuid4())
    conversation_uuid = uuid.UUID(conversation_id)
    patient_uuid = uuid.UUID(request.patient_id)

    allowed_pids = await owned_patient_ids(db, user)
    if settings.mcp_auth_required and not user_owns_patient(request.patient_id, allowed_pids):
        logger.warning("Hermes chat: user %s attempted patient_id %s they do not own",
                       user.id, request.patient_id)
        raise HTTPException(status_code=403,
                            detail="You are not authorized to access this patient's records")
    mcp_token = mint_mcp_token(str(user.id), allowed_pids)

    hindsight = Hindsight(db, None, patient_uuid)
    conversation_history = await hindsight.get_summary(conversation_uuid)

    fastmcp_client = get_fastmcp_client()
    tools = await fastmcp_client.get_tool_definitions()

    history_context = ""
    if conversation_history:
        history_context = f"""

**PREVIOUS CONVERSATION:**
{conversation_history}

Use this context to understand what the patient is referring to. If they say "that", "it", or "what I asked before", refer to the conversation above.
"""

    tool_names = {t.get("function", {}).get("name", "") for t in tools}
    has_biorxiv = any(n.startswith("biorxiv_") for n in tool_names)
    has_knowledge = "search_medical_literature" in tool_names

    if has_knowledge:
        literature_tools_section = """
MEDICAL LITERATURE TOOL:
- search_medical_literature: Search the curated PubMed corpus for passages relevant to a medical/health question. It returns only passages that pass a relevance check."""
        retrieval_instructions = """CRITICAL — MEDICAL & HEALTH QUESTIONS REQUIRE LITERATURE RETRIEVAL:
For ANY question about a medication, treatment, symptom, diagnosis, health condition, or clinical topic:
  a. You MUST call search_medical_literature BEFORE composing your answer.
  b. Answer ONLY from the passages it returns. Synthesise them into one clear, user-friendly answer.
  c. If the result has "relevant": false or no results, tell the user you do not have reliable evidence on this — do NOT answer from memory.
  d. Cite the sources you used (title / PMID where present).
  e. Never invent facts, numbers, or citations that are not in the returned passages."""
    else:
        literature_tools_section = """
MEDICAL LITERATURE TOOLS:
- pubmed_search: Search PubMed for peer-reviewed human clinical studies. Use for any medical or health question.
- pubmed_search_advanced: Search PubMed for high-evidence studies only (RCTs, meta-analyses, systematic reviews, practice guidelines). Use when the strongest evidence is needed or for a second opinion."""
        if has_biorxiv:
            literature_tools_section += """
- biorxiv_search_preprints: Search bioRxiv/medRxiv for the latest medical preprints. Use alongside PubMed to surface cutting-edge research not yet in peer-reviewed journals."""
        biorxiv_rule = "and biorxiv_search_preprints " if has_biorxiv else ""
        retrieval_instructions = f"""CRITICAL — MEDICAL & HEALTH QUESTIONS REQUIRE LITERATURE RETRIEVAL:
For ANY question about a medication, treatment, symptom, diagnosis, health condition, or clinical topic:
  a. You MUST call pubmed_search {biorxiv_rule}BEFORE composing your answer.
  b. Call pubmed_search_advanced as well when the user asks for strong evidence, guidelines, or a second opinion.
  c. Synthesise findings from ALL retrieved sources into a single, coherent answer.
  d. Cite each article you used: title, journal (or "bioRxiv preprint"), year, and URL.
  e. NEVER answer a medical question from your training knowledge alone — always retrieve first.
  f. If retrieval returns no results, say so explicitly rather than answering from memory."""

    system_prompt = f"""You are PAL Health Assistant, an AI medical assistant with access to patient data, appointment systems, and medical literature databases.{history_context}

AVAILABLE TOOLS:

PATIENT DATA TOOLS (Local):
- get_patient_info: Get patient demographics and profile
- get_patient_records: Get complete medical records (appointments, prescriptions, lab tests)
- get_latest_prescription: Get most recent prescription
- get_lab_results: Get lab test results
- get_medication_schedule: Get the patient's active medicine reminders (which medicine, dose, times, days)
- get_nutrition_plan: Get the patient's dietitian-prescribed nutrition/diet plan — goal, daily calorie/protein/carb/fat targets, BMI, foods to eat and avoid, dietary instructions, and the day-by-day meal plan. ALWAYS call this for any question about the patient's diet, meals, what to eat or avoid, calories, macros, or nutrition goal.

DOCTOR & APPOINTMENT TOOLS (MCP-DocEHR):
- Tools for checking doctor availability and booking appointments
- Use these when user asks about doctors, appointments, or availability
- Pass the hospital or clinic the user names as clinic_name, and the doctor as doctor_name
- If a tool reports the clinic or doctor was NOT found, do NOT invent or retry a made-up
  name. The error lists the available clinics/doctors — read those options back to the
  user, ask which one they mean, then retry with that EXACT name.
- ALWAYS confirm booking details with user before making a reservation
{literature_tools_section}

IMPORTANT RULES:
1. When asked about patient medical data, use patient data tools with patient_id: {request.patient_id}
2. For ANY question about the patient's diet, meals, nutrition, what to eat or avoid, calories or macros, FIRST call get_nutrition_plan with patient_id: {request.patient_id} and answer from that plan. If it returns has_plan=false, tell the patient they don't have a nutrition plan yet (don't invent one).
3. When asked about doctor availability or booking appointments, use the MCP-DocEHR tools
3. BEFORE booking any appointment, ALWAYS confirm: doctor name, date, time, and reason with the user
4. Use tool results to answer - never make up or guess information
5. Be concise and helpful

{retrieval_instructions}

Patient ID for this conversation: {request.patient_id}
"""

    return {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.query},
        ],
        "tools": tools,
        "fastmcp_client": fastmcp_client,
        "mcp_token": mcp_token,
        "conversation_id": conversation_id,
        "conversation_uuid": conversation_uuid,
        "patient_uuid": patient_uuid,
        "hindsight": hindsight,
    }


async def _resolve_with_tools(messages, tools, fastmcp_client, mcp_token, db) -> str:
    """Run the Gemma tool-resolution loop (same as /chat) and return the final
    answer text. Shared by the text and voice endpoints."""
    vertex_client = get_vertex_client()
    MAX_TOOL_ROUNDS = 6
    answer = None
    for _round in range(MAX_TOOL_ROUNDS):
        response = await vertex_client.generate_with_tools(messages, tools)
        message = response.choices[0].message
        if not message.tool_calls:
            answer = message.content
            break
        messages.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": [tc.dict() for tc in message.tool_calls],
        })
        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            try:
                tool_args = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError:
                tool_args = {}
            try:
                tool_result = await fastmcp_client.call_tool(tool_name, tool_args, db, mcp_token=mcp_token)
            except Exception as tool_err:  # noqa: BLE001
                logger.error("Tool %s failed: %s", tool_name, tool_err)
                tool_result = {"error": str(tool_err)}
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result, default=str),
            })
    if answer is None:
        response = await vertex_client.generate_with_tools(messages, tools)
        answer = response.choices[0].message.content or ""
    return answer or ""


async def _translate_chunked(text: str, *, source: str, target: str, limit: int = 900) -> str:
    """Translate a long answer by splitting on blank lines so each piece stays
    under the Sarvam /translate input limit. A chunk that fails to translate is
    kept as-is rather than dropping content."""
    from services.sarvam import client as sarvam
    if not text.strip():
        return text
    chunks: list[str] = []
    cur = ""
    for para in text.split("\n"):
        if cur and len(cur) + len(para) + 1 > limit:
            chunks.append(cur)
            cur = para
        else:
            cur = f"{cur}\n{para}" if cur else para
    if cur:
        chunks.append(cur)
    out: list[str] = []
    for ch in chunks:
        if not ch.strip():
            out.append(ch)
            continue
        try:
            out.append(await sarvam.translate(ch, source=source, target=target))
        except Exception as exc:  # noqa: BLE001
            logger.warning("translate chunk failed, keeping original: %s", exc)
            out.append(ch)
    return "\n".join(out)


@router.post("/voice-query")
async def hermes_voice_query(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    conversation_id: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Voice Ask. Sarvam transcribes the clip in the spoken Indian language,
    the query is translated to English for Gemma, Gemma answers (grounded on the
    patient's data + literature), and the answer is translated back to the spoken
    language. Returns the original transcript and the localized answer."""
    from services.sarvam import client as sarvam

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="No audio received")

    # 1) Speech → text in the spoken language (+ detected language).
    try:
        stt = await sarvam.speech_to_text(
            audio_bytes,
            filename=audio.filename or "query.webm",
            content_type=audio.content_type or "audio/webm",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Sarvam STT failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not transcribe the audio")

    spoken_text = (stt.get("text") or "").strip()
    lang = (stt.get("language_code") or "").strip() or "en-IN"
    if not spoken_text:
        raise HTTPException(status_code=422, detail="Couldn't hear a question in the recording")
    is_english = lang.lower().startswith("en")

    # 2) Translate the question to English for Gemma (skip if already English).
    english_query = spoken_text
    if not is_english:
        try:
            english_query = await sarvam.translate(spoken_text, source=lang, target="en-IN")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Query translate failed, using original text: %s", exc)
            english_query = spoken_text

    # 3) Run the Hermes agent on the English query.
    req = ChatRequest(query=english_query, patient_id=patient_id, conversation_id=conversation_id)
    ctx = await _build_chat_setup(req, user, db)
    answer_en = await _resolve_with_tools(
        ctx["messages"], ctx["tools"], ctx["fastmcp_client"], ctx["mcp_token"], db
    )

    # Persist the English Q/A so history matches the text chat.
    try:
        await store_conversation(db, ctx["conversation_uuid"], user, ctx["patient_uuid"], english_query, answer_en)
        await ctx["hindsight"].update_summary(query=english_query, answer=answer_en, conversation_id=ctx["conversation_uuid"])
    except Exception:  # noqa: BLE001
        logger.exception("voice-query: persist failed")

    # 4) Translate the answer back to the spoken language.
    answer_local = answer_en
    if not is_english and answer_en:
        answer_local = await _translate_chunked(answer_en, source="en-IN", target=lang)

    return {
        "transcript": spoken_text,
        "source_language": lang,
        "answer": answer_local,
        "answer_en": answer_en,
        "conversation_id": ctx["conversation_id"],
    }


@router.post("/chat/stream")
async def chat_with_hermes_stream(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Streaming chat: resolves tool calls, then streams the answer as SSE.
    Events: `data: {"delta": "..."}` per chunk, then `data: {"done": true, ...}`."""
    ctx = await _build_chat_setup(request, user, db)
    messages = ctx["messages"]
    tools = ctx["tools"]
    fastmcp_client = ctx["fastmcp_client"]
    mcp_token = ctx["mcp_token"]
    conversation_id = ctx["conversation_id"]
    conversation_uuid = ctx["conversation_uuid"]
    patient_uuid = ctx["patient_uuid"]
    hindsight = ctx["hindsight"]
    vertex_client = get_vertex_client()

    async def tool_executor(name: str, args_json: str):
        try:
            args = json.loads(args_json or "{}")
        except json.JSONDecodeError:
            args = {}
        try:
            return await fastmcp_client.call_tool(name, args, db, mcp_token=mcp_token)
        except Exception as exc:  # noqa: BLE001
            logger.error("Stream tool %s failed: %s", name, exc)
            return {"error": str(exc)}

    async def event_stream():
        parts: list[str] = []
        try:
            async for delta in vertex_client.stream_tokens(messages, tools, tool_executor):
                parts.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        except Exception as exc:  # noqa: BLE001
            logger.exception("Hermes stream error")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        answer = "".join(parts)
        try:
            await store_conversation(db=db, conversation_id=conversation_uuid, user=user,
                                     patient_id=patient_uuid, query=request.query, answer=answer)
            await hindsight.update_summary(query=request.query, answer=answer,
                                           conversation_id=conversation_uuid)
        except Exception:  # noqa: BLE001
            logger.exception("Hermes stream: post-stream persist failed")
        yield f"data: {json.dumps({'done': True, 'conversation_id': conversation_id})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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

        # Shared setup: auth gate, mcp token, history, tools, system prompt, messages.
        ctx = await _build_chat_setup(request, user, db)
        messages = ctx["messages"]
        tools = ctx["tools"]
        fastmcp_client = ctx["fastmcp_client"]
        mcp_token = ctx["mcp_token"]
        conversation_id = ctx["conversation_id"]
        conversation_uuid = ctx["conversation_uuid"]
        patient_uuid = ctx["patient_uuid"]
        hindsight = ctx["hindsight"]

        # Call Gemma with tools
        vertex_client = get_vertex_client()

        try:
            MAX_TOOL_ROUNDS = 6
            answer = None

            for round_num in range(MAX_TOOL_ROUNDS):
                response = await vertex_client.generate_with_tools(messages, tools)
                message = response.choices[0].message

                if not message.tool_calls:
                    answer = message.content
                    break

                logger.info(
                    f"Round {round_num + 1}: Gemma requested "
                    f"{len(message.tool_calls)} tool call(s): "
                    f"{[tc.function.name for tc in message.tool_calls]}"
                )

                # Append assistant turn with all tool calls for this round
                messages.append({
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [tc.dict() for tc in message.tool_calls],
                })

                # Execute every tool call and append each result
                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    try:
                        tool_args = json.loads(tool_call.function.arguments or "{}")
                    except json.JSONDecodeError:
                        tool_args = {}
                    logger.info(f"Calling tool: {tool_name} args={tool_args}")
                    try:
                        tool_result = await fastmcp_client.call_tool(tool_name, tool_args, db, mcp_token=mcp_token)
                    except Exception as tool_err:
                        # A single tool failure (e.g. an unmatched clinic/doctor name)
                        # must NEVER abort the whole chat with a 500. Hand the error
                        # back to the model so it can recover — typically by asking
                        # the user to choose from the valid names the error lists.
                        logger.error(f"Tool {tool_name} failed: {tool_err}")
                        tool_result = {"error": str(tool_err)}
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(tool_result, default=str),
                    })

            if answer is None:
                # Hit the round cap — do one final call to get a plain answer
                logger.warning("Hit MAX_TOOL_ROUNDS cap, forcing final answer")
                response = await vertex_client.generate_with_tools(messages, tools)
                answer = response.choices[0].message.content or ""

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
