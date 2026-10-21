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
| Purpose | Portfolio project for AI/data engineering roles **and** the foundation for a freelance "dashboards and reporting" service for small businesses (India-first) |
| Repository | https://github.com/ShiwamMishra-0599k/tabulavibe-ai (public) |
| Local path | `C:\Users\swath\projects\tabulavibe-ai` |
| Budget rule | ₹0 software and infrastructure cost wherever possible; never claim "free forever" |
| Status | Local app complete and tested; AWS deployment prepared, **not deployed** (no AWS CLI, SAM or credentials) |
| Version | 0.1.0 (UI v2 "calm confidence" design, 2026-10-21) |

## 2. Non-negotiable product rules

1. **Python computes every number.** The frontend only formats; the LLM only describes aggregates.
   Even display figures like data health (`valid_cell_pct`, `valid_pct`) come from the backend.
2. **Report, never silently fix.** Missing and invalid values are excluded *and counted*. Cleaning (dedupe, label merging) is opt-in and announced.
3. **Store nothing.** The browser re-sends the file with each request; no database, no sessions, no upload storage.
4. **AI is optional and off by default.** It gets aggregates only, its output is labelled, and the exact payload is shown to the user.
5. **Safe uploads:** extension *and* content checks, macro and zip-bomb rejection, formulas never evaluated, limits enforced while streaming.
6. **No Claude/AI attribution in git metadata.** No `Co-Authored-By: Claude` trailers. Shiwam asked for this on 2026-10-21.

## 3. Decision log (newest first)

| Date | Decision | Why |
|---|---|---|
| 2026-10-21 | **UI v2 redesign**: Inter, indigo→violet brand, lucide icons, top 4-step stepper, suggested analyses, data-health ring, light/dark toggle, skeletons | Shiwam found v1 "boring"; the goal was modern, captivating and user-friendly without losing clarity |
| 2026-10-21 | Stepper moved from a left sidebar to a **full-width top bar** | The sidebar squeezed the Analyse page at 1280 px (clipped KPI values, truncated dropdowns) |
| 2026-10-21 | Phones: header **not sticky** below `sm`; stepper is a 4-column grid | A sticky header covered tapped elements; a sideways-scrolling tab strip overlapped (found by Playwright on Pixel 7) |
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
- **Print:** browsers drop background colours, so white-on-gradient headers need `print:` overrides.

## 7. Open items

| Item | Priority | Notes |
|---|---|---|
| Fix F10 (500 responses without CORS headers) | **High before AWS** | See TECHNICAL_REFERENCE §14 |
| Deploy to AWS | Waiting on Shiwam | Install AWS CLI + SAM, non-root credentials, check Free/Paid plan, follow `docs/DEPLOYMENT.md` |
| Live-test Gemini | Optional | Needs a key from an AI Studio project **without billing** |
| Fix F1–F9 | Low–medium | Filter options vs. label merging (F2) is the most user-visible |
| Saved report templates | Next feature | Export/import `AnalysisSpec` JSON; no backend change needed |
| Code-split Recharts | Low | Bundle is a single chunk (~200 kB gzipped) |
