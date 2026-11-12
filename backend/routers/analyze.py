"""Inference endpoint (/api/analyze) and lazy predictor lifecycle."""

from datetime import datetime, timezone
from io import BytesIO
import os
import threading
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from sqlalchemy.orm import Session

from .. import metrics
from ..config import (
    ALLOWED_EXTENSIONS,
    ANATOMIC_SITES,
    MAX_CONCURRENT_INFERENCE,
    MAX_UPLOAD_BYTES,
    UPLOAD_DIR,
)
from ..database import get_db
from ..logging_setup import get_logger, get_request_id
from ..ml_engine import SkinCancerPredictor
from ..models import DiagnosticSession
from ..security import normalise_case_label
from ..storage import PARTIAL_SUFFIX, new_upload_name, to_stored_path

log = get_logger("analyze")

router = APIRouter(prefix="/api", tags=["Analysis"])

_predictor = None
_predictor_lock = threading.Lock()

# Inference is CPU-bound and single-threaded per call. Without a bound, every
# request that arrives at once gets its own threadpool thread and they all
# contend for the same cores, so latency degrades faster than throughput
# improves. Queueing past this point is preferable to thrashing.
_inference_semaphore = threading.BoundedSemaphore(MAX_CONCURRENT_INFERENCE)


def _discard(path):
    """Remove a file this request owns. Absence is not a failure."""
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        log.warning("could not remove %s: %s", path, e)


def get_predictor():
    """Build the predictor once, even under concurrent cold-start requests.

    Without the lock, two requests arriving before the first load completed
    would each construct a SkinCancerPredictor: the 41 MB checkpoint read twice,
    two sets of Grad-CAM hooks registered, and whichever finished last silently
    winning. The fast path stays lock-free - reading a module global is atomic
    under the GIL, so only the cold start pays for synchronisation.
    """
    global _predictor
    if _predictor is not None:
        return _predictor
    with _predictor_lock:
        if _predictor is None:
            _predictor = SkinCancerPredictor()
    return _predictor


@router.post("/analyze")
def analyze_lesion(
    file: UploadFile = File(...),
    site: str = Form(default=""),
    case_label: str = Form(default="", alias="case"),
    db: Session = Depends(get_db),
):
    """Upload an image and run synchronous EfficientNet-B3 inference.

    Deliberately a plain `def`, not `async def`. The body is CPU-bound and
    blocking - a forward pass plus a Grad-CAM backward pass, hundreds of
    milliseconds to seconds on CPU - and FastAPI runs a sync endpoint in a
    worker thread. Declared `async`, that same work ran directly on the event
    loop and stalled every other request in the process, `/api/health`
    included, for the duration of each scan.

    `site` is the anatomic site chosen in the UI. It is recorded alongside the
    result but does not influence inference: the model takes only the image.
    """
    anatomic_site = site.strip() if site and site.strip() in ANATOMIC_SITES else None
    scan_case_label = normalise_case_label(case_label)

    # The client-supplied extension is never trusted as a path component.
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            detail=f"Invalid file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}.",
        )

    # Sync endpoint: read the underlying spooled file directly rather than
    # awaiting UploadFile.read().
    contents = file.file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            detail=f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
        )

    # Validate by decoding, not by the client-declared content type.
    try:
        Image.open(BytesIO(contents)).verify()
    except Exception:
        raise HTTPException(400, detail="File is not a readable image.")

    # Write to a partial name first and commit it only once the record that owns
    # it exists. Previously the final file was written before inference ran, so a
    # crash in between left it on disk forever with nothing referring to it.
    filename = new_upload_name(ext)
    filepath = os.path.join(UPLOAD_DIR, filename)
    partial_path = filepath + PARTIAL_SUFFIX

    with open(partial_path, "wb") as f:
        f.write(contents)

    committed = False   # partial renamed to its final name
    recorded = False    # a row now owns that file
    try:
        predictor = get_predictor()
        image = Image.open(BytesIO(contents))
        # Time the forward pass and the wait for a slot separately. Measured
        # together, p95 "inference" would climb with queue depth and no longer
        # describe how long the model actually takes.
        queued_at = time.perf_counter()
        with _inference_semaphore:
            started = time.perf_counter()
            result = predictor.predict(image)
            inference_ms = (time.perf_counter() - started) * 1000
        queue_ms = (started - queued_at) * 1000
        metrics.observe_inference_ms(inference_ms)
        metrics.observe_queue_ms(queue_ms)

        if result.get("is_ood"):
            reason = result.get("reason") or "unspecified"
            metrics.incr("ood_rejections_total")
            metrics.incr("ood_rejection_{}".format(reason))
            log.info("scan rejected by the OOD gate: reason=%s inference=%.0fms",
                     reason, inference_ms)
            detail = result.get("detail") or (
                "Image does not appear to be a clinical skin lesion."
            )
            raise HTTPException(
                422,
                detail={
                    "message": "Invalid Scan Detected: " + detail,
                    "reason": result.get("reason"),
                },
            )

        os.replace(partial_path, filepath)
        committed = True

        session = DiagnosticSession(
            image_path=to_stored_path(filepath),
            anatomic_site=anatomic_site,
            case_label=scan_case_label,
            status="completed",
            prediction=result["prediction"],
            confidence=result["confidence"],
            threshold_used=result["threshold"],
            all_scores=result["scores"],
            is_high_risk=result["prediction"] in ["mel", "bcc", "akiec"],
            melanoma_alert=result.get("melanoma_alert", False),
            melanoma_probability=result.get("melanoma_probability"),
            completed_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        recorded = True

        metrics.incr("analyses_completed")
        metrics.incr("prediction_{}".format(result["prediction"]))
        if session.melanoma_alert:
            metrics.incr("melanoma_alerts")
        log.info("scan %d: prediction=%s confidence=%.3f high_risk=%s "
                 "melanoma_alert=%s site=%s inference=%.0fms queue=%.0fms",
                 session.id, result["prediction"], result["confidence"],
                 session.is_high_risk, session.melanoma_alert,
                 anatomic_site or "-", inference_ms, queue_ms)

        return {
            "session_id": session.id,
            "prediction": result["prediction"],
            "confidence": result["confidence"],
            "threshold": result["threshold"],
            "scores": result["scores"],
            "is_high_risk": session.is_high_risk,
            "anatomic_site": session.anatomic_site,
            "case_label": session.case_label,
            "melanoma_alert": session.melanoma_alert,
            "melanoma_probability": session.melanoma_probability,
            "heatmap_base64": result.get("heatmap_base64"),
            "inference_ms": round(inference_ms, 1),
            "queue_ms": round(queue_ms, 1),
            "ood_metrics": result.get("ood_metrics"),
            "ood_calibrated": result.get("ood_calibrated", False),
            "ood_feature_stage_active": result.get("ood_feature_stage_active", False),
            "operating_point": {
                "melanoma_recall": predictor.class_metrics.get("mel", {}).get("recall"),
                "melanoma_precision": predictor.class_metrics.get("mel", {}).get("precision"),
                "thresholds_fitted_on": predictor.thresholds_fitted_on,
            },
        }
    except HTTPException:
        raise
    except Exception:
        reference = get_request_id()
        metrics.incr("analyses_failed")
        log.exception("analyze failed: site=%s file=%s", anatomic_site, filename)
        raise HTTPException(
            500,
            detail=("Analysis failed because of an internal error. "
                    "Quote reference {} when reporting this.".format(reference)),
        )
    finally:
        if not committed:
            _discard(partial_path)
        elif not recorded:
            _discard(filepath)

