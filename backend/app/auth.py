"""Sign-in enforcement for the data endpoints (upload, profile, analyse, export, AI).

When `TABULAVIBE_REQUIRE_SIGN_IN=true`, every data request must carry a Supabase access token. The
token is checked with Supabase Auth (`GET /auth/v1/user`), which also rejects signed-out and
expired sessions. Verified tokens are cached briefly in memory (by hash, never the token itself)
so a normal session costs one check a minute, not one per request.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Header

from .config import Settings, get_settings
from .storage import AuthRequiredError, StorageError

CACHE_SECONDS = 60
MAX_CACHE_ENTRIES = 5_000


@dataclass(frozen=True)
class User:
    id: str
    email: str | None


class TokenVerifier:
    def __init__(self, url: str, anon_key: str, timeout: float, transport: httpx.BaseTransport | None = None, clock=time.monotonic):
        self._endpoint = f"{url.rstrip('/')}/auth/v1/user"
        self._anon_key = anon_key
        self._timeout = timeout
        self._transport = transport
        self._clock = clock
        self._cache: dict[str, tuple[float, User]] = {}
        self._lock = threading.Lock()

    def verify(self, token: str) -> User:
        key = hashlib.sha256(token.encode()).hexdigest()
        now = self._clock()
        with self._lock:
            cached = self._cache.get(key)
            if cached and cached[0] > now:
                return cached[1]
        user = self._fetch(token)
        with self._lock:
            if len(self._cache) >= MAX_CACHE_ENTRIES:
                self._cache.clear()
            self._cache[key] = (now + CACHE_SECONDS, user)
        return user

    def _fetch(self, token: str) -> User:
        headers = {"apikey": self._anon_key, "Authorization": f"Bearer {token}"}
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(self._endpoint, headers=headers)
        except httpx.TimeoutException as exc:
            raise StorageError("auth_timeout", "The sign-in service did not respond in time. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise StorageError("auth_unavailable", "The sign-in service could not be reached.") from exc
        if response.status_code in (401, 403):
            raise AuthRequiredError("Your sign-in has expired or is not valid. Please sign in again.")
        if response.status_code != 200:
            raise StorageError("auth_error", f"The sign-in service returned an error (HTTP {response.status_code}).")
        try:
            body = response.json()
            user_id = body["id"]
        except (ValueError, KeyError, TypeError) as exc:
            raise StorageError("auth_malformed_response", "The sign-in service returned a response that could not be read.") from exc
        if not isinstance(user_id, str) or not user_id:
            raise AuthRequiredError()
        email = body.get("email")
        return User(id=user_id, email=email if isinstance(email, str) else None)


_verifiers: dict[tuple[str, str, float], TokenVerifier] = {}


def get_token_verifier(settings: Annotated[Settings, Depends(get_settings)]) -> TokenVerifier | None:
    """FastAPI dependency (overridden in tests). None when sign-in is not required."""
    if not settings.require_sign_in:
        return None
    key = (settings.supabase_url or "", (settings.supabase_anon_key or "").strip(), settings.supabase_timeout_seconds)
    if key not in _verifiers:
        _verifiers[key] = TokenVerifier(*key)
    return _verifiers[key]


def signed_in_user(
    verifier: Annotated[TokenVerifier | None, Depends(get_token_verifier)],
    authorization: Annotated[str | None, Header(max_length=8_192)] = None,
) -> User | None:
    """Guard for data endpoints: a verified user when sign-in is required, otherwise None."""
    if verifier is None:
        return None
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthRequiredError("Sign in to upload and analyse files.")
    return verifier.verify(token.strip())


SignedInUser = Annotated[User | None, Depends(signed_in_user)]
