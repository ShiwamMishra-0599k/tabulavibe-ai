# Changelog

## 0.7.0 — 2026-10-22 (Ask AI: chat about your data)

### Added
- **Ask AI**, the first tab of the AI Analyst report: ask questions about the data and get detailed answers (a direct answer, then bullets with caveats and a next step) with up to 3 charts, suggested starter questions and follow-up chips. The conversation survives tab switches.
- `POST /api/agent/chat` (`app/agent/chat.py`): the model reads a summary of the report and any evidence item, which the server **recomputes from the file** (numbers sent by the browser are never trusted); new questions run the same analysis tools (evidence C1, C2…, continued across follow-ups). Every number in an answer is checked against the cited evidence (one correction allowed, then flagged "Unverified"). Charts are built by Python from evidence results. Groq first, NVIDIA when Groq cannot; 8 questions per minute per user (`TABULAVIBE_CHAT_QUESTIONS_PER_MINUTE`).
- Tests: 10 pytest (hand-checked answers and chart, tampered evidence ignored, follow-ups, number check, Groq → NVIDIA, chart rules, API, AI off, validation, rate limit), 2 Vitest (AI off; question, chart, checked numbers, history and follow-up payload).

## 0.6.0 — 2026-10-22 (Groq → NVIDIA analyst, best-wins dashboard, Kumo Relational forecasts)

### Changed
- **AI providers: Groq first, then the NVIDIA API catalog, instead of Google Gemini**, for the AI Analyst and AI commentary. `TABULAVIBE_AI_PROVIDER=groq,nvidia` sets the order; keys `TABULAVIBE_GROQ_API_KEY`, `TABULAVIBE_NVIDIA_API_KEY`; models `TABULAVIBE_GROQ_MODEL` (default `llama-3.3-70b-versatile`), `TABULAVIBE_NVIDIA_MODEL` (default `meta/llama-3.3-70b-instruct`). The `GEMINI_*` settings are removed; a deployment still set to `gemini` starts with AI off instead of failing.
- When Groq cannot finish a step (rate limit, request too large for the free plan, error), **the same analyst conversation continues on NVIDIA**; the report lists the switch. The commentary also falls back from Groq to NVIDIA.
- The analyst speaks OpenAI-compatible chat completions with tool calling (`app/agent/llm.py`, `LLMAnalyst`); each request offers only the current stage's functions. Phase gates, grounding checks and the rules-based fallback are unchanged.
- The analyst badge shows the provider order ("Groq → NVIDIA"); `/api/config` reports `agent.chain` and `agent.forecast`.
- AWS template parameters: `GroqApiKey`, `NvidiaApiKey`, `NvidiaModel`, `ForecastProvider`.

### Added
- **Best analysis builds the dashboard:** after an AI run, the rules-based analyst also runs; Python scores both (findings grounded 30, high-priority questions answered 25, phase gates 20, totals reconciled 15, hypotheses resolved 10) and the higher score wins (tie → AI). Scorecard on "Plan & method", in the handover and in PDF/PowerPoint.
- **Predictive forecast with NVIDIA Kumo Relational** (`TABULAVIBE_FORECAST_PROVIDER=kumo`, NVIDIA key): Python builds period totals of the primary measure (month, week or day, at least 8 complete periods); Kumo predicts up to 6 periods ahead (one regression per horizon, the hosted API's documented multi-table shape); a backtest on the last 3 periods compares its error with "same as last period". Only period totals are sent. Forecast card on the Overview, sections in the handover and PDF/PowerPoint.
- Handling for open-model quirks: tool calls written as JSON text are accepted, missing tool-call ids are filled in, and invalid argument JSON is sent back to the model.
- Tests: provider order and keys, Groq → NVIDIA hand-over mid-run (413, 429, 500, 401), all-fail fallback, commentary fallback, evaluation scoring (hand-checked 100) and the rules-wins case, Kumo request shape against the published schema, hand-checked backtest (MAE 0 vs 10), skipped and failed forecasts, exports.

### Fixed
- Report export no longer fails with a server error when the request text contains lone surrogate characters (e.g. text mis-decoded by a client); they are replaced. Found by the end-to-end smoke test.

### Not verified live
- No call has been made to Groq, NVIDIA or Kumo Relational: the keys are the owner's to set. In particular, Kumo's hosted endpoint has not yet accepted a request from this app.

## 0.5.0 — 2026-10-22 (choose your analyst; PDF and PowerPoint reports)

### Added
- **Choice screen after upload:** "How would you like to analyse <file>?" with two options, **AI Analyst** (the 9-phase workflow) and **Manual Analyst** (1. Preview → 2. Data quality → 3. Analyse → 4. Report & export). A bar above each mode switches to the other; "Explore in Analyse" still drills from an AI insight into the Manual Analyst.
- **Final reports as PDF and PowerPoint** (`POST /api/report/export`, sign-in required when enabled), for the Manual report step, the AI Analyst report and saved reports:
  - PowerPoint (python-pptx): 16:9 deck with a brand cover, KPI cards, **native editable charts** (Indian digit grouping), results and register tables, one slide per insight.
  - PDF (ReportLab): A4 report with vector charts starting at zero, insight cards, tables and page footers; **DejaVu Sans embedded** so ₹, →, η and ρ render everywhere (`backend/app/fonts`, licence included).
  - Built from the already-computed results; Python formats every number.
- Tests: 12 pytest (slide text, native chart values, PDF structure, API, sign-in), 3 Vitest (choice screen, switching, downloads), E2E downloads of real PDF and PPTX files on desktop and mobile.

### Changed
- The Manual stepper has four steps again ("5. AI analyst" moved to the choice screen); the Preview banner was removed. "Print / save as PDF" is replaced by "Download PDF" and "Download PowerPoint".
- Finding wording: "adjusted p < 0.0001" instead of "adjusted p = < 0.0001"; finding titles start with a capital letter.
- Dependencies: python-pptx 1.0.2, ReportLab 5.0.1, lxml 6.1.3, **Pillow 13.0.0** (12.3.0 had 20+ advisories fixed in 13.0.0).

### Fixed
- **Phone layouts:** every screen (choice, all Manual steps and results, all AI Analyst pages) now fits 320, 360 and 412 px wide phones. Grids that could grow to their widest table now use `grid-cols-[minmax(0,1fr)]`; the chart-type switcher shows icons only below 380 px; card action controls use the full card width on phones. Previously the Preview step was 1,035 px wide on a 360 px phone and Data quality 812 px.
- Contributed by Shashank Chaubey (`bdae0d0`): compact phone header (icon-only "New file"/"Sign in" below 430 px, GitHub badge hidden below 640 px) and swipeable step and analyst tabs.

## 0.4.0 — 2026-10-22 (AI analyst: the analytics workflow)

### Added
- **AI analyst** (step 5, `POST /api/agent/run`): runs the owner's 9-phase analytics workflow (business understanding → data understanding → problem discovery → preparation → EDA → validation → dashboard → quality checks → handover) with code-enforced phase gates. See `docs/AGENT_WORKFLOW.md`.
- Gemini analyst (free tier, function calling): plans questions and hypotheses, chooses the statistics, words the findings. Python computes every number; findings whose numbers cannot be matched to cited evidence are sent back for correction or flagged.
- Rules-based analyst: completes the same workflow without AI, and takes over if Gemini fails (quota, timeout, step budget); the report says which ran.
- 13 analysis tools with SciPy statistics (Welch's t-test, ANOVA, Alexander–Govern, Kruskal–Wallis, chi-square, Pearson/Spearman, PCA, OLS, trends with partial-period handling), Holm correction and independent recalculation of totals.
- Dashboard pages: Overview, Data quality, Univariate (histogram, box plot), Bivariate, Multivariate (correlation heatmap, PCA), Insights (cards answering the seven questions), Plan & method; "Explore in Analyse" drill-down; handover download (.md).
- Streaming progress (NDJSON) with a live phase timeline.
- Tests: 18 statistics (hand-computed), 33 workflow, 14 Gemini (scripted API), 8 API; 5 Vitest; 1 Playwright journey (desktop + mobile).

### Fixed
- Analyse step: the "Suggested for your data" panel no longer overlaps the dashboard when suggestion labels are long (e.g. "Compare total Amount (INR) across Repeat Customer"). The sidebar keeps its 340 px column and labels wrap instead of overflowing.
- **Small-screen navigation:** the header is a compact toolbar with icon-only narrow-screen actions; workflow and AI analyst tabs scroll horizontally when they do not fit, preventing overflow and oversized stacked navigation.

### Changed
- **Larger uploads:** CSV up to 100 MB (was 4 MB), Excel up to 20 MB, 2,000,000 rows (was 100,000), 200 columns (was 60), 20,000,000 cells (was 2,000,000). Limits were chosen from measurements (peak memory ≈ 14× the CSV size; Excel reads ~10× slower than CSV). Files over 25 MB are processed one at a time (503 `server_busy` otherwise). The Excel zip-bomb guard scales with the Excel limit. Vercel stays at 3.5 MB (platform cap) and the AWS template pins 4 MB. The upload panel shows both limits and suggests CSV for large Excel files.
- Dependency: SciPy 1.18.1. Vercel `maxDuration` 300 s for the API function.
- Tests (pytest and Playwright) ignore the developer's `backend/.env` (`TABULAVIBE_ENV_FILE=""`).

## 0.3.0 — 2026-10-21 (accounts and saved reports)

### Contributions by Shashank Chaubey (`shashank-chaubey`), built on first
- `4faf22d` **Floating navigation bar:** a rounded, glass "pill" header that stays visible on every screen size.
- `c390ec6` **Sign-in button and dialog** with "Continue with Google" / "Continue with GitHub" (+ Vitest test).
  v0.3.0 wires this dialog to Supabase Auth; without Supabase it keeps the original "available after OAuth is configured" preview.

### Added
- Sign-in buttons check which providers are switched on in Supabase (`/auth/v1/settings`) and explain "Google sign-in isn't switched on yet" instead of sending visitors to Supabase's raw error page.
- **Sign-in-only uploads** (`TABULAVIBE_REQUIRE_SIGN_IN=true`): every upload/analysis/export/AI endpoint needs a valid Supabase session, checked by the backend with Supabase Auth (`/auth/v1/user`, verified tokens cached 60 s by hash). Signed-out visitors see "Sign in to upload your data" and locked samples; signing out closes the open file. Refuses to start if enabled without Supabase. AI rate limit is per user when signed in.
- Optional **Supabase** integration (off until `TABULAVIBE_SUPABASE_URL` and `TABULAVIBE_SUPABASE_ANON_KEY` are set).
- **Sign in** (Shashank's dialog, now live) and a full **Sign up page**, both with Google (Gmail) and GitHub (Supabase Auth, PKCE). A `profiles` row is created by a database trigger on first sign-in.
- **Save report** card on the Report step, **My reports** page (open, print, two-step delete) and a saved-report viewer that needs no file.
- Endpoints: `GET /api/account`, `POST/GET /api/reports`, `GET/DELETE /api/reports/{id}`. Saving recalculates from the file on the server.
- `supabase/migrations/20261021000000_profiles_and_reports.sql`: tables, RLS policies (own rows only), grants, signup trigger.
- **GitHub badge** in the navbar: GitHub logo + live star count, linking to the repo. The backend fetches the public count (`GET /api/github`, no token) and caches it for 10 minutes, so browsers never call GitHub. Hidden if `TABULAVIBE_GITHUB_REPO` is empty; shows no count if GitHub is unreachable.
- **Supabase connected on the live site:** Google (Gmail) and GitHub sign-in, profiles and saved reports working; sign-in required for uploads enabled in Vercel.
- Supabase agent skills for Claude Code in `.claude/skills/` (`supabase`, `supabase-postgres-best-practices`).
- **Live on Vercel:** <https://tabulavibe-ai.vercel.app>. Playwright can target any deployment with `E2E_BASE_URL`.
- **Vercel deployment:** `vercel.json` (Services: `web` = Vite build, `api` = FastAPI on Python 3.14; `/api/*` → api, rest → web), `backend/.python-version`, runtime dependencies and sample package data in `backend/pyproject.toml`, and `docs/DEPLOYMENT_VERCEL.md`. On Vercel (`VERCEL=1`) the backend defaults to production mode and a 3.5 MB upload limit (4.5 MB body cap). Verified locally with `vercel dev -L`.
- `docs/SUPABASE_SETUP.md`: step-by-step project, provider and `.env` setup.
- Safety: the backend refuses service-role / `sb_secret_` keys and non-HTTPS Supabase URLs; database error bodies are never echoed or logged.
- SAM template parameters `SupabaseUrl` and `SupabaseAnonKey`.
- Tests: 26 pytest (sign-in enforcement on every data endpoint, token cache, outages, fail-closed config) + 15 pytest (fake Supabase with RLS semantics) + 13 pytest (GitHub stars, caching, failures); 3 Vitest (locked/unlocked uploads, token on requests); 4 Vitest (sign-in dialog, sign-up page, save/list/open/delete) + 2 Vitest (GitHub badge).

### Changed
- `ReportView` takes `dataset` + `issues` (so saved reports render without a profile).
- CORS allows `DELETE` and the `Authorization` header.
- supabase-js is loaded on demand (separate 54 kB gzip chunk); the main bundle stays at 207 kB gzip.

## 0.2.0 — 2026-10-21 (UI v2 "calm confidence")

### Added
- New design system (see `DESIGN.md`):
  - Inter (self-hosted), indigo→violet brand gradient, lucide icons.
  - Glass header, soft background glows, light/dark/system theme toggle (remembered per browser).
- Landing page: hero, large drag-and-drop zone with limit chips, sample cards, 4-step "how it works" strip.
- Full-width 4-step stepper with completion ticks and live hints.
- **Data health** ring (share of cells that are present and valid) and per-column completeness bars.
  Both are calculated by the backend (`valid_cell_pct`, `invalid_cell_count`, `valid_pct`).
- **Suggested analyses:** up to three one-click specs built from the detected schema.
- Redesigned KPI cards (icons, "values used / excluded" badges), segmented chart switcher with icons, gradient-wash trend chart, donut with server total in the centre.
- Switch-style toggles (styled native checkboxes), skeleton loaders, empty states, entrance motion that respects reduced-motion.
- Document-style printable report with a brand title band that prints as plain dark text.
- `DESIGN.md` (design system) and `MEMORY.md` (project memory).
- Tests:
  - 4 new Vitest tests: suggestions, data health, theme, one-click run.
  - A new Playwright journey covering dark theme, suggestions and theme persistence on desktop and mobile.

### Fixed
- Phone layout: the sticky header no longer covers content (sticky only from `sm`); the stepper fits the screen with no sideways scrolling.
- KPI values no longer clip in narrow columns (auto-fit grid).


## 0.1.0 — 2026-10-21

### Added
- FastAPI backend that processes uploads in memory and stores nothing:
  - CSV/XLSX ingestion with extension and content checks, macro and zip-bomb protection, and size, row, column and cell limits.
  - Type inference: Indian and Western digit grouping, currency prefixes, day-first dates.
  - Data-quality profiling: missing, invalid and duplicate values, case/spacing label variants, numeric stats.
  - KPI analysis: sum, average, count, min and max; category and time grouping (day to year); value and date filters; opt-in duplicate removal and label merging; chart suitability advice.
  - Results and cleaned-data CSV exports with formula-injection protection.
  - Optional Gemini narrative behind a provider abstraction. It is disabled by default, sends aggregates only, and is rate-limited.
  - Mangum Lambda handler.
- Synthetic sample datasets (retail CSV, salon bookings XLSX) from a seeded generator.
- React dashboard:
  - Upload and samples, preview, quality report, analysis builder, KPI cards, line, bar and donut charts, results table, AI panel, printable report, downloads.
  - Light/dark tokens from a validated chart palette, keyboard and screen-reader labels, responsive layout.
- Tests:
  - 108 pytest tests, including hand-computed fixtures, an independent `csv`-module cross-check and Function URL event tests.
  - 15 Vitest tests.
  - 6 Playwright E2E runs (3 journeys × desktop/mobile) in local Chrome.
- AWS SAM template, staging script and deploy script:
  - Lambda arm64 with a Function URL; private S3 with CloudFront OAC; 7-day log retention; monthly cost budget alerts.
  - The template passes cfn-lint.
  - The arm64 package was verified in the official Lambda image and Runtime Interface Emulator.
- Documentation: spec, architecture, deployment and cost analysis, status, research notes.
- Published to GitHub: https://github.com/ShiwamMishra-0599k/tabulavibe-ai (public).
