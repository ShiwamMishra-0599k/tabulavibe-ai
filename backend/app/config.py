"""Environment-based configuration. All variables use the TABULAVIBE_ prefix."""

import base64
import json
import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AI_PROVIDERS = ("groq", "nvidia")


class Settings(BaseSettings):
    # TABULAVIBE_ENV_FILE="" disables the .env file (the test suite does this so a developer's local
    # settings, e.g. Supabase or sign-in, never change test results).
    model_config = SettingsConfigDict(
        env_prefix="TABULAVIBE_", env_file=os.environ.get("TABULAVIBE_ENV_FILE", ".env") or None, extra="ignore"
    )

    app_env: Literal["development", "test", "production"] = "development"
    # Comma-separated list of exact origins allowed by CORS. Never use "*".
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Upload limits. The engine holds the whole file in memory (strings first), measured at about 14x the
    # CSV size at peak (docs/PROJECT_STATUS.md). Defaults suit an 8 GB machine: 100 MB CSV ≈ 1.8 GB peak and
    # ~45 s per action. Raise them only on machines with more memory. On Vercel (VERCEL=1) the upload limit
    # defaults to 3.5 MB (4.5 MB request/response cap); the AWS template sets 4 MB (6 MB Lambda payload).
    max_upload_mb: float = Field(100.0, gt=0, le=1024)
    # Excel is read about 10x slower than CSV (openpyxl), so it has its own, smaller limit.
    max_xlsx_mb: float = Field(20.0, gt=0, le=1024)
    max_rows: int = Field(2_000_000, gt=0)
    max_columns: int = Field(200, gt=0)
    max_cells: int = Field(20_000_000, gt=0)
    max_groups: int = Field(100, gt=0)
    # Files above this size are processed one at a time, so two large uploads cannot exhaust memory together.
    large_file_mb: float = Field(25.0, gt=0)

    # Optional AI (commentary and the AI analyst). Disabled unless explicitly configured.
    # ai_provider is "none" or a comma-separated order of OpenAI-compatible chat providers to try, e.g.
    # "groq,nvidia": Groq first, NVIDIA (build.nvidia.com, nvapi- key) when Groq cannot finish. Providers
    # without a key are skipped. Models must support tool calling (the AI analyst relies on it).
    ai_provider: str = "none"
    groq_api_key: SecretStr | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    nvidia_api_key: SecretStr | None = None
    nvidia_model: str = "meta/llama-3.3-70b-instruct"
    # Predictive forecasting of the AI analyst's primary measure with NVIDIA Kumo Relational (hosted on
    # build.nvidia.com, uses the NVIDIA key). Only period totals are sent, never raw rows.
    forecast_provider: Literal["none", "kumo"] = "none"
    ai_timeout_seconds: float = Field(20.0, gt=0, le=60)
    ai_requests_per_minute: int = Field(5, ge=1)

    # Analytics agent (phases 0-8). Uses the AI providers above when configured, otherwise the
    # rules-based analyst. Limits keep one run inside the serverless time limit and the free AI quota.
    agent_max_steps: int = Field(24, ge=4, le=60)
    agent_deadline_seconds: float = Field(200, gt=10, le=280)
    agent_runs_per_minute: int = Field(4, ge=1)
    # "Ask AI" questions about an analysed file, per user (or IP) per minute.
    chat_questions_per_minute: int = Field(8, ge=1)

    # Optional saved reports (Supabase). Disabled unless both values are set. Use the project's
    # anon/publishable key: it is public by design and Row Level Security protects the data.
    # The service-role/secret key is refused because it would bypass Row Level Security.
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_timeout_seconds: float = Field(10.0, gt=0, le=30)
    # Require a signed-in Supabase user for every upload and analysis request. Needs Supabase above:
    # the backend refuses to start with this on and Supabase unset (fail closed, never silently open).
    require_sign_in: bool = False

    # Public GitHub repository ("owner/name") whose star count the navigation bar shows. Empty hides it.
    github_repo: str = "ShiwamMishra-0599k/tabulavibe-ai"

    @field_validator("ai_provider")
    @classmethod
    def _check_ai_provider(cls, value: str) -> str:
        names = [n.strip().lower() for n in value.split(",") if n.strip()]
        # Gemini was replaced in 0.6.0. An old deployment that still says "gemini" starts with AI off
        # (rules-based analyst) instead of failing to start.
        names = [n for n in names if n != "gemini"]
        if not names or names == ["none"]:
            return "none"
        unknown = [n for n in names if n not in AI_PROVIDERS]
        if unknown or len(set(names)) != len(names):
            raise ValueError(f"TABULAVIBE_AI_PROVIDER must be 'none' or a comma-separated list of {', '.join(AI_PROVIDERS)}")
        return ",".join(names)

    @property
    def ai_chain(self) -> list[str]:
        """Providers to try, in order (keys are checked by app.ai.chat_backends)."""
        return [] if self.ai_provider == "none" else self.ai_provider.split(",")

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
        if self.require_sign_in and not (self.supabase_url and self.supabase_anon_key):
            raise ValueError("TABULAVIBE_REQUIRE_SIGN_IN=true needs TABULAVIBE_SUPABASE_URL and TABULAVIBE_SUPABASE_ANON_KEY")
        return self

    @model_validator(mode="after")
    def _platform_defaults(self) -> "Settings":
        # Vercel sets VERCEL=1. Its functions accept at most 4.5 MB per request *and* per response, and a
        # cleaned-data CSV can be slightly larger than the upload, so default to 3.5 MB there. Explicitly
        # configured values always win.
        if os.environ.get("VERCEL") == "1":
            if "max_upload_mb" not in self.model_fields_set:
                self.max_upload_mb = 3.5
            if "max_xlsx_mb" not in self.model_fields_set:
                self.max_xlsx_mb = 3.5
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

    @property
    def max_xlsx_bytes(self) -> int:
        return int(min(self.max_xlsx_mb, self.max_upload_mb) * 1024 * 1024)

    @property
    def large_file_bytes(self) -> int:
        return int(self.large_file_mb * 1024 * 1024)


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
