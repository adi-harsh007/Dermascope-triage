"""FastAPI application entrypoint, middleware, routers, and static mounts."""

from contextlib import asynccontextmanager
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import uvicorn

from . import metrics, ratelimit
from .config import (
    CORS_ORIGINS,
    FRONTEND_DIR,
    IMG_SIZE,
    MAX_UPLOAD_BYTES,
    MODEL_ARCH,
    MODEL_PATH,
    SAMPLES_DIR,
)
from .database import init_db
from .logging_setup import (
    adopt_request_id,
    get_logger,
    reset_request_id,
    set_request_id,
)
from .routers import analyze, history, system

log = get_logger("app")
access_log = get_logger("access")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info("database ready; serving %s at %dpx, decision layer %s",
             MODEL_ARCH, IMG_SIZE,
             "calibrated" if os.path.exists(
                 os.path.join(os.path.dirname(MODEL_PATH), "calibration.json"))
             else "UNCALIBRATED")
    yield
    log.info("shutting down")


app = FastAPI(
    title="DermaScope Triage — Inference API",
    description="EfficientNet-B3 dermoscopic skin lesion triage API",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


@app.middleware("http")
async def guard_request(request, call_next):
    """Reject oversized and over-frequent requests before they cost anything."""
    if request.url.path.startswith("/api/"):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
            metrics.incr("rejected_oversized")
            return JSONResponse(
                status_code=413,
                content={"detail": "Image exceeds the {} MB upload limit.".format(
                    MAX_UPLOAD_BYTES // (1024 * 1024))},
            )

        client = request.client.host if request.client else "unknown"
        allowed, retry_after, limit = ratelimit.check(client, request.url.path)
        if not allowed:
            metrics.incr("rate_limited")
            access_log.warning("rate limit hit: client=%s path=%s limit=%d/min",
                               client, request.url.path, limit)
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
                content={"detail": "Too many requests. Try again in {}s.".format(
                    retry_after)},
            )

    return await call_next(request)


@app.middleware("http")
async def request_context(request, call_next):
    """Tag every request with an id and record status and duration."""
    request_id = adopt_request_id(request.headers.get("x-request-id"))
    token = set_request_id(request_id)
    is_api = request.url.path.startswith("/api/")
    started = time.perf_counter()
    try:
        try:
            response = await call_next(request)
        except Exception:
            elapsed = (time.perf_counter() - started) * 1000
            metrics.incr("requests_unhandled_error")
            access_log.exception("%s %s -> unhandled exception after %.0fms",
                                 request.method, request.url.path, elapsed)
            raise

        elapsed = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        if is_api:
            metrics.incr("requests_total")
            if response.status_code >= 500:
                metrics.incr("requests_5xx")
            elif response.status_code >= 400:
                metrics.incr("requests_4xx")
            access_log.info("%s %s -> %d in %.0fms",
                            request.method, request.url.path,
                            response.status_code, elapsed)
        return response
    finally:
        reset_request_id(token)


@app.middleware("http")
async def no_stale_frontend(request, call_next):
    """Force revalidation of unversioned frontend assets."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/js/") or path.startswith("/css/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.include_router(system.router)
app.include_router(analyze.router)
app.include_router(history.router)

app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/samples", StaticFiles(directory=SAMPLES_DIR), name="samples")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8088, reload=True)
