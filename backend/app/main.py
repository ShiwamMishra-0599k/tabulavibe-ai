"""TabulaVibe AI API. Every request carries its own file. Uploads are never stored; only reports a
signed-in user chooses to save are written to Supabase (aggregated results, no raw rows)."""

from __future__ import annotations

import logging
import time
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ValidationError

from . import __version__
from .ai import AIDisabledError, RateLimiter, build_payload, generate_narrative, get_provider
from .analysis import filter_options, run_analysis
from .config import Settings, get_settings
from .errors import AppError, DataError
from .export import cleaned_csv, results_csv
from .github import StarCounter, repo_info
from .ingest import load_table
from .profiling import Dataset, build_dataset, build_profile, duplicate_row_count
from .samples import SAMPLES, SAMPLES_DIR, list_samples
from .schemas import AnalysisSpec, CleanOptions, SavedNarrative
from .storage import AuthRequiredError, ReportStore, StorageDisabledError, build_record, get_store

logger = logging.getLogger("tabulavibe")
SettingsDep = Annotated[Settings, Depends(get_settings)]
_MULTIPART_OVERHEAD = 64 * 1024


def _error(status: int, code: str, message: str, details: list[str] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


def _validation_details(exc: RequestValidationError | ValidationError) -> list[str]:
    details = []
    for err in exc.errors()[:5]:
        loc = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body",))
        details.append(f"{loc}: {err.get('msg')}" if loc else str(err.get("msg")))
    return details


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="TabulaVibe AI API",
        version=__version__,
        docs_url="/api/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
    )
    app.dependency_overrides[get_settings] = lambda: settings
    app.state.rate_limiter = RateLimiter(settings.ai_requests_per_minute)
    app.state.star_counter = StarCounter()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["Content-Disposition", "X-Rows-Exported", "X-Duplicates-Removed", "X-Labels-Merged"],
        max_age=600,
    )

    @app.middleware("http")
    async def guard_and_log(request: Request, call_next):
        started = time.perf_counter()
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_upload_bytes + _MULTIPART_OVERHEAD:
            return _error(413, "file_too_large", f"The file is larger than the {settings.max_upload_mb:g} MB limit.")
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        # Log only method, path, status and timing: never file names or contents.
        logger.info("%s %s %s %.0fms", request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000)
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError):
        return _error(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError):
        return _error(
            422, "invalid_request", "The request is missing required fields or contains invalid values.", _validation_details(exc)
        )

    @app.exception_handler(Exception)
    async def unexpected_handler(_: Request, exc: Exception):
        logger.exception("Unhandled error: %s", type(exc).__name__)
        return _error(500, "internal_error", "Something went wrong while processing the request. Please try again.")

    _register_routes(app)
    return app


def _load(file: UploadFile, settings: Settings) -> Dataset:
    content = file.file.read(settings.max_upload_bytes + 1)
    table = load_table(file.filename, content, settings)
    return build_dataset(table)


def _parse_json_field(model: type[BaseModel], raw: str, field: str):
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        raise _FieldError(field, _validation_details(exc)) from exc


class _FieldError(DataError):
    def __init__(self, field: str, details: list[str]):
        super().__init__("invalid_request", f"The '{field}' field is invalid: " + "; ".join(details))


def _register_routes(app: FastAPI) -> None:
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/config")
    def config(settings: SettingsDep) -> dict[str, Any]:
        provider = get_provider(settings)
        return {
            "limits": {
                "max_upload_mb": settings.max_upload_mb,
                "max_rows": settings.max_rows,
                "max_columns": settings.max_columns,
                "max_cells": settings.max_cells,
                "supported_extensions": [".csv", ".xlsx"],
            },
            "ai": {
                "enabled": provider is not None,
                "provider": provider.name if provider else None,
                "model": provider.model if provider else None,
            },
            # Public values the browser needs for Supabase sign-in (the anon key is public by design).
            "storage": {
                "enabled": settings.storage_enabled,
                "supabase_url": settings.supabase_url if settings.storage_enabled else None,
                "supabase_anon_key": settings.supabase_anon_key.strip()
                if settings.storage_enabled and settings.supabase_anon_key
                else None,
            },
        }

    @app.get("/api/github")
    def github(request: Request, settings: SettingsDep) -> dict[str, Any]:
        return repo_info(settings.github_repo, request.app.state.star_counter)

    @app.get("/api/samples")
    def samples() -> list[dict[str, str]]:
        return list_samples()

    @app.get("/api/samples/{sample_id}")
    def sample_file(sample_id: str):
        sample = SAMPLES.get(sample_id)
        if sample is None:
            raise DataError("sample_not_found", "That sample dataset does not exist.", 404)
        return FileResponse(SAMPLES_DIR / sample["file"], media_type=sample["media_type"], filename=sample["file"])

    @app.post("/api/profile")
    def profile(settings: SettingsDep, file: UploadFile = File(...)) -> dict[str, Any]:
        ds = _load(file, settings)
        result = build_profile(ds, file.filename)
        result["filter_options"] = filter_options(ds)
        return result

    @app.post("/api/analyze")
    def analyze(settings: SettingsDep, file: UploadFile = File(...), spec: str = Form(..., max_length=20_000)) -> dict[str, Any]:
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        ds = _load(file, settings)
        return run_analysis(ds, parsed, settings.max_groups)

    @app.post("/api/export/cleaned")
    def export_cleaned(settings: SettingsDep, file: UploadFile = File(...), options: str = Form("{}", max_length=2_000)):
        parsed = _parse_json_field(CleanOptions, options, "options")
        ds = _load(file, settings)
        text, summary = cleaned_csv(ds, parsed.remove_duplicates, parsed.merge_label_variants)
        return Response(
            content=text.encode("utf-8"),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="tabulavibe_cleaned_data.csv"',
                "X-Rows-Exported": str(summary["rows_exported"]),
                "X-Duplicates-Removed": str(summary["duplicates_removed"]),
                "X-Labels-Merged": str(summary["labels_merged"]),
            },
        )

    @app.post("/api/export/results")
    def export_results(settings: SettingsDep, file: UploadFile = File(...), spec: str = Form(..., max_length=20_000)):
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        ds = _load(file, settings)
        result = run_analysis(ds, parsed, settings.max_groups)
        return Response(
            content=results_csv(result).encode("utf-8"),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="tabulavibe_results.csv"'},
        )

    @app.post("/api/narrative")
    def narrative(
        request: Request,
        settings: SettingsDep,
        file: UploadFile = File(...),
        spec: str = Form(..., max_length=20_000),
        provider=Depends(get_narrative_provider),
    ) -> dict[str, Any]:
        if provider is None:
            raise AIDisabledError()
        request.app.state.rate_limiter.check(request.client.host if request.client else "unknown")
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        ds = _load(file, settings)
        result = run_analysis(ds, parsed, settings.max_groups)
        quality = {
            "duplicate_rows_in_file": duplicate_row_count(ds),
            "columns_with_invalid_values": [c.name for c in ds.columns.values() if c.invalid_count][:10],
        }
        return generate_narrative(provider, build_payload(result, quality))

    @app.get("/api/account")
    def account(store: StoreDep, token: TokenDep) -> dict[str, Any]:
        return store.account(token)

    @app.post("/api/reports", status_code=201)
    def save_report(
        settings: SettingsDep,
        store: StoreDep,
        token: TokenDep,
        file: UploadFile = File(...),
        spec: str = Form(..., max_length=20_000),
        title: str = Form(..., max_length=200),
        narrative: str | None = Form(None, max_length=40_000),
    ) -> dict[str, Any]:
        clean_title = " ".join(title.split())
        if not clean_title:
            raise DataError("invalid_request", "Give the report a title.")
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        saved_narrative = _parse_json_field(SavedNarrative, narrative, "narrative").model_dump() if narrative else None
        # Recalculate from the file so stored figures always come from the backend.
        ds = _load(file, settings)
        profile = build_profile(ds, file.filename)
        result = run_analysis(ds, parsed, settings.max_groups)
        return store.create(token, build_record(clean_title, profile, result, saved_narrative))

    @app.get("/api/reports")
    def list_reports(store: StoreDep, token: TokenDep) -> list[dict[str, Any]]:
        return store.list(token)

    @app.get("/api/reports/{report_id}")
    def get_report(report_id: UUID, store: StoreDep, token: TokenDep) -> dict[str, Any]:
        return store.get(token, str(report_id))

    @app.delete("/api/reports/{report_id}", status_code=204)
    def delete_report(report_id: UUID, store: StoreDep, token: TokenDep) -> Response:
        store.delete(token, str(report_id))
        return Response(status_code=204)


def get_narrative_provider(settings: SettingsDep):
    """FastAPI dependency so tests can swap in fake providers."""
    return get_provider(settings)


def get_report_store(settings: SettingsDep) -> ReportStore:
    """FastAPI dependency so tests can swap in a fake Supabase transport."""
    store = get_store(settings)
    if store is None:
        raise StorageDisabledError()
    return store


def get_access_token(authorization: Annotated[str | None, Header(max_length=8_192)] = None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthRequiredError()
    return token.strip()


StoreDep = Annotated[ReportStore, Depends(get_report_store)]
TokenDep = Annotated[str, Depends(get_access_token)]


app = create_app()
