# FastMCP Migration Guide

## 🚀 What is FastMCP?

**FastMCP** is a modern Python framework for building MCP (Model Context Protocol) servers. It's like FastAPI but for MCP tools!

### Why Upgrade?

| Current (Express.js) | FastMCP (Python) |
|---------------------|------------------|
| ❌ JavaScript/Node.js | ✅ Python (same stack as your API) |
| ❌ Manual REST endpoints | ✅ Auto-generated MCP tools |
| ❌ No type validation | ✅ Pydantic models + type safety |
| ❌ Manual docs | ✅ Auto-generated tool descriptions |
| ❌ HTTP only | ✅ HTTP + stdio + SSE transport |
| ❌ Separate codebase | ✅ Integrates with your Python API |

---

## 📋 What Changed

### 1. **Current MCP Server** (Express.js)
**Location:** `mcp-server/server.js`
- Express.js REST API
- Manual endpoint definitions
- Port 3001 (HTTP)

### 2. **New FastMCP Server** (Python)
**Location:** `mcp-server-fastmcp/server.py`
- FastMCP framework
- Decorator-based tool definitions
- Auto type validation with Pydantic
- Same database queries (asyncpg)

---

## 🔧 FastMCP Features

### Tool Definition (Auto-exposed to LLM)
```python
@mcp.tool()
async def get_patient_records(patient_id: str) -> PatientRecords:
    """
    Get complete patient medical records.
    
    Args:
        patient_id: UUID of the patient
        
    Returns:
        Complete patient records bundle
    """
    # Implementation...
```

**Benefits:**
- ✅ LLM can call this tool directly
- ✅ Auto validates patient_id is a string
- ✅ Auto generates tool description
- ✅ Type-safe return values

### Available Tools

1. **`get_patient_info(patient_id)`** - Demographics only
2. **`get_patient_records(patient_id)`** - Complete records (all-in-one)
3. **`get_latest_prescription(patient_id)`** - Most recent Rx
4. **`get_lab_results(patient_id, limit=20)`** - Lab test results
5. **`search_patients(phone?, email?, patient_id?)`** - Search patients

---

## 🔄 Migration Options

### Option A: Replace Current MCP Server (Recommended)

**Steps:**
1. Stop current MCP server
2. Build FastMCP container
3. Update docker-compose
4. Test

**Impact:**
- ✅ Same API endpoints work (backwards compatible)
- ✅ Can still call via HTTP REST
- ✅ Bonus: Can use MCP protocol natively

### Option B: Run Both (for Testing)

**Steps:**
1. Keep current MCP on port 3001
2. Run FastMCP on port 3002
3. Test side-by-side
4. Switch when ready

---

## 🚀 How to Migrate

### Step 1: Build FastMCP Container

Add to `docker-compose.yml`:

```yaml
services:
  # ... existing services ...

  mcp-fastmcp:
    build: ./mcp-server-fastmcp
    container_name: pal-mcp-fastmcp
    environment:
      - POSTGRES_HOST=db
      - POSTGRES_PORT=5432
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
      - PAL_API_KEY=${PAL_API_KEY}
    ports:
      - "3002:3001"  # Run on different port for testing
    depends_on:
      db:
        condition: service_healthy
    networks:
      - pal-network
    restart: unless-stopped
```

### Step 2: Build and Start

```bash
cd c:\PAL
docker-compose up -d --build mcp-fastmcp
```

### Step 3: Test FastMCP

```bash
# Test health
curl http://localhost:3002/health

# Test get_patient_records tool
curl -X POST http://localhost:3002/tools/get_patient_records \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"}'
```

### Step 4: Update API to Use FastMCP (Optional)

Update `.env`:
```env
# Option 1: Use old MCP (port 3001)
MCP_API_URL=http://mcp-api:3001

# Option 2: Use FastMCP (port 3001 after switch)
MCP_API_URL=http://mcp-fastmcp:3001
```

### Step 5: Replace Old MCP (when ready)

1. **Stop old MCP:**
   ```bash
   docker-compose stop mcp-api
   ```

2. **Update docker-compose.yml** - change FastMCP port from 3002 to 3001

3. **Rebuild:**
   ```bash
   docker-compose up -d --build mcp-fastmcp
   ```

4. **Remove old service:**
   ```bash
   docker-compose rm mcp-api
   ```

---

## 🎯 Direct LLM Integration (Future)

FastMCP's **killer feature**: LLMs can call tools directly via MCP protocol!

### Current Flow:
```
User → FastAPI → HTTP → MCP Server → PostgreSQL → FastAPI → LLM
```

### With Native MCP:
```
User → FastAPI → LLM (with MCP tools) → PostgreSQL
```

**LLM can directly:**
- Call `get_patient_records(patient_id)`
- Call `get_lab_results(patient_id)`
- Call `search_patients(phone="...")`

**No HTTP overhead, no manual API calls!**

---

## 🔍 Monitoring FastMCP

### Check Logs:
```bash
docker-compose logs -f mcp-fastmcp
```

### List Available Tools:
```bash
curl http://localhost:3002/tools
```

### Call a Tool:
```bash
curl -X POST http://localhost:3002/tools/get_patient_info \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"}'
```

---

## ✅ Benefits Summary

1. **Same Stack:** Python everywhere (API + MCP + AI)
2. **Type Safety:** Pydantic validation prevents bugs
3. **Auto Docs:** Tools self-document
4. **Future-Proof:** Native MCP protocol support
5. **Better DX:** Decorators > manual endpoints
6. **Integration:** Can import from your FastAPI models

---

## 🚨 Important Notes

- **Backwards Compatible:** FastMCP can serve HTTP REST endpoints
- **No Breaking Changes:** Your FastAPI code doesn't need to change
- **Gradual Migration:** Run both servers during testing
- **Database:** Same PostgreSQL, same queries

---

## Next Steps

1. Review `mcp-server-fastmcp/server.py`
2. Add FastMCP service to docker-compose
3. Build and test on port 3002
4. Compare responses with old MCP
5. Switch when confident
6. (Future) Integrate native MCP protocol with LLM

**Want me to update docker-compose.yml and start the migration?** 🚀
