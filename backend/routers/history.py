"""History, case grouping, stored upload retrieval, and admin deletion endpoints."""

from datetime import timezone
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..logging_setup import get_logger
from ..models import DiagnosticSession
from ..security import normalise_case_label, require_admin, require_history_access
from ..storage import delete_stored_file, resolve_stored_path

log = get_logger("history")

router = APIRouter(prefix="/api", tags=["History & Cases"])


def _utc_isoformat(value):
    """Serialise a timestamp as unambiguous UTC.

    SQLite has no timezone type, so a value written as timezone-aware UTC comes
    back naive. Emitting that bare ("2026-09-04T06:11:00") makes every browser
    read it as *local* time, shifting displayed timestamps by the client's
    offset. Marking it UTC explicitly is what makes the client render it right.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _image_is_available(stored):
    """Is the file behind a record actually there?"""
    path = resolve_stored_path(stored)
    return bool(path) and os.path.isfile(path)


def _session_summary(s):
    """The fields the history list and the comparison view both read."""
    return {
        "id": s.id,
        "prediction": s.prediction,
        "confidence": s.confidence,
        "is_high_risk": s.is_high_risk,
        "anatomic_site": s.anatomic_site,
        "case_label": s.case_label,
        "melanoma_alert": s.melanoma_alert,
        "melanoma_probability": s.melanoma_probability,
        "threshold_used": s.threshold_used,
        "scores": s.all_scores,
        "created_at": _utc_isoformat(s.created_at),
        "has_image": _image_is_available(s.image_path),
    }


def _get_completed_session(db: Session, session_id: int) -> DiagnosticSession:
    """Fetch a completed session or raise 404."""
    session = (
        db.query(DiagnosticSession)
        .filter(
            DiagnosticSession.id == session_id,
            DiagnosticSession.status == "completed",
        )
        .first()
    )
    if not session:
        raise HTTPException(404, detail="Session not found")
    return session


@router.get("/history", dependencies=[Depends(require_history_access)])
def get_history(limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    """Return completed diagnostic sessions ordered by newest first."""
    sessions = (
        db.query(DiagnosticSession)
        .filter(DiagnosticSession.status == "completed")
        .order_by(DiagnosticSession.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_session_summary(s) for s in sessions]


@router.get("/history/{session_id}", dependencies=[Depends(require_history_access)])
def get_history_entry(session_id: int, db: Session = Depends(get_db)):
    """One completed session, for the side-by-side comparison view."""
    return _session_summary(_get_completed_session(db, session_id))


@router.get("/history/{session_id}/image", dependencies=[Depends(require_history_access)])
def get_history_image(session_id: int, db: Session = Depends(get_db)):
    """The stored image for a session."""
    session = _get_completed_session(db, session_id)

    path = resolve_stored_path(session.image_path)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, detail="The image for this session is no longer stored.")

    return FileResponse(path, headers={"Cache-Control": "private, max-age=86400"})


class CaseLabelUpdate(BaseModel):
    """Body of PATCH /api/history/{id}. `null` clears the label."""
    case_label: Optional[str] = None


@router.patch("/history/{session_id}", dependencies=[Depends(require_history_access)])
def set_case_label(
    session_id: int,
    update: CaseLabelUpdate,
    db: Session = Depends(get_db),
):
    """Assign, change or clear the case label on an existing scan."""
    session = _get_completed_session(db, session_id)
    session.case_label = normalise_case_label(update.case_label)
    db.commit()
    db.refresh(session)
    log.info("scan %d: case_label=%s", session.id, session.case_label or "-")
    return _session_summary(session)


@router.get("/cases", dependencies=[Depends(require_history_access)])
def get_cases(db: Session = Depends(get_db)):
    """Every case label in use, with what is filed under it."""
    rows = (
        db.query(
            DiagnosticSession.case_label,
            func.count(DiagnosticSession.id),
            func.min(DiagnosticSession.created_at),
            func.max(DiagnosticSession.created_at),
            func.sum(case((DiagnosticSession.is_high_risk, 1), else_=0)),
        )
        .filter(
            DiagnosticSession.status == "completed",
            DiagnosticSession.case_label.isnot(None),
        )
        .group_by(DiagnosticSession.case_label)
        .order_by(func.max(DiagnosticSession.created_at).desc())
        .all()
    )

    return [
        {
            "case_label": label,
            "scan_count": int(count or 0),
            "first_scan": _utc_isoformat(first),
            "latest_scan": _utc_isoformat(last),
            "high_risk_count": int(high or 0),
        }
        for label, count, first, last, high in rows
    ]


@router.delete("/history/all", dependencies=[Depends(require_admin)])
def delete_all_history(db: Session = Depends(get_db)):
    """Delete ALL diagnostic sessions and their uploaded images."""
    sessions = db.query(DiagnosticSession).all()
    count = len(sessions)
    for s in sessions:
        delete_stored_file(s.image_path)
        db.delete(s)
    db.commit()
    log.info("deleted all %d diagnostic session(s) and their images", count)
    return {"message": f"Deleted {count} sessions"}


@router.delete("/history/{session_id}", dependencies=[Depends(require_admin)])
def delete_history_entry(session_id: int, db: Session = Depends(get_db)):
    """Delete a single diagnostic session by ID."""
    session = db.query(DiagnosticSession).filter(DiagnosticSession.id == session_id).first()
    if not session:
        raise HTTPException(404, detail="Session not found")

    delete_stored_file(session.image_path)
    db.delete(session)
    db.commit()
    return {"message": "Deleted", "id": session_id}

