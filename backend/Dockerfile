# Reuses local python:3.11-slim (same base as ontology_hkex-demo)
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TEMPLATES_DIR=/app/templates \
    DATA_DIR=/app/data \
    SKILLS_VENDOR_DIR=/app/skills/vendor \
    SKILLS_PLAYBOOKS_DIR=/app/skills/playbooks

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /app/templates /app/data/contracts /app/skills/vendor /app/skills/playbooks

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
