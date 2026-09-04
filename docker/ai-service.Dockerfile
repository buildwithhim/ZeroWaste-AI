# ZeroWaste AI -- Python prediction and invoice extraction service
#
# Separated from the backend image because the two have almost nothing in
# common. scikit-learn, pandas and pdfplumber pull in a large native
# dependency tree; carrying that inside the Node image made it several times
# larger, coupled the two release cycles, and meant a change to a route
# rebuilt the machine-learning stack.

FROM python:3.12.8-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
# Built in a separate stage so the compilers needed to build wheels do not end
# up in the runtime image. A C toolchain in a production container is a
# meaningful part of what an attacker with code execution would otherwise have
# to bring themselves.
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
COPY ai-service/requirements.txt ./requirements-service.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install -r requirements.txt -r requirements-service.txt

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --shell /usr/sbin/nologin zerowaste

COPY --from=deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY --chown=zerowaste:zerowaste ai-service/app.py ./app.py

# The prediction and extraction logic itself. Copied from backend/ rather than
# duplicated, so there is exactly one implementation: the backend's spawn path
# and this service run the same code, which is what makes the two transports
# interchangeable rather than merely similar.
COPY --chown=zerowaste:zerowaste backend/predict.py ./predict.py
COPY --chown=zerowaste:zerowaste backend/parse_invoices.py ./parse_invoices.py

# predict.py loads model.pkl and both encoders at import. They are mounted at
# runtime rather than baked in: a model is retrained on its own schedule, and
# rebuilding and redeploying the service to ship one would tie a data change to
# a code release.
ENV ZEROWASTE_DATA_DIR=/var/lib/zerowaste \
    MODEL_SOURCE_DIR=/app \
    PORT=8000
RUN mkdir -p /var/lib/zerowaste && chown zerowaste:zerowaste /var/lib/zerowaste

USER zerowaste
EXPOSE 8000

# Liveness, not readiness -- readiness reports the model load, and a failed
# model load is not fixed by restarting into the same missing file.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/health/live', timeout=4).status==200 else 1)"

# tini reaps zombies and forwards signals, so uvicorn's graceful shutdown
# actually receives the SIGTERM the orchestrator sends.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "app.py"]
