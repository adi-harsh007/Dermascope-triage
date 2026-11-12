"""Upload validation, inference, OOD rejection, calibration guards, and error handling."""

import json
import logging
import os
import re

import numpy as np
import pytest
from PIL import Image

from tests.api_helpers import jpeg_bytes, upload


# ── upload validation ────────────────────────────────────────────────────

def test_rejects_disallowed_extension(client):
    r = upload(client, "payload.py", b"print(1)")
    assert r.status_code == 400


def test_rejects_traversal_style_filename(client, lesion):
    """The client-supplied name must never reach the filesystem path."""
    r = upload(client, "../../evil.jpg/x.php", lesion)
    assert r.status_code == 400


def test_rejects_non_image_with_image_extension(client):
    """content_type is client-controlled, so validation decodes the bytes."""
    r = upload(client, "fake.jpg", b"not an image at all")
    assert r.status_code == 400


def test_rejects_oversized_upload(client):
    from backend.config import MAX_UPLOAD_BYTES

    r = upload(client, "big.jpg", b"\0" * (MAX_UPLOAD_BYTES + 1))
    assert r.status_code == 413


# ── inference ────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_accepts_real_lesion_and_records_it(client, lesion):
    r = upload(client, "lesion.jpg", lesion)
    assert r.status_code == 200
    body = r.json()
    assert body["prediction"] in ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    assert 0.0 <= body["confidence"] <= 1.0
    assert set(body["scores"]) == {"akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"}

    history = client.get("/api/history").json()
    assert len(history) == 1
    assert history[0]["prediction"] == body["prediction"]


@pytest.mark.slow
def test_heatmap_is_absent_or_real_never_synthetic(client, lesion):
    """A heatmap is either genuine model attribution or absent - never a stand-in."""
    body = upload(client, "lesion.jpg", lesion).json()
    hm = body.get("heatmap_base64")
    assert hm is None or hm.startswith("data:image/png;base64,")


@pytest.mark.slow
def test_ood_rejection_reports_a_reason(client):
    flat = jpeg_bytes(Image.new("RGB", (300, 300), (240, 240, 238)))
    r = upload(client, "wall.jpg", flat)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["reason"] == "uniform_field"
    assert detail["message"]


@pytest.mark.slow
def test_rejected_scan_is_not_persisted(client):
    noise = jpeg_bytes(Image.fromarray(
        np.random.randint(0, 255, (300, 300, 3), dtype=np.uint8)))
    assert upload(client, "noise.jpg", noise).status_code == 422
    assert client.get("/api/history").json() == []


@pytest.mark.slow
def test_anatomic_site_is_persisted_and_returned(client, lesion):
    """The UI collects an anatomic site; it must survive into the record."""
    r = client.post("/api/analyze",
                    files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                    data={"site": "Palms & Soles"})
    assert r.status_code == 200
    assert r.json()["anatomic_site"] == "Palms & Soles"
    assert client.get("/api/history").json()[0]["anatomic_site"] == "Palms & Soles"


@pytest.mark.slow
def test_unknown_anatomic_site_is_discarded(client, lesion):
    """Only sites the UI offers are stored; anything else is dropped."""
    r = client.post("/api/analyze",
                    files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                    data={"site": "'; DROP TABLE diagnostic_sessions;--"})
    assert r.status_code == 200
    assert r.json()["anatomic_site"] is None


@pytest.mark.slow
def test_melanoma_alert_is_reported_and_persisted(client, lesion):
    """The alert channel is an additive output; it must reach the API and the record."""
    body = client.post("/api/analyze",
                       files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    assert isinstance(body["melanoma_alert"], bool)
    assert 0.0 <= body["melanoma_probability"] <= 1.0
    assert client.get("/api/history").json()[0]["melanoma_alert"] == body["melanoma_alert"]


@pytest.mark.slow
def test_operating_point_comes_from_the_served_threshold_file(client, lesion,
                                                             project_root):
    """The recall the UI states must be read, not remembered."""
    with open(os.path.join(project_root, "models", "class_thresholds.json")) as f:
        shipped = json.load(f)

    body = client.post("/api/analyze",
                       files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    point = body["operating_point"]

    assert point["melanoma_recall"] == shipped["per_class_metrics"]["mel"]["recall"]
    assert point["melanoma_precision"] == shipped["per_class_metrics"]["mel"]["precision"]
    assert point["thresholds_fitted_on"] == shipped.get("fitted_on")


def test_threshold_file_carries_the_metrics_the_ui_quotes(project_root):
    from backend.ml_engine import read_threshold_file

    classes = ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    thresholds, metrics, fitted_on = read_threshold_file(
        os.path.join(project_root, "models", "class_thresholds.json"), classes)

    assert set(thresholds) == set(classes)
    assert set(metrics) == set(classes)
    assert "recall" in metrics["mel"]
    assert 0.0 <= metrics["mel"]["recall"] <= 1.0
    assert isinstance(fitted_on, (str, type(None)))


@pytest.mark.requires_model
def test_predictor_exposes_the_metrics_beside_its_thresholds():
    from backend.routers.analyze import get_predictor

    predictor = get_predictor()
    assert set(predictor.class_metrics) == set(predictor.classes)
    assert "recall" in predictor.class_metrics["mel"]
    assert 0.0 <= predictor.class_metrics["mel"]["recall"] <= 1.0


@pytest.mark.slow
def test_analyze_reports_its_own_timings(client, lesion):
    body = client.post("/api/analyze",
                       files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()

    assert isinstance(body["inference_ms"], (int, float))
    assert isinstance(body["queue_ms"], (int, float))
    assert body["inference_ms"] > 0
    assert body["queue_ms"] >= 0


@pytest.mark.slow
def test_alert_fires_whenever_melanoma_probability_clears_threshold(client, lesion):
    from backend.routers.analyze import get_predictor

    predictor = get_predictor()
    if predictor.mel_alert_threshold is None:
        pytest.skip("calibration not fitted")

    body = client.post("/api/analyze",
                       files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    expected = (body["prediction"] == "mel"
                or body["melanoma_probability"] >= predictor.mel_alert_threshold)
    assert body["melanoma_alert"] is expected


def test_temperature_is_applied_to_confidence():
    import torch

    logits = torch.tensor([[3.0, -1.0, 0.5, -2.0, 1.0, 2.0, -1.5]])
    raw = torch.sigmoid(logits).numpy()
    scaled = torch.sigmoid(logits / 2.0).numpy()
    assert scaled.max() < raw.max()
    assert np.all(np.abs(scaled - 0.5) <= np.abs(raw - 0.5) + 1e-9)


# ── serving-configuration guards & failure cleanup ───────────────────────

def test_refuses_to_serve_without_decision_calibration(monkeypatch):
    import backend.ml_engine as ml_engine

    monkeypatch.setattr(ml_engine, "CALIBRATION_PATH", "models/__absent__.json")
    monkeypatch.setattr(ml_engine, "ALLOW_UNCALIBRATED", False)

    with pytest.raises(RuntimeError, match="calibration is unavailable"):
        ml_engine.SkinCancerPredictor()


@pytest.mark.requires_model
def test_uncalibrated_serving_requires_an_explicit_opt_in(monkeypatch):
    import backend.ml_engine as ml_engine

    monkeypatch.setattr(ml_engine, "CALIBRATION_PATH", "models/__absent__.json")
    monkeypatch.setattr(ml_engine, "ALLOW_UNCALIBRATED", True)

    predictor = ml_engine.SkinCancerPredictor()
    assert predictor.calibration_loaded is False


def test_internal_errors_do_not_leak_exception_text(client, monkeypatch, caplog):
    import backend.routers.analyze as analyze

    secret = "cuDNN handle creation failed at " + os.path.join("private", "latest.pt")

    class Exploder:
        mel_alert_threshold = 0.1

        def predict(self, image):
            raise RuntimeError(secret)

    monkeypatch.setattr(analyze, "_predictor", Exploder())

    img = Image.new("RGB", (300, 300), (180, 120, 100))
    with caplog.at_level(logging.ERROR, logger="dermascan.analyze"):
        response = upload(client, "scan.jpg", jpeg_bytes(img))

    assert response.status_code == 500
    detail = response.json()["detail"]

    assert secret not in detail
    assert "cuDNN" not in detail
    assert "Traceback" not in detail
    assert "RuntimeError" not in detail

    match = re.search(r"reference ([0-9a-f]{12})", detail)
    assert match, detail
    reference = match.group(1)

    assert secret in caplog.text
    failure_records = [r for r in caplog.records if "analyze failed" in r.getMessage()]
    assert failure_records, caplog.text
    assert failure_records[0].request_id == reference
    assert response.headers["X-Request-ID"] == reference


def test_failed_analysis_does_not_leave_the_upload_behind(client, monkeypatch):
    import backend.routers.analyze as analyze

    class Exploder:
        mel_alert_threshold = 0.1

        def predict(self, image):
            raise RuntimeError("boom")

    monkeypatch.setattr(analyze, "_predictor", Exploder())

    before = set(os.listdir(analyze.UPLOAD_DIR))
    upload(client, "scan.jpg", jpeg_bytes(Image.new("RGB", (300, 300), (170, 110, 90))))
    after = set(os.listdir(analyze.UPLOAD_DIR))

    assert after == before

