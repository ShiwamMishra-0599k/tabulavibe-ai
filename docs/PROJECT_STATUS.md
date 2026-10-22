# Project status

_Last updated: 2026-10-22 (v0.4.0: AI analyst and responsive navigation)_

| Milestone | Status | Evidence |
|---|---|---|
| M1 Local dashboard MVP | **Done** | Full journey verified in real Chrome on desktop and mobile viewports (Playwright). Hand-computed fixtures and an independent `csv` cross-check pass |
| M2 Optional AI commentary | **Done** (not live-tested) | Provider abstraction plus Gemini REST provider. Missing key, failures, quota, timeouts, malformed responses and rate limiting are tested. No real API key was available, so no live Gemini call was made |
| M3 GitHub / AWS deployment | **GitHub: done. AWS: prepared, not deployed** | Public repo <https://github.com/ShiwamMishra-0599k/tabulavibe-ai> (pushed and verified 2026-10-21). SAM template passes cfn-lint; the arm64 package was built and invoked in the official Lambda image; deploy script and checklist written. AWS blocker below |
| v0.4 AI analyst (workflow phases 0–8) | **Built and tested locally; Gemini mode not live-tested** | Rules-based analyst verified end to end (pytest, Vitest, Playwright on both samples). Gemini mode tested against a scripted fake of the generateContent API only: no API key is configured. See [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) |
| Small-screen navigation | **Fixed locally** | Header is a compact toolbar with icon-only narrow-screen actions; workflow and analyst report tabs use horizontal touch scrolling; frontend build and 36 Vitest tests pass |
| Vercel deployment | **Live: <https://tabulavibe-ai.vercel.app>** (2026-10-21) | Project `shiwam/tabulavibe-ai` (Hobby), built from GitHub `main`. Verified live: health, both samples, CSV + XLSX profile, analysis (same totals as local), both CSV exports, 413 above 3.5 MB, docs hidden, security headers, and all 8 Playwright journeys (desktop + Pixel 7) via `E2E_BASE_URL`. See [DEPLOYMENT_VERCEL.md](DEPLOYMENT_VERCEL.md) |
| M4 Quality and handover | **Done** | See the check results below |
| v0.3 Accounts + saved reports (Supabase) | **Live** (2026-10-21) | Project `xftrxawqcoygrzohaase`: tables and RLS created (anonymous access refused, verified), Google + GitHub providers on (OAuth hand-offs verified). Shiwam signed in and saved a report on the live site. `TABULAVIBE_REQUIRE_SIGN_IN=true` set in Vercel; effective from the next deployment. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) |

## Check results (2026-10-22)

| Check | Result |
|---|---|
| Backend `pytest` | 238 passed |
| Backend `ruff check` / `ruff format --check` | clean |
| Frontend `tsc -b` | clean |
| Frontend `oxlint` | 0 warnings, 0 errors |
| Frontend `vitest run` | 36 passed |
| Frontend `vite build` | OK (main JS 207 kB gzipped + lazy supabase-js chunk 54 kB gzipped; Inter Latin font 48 kB; Vite warns about chunk size) |
| Playwright E2E (Chrome, desktop + Pixel 7 viewport, light + dark) | 10 passed (serially; parallel runs time out on this 8 GB PC) |
| `cfn-lint infra/template.yaml` | clean |
| `npm audit` / `pip-audit -r requirements.txt` | 0 known vulnerabilities |
| Secret scan (AWS, Google, GitHub, OpenAI key patterns, private keys) | none found |
| Lambda package in `public.ecr.aws/lambda/python:3.14` arm64 + Runtime Interface Emulator | health, analyze, XLSX profile, production docs hidden: all as expected |

## Blockers for deployment

1. **AWS:** the AWS CLI and SAM CLI are not installed and there are no AWS credentials. The account plan, free-tier eligibility and credits are therefore unknown, so the ₹0 budget cannot be evaluated for a real account. Follow [DEPLOYMENT.md](DEPLOYMENT.md).

## Upload size (measured 2026-10-22 on this 8 GB Windows laptop)

| File | Peak memory | Time |
|---|---|---|
| CSV 17 MB (300,000 rows × 9) | 0.4 GB | ~8 s per action |
| CSV 35 MB (600,000 rows) | 0.7 GB | ~16 s per action |
| CSV 50 MB (860,000 rows), through the running app | — | profile 40 s; AI analyst 45 s (all phases passed) |
| CSV 70 MB (1,200,000 rows) | 1.3 GB | ~32 s per action, AI analyst +24 s |
| Excel 9 MB (200,000 rows) | — | 32 s just to read (openpyxl) |

Limits: CSV 100 MB, Excel 20 MB, 2,000,000 rows, 20,000,000 cells (local/self-hosted); 3.5 MB on Vercel; 4 MB on AWS.
A 10 GB limit was requested and is not feasible with the in-memory, re-upload-per-request design (see README, Known Challenges).

## Known limitations

- Signing in redirects to Google/GitHub and back, which reloads the page and closes an open file (the sign-in page warns about this).
- Saved reports are snapshots: to change one, upload the file again and save a new report.
- Supabase Free projects pause after a week without activity.
- The API is a public, unauthenticated Lambda Function URL. It is protected only by size limits, CORS (a browser control, not an access control) and budget alerts. Abuse could create charges beyond the free tier.
- The AI rate limiter is per Lambda instance and in memory. It is a burst guard, not a quota.
- Only the first Excel worksheet is read. Formulas use the values Excel last saved; workbooks generated by code without cached values show those cells as empty.
- Date parsing uses a fixed list of formats. Mixed formats within one column count as invalid values.
- The main frontend bundle is a 207 kB (gzipped) chunk. Code-splitting Recharts is a possible optimisation.
- `starlette.testclient` warns that `httpx` is deprecated in favour of `httpx2`. The warning is filtered in tests; the app itself is unaffected.
- `openpyxl` 3.1.5 and `httpx` 0.28.1 do not officially list Python 3.14 in their classifiers. Both are pure Python, and every test passes on 3.14.4.

## Next recommended improvement

1. Create the Supabase project and OAuth apps ([SUPABASE_SETUP.md](SUPABASE_SETUP.md)), then live-test sign-in and saving.
2. "Report templates": re-apply a saved report's analysis spec to next month's file in one click. That turns a
   one-off demo into a repeatable monthly reporting service.
