"""Service health, model card, observability, and rate-limit tests."""

import json
import logging
import os
import re

import pytest
from PIL import Image

from tests.api_helpers import LESION_SAMPLE, jpeg_bytes, upload


# ── service ──────────────────────────────────────────────────────────────

def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_health_reports_real_configuration(client):
    """Health must describe the actual serving config, not a hardcoded string."""
    from backend.config import IMG_SIZE, MODEL_ARCH

    model = client.get("/api/health").json()["model"]
    assert model["architecture"] == MODEL_ARCH
    assert model["input_size"] == IMG_SIZE
    assert "loaded" in model and isinstance(model["loaded"], bool)


def test_health_does_not_force_model_load(client):
    """A health check must not pull the checkpoint into memory."""
    import backend.routers.analyze as analyze

    before = analyze._predictor
    client.get("/api/health")
    assert analyze._predictor is before


def test_index_and_samples_are_served(client):
    assert client.get("/").status_code == 200
    assert client.get("/samples/" + LESION_SAMPLE).status_code == 200


def test_favicon_is_no_content(client):
    """Previously returned index.html as image/x-icon."""
    assert client.get("/favicon.ico").status_code == 204


def test_health_reports_the_decision_rule_in_force(client):
    """The decision layer must be inspectable without running a scan."""
    body = client.get("/api/health").json()

    decision = body["decision_layer"]
    assert decision["calibration_loaded"] is True
    assert decision["readout"] in {"softmax", "sigmoid"}
    assert decision["temperature"] > 0
    assert "decision_layer_uncalibrated" not in body["degraded"]


def test_health_reports_ood_gate_state(client):
    """An unfitted OOD gate must be visible, not implied to be working."""
    body = client.get("/api/health").json()

    ood = body["ood_gate"]
    assert set(ood) == {"thresholds_fitted", "feature_stage_fitted"}
    if not ood["feature_stage_fitted"]:
        assert "ood_feature_stage_inactive" in body["degraded"]


def test_inference_threads_do_not_oversubscribe_the_cpu(client):
    """Concurrent scans must not each claim a full-width torch thread pool."""
    import torch

    body = client.get("/api/health").json()["concurrency"]
    total = body["max_concurrent_inference"] * torch.get_num_threads()
    assert torch.get_num_threads() == body["torch_num_threads"]
    assert total <= (os.cpu_count() or 2)


def test_health_reports_which_hardening_is_active(client):
    hardening = client.get("/api/health").json()["hardening"]
    assert hardening["max_upload_mb"] >= 1
    assert hardening["history_requires_token"] is False
    assert "rate_limit_per_minute" in hardening
    assert "upload_retention_days" in hardening


# ── observability ────────────────────────────────────────────────────────

def test_every_response_carries_a_request_id(client):
    response = client.get("/api/health")
    assert re.fullmatch(r"[0-9a-f]{12}", response.headers["X-Request-ID"])


def test_a_caller_supplied_request_id_is_echoed(client):
    """Lets a caller correlate its logs with ours."""
    response = client.get("/api/health", headers={"X-Request-ID": "caller-abc_123"})
    assert response.headers["X-Request-ID"] == "caller-abc_123"


def test_an_unsafe_request_id_is_replaced_not_echoed(client):
    """The id lands in every log line, so it is untrusted input."""
    injected = "abc\nFAKE LOG LINE"
    response = client.get("/api/health", headers={"X-Request-ID": injected})
    returned = response.headers["X-Request-ID"]
    assert returned != injected
    assert re.fullmatch(r"[0-9a-f]{12}", returned)


def test_log_records_carry_the_request_id(client, caplog):
    """Every record, from any module, must be attributable to a request."""
    with caplog.at_level(logging.INFO, logger="dermascan"):
        response = client.get("/api/health")

    request_id = response.headers["X-Request-ID"]
    access = [r for r in caplog.records if r.name == "dermascan.access"]
    assert access, caplog.text
    assert access[0].request_id == request_id


@pytest.mark.requires_model
def test_metrics_report_inference_latency_and_outcomes(client, lesion):
    from backend import metrics as metrics_module

    metrics_module.reset()
    client.post("/api/analyze", files={"file": ("lesion.jpg", lesion, "image/jpeg")})

    body = client.get("/api/metrics").json()
    assert body["counters"]["analyses_completed"] == 1
    assert body["inference_ms"]["count"] == 1
    assert body["inference_ms"]["p50"] > 0
    assert any(k.startswith("prediction_") for k in body["counters"])


@pytest.mark.requires_model
def test_metrics_count_ood_rejections_by_reason(client):
    from backend import metrics as metrics_module

    metrics_module.reset()
    flat = Image.new("RGB", (300, 300), (128, 128, 128))
    response = upload(client, "flat.jpg", jpeg_bytes(flat))
    assert response.status_code == 422

    counters = client.get("/api/metrics").json()["counters"]
    assert counters["ood_rejections_total"] == 1
    assert counters["ood_rejection_uniform_field"] == 1


# ── hardening ────────────────────────────────────────────────────────────

def test_oversized_upload_is_refused_before_the_body_is_parsed(client):
    """Content-Length is checked in middleware, before Starlette spools the body."""
    from backend.config import MAX_UPLOAD_BYTES

    response = client.post(
        "/api/analyze",
        headers={"Content-Length": str(MAX_UPLOAD_BYTES + 1),
                 "Content-Type": "application/octet-stream"},
        content=b"x" * 16,
    )
    assert response.status_code == 413


def test_rate_limit_rejects_a_flood_with_retry_after(client, monkeypatch):
    from backend import ratelimit

    monkeypatch.setattr(ratelimit, "RATE_LIMIT_PER_MINUTE", 3)
    ratelimit.reset()

    codes = [client.get("/api/health").status_code for _ in range(5)]
    assert codes[:3] == [200, 200, 200]
    assert codes[3:] == [429, 429]

    blocked = client.get("/api/health")
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0


def test_inference_has_its_own_tighter_budget(client, monkeypatch):
    """Polling history freely must not buy the right to queue hundreds of scans."""
    from backend import ratelimit

    monkeypatch.setattr(ratelimit, "RATE_LIMIT_PER_MINUTE", 100)
    monkeypatch.setattr(ratelimit, "ANALYZE_RATE_LIMIT_PER_MINUTE", 1)
    ratelimit.reset()

    assert upload(client, "a.jpg", b"not an image").status_code == 400
    assert upload(client, "b.jpg", b"not an image").status_code == 429
    assert client.get("/api/health").status_code == 200


# ── model card ───────────────────────────────────────────────────────────

def test_model_card_reports_the_serving_configuration(client):
    """Readable without a checkpoint: it reads files, it does not load the model."""
    body = client.get("/api/model").json()

    assert body["backbone"] == "EfficientNet-B3"
    assert body["classes"] == ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    assert body["thresholds"] is not None, "thresholds ship with the repo"
    assert set(body["thresholds"]) == set(body["classes"])
    assert "readout" in body["decision_layer"]
    assert body["checkpoint"]["loaded"] is False or body["checkpoint"]["present"]


def test_model_card_reports_whether_thresholds_can_be_traced(client):
    p = client.get("/api/model").json()["threshold_provenance"]

    assert p["readable"] is True
    assert isinstance(p["produced_by_pipeline"], bool)
    assert isinstance(p["missing_fields"], list)
    if p["produced_by_pipeline"]:
        assert p["reported_on"] and p["reported_on"] != p["fitted_on"]
        assert p["splits_shown_separate"] is True
    else:
        assert p["missing_fields"], "not from the pipeline, yet nothing missing?"
        assert p["splits_shown_separate"] is False


def test_threshold_provenance_detects_a_file_from_the_pipeline(tmp_path):
    from backend.ml_engine import threshold_provenance

    good = tmp_path / "class_thresholds.json"
    good.write_text(json.dumps({
        "fitted_on": "/data/calib", "reported_on": "/data/test",
        "readout": "softmax", "rule": "argmax(probability - threshold)",
        "objective": "macro_f1", "class_thresholds": {"mel": 0.0},
        "test_metrics": {"accuracy": 0.8, "macro_f1": 0.7},
        "per_class_metrics": {"mel": {"threshold": 0.0, "f1": 0.6, "recall": 0.8}},
    }), encoding="utf-8")

    p = threshold_provenance(str(good))
    assert p["produced_by_pipeline"] is True
    assert p["missing_fields"] == []
    assert p["splits_shown_separate"] is True

    same = tmp_path / "same.json"
    same.write_text(json.dumps({
        "fitted_on": "/data/test", "reported_on": "/data/test",
        "rule": "r", "objective": "o", "test_metrics": {},
    }), encoding="utf-8")
    assert threshold_provenance(str(same))["splits_shown_separate"] is False

    assert threshold_provenance(str(tmp_path / "absent.json"))["readable"] is False


def test_model_card_reports_the_ood_gate_state(client):
    gate = client.get("/api/model").json()["ood_gate"]
    assert set(gate) == {"thresholds_fitted", "feature_stage_fitted"}
    assert all(isinstance(v, bool) for v in gate.values())


def test_model_card_says_whether_the_evaluation_matches_what_is_served(client):
    body = client.get("/api/model").json()

    if not body["evaluation_available"]:
        pytest.skip("no evaluation artifact in this checkout")

    assert body["evaluation_describes_this_configuration"] is True, (
        "the shipped evaluation should have been measured under the shipped "
        f"thresholds; mismatches: {body['evaluation_threshold_mismatches']}")
    assert body["evaluation_threshold_mismatches"] == []


def test_model_card_flags_an_evaluation_measured_under_other_thresholds(client,
                                                                       monkeypatch,
                                                                       tmp_path):
    import backend.routers.system as system

    check = json.loads(open(system.SERVING_CHECK_PATH, encoding="utf-8").read())
    check["thresholds"]["mel"] = 0.99
    drifted = tmp_path / "drifted.json"
    drifted.write_text(json.dumps(check), encoding="utf-8")
    monkeypatch.setattr(system, "SERVING_CHECK_PATH", str(drifted))

    body = client.get("/api/model").json()
    assert body["evaluation_describes_this_configuration"] is False
    mismatch = [m for m in body["evaluation_threshold_mismatches"] if m["class"] == "mel"]
    assert mismatch and mismatch[0]["evaluated_with"] == 0.99


def test_model_card_degrades_when_the_evaluation_is_absent(client, monkeypatch,
                                                           tmp_path):
    import backend.routers.system as system

    monkeypatch.setattr(system, "EVALUATION_PATH", str(tmp_path / "nope.json"))
    monkeypatch.setattr(system, "SERVING_CHECK_PATH", str(tmp_path / "nope2.json"))

    body = client.get("/api/model").json()
    assert body["evaluation_available"] is False
    assert body["evaluation"] is None
    assert body["evaluation_describes_this_configuration"] is None
    assert body["thresholds"] is not None


def test_confusion_matrix_axes_are_in_the_order_the_api_declares(client):
    body = client.get("/api/model").json()
    if not body["evaluation_available"]:
        pytest.skip("no evaluation artifact in this checkout")

    classes = body["classes"]
    matrix = body["evaluation"]["confusion_matrix"]
    per_class = body["evaluation"]["per_class"]

    assert len(matrix) == len(classes)
    for i, cls in enumerate(classes):
        row_total = sum(matrix[i])
        assert row_total == per_class[cls]["support"], (
            f"row {i} sums to {row_total}, but {cls} has support "
            f"{per_class[cls]['support']} - the axes are not in this order")
        assert matrix[i][i] / row_total == pytest.approx(per_class[cls]["recall"])

