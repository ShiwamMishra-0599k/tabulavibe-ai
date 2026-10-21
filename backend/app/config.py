"""Environment-based configuration. All variables use the TABULAVIBE_ prefix."""

import base64
import json
import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TABULAVIBE_", env_file=".env", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    # Comma-separated list of exact origins allowed by CORS. Never use "*".
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Upload limits. 4 MB keeps a base64-encoded multipart body under the 6 MB
    # AWS Lambda synchronous payload limit.
    max_upload_mb: float = Field(4.0, gt=0, le=5)
    max_rows: int = Field(100_000, gt=0)
    max_columns: int = Field(60, gt=0)
    max_cells: int = Field(2_000_000, gt=0)
    max_groups: int = Field(100, gt=0)

    # Optional AI narrative. Disabled unless explicitly configured.
    ai_provider: Literal["none", "gemini"] = "none"
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    ai_timeout_seconds: float = Field(20.0, gt=0, le=60)
    ai_requests_per_minute: int = Field(5, ge=1)

    # Optional saved reports (Supabase). Disabled unless both values are set. Use the project's
    # anon/publishable key: it is public by design and Row Level Security protects the data.
    # The service-role/secret key is refused because it would bypass Row Level Security.
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_timeout_seconds: float = Field(10.0, gt=0, le=30)

    # Public GitHub repository ("owner/name") whose star count the navigation bar shows. Empty hides it.
    github_repo: str = "ShiwamMishra-0599k/tabulavibe-ai"

    @model_validator(mode="after")
    def _check_supabase(self) -> "Settings":
        if self.supabase_url:
            url = self.supabase_url.strip().rstrip("/")
            local = url.startswith(("http://localhost", "http://127.0.0.1"))
            if not (url.startswith("https://") or local):
                raise ValueError("TABULAVIBE_SUPABASE_URL must start with https://")
            self.supabase_url = url
        if self.supabase_anon_key and _is_privileged_key(self.supabase_anon_key.strip()):
            raise ValueError("TABULAVIBE_SUPABASE_ANON_KEY must be the anon/publishable key, not the service-role/secret key")
        return self

    @model_validator(mode="after")
    def _platform_defaults(self) -> "Settings":
        # Vercel sets VERCEL=1. Its functions accept at most 4.5 MB per request *and* per response, and a
        # cleaned-data CSV can be slightly larger than the upload, so default to 3.5 MB there. Explicitly
        # configured values always win.
        if os.environ.get("VERCEL") == "1":
            if "max_upload_mb" not in self.model_fields_set:
                self.max_upload_mb = 3.5
            if "app_env" not in self.model_fields_set:
                self.app_env = "production"
        return self

    @property
    def storage_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip() and o.strip() != "*"]

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)


def _is_privileged_key(key: str) -> bool:
    if key.startswith("sb_secret_"):
        return True
    parts = key.split(".")
    if len(parts) != 3:
        return False
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except ValueError:
        return False
    return isinstance(claims, dict) and claims.get("role") == "service_role"


@lru_cache
def get_settings() -> Settings:
    return Settings()
