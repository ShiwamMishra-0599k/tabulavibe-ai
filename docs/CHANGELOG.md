# Changelog

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
