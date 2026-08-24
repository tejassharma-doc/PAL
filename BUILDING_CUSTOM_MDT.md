# Building Custom MDT Container

## Status: IN PROGRESS 🔄

Building a custom Medical Data Toolkit container with the correct Gemini Flash model.

---

## What We're Doing

### 1. Cloned Official Google Health MDT
```bash
✅ git clone https://github.com/Google-Health/medical-data-toolkit
```

### 2. Modified Configuration
**File**: `mdt-source/src/config.yaml`

**Changed:**
```yaml
# OLD (doesn't exist yet)
classifier_llm_client:
  model: "gemini-3.1-flash-lite-preview"
extractor_llm_client:
  model: "gemini-3-flash-preview"

# NEW (stable, available now)
classifier_llm_client:
  model: "gemini-1.5-flash"
extractor_llm_client:
  model: "gemini-1.5-flash"
```

### 3. Building Docker Image
```bash
🔄 docker build -t medical-data-toolkit-custom:latest .
```

**This will take 5-10 minutes...**

The build process:
1. Downloads Python 3.12 base image
2. Installs nginx
3. Installs Python dependencies
4. Copies source code
5. Compiles Python to `.pyc`
6. Runs unit tests
7. Creates non-root user
8. Finalizes image

---

## Configuration Details

### Models Being Used:
- **Classifier**: `gemini-1.5-flash` - Identifies document type (lab report, etc.)
- **Extractor**: `gemini-1.5-flash` - Extracts patient name, lab values, LOINC codes

### API Key:
- Environment variable: `GEMINI_API_KEY`
- Your key: `AIzaSyDUd-lkQq4A25xWTkuXT8HoIKBZtYi-Uyo`

### Other Settings:
```yaml
max_pdf_pages: 40
supported_types:
  - "LABORATORY_REPORT"
document_standardization_policy: ACCEPT_ALL
```

---

## Next Steps (After Build Completes)

### 1. Update docker-compose.yml
```yaml
mdt:
  image: medical-data-toolkit-custom:latest  # ← Use custom image
  container_name: pal-mdt
  environment:
    GEMINI_API_KEY: "AIzaSyDUd-lkQq4A25xWTkuXT8HoIKBZtYi-Uyo"
  ports:
    - "8080:8080"
  volumes:
    - ./loinc-kb-minimal:/data:ro
  # Use default entrypoint from image
```

### 2. Update .env
```bash
MDT_ENABLED=true  # ← Re-enable MDT
```

### 3. Restart Services
```bash
docker-compose up -d mdt
docker restart pal-api-v2
```

### 4. Test Upload
Upload a lab report PDF and verify extraction works!

---

## Build Progress

Check build status:
```bash
# List all background tasks
/tasks

# Or check Docker images
docker images | grep medical-data-toolkit
```

---

## Troubleshooting

### If Build Fails:

**Issue: Tests fail during build**
```bash
# Build without tests
docker build --target builder -t medical-data-toolkit-custom:latest .
```

**Issue: Network timeout**
```bash
# Retry the build
cd c:/PAL/mdt-source
docker build -t medical-data-toolkit-custom:latest .
```

**Issue: Out of disk space**
```bash
# Clean up old images
docker system prune -a
```

---

## Verification

After build completes, verify:

```bash
# 1. Image exists
docker images medical-data-toolkit-custom

# 2. Run test container
docker run --rm -e GEMINI_API_KEY="AIzaSyDUd-lkQq4A25xWTkuXT8HoIKBZtYi-Uyo" \
  -p 8080:8080 medical-data-toolkit-custom:latest

# 3. Test endpoint (in another terminal)
curl -X POST --data-binary @sample.pdf http://localhost:8080/document_to_fhir
```

---

## Timeline

- **Clone repo**: ✅ Complete (30 seconds)
- **Modify config**: ✅ Complete (5 seconds)
- **Docker build**: 🔄 In progress (~5-10 minutes)
- **Update compose**: ⏳ Waiting
- **Test extraction**: ⏳ Waiting

---

**Started**: 2024-07-27 18:22  
**Status**: Building...  
**ETA**: ~5-10 minutes
