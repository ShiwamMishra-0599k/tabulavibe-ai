# 📊 TabulaVibe AI: Spreadsheet-to-Dashboard Analytics with Optional Generative AI

An end-to-end business analytics web app built with **FastAPI**, **pandas**, **React + TypeScript** and
optional **Google Gemini** commentary. It turns ordinary CSV and Excel files into a data-quality report,
an interactive KPI dashboard, downloadable CSV exports and a print-ready management report, with no
database and no paid services required.

> ⚠️ TabulaVibe AI is a demonstration tool. Files are processed in memory and never stored, but do not
> upload confidential or regulated data.

## 🚀 Features

- 📥 Upload `.csv` or `.xlsx` files (up to 4 MB, 100,000 rows, 60 columns), or load a synthetic sample dataset
- 👀 Preview the first 50 rows with the inferred type of every column
- 🩺 Data-quality report: missing values, invalid values, exact duplicate rows, labels that differ only by case or spacing
- 🧮 KPI analysis: sum, average, count, minimum and maximum, with a plain-English definition of every number
- 🗂️ Grouping by category, or by a date column at day / week / month / quarter / year
- 🔎 Filters on category values and date ranges
- 📈 Interactive dashboard: KPI cards; line, bar and donut charts (each only where it suits the data); results table
- 🧹 Opt-in cleaning: exclude duplicate rows; merge `North` / `north` style label variants
- 📤 Exports: results CSV, cleaned-data CSV (safe from spreadsheet formula injection), printable report (save as PDF)
- ✍️ Optional AI commentary: Gemini summarises the already-calculated results and never sees raw rows
- 📡 REST API built with FastAPI, ready for AWS Lambda (Function URL) + S3 / CloudFront

## 🧰 Tech Stack

| Layer | Tech Used |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind CSS v4 |
| Charts | Recharts 3 (validated colour palette, light and dark themes) |
| Backend | FastAPI 0.156, Uvicorn, Pydantic 2 / pydantic-settings |
| Data processing | pandas 3.0, NumPy, openpyxl (Excel), python-multipart |
| Optional LLM | Google Gemini over REST (`httpx`, no SDK) |
| Cloud (prepared) | AWS SAM: Lambda (python3.14, arm64) + Function URL, S3 + CloudFront, AWS Budgets |
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
↓ [ Optional Gemini Narrative: aggregates only ] ↓ [ JSON / CSV responses ]

The server is **stateless**. Nothing is stored; the browser re-sends the file with each request.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🧾 FastAPI Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check and version |
| `GET /api/config` | Upload limits and whether AI is enabled (never exposes the key) |
| `GET /api/samples` | List the synthetic sample datasets |
| `GET /api/samples/{id}` | Download a sample file |
| `POST /api/profile` | Preview, column profiles, data-quality issues and suggested measures/dimensions |
| `POST /api/analyze` | KPIs, grouped results, chart advice and calculation notes |
| `POST /api/export/results` | Download the calculated results as CSV |
| `POST /api/export/cleaned` | Download the standardised (cleaned) data as CSV |
| `POST /api/narrative` | Optional AI commentary (returns 503 when AI is disabled) |

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
- Frontend: 15 Vitest tests pass.
- End-to-end: 6 Playwright runs pass.
- Lint, type checks and `cfn-lint` are clean.
- `npm audit` and `pip-audit` report 0 known vulnerabilities.

Calculations are checked against hand-computed fixtures and an independent `csv`-module cross-check.

## ✨ Optional AI Commentary

Off by default. To enable it, add to `backend/.env`:

```
TABULAVIBE_AI_PROVIDER=gemini
TABULAVIBE_GEMINI_API_KEY=<key from a Google AI Studio project without billing>
TABULAVIBE_GEMINI_MODEL=gemini-3.5-flash-lite
```

Before enabling it, note:
- On Gemini's free tier, prompts may be used to improve Google's products. That is why only aggregated figures are sent, and the UI shows the exact payload.
- If the provider fails or hits its quota, the rest of the app keeps working.

## 🧪 Libraries & Services Used

✅ Successfully Integrated:

- pandas (authoritative calculations)
- openpyxl (read-only, no formula evaluation)
- Recharts
- Google Gemini via REST (optional)
- Mangum (FastAPI → AWS Lambda)
- Playwright with the system Chrome (no browser download)

❌ Not Used / Dropped:

- **Database / file storage:** not needed. The stateless design keeps the "we don't store your data" promise.
- **API Gateway:** a Lambda Function URL costs nothing extra.
- **AWS Lambda Web Adapter:** adds a second process and slower cold starts compared with Mangum.
- **Gemini Python SDK:** plain REST is easier to mock and adds no dependency.
- **Gemini 2.5 models:** Google now limits them to existing users, so the default is `gemini-3.5-flash-lite`.
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
- Files are processed in memory and never stored.
- File names and cell values are never logged.
- CORS uses an explicit origin list.
- Secrets live only in environment variables.

## ☁️ Deployment (AWS)

Infrastructure as code is ready in `infra/` (SAM template, `deploy.ps1`).
- The template passes `cfn-lint`.
- The arm64 Lambda package (152.5 MB unzipped) was verified in AWS's official Python 3.14 image and the local Lambda emulator.

**Not deployed yet.** Credentials and an account cost check are still needed. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for:
- the verified free-tier conditions
- the cost risks (close to ₹0 for demo traffic, but not guaranteed)
- the step-by-step checklist and teardown

## 🚧 Known Challenges

- **Ambiguous dates and numbers:** `03/04/2024` and `1,2` mean different things in different regions. Handled with a fixed format list, a day-first rule and visible notes.
- **Lambda payload limit:** Lambda caps payloads at 6 MB and base64 adds about 33%, hence the 4 MB upload limit.
- **Recharts first-load delay:** Vite re-optimising Recharts on first load made early E2E runs time out. Fixed with `optimizeDeps`.
- **Windows dev environment:**
  - port conflicts with other local projects
  - Windows Credential Manager supplying the wrong GitHub account
  - a formatter turning `﻿` escapes into invisible characters (the UTF-8 BOM is now written as `chr(0xFEFF)`)
- **Public Function URL:** it has no authentication, so cost safety relies on limits and budget alerts.

## 📈 Future Enhancements

- 💾 Saved report templates: re-apply the same analysis to next month's file in one click
- 📑 Multi-sheet Excel support and joining two files
- 🔐 Optional authentication and CloudFront + WAF rate limiting for the public API
- 📊 Period-over-period comparisons (this month vs last month) on KPI cards
- ⚡ Code-split the chart library to shrink the first page load
- 🧪 Live-test the Gemini integration with a free-tier key

## 📚 Documentation

- [PROJECT_SPEC.md](PROJECT_SPEC.md): goals, users, requirements, milestones
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, API, data rules, security
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): AWS plan, costs, checklist
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md): what is done, verified and pending
- [docs/CHANGELOG.md](docs/CHANGELOG.md)

## 📌 License

This project is for educational and demo purposes. All sample data is synthetic. For commercial use,
review the terms of third-party services (e.g. Google Gemini API, AWS).

## 🤝 Contributions

Pull requests and discussions are welcome! Feel free to fork and adapt it for client reporting, small-business
dashboards or internal analytics tools.
