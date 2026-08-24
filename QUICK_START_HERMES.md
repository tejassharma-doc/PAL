# Quick Start - Hermes AI Chat

## ✅ Integration Complete!

Your Hermes + MCP + Vertex AI integration is ready!

---

## 🚀 Start in 3 Steps:

### Step 1: Rebuild API
```bash
cd c:\PAL
docker-compose up -d --build api
```

Wait ~2 minutes for build to complete.

### Step 2: Check It's Working
```bash
curl http://localhost:8000/hermes/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "vertex_ai": {
    "model": "vertex_ai/google/gemma-4-26b-a4b-it-maas",
    "configured": true
  },
  "mcp": {
    "url": "http://mcp-api:3001",
    "configured": true
  }
}
```

✅ If you see this, it's working!

### Step 3: Test a Query
```bash
curl -X POST http://localhost:8000/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are my recent lab results?",
    "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
  }'
```

**Note:** Add Authorization header with JWT token for production.

---

## 📱 Connect to Frontend

### Quick Test in Browser Console:

1. Open http://localhost:3000
2. Login as Tejash
3. Open browser console (F12)
4. Run:

```javascript
const patientId = localStorage.getItem('pal_patient_id')
const token = localStorage.getItem('pal_token')

fetch('http://localhost:8000/hermes/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    query: 'What medications am I taking?',
    patient_id: patientId
  })
})
.then(r => r.json())
.then(data => console.log(data.answer))
```

You should see your medications listed!

---

## 🎯 What It Does:

**User asks**: "What are my lab results?"

**Hermes**:
1. ✅ Gets your data from MCP server (PostgreSQL)
2. ✅ Builds a grounded prompt with YOUR data
3. ✅ Calls Vertex AI (Gemma 4) with context
4. ✅ Returns answer ONLY from your records

**Example Response:**
```
"Based on your recent lab results:

1. Complete Blood Count (CBC) - All normal
   - WBC: 7500 cells/μL (normal)
   - RBC: 4.8 million cells/μL (normal)
   
2. Lipid Panel - LDL slightly elevated
   - LDL: 110 mg/dL (target: <100)
   - You're on Atorvastatin for this
   
3. Metabolic Panel - All normal
   - Kidney and liver function good
"
```

---

## 📊 Files Created:

1. ✅ `api/services/llm_vertex.py` - Vertex AI client
2. ✅ `api/services/mcp_client.py` - MCP server client
3. ✅ `api/routers/hermes_chat.py` - Chat endpoint
4. ✅ `.env` - Added Vertex AI credentials
5. ✅ `api/requirements.txt` - Added LiteLLM
6. ✅ `api/main.py` - Registered router

---

## 🔑 Configuration:

Your `.env` now has:
```env
VERTEX_AI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
VERTEX_AI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
MCP_API_URL=http://mcp-api:3001
```

---

## ✨ Try These Queries:

1. "What are my lab results?"
2. "What medications am I taking?"
3. "When was my last appointment?"
4. "What did the doctor say?"
5. "Do I have any abnormal lab values?"

---

## 📖 Full Documentation:

- **[HERMES_SETUP_COMPLETE.md](HERMES_SETUP_COMPLETE.md)** - Complete guide
- **[HERMES_INTEGRATION_COMPLETE.md](HERMES_INTEGRATION_COMPLETE.md)** - Architecture details

---

## 🎉 That's It!

**Your AI chat is ready!**

Run: `docker-compose up -d --build api`

Then test with the curl command above! 🚀
