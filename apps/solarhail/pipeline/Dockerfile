FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libeccodes-dev \
    libgeos-dev \
    libproj-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

ENV PYTHONPATH=/app

ENTRYPOINT ["python", "-m", "src.main"]
