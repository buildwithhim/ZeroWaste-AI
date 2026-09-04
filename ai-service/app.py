"""HTTP front door for the Python side of ZeroWaste AI.

WHY THIS EXISTS
---------------
Prediction and invoice extraction were reached by spawning a Python process per
request: `spawn(python, ["predict.py", ...])` from three places in the backend.
That works on a laptop and is the wrong shape for a deployment.

  * Every call pays the interpreter start-up cost plus a joblib load of the
    model and both encoders -- roughly a second of wall clock for a query the
    model itself answers in microseconds. Rendering one admin dashboard does it
    several times over.

  * It couples the two runtimes into one container. A Node image that must also
    carry Python, scikit-learn, pandas and pdfplumber is several times larger,
    is rebuilt whenever either side changes, and cannot be scaled or rolled back
    independently.

  * It made the interpreter path a deployment detail spread across modules, each
    defaulting to a Windows `.venv\\Scripts\\python.exe` that does not exist in a
    Linux container.

Loading the model once at start-up and answering over HTTP fixes all three. The
backend keeps its spawn path (see backend/lib/operations/predictor.js) so
development and the test suite are unchanged; production sets AI_SERVICE_URL and
takes this route instead.

WHAT THIS SERVICE IS NOT
------------------------
It has no authentication and must not be exposed publicly. It answers only to
the backend, on a private network. That is a deployment constraint, and
docs/DEPLOYMENT.md states it as one; a service that will happily tell any caller
what the cafeteria should cook is a smaller problem than one that lets a caller
influence it, and `/extract` accepts uploaded bytes.
"""

import base64
import binascii
import json
import logging
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# predict.py and parse_invoices.py are the existing, tested implementations.
# They are imported rather than reimplemented so there is exactly one copy of
# the prediction and extraction logic; the Dockerfile copies them in alongside
# this module.
MODEL_SOURCE_DIR = os.environ.get("MODEL_SOURCE_DIR") or str(Path(__file__).resolve().parent)
if MODEL_SOURCE_DIR not in sys.path:
    sys.path.insert(0, MODEL_SOURCE_DIR)

SERVICE_NAME = os.environ.get("SERVICE_NAME", "zerowaste-ai-service")
APP_VERSION = os.environ.get("APP_VERSION") or os.environ.get("GIT_SHA") or "dev"
MAX_EXTRACT_BYTES = int(os.environ.get("MAX_EXTRACT_BYTES", 10 * 1024 * 1024))
MAX_EXTRACT_FILES = int(os.environ.get("MAX_EXTRACT_FILES", 200))


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line, matching the backend's logger.

    Two services writing differently shaped logs into the same aggregator means
    a request cannot be followed across the boundary without a per-service
    parser. The field names here mirror backend/lib/logger.js deliberately.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "service": SERVICE_NAME,
            "version": APP_VERSION,
            "msg": record.getMessage(),
        }
        if isinstance(getattr(record, "detail", None), dict):
            payload.update(record.detail)
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging() -> logging.Logger:
    handler = logging.StreamHandler(sys.stdout)
    if os.environ.get("LOG_FORMAT", "json") == "json":
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-5s %(message)s"))

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.environ.get("LOG_LEVEL", "info").upper())
    return logging.getLogger(SERVICE_NAME)


log = configure_logging()

# Populated at start-up. Held in a dict rather than as globals so the readiness
# probe can distinguish "still loading" from "failed to load".
state: Dict[str, Any] = {"predict": None, "parse": None, "ready": False, "error": None, "started_at": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Loads the model once, at start-up rather than per request.

    A failure here leaves the service running but not ready, so an orchestrator
    holds traffic off it and reports the reason, instead of the container
    crash-looping with the cause buried in a restart log.
    """
    state["started_at"] = time.time()
    try:
        import predict as predict_module

        state["predict"] = predict_module
        log.info("prediction model loaded", extra={"detail": {"dataDir": predict_module.DATA_DIR}})
    except Exception as error:  # noqa: BLE001 - reported through readiness
        state["error"] = f"prediction model failed to load: {error}"
        log.error("prediction model failed to load", exc_info=True)

    try:
        import parse_invoices as parse_module

        state["parse"] = parse_module
    except Exception as error:  # noqa: BLE001 - reported through readiness
        state["error"] = f"{state['error'] or ''} invoice extractor failed to load: {error}".strip()
        log.error("invoice extractor failed to load", exc_info=True)

    state["ready"] = state["predict"] is not None and state["parse"] is not None
    yield
    log.info("shutting down")


app = FastAPI(
    title="ZeroWaste AI service",
    version=APP_VERSION,
    lifespan=lifespan,
    # No interactive docs in production: this service is internal, and an
    # OpenAPI page is a map of it for anyone who reaches the network it is on.
    docs_url=None if os.environ.get("NODE_ENV") == "production" else "/docs",
    redoc_url=None,
    openapi_url=None if os.environ.get("NODE_ENV") == "production" else "/openapi.json",
)


class PredictionRequest(BaseModel):
    weekday: str = Field(default="Friday", max_length=32)
    menu: str = Field(default="Biryani", max_length=128)


class BatchPredictionRequest(BaseModel):
    requests: List[PredictionRequest] = Field(default_factory=list, max_length=200)


class ExtractFile(BaseModel):
    id: str = Field(max_length=128)
    # Base64 rather than a path: the backend holds uploads in memory and the two
    # services do not share a filesystem. Sending the path would have worked
    # only while they were the same process.
    contentBase64: str


class ExtractRequest(BaseModel):
    files: List[ExtractFile] = Field(default_factory=list)


@app.get("/health/live")
def live() -> Dict[str, Any]:
    """The process is up. Deliberately checks nothing else.

    A liveness probe that fails when a dependency is down causes the
    orchestrator to restart a healthy container, which never fixes a dependency
    and turns a partial outage into a crash loop.
    """
    return {"status": "ok", "service": SERVICE_NAME, "version": APP_VERSION}


@app.get("/health/ready")
def ready() -> JSONResponse:
    """The model is loaded and the service can answer. Gates traffic."""
    body = {
        "status": "ok" if state["ready"] else "unavailable",
        "service": SERVICE_NAME,
        "version": APP_VERSION,
        "checks": [
            {"name": "prediction-model", "status": "ok" if state["predict"] else "error"},
            {"name": "invoice-extractor", "status": "ok" if state["parse"] else "error"},
        ],
        "uptimeSeconds": round(time.time() - state["started_at"], 3) if state["started_at"] else 0,
    }
    if state["error"]:
        body["detail"] = state["error"]
    return JSONResponse(body, status_code=200 if state["ready"] else 503)


def require_predictor():
    if not state["predict"]:
        raise HTTPException(status_code=503, detail=state["error"] or "Prediction model is not loaded")
    return state["predict"]


@app.post("/predict")
def predict(request: PredictionRequest) -> Dict[str, Any]:
    """One forecast. Mirrors `predict.py <weekday> <menu>`."""
    module = require_predictor()
    return module.predict_one(request.weekday, request.menu)


@app.post("/predict/batch")
def predict_batch(request: BatchPredictionRequest) -> Dict[str, Any]:
    """Many forecasts from the one loaded model. Mirrors `predict.py --batch`.

    The planner needs a forecast per menu family on the board, which is what
    made the per-process spawn expensive enough to matter.
    """
    module = require_predictor()
    predictions = [module.predict_one(item.weekday, item.menu) for item in request.requests]
    return {"predictions": predictions}


@app.post("/extract")
def extract(request: ExtractRequest) -> Dict[str, Any]:
    """Reads SmartQ invoice PDFs. Mirrors `parse_invoices.py` over stdin.

    Bytes are written to a private temp directory because pdfplumber needs a
    real path, and the directory is removed whether or not extraction succeeds.
    Nothing untrusted is kept.
    """
    if not state["parse"]:
        raise HTTPException(status_code=503, detail=state["error"] or "Invoice extractor is not loaded")

    if len(request.files) > MAX_EXTRACT_FILES:
        raise HTTPException(status_code=413, detail=f"At most {MAX_EXTRACT_FILES} files per request")

    results: List[Dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="zerowaste-extract-") as workdir:
        for entry in request.files:
            try:
                payload = base64.b64decode(entry.contentBase64, validate=True)
            except (binascii.Error, ValueError):
                results.append({"id": entry.id, "ok": False, "code": "UNREADABLE_PDF", "message": "Payload is not valid base64"})
                continue

            if not payload:
                results.append({"id": entry.id, "ok": False, "code": "EMPTY_FILE", "message": "File is empty"})
                continue

            if len(payload) > MAX_EXTRACT_BYTES:
                results.append({"id": entry.id, "ok": False, "code": "TOO_LARGE", "message": "File exceeds the maximum invoice size"})
                continue

            # The id is a content hash chosen by the backend, but this service
            # does not get to assume that: the name is derived from the index so
            # a hostile id can never influence a path.
            target = Path(workdir) / f"{len(results):06d}.pdf"
            target.write_bytes(payload)

            outcome = state["parse"].extract(str(target))
            outcome["id"] = entry.id
            results.append(outcome)

    return {"results": results}


def main() -> None:
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", 8000)),
        log_config=None,
        # Uvicorn finishes in-flight requests before exiting on SIGTERM. The
        # window has to be shorter than the orchestrator's termination grace
        # period, or the container is killed mid-request anyway.
        timeout_graceful_shutdown=int(os.environ.get("SHUTDOWN_GRACE_SECONDS", 15)),
    )


if __name__ == "__main__":
    main()
