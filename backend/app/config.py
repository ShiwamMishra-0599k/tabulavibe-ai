"""Environment-based configuration. All variables use the TABULAVIBE_ prefix."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
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

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip() and o.strip() != "*"]

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)


@lru_cache
def get_settings() -> Settings:
    return Settings()
