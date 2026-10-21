"""User profiles and saved reports in Supabase Postgres, through its REST API (PostgREST).

The backend never holds a privileged key. Every call carries the signed-in user's own access
token, so Row Level Security in the database (see supabase/migrations) limits each user to their
own rows. Only aggregated results are stored, never the uploaded file or its rows.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from . import __version__
from .config import Settings
from .errors import AppError

logger = logging.getLogger("tabulavibe")

PROFILE_COLUMNS = "id,email,full_name,avatar_url,provider,created_at"
LIST_COLUMNS = "id,title,source_name,source_type,row_count,column_count,created_at"
MAX_REPORTS_LISTED = 100


class StorageError(AppError):
    status_code = 502


class StorageDisabledError(StorageError):
    status_code = 503

    def __init__(self) -> None:
        super().__init__("storage_disabled", "Saved reports are not enabled on this server. Everything else works without them.")


class AuthRequiredError(AppError):
    status_code = 401

    def __init__(self, message: str = "Sign in to save and view reports.") -> None:
        super().__init__("auth_required", message)


class ReportNotFoundError(AppError):
    status_code = 404

    def __init__(self) -> None:
        super().__init__("report_not_found", "That report does not exist or belongs to another account.")


class ProfileNotFoundError(AppError):
    status_code = 404

    def __init__(self) -> None:
        super().__init__("profile_not_found", "No TabulaVibe profile exists for this account yet. Sign out and sign in again.")


class ReportStore:
    def __init__(self, url: str, anon_key: str, timeout: float, transport: httpx.BaseTransport | None = None):
        self._rest = f"{url.rstrip('/')}/rest/v1"
        self._anon_key = anon_key
        self._timeout = timeout
        self._transport = transport

    def _request(
        self, method: str, token: str, *, table: str = "reports", params: dict[str, str], body: Any = None, prefer: str | None = None
    ) -> Any:
        headers = {"apikey": self._anon_key, "Authorization": f"Bearer {token}", "Accept": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.request(method, f"{self._rest}/{table}", params=params, json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise StorageError("storage_timeout", "The report database did not respond in time. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise StorageError("storage_unavailable", "The report database could not be reached.") from exc

        if response.status_code in (401, 403):
            raise AuthRequiredError("Your sign-in has expired or is not valid. Please sign in again.")
        if response.status_code >= 400:
            # Status only: the response body can echo stored values.
            logger.warning("Supabase returned HTTP %s", response.status_code)
            raise StorageError("storage_error", f"The report database returned an error (HTTP {response.status_code}).")
        if not response.content:
            return []
        try:
            return response.json()
        except ValueError as exc:
            raise StorageError("storage_malformed_response", "The report database returned a response that could not be read.") from exc

    def account(self, token: str) -> dict[str, Any]:
        rows = self._request("GET", token, table="profiles", params={"select": PROFILE_COLUMNS, "limit": "1"})
        if not rows:
            raise ProfileNotFoundError()
        return rows[0]

    def create(self, token: str, record: dict[str, Any]) -> dict[str, Any]:
        rows = self._request("POST", token, params={"select": LIST_COLUMNS}, body=record, prefer="return=representation")
        if not rows:
            raise StorageError("storage_error", "The report could not be saved.")
        return rows[0]

    def list(self, token: str) -> list[dict[str, Any]]:
        params = {"select": LIST_COLUMNS, "order": "created_at.desc", "limit": str(MAX_REPORTS_LISTED)}
        return self._request("GET", token, params=params)

    def get(self, token: str, report_id: str) -> dict[str, Any]:
        rows = self._request("GET", token, params={"select": "*", "id": f"eq.{report_id}"})
        if not rows:
            raise ReportNotFoundError()
        return rows[0]

    def delete(self, token: str, report_id: str) -> None:
        rows = self._request("DELETE", token, params={"select": "id", "id": f"eq.{report_id}"}, prefer="return=representation")
        if not rows:
            raise ReportNotFoundError()


def get_store(settings: Settings) -> ReportStore | None:
    if settings.storage_enabled:
        return ReportStore(settings.supabase_url or "", (settings.supabase_anon_key or "").strip(), settings.supabase_timeout_seconds)
    return None


def build_record(title: str, profile: dict[str, Any], result: dict[str, Any], narrative: dict[str, Any] | None) -> dict[str, Any]:
    """The row written to the database. `user_id` is filled in by Postgres from the access token."""
    dataset = profile["dataset"]
    return {
        "title": title,
        "source_name": (dataset["file_name"] or "uploaded file")[:255],
        "source_type": dataset["file_type"],
        "row_count": dataset["row_count"],
        "column_count": dataset["column_count"],
        "spec": result["spec"],
        "result": result,
        "quality": {"dataset": dataset, "issues": profile["issues"]},
        "narrative": narrative,
        "app_version": __version__,
    }
