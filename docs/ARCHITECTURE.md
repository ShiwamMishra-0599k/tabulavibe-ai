# Architecture

## Overview

```
 Browser (React SPA)                         FastAPI (local: uvicorn · AWS: Lambda + Mangum)
 ───────────────────                         ─────────────────────────────────────────────
 keeps the File object in memory   ──POST multipart (file + spec JSON)──▶  ingest.py   parse + validate (CSV/XLSX → strings)
 UploadPanel → Preview → Quality             ◀── JSON / CSV ──────────     profiling.py  type inference, quality, stats
 → AnalysisBuilder → Dashboard                                             analysis.py   KPIs, grouping, filters, chart advice
 → Report (window.print)                                                   export.py     cleaned/results CSV (injection-safe)
                                                                           ai.py         optional narrative (aggregates only)
```

**Uploads are never stored.** The server never stores uploads. The browser keeps the selected `File` and
re-sends it with each request (`/profile`, `/analyze`, `/export/*`, `/narrative`). The server re-parses it
each time (well under a second for files within the limits). This avoids object storage and server
sessions, and makes "we do not retain your data" literally true.

**Optional accounts and saved reports (v0.3).** When `TABULAVIBE_SUPABASE_URL`/`_ANON_KEY` are set:

```
 Browser ── signInWithOAuth (Google | GitHub, PKCE) ──▶ Supabase Auth ──▶ trigger creates public.profiles row
    │  access token (JWT)
    ▼
 POST /api/reports (file + spec + title, Authorization: Bearer <user JWT>)
    FastAPI: re-profile + re-run analysis (Python stays the source of truth)
    storage.py ── PostgREST (apikey = anon key, Authorization = user JWT) ──▶ public.reports  (RLS: own rows only)
```

The backend holds no privileged key: the anon/publishable key is public, PostgREST verifies the user's
JWT, and RLS policies (`auth.uid() = user_id`) do the authorisation. Reports are immutable (no UPDATE policy).
Stored: title, file name, counts, spec, aggregated result, quality summary, optional AI narrative. Never rows.
supabase-js is lazy-loaded in the browser and only used for sign-in. Schema: `supabase/migrations/`.

## Repository layout

```
backend/
  app/
    main.py           FastAPI app factory, routes, error handlers, CORS, body-size guard
    config.py         pydantic-settings (TABULAVIBE_* env vars)
    ingest.py         safe CSV/XLSX loading and limits
    profiling.py      inference, Dataset, profile, label-variant merging
    analysis.py       authoritative calculations
    export.py         CSV exports, formula-injection protection
    ai.py             provider abstraction, Gemini REST provider, rate limiter, payload builder
    schemas.py        request models (AnalysisSpec, CleanOptions)
    samples.py        sample registry;  samples/  synthetic CSV + XLSX
    lambda_handler.py Mangum entry point
  scripts/generate_samples.py   seeded synthetic data generator
  tests/              pytest suite (ingest, profiling, analysis, API, AI, Lambda events, samples)
frontend/
  src/App.tsx         workflow state machine (tabs)
  src/components/     UploadPanel, DataPreview, QualityReport, AnalysisBuilder, Dashboard, Charts, ReportView, AiNarrative, ui
  src/lib/            api client, types, formatting, spec helpers, chart helpers
  e2e/                Playwright journey tests (desktop + mobile, local Chrome)
infra/
  template.yaml       AWS SAM template
  stage_backend.py    copies runtime code only into infra/build/api
  deploy.ps1          build, deploy, upload frontend, smoke test
docs/                 architecture, deployment, status, changelog, research notes
```

## API

All responses are JSON unless noted. Errors are always `{"error": {"code", "message", "details?"}}`.

| Method & path | Input | Output |
|---|---|---|
| `GET /api/health` | – | `{status, version}` |
| `GET /api/config` | – | limits, AI enabled/provider/model (never the key) |
| `GET /api/samples` | – | list of sample datasets |
| `GET /api/samples/{id}` | – | sample file |
| `POST /api/profile` | `file` | dataset summary, column profiles, issues, notes, preview (50 rows), suggestions, filter options |
| `POST /api/analyze` | `file`, `spec` (JSON) | KPIs with definitions, grouped rows, chart advice, notes |
| `POST /api/export/cleaned` | `file`, `options` (JSON) | `text/csv` attachment + `X-Rows-Exported`, `X-Duplicates-Removed`, `X-Labels-Merged` |
| `POST /api/export/results` | `file`, `spec` | `text/csv` attachment of the calculated table |
| `POST /api/narrative` | `file`, `spec` | AI text, provider, model, disclaimer, exact `shared_payload`; 503 when disabled |

`spec` example:

```json
{"measures": [{"column": "revenue", "aggregation": "sum"}, {"column": null, "aggregation": "count"}],
 "group_by": "order_date", "time_grain": "month",
 "filters": [{"column": "region", "values": ["North", "South"]}, {"column": "order_date", "start": "2025-01-01", "end": "2025-06-30"}],
 "remove_duplicates": false, "merge_label_variants": false}
```

Status codes: 413 size/row/column/cell limits, 415 unsupported or mismatched file type, 422 invalid data or
request, 429 AI quota/rate limit, 502 AI provider failure, 503 AI disabled, 500 unexpected (generic message).

## Data-processing rules

- **Header:** first non-empty row. Blank headers → `column_N`; duplicates → `name_2`; whitespace collapsed.
- **Cells:** trimmed strings. Fully empty rows are skipped and reported. Short rows are padded.
- **Missing tokens:** empty, `NA`, `N/A`, `null`, `none`, `nan`, `nil`, `-`, `--`, `#N/A` (case-insensitive).
- **Numbers:** optional sign, currency prefix (₹, Rs, INR, $, €, £), thousands separators in Western
  (1,234,567) or Indian (12,34,567) grouping, decimals, exponent, trailing `%` (value kept on its scale).
  Ambiguous forms such as `1,2` are **not** treated as numbers.
- **Dates:** one consistent format chosen from a fixed list; day-first wins ties (`03/04/2024` = 3 April,
  with a visible note).
- **Type threshold:** a column becomes number/date/yes-no when ≥ 90% of non-missing values parse; the rest
  are counted as **invalid** and excluded from calculations, never altered.
- **Category vs text:** ≤ 200 distinct values or ≤ 20% distinct ratio → category.
- **Identifiers:** names like `*_id`, `* no`, `code`, `phone`, or consecutive unique integers. They are not suggested as measures.
- **Aggregations** ignore missing/invalid values; `count` with a column counts non-missing values; `count`
  without a column counts rows. Average = sum ÷ count of values; no values → `null`.
- **Floating-point noise** is rounded at 9 decimal places.
- **Grouping:** categories sorted by the first measure (descending), dates chronologically; rows with missing
  category become `(missing)`; rows without a valid date are excluded from the trend (with a note) but still
  counted in the KPI cards. At most 100 groups are returned.

## Security

| Concern | Control |
|---|---|
| Malicious uploads | Extension allow-list + content signature checks; macro detection; zip-bomb limits (entries, uncompressed size); `openpyxl` read-only, `data_only`, no external links; no formula evaluation |
| Resource exhaustion | Content-Length guard before multipart parsing; byte, row, column and cell limits enforced while reading; Lambda timeout 20 s |
| Spreadsheet formula injection | Export cells starting with `= + - @ TAB CR LF` are prefixed with `'` (numbers are written as plain numbers) |
| CORS | Explicit origin list, `*` ignored, GET/POST only, no credentials |
| Secrets | Only via env vars; `SecretStr`; never returned by `/api/config`; `.env` gitignored; frontend gets only `VITE_API_BASE_URL` |
| Information leakage | Generic 500 handler; validation messages summarised; `/api/docs` disabled in production; logs contain method, path, status and timing only |
| AI data exposure | Aggregates only; payload shown to the user; free-tier data-use notice in the UI and docs |
| Headers | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on API responses; CloudFront managed security-headers policy for the site |

Known limitation: the public Function URL has no authentication, so anyone with the URL can call it. See the cost
risks in [DEPLOYMENT.md](DEPLOYMENT.md).

## Technology decisions

| Choice | Reason |
|---|---|
| FastAPI + Pydantic | Matches the author's skills; typed validation; easy testing |
| pandas + openpyxl | Reliable vectorised calculations; safe XLSX reading without formula evaluation |
| Stateless re-upload per request | No database or storage needed; strongest privacy story; fits Lambda |
| Mangum | Simplest ASGI → Lambda adapter. Its tests cover Function URL payload v2. No second process (unlike Lambda Web Adapter) |
| Lambda Function URL | No extra charge, unlike API Gateway; one less service |
| S3 (private) + CloudFront OAC | Static hosting with HTTPS; CloudFront's always-free allowance covers a demo |
| arm64 | About 20% cheaper per GB-second than x86 once the free tier is exceeded |
| Recharts | Requested stack; enough for line/bar/donut with custom tooltips |
| Tailwind v4 + CSS tokens | Small CSS; light/dark themes from one token set |
| Gemini over REST (httpx) | No SDK dependency; easy to mock; key stays server-side |
| Vitest + Testing Library, Playwright (system Chrome) | Fast unit tests; real-browser E2E without downloading browsers |
