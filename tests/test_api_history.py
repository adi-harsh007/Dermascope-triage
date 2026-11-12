"""History, stored image retrieval, case labels, admin guards, and schema migration."""

import io
import os
import sqlite3

import pytest
from PIL import Image

from tests.api_helpers import upload


# ── admin guard ──────────────────────────────────────────────────────────

def test_delete_all_requires_token(client):
    assert client.delete("/api/history/all").status_code == 401


def test_delete_one_requires_token(client):
    assert client.delete("/api/history/1").status_code == 401


def test_delete_rejects_wrong_token(client):
    r = client.delete("/api/history/all", headers={"X-Admin-Token": "wrong"})
    assert r.status_code == 401


@pytest.mark.slow
def test_single_delete_works_with_token(client, lesion, admin_headers):
    session_id = upload(client, "lesion.jpg", lesion).json()["session_id"]
    assert client.delete(f"/api/history/{session_id}").status_code == 401
    r = client.delete(f"/api/history/{session_id}", headers=admin_headers)
    assert r.status_code == 200
    assert client.get("/api/history").json() == []


def test_delete_disabled_when_no_token_configured(client, monkeypatch):
    import backend.security as security

    monkeypatch.setattr(security, "ADMIN_TOKEN", None)
    r = client.delete("/api/history/1", headers={"X-Admin-Token": "anything"})
    assert r.status_code == 403
    assert "disabled" in r.json()["detail"].lower()


@pytest.mark.slow
def test_delete_all_with_token_removes_rows_and_files(client, lesion, admin_headers):
    upload(client, "lesion.jpg", lesion)
    assert len(client.get("/api/history").json()) == 1

    r = client.delete("/api/history/all", headers=admin_headers)
    assert r.status_code == 200
    assert client.get("/api/history").json() == []


# ── database migration ───────────────────────────────────────────────────

def test_migration_adds_missing_columns(tmp_path):
    """A database created before the column existed must be migrated, not broken."""
    db = tmp_path / "legacy.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE diagnostic_sessions ("
                "id INTEGER PRIMARY KEY, image_path VARCHAR(500) NOT NULL)")
    con.commit()
    con.close()

    from sqlalchemy import create_engine, inspect
    import backend.database as database

    original = database.engine
    database.engine = create_engine(f"sqlite:///{db}",
                                    connect_args={"check_same_thread": False})
    try:
        database._add_missing_columns()
        cols = {c["name"] for c in inspect(database.engine).get_columns("diagnostic_sessions")}
        assert "anatomic_site" in cols
        database._add_missing_columns()
    finally:
        database.engine.dispose()
        database.engine = original


# ── history & record retrieval ───────────────────────────────────────────

def test_history_limit_is_bounded(client):
    assert client.get("/api/history?limit=0").status_code == 422
    assert client.get("/api/history?limit=500").status_code == 422


@pytest.mark.slow
def test_history_detail_carries_everything_the_comparison_shows(client, lesion):
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                          data={"site": "Anterior Torso"}).json()

    body = client.get(f"/api/history/{created['session_id']}").json()

    for field in ("id", "prediction", "confidence", "scores", "is_high_risk",
                  "anatomic_site", "melanoma_alert", "melanoma_probability",
                  "threshold_used", "created_at", "has_image"):
        assert field in body, f"{field} missing from the history detail payload"

    assert body["id"] == created["session_id"]
    assert body["prediction"] == created["prediction"]
    assert set(body["scores"]) == set(created["scores"])
    assert body["has_image"] is True


@pytest.mark.slow
def test_history_list_and_detail_agree(client, lesion):
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    row = next(r for r in client.get("/api/history").json()
               if r["id"] == created["session_id"])
    assert client.get(f"/api/history/{created['session_id']}").json() == row


@pytest.mark.slow
def test_has_image_agrees_with_the_image_endpoint(client, lesion):
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    sid = created["session_id"]

    assert client.get(f"/api/history/{sid}").json()["has_image"] is True
    assert client.get(f"/api/history/{sid}/image").status_code == 200

    from backend.models import DiagnosticSession
    from backend.database import SessionLocal
    from backend.storage import resolve_stored_path

    db = SessionLocal()
    try:
        stored = db.query(DiagnosticSession).filter_by(id=sid).first().image_path
    finally:
        db.close()
    os.remove(resolve_stored_path(stored))

    assert client.get(f"/api/history/{sid}").json()["has_image"] is False
    assert client.get(f"/api/history/{sid}/image").status_code == 404


def test_history_detail_404s_for_an_unknown_id(client):
    assert client.get("/api/history/99999999").status_code == 404


@pytest.mark.slow
def test_history_image_serves_the_stored_upload(client, lesion):
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()

    r = client.get(f"/api/history/{created['session_id']}/image")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")
    Image.open(io.BytesIO(r.content)).verify()


def test_history_image_404s_for_an_unknown_id(client):
    assert client.get("/api/history/99999999/image").status_code == 404


@pytest.mark.slow
def test_history_image_reports_a_missing_file_as_404(client, lesion, monkeypatch):
    import backend.routers.history as history_router

    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    monkeypatch.setattr(history_router, "resolve_stored_path", lambda stored: None)

    r = client.get(f"/api/history/{created['session_id']}/image")
    assert r.status_code == 404
    assert "no longer stored" in r.json()["detail"]


def test_history_read_guard_is_off_by_default(client):
    from backend.config import REQUIRE_HISTORY_TOKEN

    assert REQUIRE_HISTORY_TOKEN is False
    assert client.get("/api/history").status_code == 200


def test_history_can_be_put_behind_the_admin_token(client, monkeypatch, admin_headers):
    import backend.security as security

    monkeypatch.setattr(security, "REQUIRE_HISTORY_TOKEN", True)
    assert client.get("/api/history").status_code == 401
    assert client.get("/api/history", headers=admin_headers).status_code == 200


@pytest.mark.slow
def test_record_endpoints_honour_the_history_read_guard(client, lesion,
                                                        monkeypatch, admin_headers):
    import backend.security as security

    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    session_id = created["session_id"]

    monkeypatch.setattr(security, "REQUIRE_HISTORY_TOKEN", True)
    assert client.get(f"/api/history/{session_id}").status_code == 401
    assert client.get(f"/api/history/{session_id}/image").status_code == 401
    assert client.get(f"/api/history/{session_id}",
                      headers=admin_headers).status_code == 200
    assert client.get(f"/api/history/{session_id}/image",
                      headers=admin_headers).status_code == 200


# ── case labels ──────────────────────────────────────────────────────────

def test_case_label_is_normalised_not_validated():
    from backend.security import normalise_case_label
    from backend.config import CASE_LABEL_MAX_LENGTH

    assert normalise_case_label("  Left  shoulder   mole  ") == "Left shoulder mole"
    assert normalise_case_label("") is None
    assert normalise_case_label("   ") is None
    assert normalise_case_label(None) is None
    assert normalise_case_label("A  B") == normalise_case_label("A B")
    assert len(normalise_case_label("x" * 500)) == CASE_LABEL_MAX_LENGTH


@pytest.mark.slow
def test_case_label_is_recorded_with_the_scan(client, lesion):
    body = client.post("/api/analyze",
                       files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                       data={"site": "Anterior Torso",
                             "case": "  Left  shoulder mole "}).json()

    assert body["case_label"] == "Left shoulder mole"
    assert client.get(f"/api/history/{body['session_id']}").json()["case_label"] \
        == "Left shoulder mole"


@pytest.mark.slow
def test_case_label_can_be_set_changed_and_cleared_afterwards(client, lesion):
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()
    sid = created["session_id"]
    assert created["case_label"] is None

    assert client.patch(f"/api/history/{sid}",
                        json={"case_label": "Right calf"}).json()["case_label"] == "Right calf"
    assert client.patch(f"/api/history/{sid}",
                        json={"case_label": None}).json()["case_label"] is None
    assert client.patch(f"/api/history/{sid}",
                        json={"case_label": "  spaced   out "}).json()["case_label"] == "spaced out"


def test_case_label_patch_404s_for_an_unknown_id(client):
    assert client.patch("/api/history/99999999",
                        json={"case_label": "x"}).status_code == 404


@pytest.mark.slow
def test_cases_aggregate_the_scans_filed_under_each_label(client, lesion):
    ids = []
    for _ in range(2):
        ids.append(client.post(
            "/api/analyze", files={"file": ("lesion.jpg", lesion, "image/jpeg")},
            data={"case": "Shoulder A"}).json()["session_id"])
    client.post("/api/analyze", files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                data={"case": "Shoulder B"})

    cases = {c["case_label"]: c for c in client.get("/api/cases").json()}
    assert cases["Shoulder A"]["scan_count"] == 2
    assert cases["Shoulder B"]["scan_count"] == 1
    assert cases["Shoulder A"]["first_scan"] <= cases["Shoulder A"]["latest_scan"]

    client.patch(f"/api/history/{ids[0]}", json={"case_label": None})
    client.patch(f"/api/history/{ids[1]}", json={"case_label": None})
    assert "Shoulder A" not in {c["case_label"] for c in client.get("/api/cases").json()}


@pytest.mark.slow
def test_case_label_is_stored_verbatim_and_never_interpreted(client, lesion):
    hostile = "<img src=x onerror=alert(1)>"
    created = client.post("/api/analyze",
                          files={"file": ("lesion.jpg", lesion, "image/jpeg")},
                          data={"case": hostile}).json()

    assert created["case_label"] == hostile
    assert client.get(f"/api/history/{created['session_id']}").json()["case_label"] == hostile
    client.patch(f"/api/history/{created['session_id']}", json={"case_label": None})


@pytest.mark.slow
def test_case_writes_follow_the_history_read_guard(client, lesion, monkeypatch,
                                                   admin_headers):
    import backend.security as security

    sid = client.post("/api/analyze",
                      files={"file": ("lesion.jpg", lesion, "image/jpeg")}).json()["session_id"]

    monkeypatch.setattr(security, "REQUIRE_HISTORY_TOKEN", True)
    assert client.patch(f"/api/history/{sid}", json={"case_label": "x"}).status_code == 401
    assert client.get("/api/cases").status_code == 401
    assert client.patch(f"/api/history/{sid}", json={"case_label": "x"},
                        headers=admin_headers).status_code == 200
    assert client.get("/api/cases", headers=admin_headers).status_code == 200

