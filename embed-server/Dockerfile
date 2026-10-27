# CPU-only EmbeddingGemma service. No CUDA — installs the CPU build of torch.
FROM python:3.11-slim

WORKDIR /app
ENV PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=4 \
    HF_HOME=/cache \
    PYTHONUNBUFFERED=1

# CPU wheel of torch first (smaller, no CUDA), then the rest.
COPY requirements.txt .
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

COPY app.py .

EXPOSE 8080

# Allow up to 5 min for the first run (model download + load) before marking healthy.
# Check for HTTP 200 (the app only serves once the model is loaded) rather than
# matching JSON text, since Starlette emits compact JSON without spaces.
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/health').status==200 else 1)"

# IMPORTANT: one worker only — each worker loads its own ~3 GB model copy.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
