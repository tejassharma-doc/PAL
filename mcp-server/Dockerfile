FROM python:3.12-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py .
COPY webhook_helper.py .
COPY webhook_processor.py .
COPY clinical_output_processor.py .
COPY models_minimal.py .

EXPOSE 3001

CMD ["python", "main.py"]
