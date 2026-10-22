# 📊 TabulaVibe AI: Spreadsheet-to-Dashboard Analytics with Optional Generative AI

An end-to-end business analytics web app built with **FastAPI**, **pandas**, **React + TypeScript** and
optional AI from **Groq** and the **NVIDIA API catalog**, with **NVIDIA Kumo Relational** forecasts. It turns ordinary CSV and Excel files into a data-quality report,
an interactive KPI dashboard, downloadable CSV exports and a print-ready management report. No paid
services are required. Optional **Supabase** accounts (sign up with Google/Gmail or GitHub) let users save
reports and reopen them later.

**🌐 Live demo: <https://tabulavibe-ai.vercel.app>** (hosted on Vercel; sample data is synthetic)

> ⚠️ TabulaVibe AI is a demonstration tool. Files are processed in memory and never stored (saved reports
> keep only aggregated results), but do not upload confidential or regulated data.

## 🚀 Features

- 📥 Upload `.csv` (up to 100 MB) or `.xlsx` (up to 20 MB) files with up to 2 million rows and 200 columns, or load a synthetic sample dataset. The live Vercel site is limited to 3.5 MB by the platform's 4.5 MB request cap
- 👀 Preview the first 50 rows with the inferred type of every column
- 🩺 Data-quality report: missing values, invalid values, exact duplicate rows, labels that differ only by case or spacing
- 🧮 KPI analysis: sum, average, count, minimum and maximum, with a plain-English definition of every number
- 🗂️ Grouping by category, or by a date column at day / week / month / quarter / year
- 🔎 Filters on category values and date ranges
- 📈 Interactive dashboard: KPI cards; line, bar and donut charts (each only where it suits the data); results table
- 🩺 Data-health score: the share of cells that are present and valid, plus a completeness bar for each column
- 🪄 One-click suggested analyses built from your columns (e.g. "revenue by month")
- 🌗 Modern, responsive UI with light/dark themes, a 4-step guided workflow and accessible controls (see [DESIGN.md](DESIGN.md))
- 🧹 Opt-in cleaning: exclude duplicate rows; merge `North` / `north` style label variants
- 📤 Exports: results CSV, cleaned-data CSV (safe from spreadsheet formula injection), printable report (save as PDF)
- 🧭 **Choose your analyst** after uploading: the **AI Analyst** runs the full workflow; the **Manual Analyst** walks you through Preview → Data quality → Analyse → Report & export
- 📑 **Final report as PDF or PowerPoint**: A4 PDF with vector charts, or a 16:9 deck with native, editable PowerPoint charts, for both analysts and for saved reports
- 🤖 **AI analyst**: runs a 9-phase analytics workflow (business understanding → data understanding → problem discovery → preparation → EDA → validation → dashboard → checks → handover) with enforced phase gates. An LLM (Groq, switching to NVIDIA mid-run when Groq cannot finish) plans and explains; Python (pandas, SciPy) computes every number; the AI run is scored against a rules-based baseline and the better one builds the dashboard; NVIDIA Kumo Relational forecasts the primary measure, with a backtest, and every figure in a finding is checked against the calculation it cites. Works without AI via a rules-based analyst ([docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md))
- 👤 Accounts: sign up / sign in with **Google (Gmail) or GitHub** via Supabase Auth; a profile is created on first sign-in
- 🔐 Optional **sign-in-only uploads** (`TABULAVIBE_REQUIRE_SIGN_IN=true`), enforced by the backend on every upload and analysis request
- 💾 **My reports:** save a report (figures, chart data, quality notes, AI commentary) to Supabase Postgres, reopen, print or delete it. Row Level Security keeps every user's reports private
- ✍️ Optional AI commentary: Groq (or NVIDIA as a fallback) summarises the already-calculated results and never sees raw rows
- 📡 REST API built with FastAPI, ready for AWS Lambda (Function URL) + S3 / CloudFront

## 🧰 Tech Stack

| Layer | Tech Used |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS v4, lucide-react icons, Inter (self-hosted) |
| Charts | Recharts 3 (validated colour palette, light and dark themes) |
| Backend | FastAPI 0.156, Uvicorn, Pydantic 2 / pydantic-settings |
| Data processing | pandas 3.0, NumPy, SciPy 1.18 (statistics), openpyxl (Excel), python-multipart |
| Reports | ReportLab 5 (PDF, embedded DejaVu Sans), python-pptx 1.0 (PowerPoint with native charts) |
| Optional LLM | Groq, then the NVIDIA API catalog (OpenAI-compatible chat completions with tool calling) over REST (`httpx`, no SDK) |
| Optional forecasting | NVIDIA Kumo Relational (hosted predictions API, regression per forecast horizon) |
| Optional accounts & database | Supabase: Auth (Google + GitHub OAuth, PKCE) and Postgres with Row Level Security; backend talks to its REST API with `httpx`; `@supabase/supabase-js` (lazy-loaded) in the browser |
| Hosting | **Vercel** (Services: Vite frontend + FastAPI Python function, one domain) |
| Cloud (alternative) | AWS SAM: Lambda (python3.14, arm64) + Function URL, S3 + CloudFront, AWS Budgets |
| Lambda adapter | Mangum |
| Testing | pytest, Vitest + Testing Library, Playwright (uses installed Chrome) |
| Quality | ruff, oxlint, tsc, cfn-lint, pip-audit, npm audit |
| Environment | Python 3.13+ (tested on 3.14.4), Node.js 20+ (tested on 24.15), `.env` |

## 🧠 Analytics Capabilities

- **Type inference:** number, date, yes/no, category, text, empty; plus a role (measure, dimension, time, identifier).
  - Numbers: currency prefixes (₹, Rs, INR, $, €, £), Indian (12,34,567) and Western (1,234,567) digit grouping, decimals, `%`.
  - Dates: one consistent format per column; day-first when ambiguous (`03/04/2024` = 3 April), with a visible note.
  - Ambiguous values such as `1,2` are never treated as numbers.
- **Data quality:**
  - Missing: blank, `NA`, `N/A`, `null`, `-` and similar.
  - Invalid: values that don't fit the column's type.
  - Duplicate rows and case/spacing label variants.
  - Numeric statistics and date ranges.
- **Aggregation:** missing and invalid values are excluded *and counted*. An average of zero values is shown as "no value", never 0.
- **Chart advice:** line for time, bar for categories. Donut only for a single sum/count with 2–8 non-negative groups; otherwise the app explains why not.
- **AI commentary (optional):** a summary sentence plus 3–5 bullet points, using only the numbers provided. Labelled as AI-generated, with a disclaimer.

## 🗂️ Architecture

[ Browser: React SPA keeps the file in memory ] ↓ multipart upload (file + analysis spec) [ FastAPI ]
↓ [ Ingestion Layer ] ├─ Extension + content checks ├─ Macro / zip-bomb guards └─ Size, row, column and cell limits
↓ [ Profiling ] ├─ Type inference ├─ Missing / invalid / duplicates └─ Statistics
↓ [ Analysis Engine (pandas) ] ├─ KPIs ├─ Grouping + time periods ├─ Filters └─ Chart advice
↓ [ Exports ] ├─ Results CSV ├─ Cleaned CSV └─ Printable report (browser)
↓ [ Optional AI Narrative (Groq → NVIDIA): aggregates only ] ↓ [ JSON / CSV responses ]

Uploads are **never stored**; the browser re-sends the file with each request. Only when a signed-in user
chooses **Save report** does the backend recalculate the results and write them (aggregates only) to Supabase,
using that user's own access token, so Row Level Security applies.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🧾 FastAPI Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check and version |
| `GET /api/config` | Upload limits and whether AI is enabled (never exposes the key) |
| `GET /api/github` | Repo link and star count for the navbar badge (server-side, cached 10 min) |
| `GET /api/samples` | List the synthetic sample datasets |
| `GET /api/samples/{id}` | Download a sample file |
| `POST /api/profile` | Preview, column profiles, data-quality issues and suggested measures/dimensions |
| `POST /api/analyze` | KPIs, grouped results, chart advice and calculation notes |
| `POST /api/export/results` | Download the calculated results as CSV |
| `POST /api/export/cleaned` | Download the standardised (cleaned) data as CSV |
| `POST /api/narrative` | Optional AI commentary (returns 503 when AI is disabled) |
| `POST /api/report/export` | Final report as PDF or PowerPoint (`format`: pdf/pptx, `kind`: manual/agent) from computed results |
| `POST /api/agent/run` | AI analyst: streams phase progress (NDJSON), then the validated report |
| `GET /api/account` | Signed-in user's TabulaVibe profile (Bearer token) |
| `POST /api/reports` | Recalculate from the file and save a report (Bearer token) |
| `GET /api/reports` · `GET /api/reports/{id}` · `DELETE /api/reports/{id}` | List, open and delete your own saved reports |

Interactive API docs: `http://localhost:8000/api/docs` (disabled in production).

## 🔁 Chart Selection Logic

| Grouped by | Measures | Values | Chart offered |
|---|---|---|---|
| nothing | any | any | KPI cards only |
| date column | any | any | line chart (default), bar, table |
| category / yes-no | 1 × sum or count | all ≥ 0, 2–8 groups | bar (default), donut, table |
| category / yes-no | average / min / max, or 2+ measures | any | bar, table (donut disabled, with the reason shown) |
| category / yes-no | any | more than 20 groups | bar shows the top 20; table lists up to 100 |

## 📦 Analysis Request Mapping

| Field | Type | Meaning |
|---|---|---|
| `measures` | list (1–6) | `{column, aggregation}`; aggregation is `sum`, `mean`, `count`, `min` or `max`; `column: null` + `count` = number of rows |
| `group_by` | string or null | Category, yes/no or date column |
| `time_grain` | enum | `day`, `week`, `month`, `quarter`, `year` (date grouping only) |
| `filters` | list (≤ 10) | `{column, values}` for categories or `{column, start, end}` for dates (inclusive) |
| `remove_duplicates` | bool | Exclude exact duplicate rows (default `false`) |
| `merge_label_variants` | bool | Merge labels differing only by case/spacing (default `false`) |

## 📋 Requirements

Runtime (`backend/requirements.txt`):

```
fastapi==0.156.3
starlette==1.9.0
pydantic==2.14.1
pydantic-settings==2.16.1
pandas==3.0.6
numpy==2.5.4
openpyxl==3.1.5
python-multipart==0.0.32
httpx==0.28.1
mangum==0.22.0
```

Development (`backend/requirements-dev.txt`): `uvicorn`, `pytest`, `ruff`, `cfn-lint`, `pip-audit`.
Frontend: see `frontend/package.json`.

## ⚙️ Run It Locally (Windows PowerShell)

```powershell
git clone https://github.com/ShiwamMishra-0599k/tabulavibe-ai.git
cd tabulavibe-ai

# Backend (terminal 1)
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# Frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite forwards `/api` to `http://127.0.0.1:8000`.

If those ports are taken:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8010                 # backend
$env:API_PROXY_TARGET = 'http://127.0.0.1:8010'; npx vite --port 5180           # frontend
```

Optional configuration: copy `.env.example` to `backend/.env`.

## 🧪 Testing

```powershell
# Backend: unit, API, AI-provider and Lambda-event tests + lint
cd backend
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\ruff.exe check .

# Frontend: type check, lint, unit tests, build, end-to-end (real Chrome, desktop + mobile)
cd ..\frontend
npm run typecheck; npm run lint; npm test; npm run build
npm run test:e2e
```

Latest results (2026-10-21):
- Backend: 108 pytest tests pass.
- Frontend: 19 Vitest tests pass.
- End-to-end: 8 Playwright runs pass (desktop + mobile, light + dark).
- Lint, type checks and `cfn-lint` are clean.
- `npm audit` and `pip-audit` report 0 known vulnerabilities.

Calculations are checked against hand-computed fixtures and an independent `csv`-module cross-check.

## ✨ Optional AI Commentary

Off by default. To enable it, add to `backend/.env`:

```
TABULAVIBE_AI_PROVIDER=groq,nvidia
TABULAVIBE_GROQ_API_KEY=<key from console.groq.com>
TABULAVIBE_NVIDIA_API_KEY=<nvapi- key from build.nvidia.com>
TABULAVIBE_FORECAST_PROVIDER=kumo
```

The same keys power the AI Analyst. Before enabling them, note:
- Groq is tried first. Its free plan allows only a few thousand tokens a minute, which is smaller than one AI Analyst request, so analyst runs usually continue on NVIDIA (about 40 requests a minute; one run makes roughly 10–20). The short commentary fits Groq's free plan.
- Only aggregated figures are sent (never raw rows), and the UI shows the exact payload. Kumo Relational receives period totals of one measure. NVIDIA's trial terms allow it to record inputs, so do not use it for confidential data.
- If the provider fails or hits its quota, the rest of the app keeps working.

## 👤 Optional Accounts & Saved Reports (Supabase)

Off until configured. Full walkthrough: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

1. Create a free Supabase project and run [`supabase/migrations/…_profiles_and_reports.sql`](supabase/migrations/) in the SQL Editor.
2. Enable the **Google** and **GitHub** providers (OAuth client IDs/secrets live only in Supabase).
3. Add to `backend/.env`:

```
TABULAVIBE_SUPABASE_URL=https://<project-ref>.supabase.co
TABULAVIBE_SUPABASE_ANON_KEY=<publishable / anon key>
```

The anon key is public by design. The backend refuses the service-role/secret key, never stores files or
rows, and every query runs as the signed-in user.

## 🧪 Libraries & Services Used

✅ Successfully Integrated:

- pandas (authoritative calculations)
- openpyxl (read-only, no formula evaluation)
- Recharts
- Groq and the NVIDIA API catalog via REST (optional), NVIDIA Kumo Relational (optional forecasting)
- Supabase Auth + Postgres with Row Level Security (optional)
- Mangum (FastAPI → AWS Lambda)
- Playwright with the system Chrome (no browser download)

❌ Not Used / Dropped:

- **File storage / raw-row tables:** not needed. Only aggregated saved reports go to the database, which keeps the "we don't store your data" promise.
- **Supabase service-role key on the server:** unnecessary and dangerous; user tokens + RLS are enough.
- **API Gateway:** a Lambda Function URL costs nothing extra.
- **AWS Lambda Web Adapter:** adds a second process and slower cold starts compared with Mangum.
- **OpenAI / NVIDIA SDKs:** plain REST is easier to mock and adds no dependency.
- **Google Gemini:** replaced by the NVIDIA API catalog in 0.6.0 (owner's choice).
- **NVIDIA Kumo Relational as the analyst:** it is a prediction model, not a chat model, so it forecasts but cannot plan, call tools or write findings.
- **AI-calculated numbers:** the LLM never produces figures; it only describes pandas results.

## 🛡️ Ethics & Safeguards

⚠️ **No silent fixes:** problems are reported. Cleaning is opt-in and stated in notes, exports and the report.

🔒 **Safe uploads:**
- Extension and file content must match; the client `Content-Type` is ignored.
- Macro workbooks and archives disguised as CSV are rejected; formulas are never executed.
- Size limits are enforced before parsing.

🧾 **Formula-injection protection:** exported cells starting with `= + - @` are neutralised.

🧠 **AI guardrails:**
- Aggregates only.
- Labelled "AI-generated" with a disclaimer.
- Told not to invent numbers or claim causes.
- Rate-limited, and the exact payload is shown to the user.

🛑 **Privacy:**
- Files are processed in memory and never stored. Saved reports hold aggregates only and are private to their owner (RLS).
- File names and cell values are never logged.
- CORS uses an explicit origin list.
- Secrets live only in environment variables.

## ▲ Deployment (Vercel, from GitHub)

[`vercel.json`](vercel.json) deploys the whole app as **one Vercel project on one domain** using Vercel Services:
`/api/*` runs FastAPI as a Python 3.14 function and everything else is the Vite build on Vercel's CDN. Import
the GitHub repo at <https://vercel.com/new> and press Deploy; no settings or environment variables are needed.
On Vercel the backend switches to production mode and a 3.5 MB upload limit automatically (Vercel caps request
and response bodies at 4.5 MB). Step by step, limits and costs: [docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md).

## ☁️ Deployment (AWS, alternative)

Infrastructure as code is ready in `infra/` (SAM template, `deploy.ps1`).
- The template passes `cfn-lint`.
- The arm64 Lambda package (152.5 MB unzipped) was verified in AWS's official Python 3.14 image and the local Lambda emulator.

**Not deployed yet.** Credentials and an account cost check are still needed. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for:
- the verified free-tier conditions
- the cost risks (close to ₹0 for demo traffic, but not guaranteed)
- the step-by-step checklist and teardown

## 🚧 Known Challenges

- **Ambiguous dates and numbers:** `03/04/2024` and `1,2` mean different things in different regions. Handled with a fixed format list, a day-first rule and visible notes.
- **Upload size:** the engine keeps the whole file in memory (peak ≈ 14× the CSV size), so a 100 MB CSV needs about 1.8 GB of RAM and ~45 s per action on an 8 GB laptop. Serverless hosts cap request bodies (Vercel 4.5 MB, Lambda 6 MB), hence 3.5 MB on Vercel and 4 MB on AWS. Multi-gigabyte files would need resumable uploads to object storage, a chunked engine (DuckDB/Polars) and a dedicated paid server.
- **Recharts first-load delay:** Vite re-optimising Recharts on first load made early E2E runs time out. Fixed with `optimizeDeps`.
- **Windows dev environment:**
  - port conflicts with other local projects
  - Windows Credential Manager supplying the wrong GitHub account
  - a formatter turning `U+FEFF` escapes into invisible characters (the UTF-8 BOM is now written as `chr(0xFEFF)`)
- **Public Function URL:** it has no authentication, so cost safety relies on limits and budget alerts.

## 📈 Future Enhancements

- 💾 Report templates: re-apply a saved report's analysis to next month's file in one click
- 📑 Multi-sheet Excel support and joining two files
- 🔐 CloudFront + WAF rate limiting for the public API
- 📊 Period-over-period comparisons (this month vs last month) on KPI cards
- ⚡ Code-split the chart library to shrink the first page load
- 🧪 Live-test the Groq, NVIDIA and Kumo integrations with real keys

## 📚 Documentation

- [PROJECT_SPEC.md](PROJECT_SPEC.md): goals, users, requirements, milestones
- [DESIGN.md](DESIGN.md): design system: tokens, components, charts, motion, accessibility
- [MEMORY.md](MEMORY.md): project memory: decisions, history, conventions, lessons learned
- [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md): in-depth technical reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, API, data rules, security
- [docs/DEPLOYMENT_VERCEL.md](docs/DEPLOYMENT_VERCEL.md): Vercel deployment from GitHub
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): AWS plan, costs, checklist
- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md): accounts (Google/GitHub) and saved reports
- [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md): the AI analyst, its phases, gates, tools and data sharing
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md): what is done, verified and pending
- [docs/CHANGELOG.md](docs/CHANGELOG.md)

## 📌 License

This project is for educational and demo purposes. All sample data is synthetic. For commercial use,
review the terms of third-party services (e.g. Groq, NVIDIA API catalog, AWS).

## 🤝 Contributions

- **Shiwam Mishra** ([@ShiwamMishra-0599k](https://github.com/ShiwamMishra-0599k)): author and maintainer
- **Shashank Chaubey** ([@shashank-chaubey](https://github.com/shashank-chaubey)): floating navigation bar and sign-in dialog

Pull requests and discussions are welcome! Feel free to fork and adapt it for client reporting, small-business
dashboards or internal analytics tools.
