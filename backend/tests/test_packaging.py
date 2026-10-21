"""Deployment packaging checks (Vercel / AWS)."""

import json
import tomllib
from pathlib import Path

from app.config import Settings

BACKEND = Path(__file__).parent.parent
ROOT = BACKEND.parent


def _requirements() -> list[str]:
    lines = (BACKEND / "requirements.txt").read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def test_pyproject_dependencies_match_requirements():
    pyproject = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))
    assert pyproject["project"]["dependencies"] == _requirements()


def test_sample_datasets_are_shipped_as_package_data():
    pyproject = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))
    patterns = pyproject["tool"]["setuptools"]["package-data"]["app"]
    samples = sorted(p.name for p in (BACKEND / "app" / "samples").iterdir())
    assert samples
    assert all(any(Path(name).match(pattern.removeprefix("samples/")) for pattern in patterns) for name in samples)


def test_python_version_is_pinned_for_vercel():
    assert (BACKEND / ".python-version").read_text(encoding="utf-8").strip() == "3.14"


def test_vercel_config_routes_api_to_fastapi_and_the_rest_to_the_frontend():
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert config["services"]["api"]["entrypoint"] == "app.main:app"
    assert config["rewrites"][0] == {"source": "/api/(.*)", "destination": {"service": "api"}}
    assert config["rewrites"][-1] == {"source": "/(.*)", "destination": {"service": "web"}}
    excluded = config["services"]["api"]["functions"]["app/main.py"]["excludeFiles"]
    assert "tests/**" in excluded and ".venv/**" in excluded
    assert "samples" not in excluded  # sample files are served at runtime


def test_vercel_defaults(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    on_vercel = Settings(_env_file=None)
    assert (on_vercel.max_upload_mb, on_vercel.max_xlsx_mb, on_vercel.app_env) == (3.5, 3.5, "production")
    # Explicit configuration always wins.
    monkeypatch.setenv("TABULAVIBE_MAX_UPLOAD_MB", "2")
    monkeypatch.setenv("TABULAVIBE_APP_ENV", "development")
    explicit = Settings(_env_file=None)
    assert (explicit.max_upload_mb, explicit.app_env) == (2, "development")


def test_local_defaults_unchanged(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    local = Settings(_env_file=None)
    assert (local.max_upload_mb, local.max_xlsx_mb, local.app_env) == (100.0, 20.0, "development")
