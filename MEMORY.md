# MEMORY.md: TabulaVibe AI project memory

A living record of **why** things are the way they are: context, decisions, history, conventions and
lessons learned. Read it before making changes. Add to it when something important happens (newest
entries at the top of each log). For *what* the code does, see `docs/TECHNICAL_REFERENCE.md`; for the
look and feel, see `DESIGN.md`.

---

## 1. Project context

| Item | Value |
|---|---|
| Owner | Shiwam Mishra (GitHub `ShiwamMishra-0599k`) |
| Collaborator | Shashank Chaubey (GitHub `shashank-chaubey`): floating navbar, sign-in dialog (2026-10-21) |
| Purpose | Portfolio project for AI/data engineering roles **and** the foundation for a freelance "dashboards and reporting" service for small businesses (India-first) |
| Repository | https://github.com/ShiwamMishra-0599k/tabulavibe-ai (public) |
| Local path | `C:\Users\swath\projects\tabulavibe-ai` |
| Budget rule | ₹0 software and infrastructure cost wherever possible; never claim "free forever" |
| Status | **Live on Vercel: https://tabulavibe-ai.vercel.app** (project `shiwam/tabulavibe-ai`, Hobby). AWS prepared but not used |
| Version | 0.3.0 (Supabase accounts + saved reports, 2026-10-21) |

## 2. Non-negotiable product rules

1. **Python computes every number.** The frontend only formats; the LLM only describes aggregates.
   Even display figures like data health (`valid_cell_pct`, `valid_pct`) come from the backend.
2. **Report, never silently fix.** Missing and invalid values are excluded *and counted*. Cleaning (dedupe, label merging) is opt-in and announced.
3. **Never store uploads or rows.** The browser re-sends the file with each request. The only persistence is
   optional Supabase: `profiles` and `reports` (aggregates only), private per user via RLS.
4. **AI is optional and off by default.** It gets aggregates only, its output is labelled, and the exact payload is shown to the user.
5. **Safe uploads:** extension *and* content checks, macro and zip-bomb rejection, formulas never evaluated, limits enforced while streaming.
6. **No Claude/AI attribution in git metadata.** No `Co-Authored-By: Claude` trailers. Shiwam asked for this on 2026-10-21.

## 3. Decision log (newest first)

| Date | Decision | Why |
|---|---|---|
| 2026-10-21 | Supabase project **`xftrxawqcoygrzohaase`** connected (URL + publishable key in Vercel Production/Preview and `backend/.env`); sign-in required stays **off** until Google/GitHub work | Avoid locking visitors out; buttons check provider status first |
| 2026-10-21 | **Uploads require sign-in** (`TABULAVIBE_REQUIRE_SIGN_IN`), enforced server-side via Supabase `/auth/v1/user` (60 s cache by token hash) | Shiwam's request. Server-side so it can't be bypassed; `/auth/v1/user` needs no extra JWT library and rejects signed-out sessions; fails closed if Supabase is missing |
| 2026-10-21 | OAuth credentials are created **by Shiwam** in GitHub/Google/Supabase | Client secrets must never pass through Claude, code, Vercel or chat; GitHub OAuth apps can't be created by API anyway |
| 2026-10-21 | Host on **Vercel** (Services: one project, one domain) instead of AWS for now | Shiwam asked for Vercel via GitHub; same origin removes CORS; Hobby is free but non-commercial only |
| 2026-10-21 | On Vercel: upload limit **3.5 MB** by default | Vercel caps request *and* response bodies at 4.5 MB; cleaned CSVs can be slightly larger than the upload |
| 2026-10-21 | Runtime deps duplicated in `pyproject.toml` (test enforces equality) | `vercel dev` installed the backend from pyproject (egg-info appeared), so deps must be there; sample files declared as package data |
| 2026-10-21 | Navbar **GitHub star badge** fetched by the backend (cached 10 min), not the browser | Privacy (visitors never contact GitHub, like the self-hosted font) and stays far under GitHub's 60 req/h unauthenticated limit |
| 2026-10-21 | Shashank's **sign-in dialog** is the sign-in UI; the full page is **sign-up** only | Shashank's contribution was built on first (Shiwam's request); dialog = quick sign-in, page = explains benefits for new users |
| 2026-10-21 | **Supabase** for accounts + saved reports; sign-in with **Google and GitHub** only (OAuth, PKCE) | Shiwam asked for a database, sign-in/sign-up pages and Gmail/GitHub profiles; OAuth means no passwords to store |
| 2026-10-21 | Save **reports only** (aggregates), not files or rows | Shiwam's choice; keeps the privacy promise and the 500 MB free DB |
| 2026-10-21 | Backend writes **as the user** (anon key + user JWT → PostgREST → RLS); service-role key refused at startup | No privileged secret on the server; a backend bug cannot leak other users' rows |
| 2026-10-21 | Backend **recalculates** before saving | Stored figures always come from Python, never from the client |
| 2026-10-21 | Supabase URL/anon key served by `/api/config`, supabase-js lazy-loaded | One place to configure; no rebuild; main bundle stays ~207 kB gzip |
| 2026-10-21 | **UI v2 redesign**: Inter, indigo→violet brand, lucide icons, top 4-step stepper, suggested analyses, data-health ring, light/dark toggle, skeletons | Shiwam found v1 "boring"; the goal was modern, captivating and user-friendly without losing clarity |
| 2026-10-21 | Stepper moved from a left sidebar to a **full-width top bar** | The sidebar squeezed the Analyse page at 1280 px (clipped KPI values, truncated dropdowns) |
| 2026-10-21 | Phones: header **not sticky** below `sm` (superseded 2026-10-21 by Shashank's floating header, sticky everywhere; E2E on Pixel 7 still passes); stepper is a 4-column grid | A sticky header covered tapped elements; a sideways-scrolling tab strip overlapped (found by Playwright on Pixel 7) |
| 2026-10-21 | Data health = **% of cells present and valid**, computed server-side | Honest, definable metric; keeps "Python computes every number" |
| 2026-10-21 | Switch = styled **native checkbox** (`.switch`) | Hidden-input switches broke keyboard, screen-reader and Playwright behaviour |
| 2026-10-21 | Inter **self-hosted** (`@fontsource-variable/inter`) | No third-party font requests (privacy, offline) |
| 2026-10-21 | Trend line kept **straight** (not smoothed) | Smoothing implies values between periods |
| 2026-10-21 | Repo deleted and recreated to remove cached "claude" contributor | A force-push removed the trailers, but GitHub cached the contributor list and old commits |
| 2026-10-21 | Opt-in **merge of case/spacing label variants** (`North`/`north`) | A real small-business data problem; kept opt-in to honour "never silently fix" |
| 2026-10-21 | Gemini default `gemini-3.5-flash-lite` | Google limits 2.5 models to existing users (as of Oct 2026) |
| 2026-10-21 | AWS: Lambda (python3.14, **arm64**) + Function URL + Mangum; S3 + CloudFront OAC; no API Gateway | Fewest services; Function URL has no extra cost; arm64 about 20% cheaper |
| 2026-10-21 | Upload limit **4 MB** | Base64 multipart must fit under Lambda's 6 MB synchronous payload |
| 2026-10-21 | Strings first, then type inference with a **90% threshold**; day-first date tie-break | Same rules for CSV and XLSX; tolerate a few typos; Indian users |
| 2026-10-21 | Stack: FastAPI + pandas 3 + openpyxl · React 19 + Vite 8 + Tailwind 4 + Recharts 3 | Matches Shiwam's skills; current stable versions on Python 3.14 |

## 4. History

| Date | Event |
|---|---|
| 2026-10-21 | Backend built (ingest, profiling, analysis, exports, AI) with 108 pytest tests |
| 2026-10-21 | Frontend v1, Vitest and Playwright E2E using the system Chrome |
| 2026-10-21 | SAM template, deploy script, research notes; Lambda package verified in the official arm64 image + Runtime Interface Emulator |
| 2026-10-21 | Published to GitHub (public); README rewritten in portfolio format |
| 2026-10-21 | Claude co-author trailers removed; repo recreated to clear the cached contributor list |
| 2026-10-21 | `docs/TECHNICAL_REFERENCE.md` (+ PDF) reverse-engineered from the code; 10 findings (F1–F10) |
| 2026-10-21 | UI v2 redesign; `DESIGN.md` and `MEMORY.md` added |
| 2026-10-21 | Shashank pushed the floating navbar (`4faf22d`) and sign-in dialog (`c390ec6`) to `main` |
| 2026-10-21 | **Deployed to Vercel**: https://tabulavibe-ai.vercel.app (all live checks + 8 E2E passed). Auto-deploy on push is **not reliable yet**: `815a004` and `1b8b641` did not deploy; deploys were triggered via the Vercel API from GitHub `main`. Fix: install the Vercel GitHub App on the repo |
| 2026-10-21 | v0.3.0: Supabase accounts (Google/GitHub), profiles, saved reports; 136 pytest, 26 Vitest; GitHub star badge |

## 5. Conventions

- **Commits:**
  - Repo-local identity `ShiwamMishra-0599k <shiwammishrayt@gmail.com>`.
  - **No AI co-author trailers.**
  - Push only when Shiwam asks.
- **Git auth on this PC:** the global credential manager holds a different GitHub account (`swathivpoojary1-oss`). This repo has a local `credential.helper` set to `!gh auth git-credential`, so pushes use `gh`'s login for `ShiwamMishra-0599k`.
- **Ports:** 8000 and 5173 are often taken by other local projects. Use 8010/5180 for dev (`API_PROXY_TARGET`); E2E uses 8011/5181.
- **Accessible names are API.** Tests depend on them:
  - steps "1. Preview" … "4. Report & export"
  - "Run analysis", "Load sample: …", "Table", "Bar", "Donut"
  - "Data preview table", "Grouped results table"
  - "Data health: N%"
- **UTF-8 BOM in Python:** write `chr(0xFEFF)` / `UTF8_BOM`. A formatter here turned `"\ufeff"` escapes into invisible characters.
- **New calculations** need hand-computed test expectations (see `backend/tests/conftest.py`), never values copied from the implementation.
- **Docs to update with every meaningful change:** `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md`, this file.

## 6. Lessons learned and gotchas

- **Identifier heuristic:** "all unique integers = ID" hid real amount columns. Narrowed to *consecutive* integer sequences.
- **Vite + Recharts:** the first E2E run timed out while Vite re-optimised dependencies. Fixed with `optimizeDeps.include: ['recharts']`.
- **Starlette CORS:** 4xx responses carry CORS headers, but **unhandled 500s do not** (F10). This matters once frontend and API are on different origins.
- **GitHub contributors cache:** rewriting history does not refresh the sidebar quickly. Recreating the repo did.
- **Fixture maths:** two "test failures" during development were errors in the hand calculations (West had 1 row, not 2). Re-check the fixture before blaming the code.
- **lucide-react v1** renamed icons (`ChartColumn`, `TriangleAlert`, `LoaderCircle`). Check names against the package before using them.
- **OAuth redirect reloads the page:** the in-memory file is lost on sign-in. The sign-in page warns when a file is open.
- **Shell heredocs:** long multi-line Python heredocs in Bash sometimes fail to parse here. Write the script to the scratchpad and run it.
- **Low memory on this PC (~8 GB):** parallel Playwright + leftover dev servers starved the backend and E2E timed out. Stop old servers and use `--workers=1`.
- **Vercel CLI edits files:** `vercel link` appended `.vercel` and `.env*` to `.gitignore` (the latter would hide `.env.example`) and wrote a token to `.env.local`. Revert the `.gitignore` edit; `.env.local` is already ignored by `.env.*`.
- **Print:** browsers drop background colours, so white-on-gradient headers need `print:` overrides.

## 7. Open items

| Item | Priority | Notes |
|---|---|---|
| Fix F10 (500 responses without CORS headers) | **High before AWS** | See TECHNICAL_REFERENCE §14 |
| Install the Vercel GitHub App on `tabulavibe-ai` (auto-deploy) | **Waiting on Shiwam** | https://github.com/apps/vercel → Configure → Only select repositories |
| Create Supabase project + Google/GitHub OAuth | **Waiting on Shiwam** | `docs/SUPABASE_SETUP.md` steps 1–5; then Claude sets the 3 Vercel env vars and live-tests |
| Deploy to AWS | Optional (Vercel chosen) | Install AWS CLI + SAM, non-root credentials, check Free/Paid plan, follow `docs/DEPLOYMENT.md` |
| Live-test Gemini | Optional | Needs a key from an AI Studio project **without billing** |
| Fix F1–F9 | Low–medium | Filter options vs. label merging (F2) is the most user-visible |
| Report templates | Next feature | Re-apply a saved report's `spec` to a new file |
| Code-split Recharts | Low | Bundle is a single chunk (~200 kB gzipped) |
