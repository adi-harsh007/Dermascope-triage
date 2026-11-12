"""Health, model card, and process metrics endpoints."""

import json
import os

from fastapi import APIRouter, Request

from .. import metrics
from ..config import (
    ANALYZE_RATE_LIMIT_PER_MINUTE,
    EVALUATION_PATH,
    IMG_SIZE,
    MAX_CONCURRENT_INFERENCE,
    MAX_UPLOAD_BYTES,
    MODEL_ARCH,
    MODEL_PATH,
    RATE_LIMIT_PER_MINUTE,
    REQUIRE_HISTORY_TOKEN,
    SERVING_CHECK_PATH,
    THRESHOLD_PATH,
    TORCH_NUM_THREADS,
    UPLOAD_RETENTION_DAYS,
)
from ..logging_setup import get_logger
from ..ml_engine import decision_config, read_threshold_file, threshold_provenance
from ..ood import OOD_CONFIG_PATH, OOD_STATS_PATH
from . import analyze

log = get_logger("system")

router = APIRouter(prefix="/api", tags=["System"])


def _read_json(path):
    """Optional artifact. Absent or unreadable is a reportable state, not a crash."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _serving_check_thresholds(check):
    """The thresholds the recorded evaluation was measured under."""
    if not isinstance(check, dict):
        return None
    thresholds = check.get("thresholds")
    return thresholds if isinstance(thresholds, dict) else None


@router.get("/health")
def health_check(request: Request):
    """Reports the actual serving configuration without loading the checkpoint."""
    decision = decision_config()
    ood = {
        "thresholds_fitted": os.path.exists(OOD_CONFIG_PATH),
        "feature_stage_fitted": os.path.exists(OOD_STATS_PATH),
    }

    degraded = []
    if not decision["calibration_loaded"]:
        degraded.append("decision_layer_uncalibrated")
    if not ood["thresholds_fitted"]:
        degraded.append("ood_thresholds_provisional")
    if not ood["feature_stage_fitted"]:
        degraded.append("ood_feature_stage_inactive")
    if not os.path.exists(MODEL_PATH):
        degraded.append("checkpoint_missing")

    return {
        "status": "ok",
        "version": request.app.version,
        "degraded": degraded,
        "model": {
            "architecture": MODEL_ARCH,
            "checkpoint": os.path.basename(MODEL_PATH),
            "checkpoint_present": os.path.exists(MODEL_PATH),
            "thresholds_present": os.path.exists(THRESHOLD_PATH),
            "input_size": IMG_SIZE,
            "loaded": analyze._predictor is not None,
        },
        "decision_layer": decision,
        "ood_gate": ood,
        "concurrency": {
            "max_concurrent_inference": MAX_CONCURRENT_INFERENCE,
            "torch_num_threads": TORCH_NUM_THREADS,
        },
        "hardening": {
            "rate_limit_per_minute": RATE_LIMIT_PER_MINUTE,
            "analyze_rate_limit_per_minute": ANALYZE_RATE_LIMIT_PER_MINUTE,
            "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
            "history_requires_token": REQUIRE_HISTORY_TOKEN,
            "delete_endpoints_enabled": bool(os.getenv("ADMIN_TOKEN")),
            "upload_retention_days": UPLOAD_RETENTION_DAYS or None,
        },
    }


@router.get("/model")
def model_card():
    """What this deployment is serving, and what it measured."""
    classes = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]

    thresholds = None
    threshold_metrics = None
    thresholds_fitted_on = None
    try:
        thresholds, threshold_metrics, thresholds_fitted_on = read_threshold_file(
            THRESHOLD_PATH, classes)
    except Exception as e:
        log.warning("model card: thresholds unreadable at %s: %s", THRESHOLD_PATH, e)

    evaluation = _read_json(EVALUATION_PATH)
    check = _read_json(SERVING_CHECK_PATH)

    recorded_thresholds = _serving_check_thresholds(check)
    threshold_mismatches = []
    describes_this_configuration = None
    if thresholds and recorded_thresholds:
        for cls in classes:
            live = thresholds.get(cls)
            recorded = recorded_thresholds.get(cls)
            if live is None or recorded is None or abs(float(live) - float(recorded)) > 1e-9:
                threshold_mismatches.append({
                    "class": cls, "serving": live, "evaluated_with": recorded,
                })
        describes_this_configuration = not threshold_mismatches

    return {
        "architecture": MODEL_ARCH,
        "backbone": "EfficientNet-B3",
        "input_size": IMG_SIZE,
        "classes": classes,
        "dataset": "HAM10000",
        "checkpoint": {
            "name": os.path.basename(MODEL_PATH),
            "present": os.path.exists(MODEL_PATH),
            "loaded": analyze._predictor is not None,
        },
        "decision_layer": decision_config(),
        "thresholds": thresholds,
        "threshold_metrics": threshold_metrics,
        "thresholds_fitted_on": thresholds_fitted_on,
        "threshold_provenance": threshold_provenance(THRESHOLD_PATH),
        "ood_gate": {
            "thresholds_fitted": os.path.exists(OOD_CONFIG_PATH),
            "feature_stage_fitted": os.path.exists(OOD_STATS_PATH),
        },
        "evaluation": evaluation,
        "evaluation_available": evaluation is not None,
        "evaluation_describes_this_configuration": describes_this_configuration,
        "evaluation_threshold_mismatches": threshold_mismatches,
    }


@router.get("/metrics")
def metrics_endpoint():
    """Counters and inference latency for this process."""
    return metrics.snapshot()

