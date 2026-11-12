"""Shared request guards and input normalisation helpers."""

import secrets
from fastapi import Header, HTTPException

from .config import ADMIN_TOKEN, CASE_LABEL_MAX_LENGTH, REQUIRE_HISTORY_TOKEN


def require_admin(x_admin_token: str = Header(default="")):
    """Guards destructive endpoints.

    ADMIN_TOKEN is unset by default, which disables these endpoints entirely
    rather than leaving them open to unauthenticated callers.
    """
    if not ADMIN_TOKEN:
        raise HTTPException(
            403,
            detail="Destructive endpoints are disabled. Set ADMIN_TOKEN to enable them.",
        )
    if not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(401, detail="Invalid or missing X-Admin-Token header.")


def require_history_access(x_admin_token: str = Header(default="")):
    """Optional read guard for history and case endpoints.

    Off by default: the bundled UI reads history unauthenticated and would break.
    Any deployment reachable by someone other than the operator should set
    REQUIRE_HISTORY_TOKEN=1, because these rows describe real uploaded images.
    """
    if not REQUIRE_HISTORY_TOKEN:
        return
    if not ADMIN_TOKEN:
        raise HTTPException(
            403,
            detail="History access requires a token but ADMIN_TOKEN is not set.",
        )
    if not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(401, detail="Invalid or missing X-Admin-Token header.")


def normalise_case_label(value):
    """Tidy an operator-typed case label, or None.

    Free text, so there is no vocabulary to check it against - only whitespace to
    collapse and a length the column can hold. Two labels that differ by spacing
    alone would otherwise split one lesion's history into two cases that look
    identical on screen.
    """
    if value is None:
        return None
    label = " ".join(str(value).split())
    if not label:
        return None
    return label[:CASE_LABEL_MAX_LENGTH]

