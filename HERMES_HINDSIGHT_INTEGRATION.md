# Hermes Agent + Hindsight + MCP Integration Plan

## 🎯 Goal

Create a RAG-based chat system where:
- Frontend "Ask" tab → Hermes Agent
- Hermes Agent → Queries patient data via MCP Server
- Hindsight → Provides memory and context
- Vertex AI (Gemma 4) → LLM backend
- Answers only from relevant patient data

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (Ask Tab)                   │
│                    http://localhost:3000                 │
└─────────────────┬───────────────────────────────────────┘
                  │
                  │ POST /api/chat
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Hermes Chat API (New)                       │
│                   Port 8001                              │
├─────────────────────────────────────────────────────────┤
│  • Receives user query                                   │
│  • Uses Hindsight for context retrieval                  │
│  • Queries MCP server for patient data                   │
│  • Calls Vertex AI (Gemma 4) with context               │
│  • Returns grounded answer                               │
└─────────────┬───────────────────────────────────────────┘
              │
              ├─────────────┐
              │             │
              ▼             ▼
    ┌─────────────┐  ┌──────────────┐
    │  Hindsight  │  │  MCP Server  │
    │   Memory    │  │  Port 3001   │
    │   Engine    │  │              │
    └──────┬──────┘  └──────┬───────┘
           │                │
           │                ▼
           │         ┌─────────────┐
           │         │ PostgreSQL  │
           │         │  Database   │
           └────────>└─────────────┘
                     
                           │
                           ▼
                    ┌──────────────┐
                    │  Vertex AI   │
                    │  (Gemma 4)   │
                    └──────────────┘
```

## 📦 Components to Build

### 1. Hermes Chat API Service (New)
- **Location**: `c:\PAL\hermes-chat\`
- **Tech**: FastAPI (Python)
- **Port**: 8001
- **Purpose**: Main orchestration service

### 2. Hindsight Integration (Existing, needs update)
- **Location**: `api/services/hindsight/`
- **Purpose**: RAG memory and context retrieval

### 3. MCP Client (New)
- **Location**: `hermes-chat/mcp_client.py`
- **Purpose**: Query patient data from MCP server

### 4. Vertex AI Client (New)
- **Location**: `hermes-chat/llm_client.py`
- **Purpose**: Connect to Gemma 4 via Vertex AI

### 5. Frontend Integration (Update existing)
- **Location**: `web/app/page.tsx`
- **Purpose**: Connect Ask tab to Hermes Chat API

## 🔧 Implementation Steps

### Phase 1: Setup Hermes Chat Service

**File Structure:**
```
c:\PAL\hermes-chat\
├── main.py              # FastAPI app
├── mcp_client.py        # MCP server client
├── llm_client.py        # Vertex AI client
├── hermes_agent.py      # Hermes agent logic
├── requirements.txt     # Python dependencies
├── Dockerfile          # Container config
└── .env                # Configuration
```

### Phase 2: Configure Vertex AI

**API Key Setup:**
```env
# In c:\PAL\.env
VERTEX_AI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
VERTEX_AI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
VERTEX_AI_ENDPOINT=https://api.vertexai.google.com/v1
```

### Phase 3: MCP Integration

**Connect to existing MCP server:**
```python
# hermes-chat/mcp_client.py
class MCPClient:
    def __init__(self):
        self.base_url = "http://mcp-api:3001"
        self.api_key = os.getenv("PAL_API_KEY")
    
    async def get_patient_data(self, patient_id: str):
        # Get complete records from MCP
        url = f"{self.base_url}/api/v1/patients/{patient_id}/records"
        headers = {"X-API-Key": self.api_key}
        response = await httpx.get(url, headers=headers)
        return response.json()
```

### Phase 4: Hindsight RAG

**Use existing Hindsight:**
```python
# Use api/services/hindsight/hindsight.py
from services.hindsight import Hindsight

hindsight = Hindsight()
context = await hindsight.recall(query=user_query, patient_id=patient_id)
```

### Phase 5: Hermes Agent Logic

**Main agent flow:**
```python
async def process_query(user_query: str, patient_id: str):
    # 1. Get context from Hindsight
    context = await hindsight.recall(query=user_query, patient_id=patient_id)
    
    # 2. Get patient data from MCP
    patient_data = await mcp_client.get_patient_data(patient_id)
    
    # 3. Build prompt with grounding
    prompt = build_grounded_prompt(
        query=user_query,
        context=context,
        patient_data=patient_data
    )
    
    # 4. Call Vertex AI
    answer = await vertex_ai_client.generate(prompt)
    
    # 5. Store in Hindsight
    await hindsight.retain(query=user_query, answer=answer)
    
    return answer
```

## 🚀 Quick Start Commands

### 1. Install Dependencies
```bash
cd c:\PAL\hermes-chat
pip install -r requirements.txt
```

### 2. Start Services
```bash
# Update docker-compose.yml to include hermes-chat
docker-compose up -d
```

### 3. Test Endpoint
```bash
curl -X POST http://localhost:8001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are my recent lab results?",
    "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
  }'
```

## 📝 Configuration Files

### docker-compose.yml (Add service)
```yaml
hermes-chat:
  build: ./hermes-chat
  container_name: pal-hermes-chat
  ports:
    - "8001:8001"
  environment:
    - VERTEX_AI_API_KEY=${VERTEX_AI_API_KEY}
    - VERTEX_AI_MODEL=${VERTEX_AI_MODEL}
    - PAL_API_KEY=${PAL_API_KEY}
    - MCP_API_URL=http://mcp-api:3001
    - DATABASE_URL=${DATABASE_URL}
  depends_on:
    - db
    - mcp-api
```

### .env (Add keys)
```env
# Vertex AI Configuration
VERTEX_AI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
VERTEX_AI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
```

## 🔌 Frontend Integration

### Update Ask Tab
```typescript
// web/app/page.tsx
async function askHermes(query: string) {
  const patientId = localStorage.getItem('pal_patient_id')
  
  const response = await fetch('/api/hermes/chat', {
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

## 🎯 Key Features

1. **Grounded Answers**: Only from patient data in database
2. **Memory**: Hindsight remembers conversation context
3. **Real Data**: MCP server provides actual patient records
4. **Vertex AI**: Uses your Gemma 4 model
5. **Secure**: API key authentication on all services

## 📊 Data Flow Example

**User asks**: "What are my recent lab results?"

1. **Frontend** → POST to `/api/hermes/chat`
2. **Hermes Chat API** → Queries Hindsight for context
3. **Hindsight** → Returns previous lab-related conversations
4. **Hermes Chat API** → Queries MCP for lab tests
5. **MCP Server** → Returns actual lab data from PostgreSQL
6. **Hermes Chat API** → Builds prompt with grounding:
   ```
   Context: Patient previously asked about cholesterol on 2026-07-20
   Data: Latest lab shows LDL 110 mg/dL (elevated)
   Query: What are my recent lab results?
   
   Answer ONLY from the provided data...
   ```
7. **Vertex AI (Gemma 4)** → Generates grounded answer
8. **Hermes Chat API** → Returns answer to frontend
9. **Hindsight** → Stores Q&A for future context

## ✅ Next Steps

Would you like me to:
1. Create the complete Hermes Chat service code?
2. Update docker-compose.yml to include it?
3. Integrate with the existing Ask tab?
4. Setup Vertex AI client with your API key?

**This will be a complete, production-ready integration!** 🚀

Let me know and I'll build it!
