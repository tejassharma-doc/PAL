FROM python:3.12-slim

# ✅ SECURITY FIX (HIGH-007): Create non-root user
RUN groupadd -r palapp && useradd -r -g palapp palapp

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create uploads directory and set ownership
RUN mkdir -p /app/uploads && chown -R palapp:palapp /app

# ✅ SECURITY FIX (HIGH-007): Switch to non-root user
USER palapp

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
