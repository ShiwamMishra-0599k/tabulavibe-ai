"""TabulaVibe AI API. Every request carries its own file. Uploads are never stored; only reports a
signed-in user chooses to save are written to Supabase (aggregated results, no raw rows)."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ValidationError

from . import __version__
from .agent.forecast import KumoForecaster
from .agent.llm import LLMAnalyst
from .agent.workflow import BusinessContext, RulesAnalyst, run_best
from .ai import AIDisabledError, RateLimiter, build_payload, chat_backends, generate_narrative, get_provider
from .analysis import filter_options, run_analysis
from .auth import SignedInUser
from .config import Settings, get_settings
from .errors import AppError, DataError
from .export import cleaned_csv, results_csv
from .github import StarCounter, repo_info
from .ingest import load_table
from .profiling import Dataset, build_dataset, build_profile, duplicate_row_count
from .report_export import agent_doc, manual_doc, render_pdf, render_pptx
from .samples import SAMPLES, SAMPLES_DIR, list_samples
from .schemas import AnalysisSpec, CleanOptions, ReportExportRequest, SavedNarrative
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
    app.state.agent_limiter = RateLimiter(
        settings.agent_runs_per_minute, "Too many analyses in a short time. Please wait a minute and try again.", "agent_rate_limited"
    )
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


_large_file_slot = threading.BoundedSemaphore(1)


def _load(file: UploadFile, settings: Settings) -> Dataset:
    content = file.file.read(settings.max_upload_bytes + 1)
    if len(content) <= settings.large_file_bytes:
        return build_dataset(load_table(file.filename, content, settings))
    # Large files peak at roughly 14x their size in memory: process one at a time.
    if not _large_file_slot.acquire(blocking=False):
        raise AppError("server_busy", "Another large file is being processed right now. Please try again in a moment.", 503)
    try:
        return build_dataset(load_table(file.filename, content, settings))
    finally:
        _large_file_slot.release()


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
        chain = [{"provider": b.name, "label": b.label, "model": b.model} for b in chat_backends(settings)]
        return {
            "limits": {
                "max_upload_mb": settings.max_upload_mb,
                "max_xlsx_mb": min(settings.max_xlsx_mb, settings.max_upload_mb),
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
            "agent": {
                "mode": "ai" if provider is not None else "rules",
                "provider": provider.name if provider else None,
                "model": provider.model if provider else None,
                # Providers in the order they are tried; the next one continues when one cannot finish.
                "chain": chain,
                "forecast": "kumo" if get_forecaster(settings) else None,
            },
            # Public values the browser needs for Supabase sign-in (the anon key is public by design).
            "storage": {
                "enabled": settings.storage_enabled,
                "supabase_url": settings.supabase_url if settings.storage_enabled else None,
                "supabase_anon_key": settings.supabase_anon_key.strip()
                if settings.storage_enabled and settings.supabase_anon_key
                else None,
                "sign_in_required": settings.require_sign_in,
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
    def profile(settings: SettingsDep, user: SignedInUser, file: UploadFile = File(...)) -> dict[str, Any]:
        ds = _load(file, settings)
        result = build_profile(ds, file.filename)
        result["filter_options"] = filter_options(ds)
        return result

    @app.post("/api/analyze")
    def analyze(
        settings: SettingsDep, user: SignedInUser, file: UploadFile = File(...), spec: str = Form(..., max_length=20_000)
    ) -> dict[str, Any]:
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        ds = _load(file, settings)
        return run_analysis(ds, parsed, settings.max_groups)

    @app.post("/api/export/cleaned")
    def export_cleaned(
        settings: SettingsDep, user: SignedInUser, file: UploadFile = File(...), options: str = Form("{}", max_length=2_000)
    ):
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
    def export_results(settings: SettingsDep, user: SignedInUser, file: UploadFile = File(...), spec: str = Form(..., max_length=20_000)):
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
        user: SignedInUser,
        file: UploadFile = File(...),
        spec: str = Form(..., max_length=20_000),
        provider=Depends(get_narrative_provider),
    ) -> dict[str, Any]:
        if provider is None:
            raise AIDisabledError()
        # Per user when signed in (several users can share one IP), otherwise per client IP.
        request.app.state.rate_limiter.check(f"user:{user.id}" if user else (request.client.host if request.client else "unknown"))
        parsed = _parse_json_field(AnalysisSpec, spec, "spec")
        ds = _load(file, settings)
        result = run_analysis(ds, parsed, settings.max_groups)
        quality = {
            "duplicate_rows_in_file": duplicate_row_count(ds),
            "columns_with_invalid_values": [c.name for c in ds.columns.values() if c.invalid_count][:10],
        }
        return generate_narrative(provider, build_payload(result, quality))

    @app.post("/api/report/export")
    def export_report(req: ReportExportRequest, user: SignedInUser) -> Response:
        """The final report as PDF (A4) or PowerPoint (16:9) with native charts."""
        doc = agent_doc(req.data) if req.kind == "agent" else manual_doc(req.data, req.title)
        content = render_pdf(doc) if req.format == "pdf" else render_pptx(doc)
        slug = "".join(ch if ch.isalnum() else "_" for ch in doc.title.lower()).strip("_")[:60] or "report"
        media = "application/pdf" if req.format == "pdf" else "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        return Response(
            content=content, media_type=media, headers={"Content-Disposition": f'attachment; filename="tabulavibe_{slug}.{req.format}"'}
        )

    @app.post("/api/agent/run")
    def agent_run(
        request: Request,
        settings: SettingsDep,
        user: SignedInUser,
        file: UploadFile = File(...),
        context: str = Form("{}", max_length=4_000),
        factory=Depends(get_agent_factory),
        forecaster=Depends(get_forecaster),
    ):
        """Run the analytics workflow (phases 0-8). Streams NDJSON progress events, then the report."""
        parsed = _parse_json_field(BusinessContext, context, "context")
        ds = _load(file, settings)
        request.app.state.agent_limiter.check(f"user:{user.id}" if user else (request.client.host if request.client else "unknown"))
        analyst, fallback = factory(parsed)
        name = file.filename

        def stream():
            try:
                for event in run_best(ds, name, parsed, analyst, fallback, settings.agent_deadline_seconds, forecaster):
                    yield json.dumps(event, ensure_ascii=False, default=_json_default) + "\n"
            except Exception as exc:  # noqa: BLE001 - the status line is already sent; report the failure in-stream
                logger.exception("Agent run failed: %s", type(exc).__name__)
                yield (
                    json.dumps(
                        {
                            "type": "error",
                            "error": {"code": "agent_failed", "message": "The analysis stopped unexpectedly. Please try again."},
                        }
                    )
                    + "\n"
                )

        return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"X-Accel-Buffering": "no"})

    @app.get("/api/account")
    def account(store: StoreDep, token: TokenDep) -> dict[str, Any]:
        return store.account(token)

    @app.post("/api/reports", status_code=201)
    def save_report(
        settings: SettingsDep,
        store: StoreDep,
        token: TokenDep,
        user: SignedInUser,
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


def _json_default(value: Any) -> Any:
    item = getattr(value, "item", None)  # numpy scalars
    return item() if callable(item) else str(value)


def get_agent_factory(settings: SettingsDep):
    """FastAPI dependency: builds (analyst, fallback) for a run. Overridden in tests."""

    def make(context: BusinessContext):
        rules = RulesAnalyst(context)
        backends = chat_backends(settings, timeout=max(settings.ai_timeout_seconds, 30))
        if backends:
            ai = LLMAnalyst(backends, context, max_steps=settings.agent_max_steps, deadline_seconds=settings.agent_deadline_seconds)
            return ai, rules
        return rules, None

    return make


def get_forecaster(settings: SettingsDep) -> KumoForecaster | None:
    """FastAPI dependency: NVIDIA Kumo Relational forecasting, when switched on and an NVIDIA key is set."""
    key = settings.nvidia_api_key.get_secret_value().strip() if settings.nvidia_api_key else ""
    return KumoForecaster(key) if settings.forecast_provider == "kumo" and key else None


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
