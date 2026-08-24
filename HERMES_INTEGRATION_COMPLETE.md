# Complete Hermes + Hindsight + MCP Integration Guide

## 🎯 Summary

I understand you want to:
1. Use Vertex AI (Gemma 4) with your API key
2. Connect Hermes Agent to answer questions
3. Use Hindsight for memory/context
4. Query patient data via MCP server
5. Integrate with the "Ask" tab in frontend

## ⚠️ Important Notes

### About Your API Key Format

Your API key format suggests you're using **LiteLLM** or a proxy service:
```
api_key="sk-8cxtPKSUF-ENMMTD7pTnKg"
model="vertex_ai/google/gemma-4-26b-a4b-it-maas"
```

This is NOT a standard Vertex AI key format. Standard Vertex AI uses:
- Service Account JSON
- Project ID
- Region

**Question**: Are you using:
1. **LiteLLM Proxy** (https://litellm.ai)?
2. **OpenRouter** (https://openrouter.ai)?
3. **Custom API Gateway**?

The model path `vertex_ai/google/gemma-4-26b-a4b-it-maas` suggests LiteLLM format.

## 🏗️ Simplified Architecture

Given the complexity, here's a **practical approach** using existing PAL infrastructure:

```
┌────────────────────────────────────┐
│     Frontend (Ask Tab)             │
└──────────────┬─────────────────────┘
               │
               │ POST /api/conversations
               ▼
┌────────────────────────────────────┐
│   Existing FastAPI Backend         │
│   (Already has conversation API)   │
├────────────────────────────────────┤
│  1. Get patient context (Hindsight)│
│  2. Query MCP for patient data     │
│  3. Call LLM (Vertex AI via proxy) │
│  4. Return grounded answer         │
└──────────┬──────────────┬──────────┘
           │              │
           ▼              ▼
   ┌──────────────┐  ┌──────────────┐
   │  Hindsight   │  │  MCP Client  │
   │  (Existing)  │  │    (New)     │
   └──────────────┘  └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │ PostgreSQL   │
                     │   Database   │
                     └──────────────┘
```

## 📝 What I'll Build For You

### Option 1: Minimal Integration (Recommended)

**Extend existing PAL FastAPI backend:**

1. **Add LiteLLM client** to use your Vertex AI key
2. **Add MCP client** to query patient data
3. **Update conversation endpoint** to use MCP + Hindsight
4. **Frontend connects** to existing `/api/conversations`

**Files to create/modify:**
- `api/services/llm_vertex.py` (Vertex AI client)
- `api/services/mcp_client.py` (MCP server client)
- `api/routers/conversations.py` (Update existing)
- `.env` (Add your API key)

**Time**: ~30 minutes
**Complexity**: Low
**Uses**: Existing infrastructure

### Option 2: Separate Hermes Service (Complex)

**Create dedicated Hermes Chat service:**

1. **New FastAPI service** (Port 8001)
2. **Hermes Agent** implementation
3. **Hindsight integration**
4. **MCP client**
5. **Docker service**

**Files to create:**
- `hermes-chat/main.py`
- `hermes-chat/hermes_agent.py`
- `hermes-chat/mcp_client.py`
- `hermes-chat/llm_client.py`
- Update `docker-compose.yml`

**Time**: ~2 hours
**Complexity**: High
**Uses**: New microservice

## 🚀 **Recommendation: Option 1**

Let me implement **Option 1** because:
- ✅ Uses existing PAL infrastructure
- ✅ Hindsight already integrated
- ✅ Conversation API already exists
- ✅ Faster to implement
- ✅ Less complexity
- ✅ Same functionality

## 🔧 Implementation Plan (Option 1)

### Step 1: Add Vertex AI Client

**File**: `api/services/llm_vertex.py`
```python
from litellm import completion
import os

class VertexAIClient:
    def __init__(self):
        self.api_key = os.getenv("VERTEX_AI_API_KEY")
        self.model = os.getenv("VERTEX_AI_MODEL", "vertex_ai/google/gemma-4-26b-a4b-it-maas")
    
    async def generate(self, messages: list[dict]) -> str:
        response = completion(
            model=self.model,
            messages=messages,
            api_key=self.api_key,
            temperature=0.7,
            max_tokens=1000
        )
        return response.choices[0].message.content
```

### Step 2: Add MCP Client

**File**: `api/services/mcp_client.py`
```python
import httpx
import os

class MCPClient:
    def __init__(self):
        self.base_url = os.getenv("MCP_API_URL", "http://mcp-api:3001")
        self.api_key = os.getenv("PAL_API_KEY")
    
    async def get_patient_records(self, patient_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/v1/patients/{patient_id}/records",
                headers={"X-API-Key": self.api_key}
            )
            return response.json()
```

### Step 3: Update Conversation Endpoint

**File**: `api/routers/conversations.py`
```python
from services.llm_vertex import VertexAIClient
from services.mcp_client import MCPClient
from services.hindsight import hindsight

@router.post("/query")
async def chat_with_hermes(
    query: str,
    patient_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # 1. Get context from Hindsight
    context = await hindsight.recall(query=query, patient_id=patient_id)
    
    # 2. Get patient data from MCP
    mcp = MCPClient()
    patient_data = await mcp.get_patient_records(patient_id)
    
    # 3. Build grounded prompt
    messages = [
        {
            "role": "system",
            "content": f\"\"\"You are a medical assistant. Answer ONLY using the patient data provided.
            
Patient Data:
- Name: {patient_data['patient']['full_name']}
- Recent Labs: {json.dumps(patient_data['labTests'][:3])}
- Prescriptions: {json.dumps(patient_data['prescriptions'][:2])}
- Recent Appointments: {json.dumps(patient_data['appointments'][:3])}

Previous Context: {context}

If the question cannot be answered from this data, say "I don't have that information in your records."
\"\"\"
        },
        {
            "role": "user",
            "content": query
        }
    ]
    
    # 4. Call Vertex AI
    vertex = VertexAIClient()
    answer = await vertex.generate(messages)
    
    # 5. Store in Hindsight
    await hindsight.retain(
        query=query,
        answer=answer,
        patient_id=patient_id
    )
    
    return {"answer": answer}
```

### Step 4: Update .env

**File**: `.env`
```env
# Add these lines:
VERTEX_AI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
VERTEX_AI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
MCP_API_URL=http://mcp-api:3001
```

### Step 5: Update Frontend

**File**: `web/app/page.tsx` (Ask tab)
```typescript
async function askQuestion(query: string) {
  const patientId = localStorage.getItem('pal_patient_id')
  const token = localStorage.getItem('pal_token')
  
  const response = await fetch('/api/conversations/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      patient_id: patientId
    })
  })
  
  const data = await response.json()
  return data.answer
}
```

## ✅ What This Achieves

1. ✅ **Uses your Vertex AI key** via LiteLLM
2. ✅ **Connects to MCP server** for patient data
3. ✅ **Uses Hindsight** for conversation memory
4. ✅ **Grounded answers** only from patient records
5. ✅ **Integrates with Ask tab**
6. ✅ **No new services** to manage

## 🎯 Decision Point

**Would you like me to:**

**A) Implement Option 1** (Extend existing PAL backend)
- Quick, simple, uses existing infrastructure
- I'll create all the files above
- Ready in ~20 minutes

**B) Implement Option 2** (Separate Hermes service)
- More complex, dedicated microservice
- Follows original Hermes Agent architecture
- Takes ~1-2 hours

**C) Clarify your API setup first**
- Confirm if you're using LiteLLM/OpenRouter
- Get correct API endpoint
- Then implement

**Please choose A, B, or C and I'll proceed!** 🚀

---

## 📚 Additional Context

### About Hermes Agent
The Nous Research Hermes Agent is a **framework** for building agentic systems, not a direct drop-in solution. It provides:
- Tool calling patterns
- Multi-step reasoning
- Function execution

For PAL, we can adopt its **patterns** without needing the full repo.

### About Hindsight
PAL already has Hindsight integrated (`api/services/hindsight/`). We just need to:
- Enable it in `.env`
- Use it in conversation flow
- That's it!

### About MCP Server
Your MCP server (Port 3001) already provides all patient data via REST API. We just need a simple HTTP client to query it.

**This is actually simpler than it sounds!** Let me know which option you prefer. 👍
