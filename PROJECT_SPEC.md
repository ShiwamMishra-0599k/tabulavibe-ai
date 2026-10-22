# TabulaVibe AI: Project Specification

_Last updated: 2026-10-21. Status of each item: see [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)._

## 1. Purpose

TabulaVibe AI helps small businesses turn ordinary CSV and Excel files into checked, understandable
analytics: a data-quality report, KPI calculations, interactive charts and a printable management
report. It is a portfolio project and the foundation for a freelance "dashboards and reporting" service.

**[ASSUMPTION]** The brief used two names ("InsightForge" in the title, "TabulaVibe AI" as the project
name). The product is called **TabulaVibe AI**.

## 2. Target users

| User | Need |
|---|---|
| Small-business owner / manager (shop, salon, clinic, agency) | "What do my sales/bookings look like by month and by region?" without learning a BI tool |
| Freelancer / analyst (the author) | A fast, repeatable way to show a prospect their own data as a dashboard |
| Prospective client evaluating the service | A credible, polished demo with sample data |

## 3. Core user journey

1. Open the app.
2. Upload a `.csv`/`.xlsx` file, or load a synthetic sample.
3. Preview the first 50 rows with inferred column types.
4. Inspect data quality: missing values, duplicates, invalid values, inconsistent labels.
5. Pick measures (sum / average / count / min / max), a grouping (category or date + time period), filters.
6. Run the analysis and explore KPI cards, a line/bar/donut chart and the results table.
7. Optionally generate AI commentary (off by default).
8. Open the report view; print/save as PDF; download results CSV and cleaned-data CSV.

## 4. Functional requirements

### A. Upload
- `.csv` and `.xlsx` only; extension **and** content are checked (client `Content-Type` is ignored).
- Limits (configurable): CSV 100 MB, Excel 20 MB, 2,000,000 rows, 200 columns, 20,000,000 cells; files over 25 MB are processed one at a time. Vercel: 3.5 MB (platform cap); AWS Lambda: 4 MB.
- Rejected: `.xls`, `.xlsm`/macro workbooks, binary data, archives disguised as CSV, empty and header-only files.
- Excel: first worksheet only; formulas are never evaluated (cached values only).
- Processing is in memory per request; nothing is persisted.

### B. Profiling and data quality
- Rows, columns, inferred type per column (number, date, yes/no, category, text, empty) and role
  (measure, dimension, time, identifier).
- Missing count and %, invalid (unparseable) count with examples, distinct count, numeric stats,
  date range, top values, exact duplicate rows, labels that differ only by case/spacing.
- Issues are **reported, never silently fixed**.

### C. KPI analysis
- Aggregations: sum, average, count (non-missing values or rows), minimum, maximum.
- Group by a category/yes-no column or by a date column at day/week/month/quarter/year.
- Filters: category value lists and inclusive date ranges.
- Opt-in: exclude exact duplicates; merge labels differing only by case/spacing.
- All calculations in Python (pandas). Each KPI shows its definition and how many values were excluded.
- Errors for unknown columns, numeric aggregations on non-numeric columns, invalid groupings/filters.
- Average of zero values is reported as "no value" (`null`), never 0 (division-by-zero guard).

### D. Dashboard
- KPI cards, line chart for time grouping, horizontal bar chart for categories (top 20), donut only when
  proportions are meaningful (single sum/count measure, non-negative, 2–8 groups), results table.
- When a chart type is unsuitable, the UI states why.

### E. Export and reporting
- Results CSV (exactly the calculated table), cleaned-data CSV, printable report (browser print → PDF).
- Cleaned data: standardised numbers/dates/yes-no; missing stays empty; invalid values kept as uploaded.
- Spreadsheet formula injection prevented (`= + - @ \t \r \n` prefixes are neutralised with `'`).

### F. Optional AI narrative
- Disabled by default; provider abstraction (`none`, `nvidia`); key only on the backend.
- Sends only aggregated results (KPIs, ≤30 group rows, column/group labels), never raw rows or file names.
- Output is labelled AI-generated with a disclaimer; failures (missing key, quota, timeout, malformed
  response) never affect the dashboard. The exact payload sent is shown to the user.

## 5. Non-functional requirements
- Accessible: labelled controls, keyboard operable, visible focus, tables for every chart, no colour-only meaning.
- Responsive from 360 px phones to desktop. Light and dark themes.
- No stack traces in responses; no raw data or file names in logs.
- Explicit CORS origins; no credentials in code; `.env` never committed.

## 6. Accounts and saved reports (added in v0.3)
Optional. Users sign up / sign in with Google (Gmail) or GitHub through Supabase Auth; a profile is created on
first sign-in. Signed-in users can save a report (aggregated results, settings, quality summary, optional AI
commentary), list, open, print and delete their own reports. Uploaded files and rows are never stored. Each
user sees only their own data (Postgres Row Level Security). Every other feature works without an account.

## 7. Out of scope
File storage, re-analysing a saved report without the file, editing saved reports, team sharing, scheduled reports, emailing/sharing results,
multi-sheet or joined datasets, pivot tables, forecasting, custom formulas, PDF generation on the server,
custom domains. This tool is **not** certified for confidential, regulated or high-risk data.

## 8. Milestones and acceptance criteria

| Milestone | Acceptance criteria |
|---|---|
| **M1 Local MVP** | Full journey works locally with AI off and no cloud credentials; invalid files rejected safely; calculations match hand-computed fixtures and an independent `csv`-module check; exports verified; README setup works; tests and production build pass |
| **M2 Optional AI** | AI off by default; missing key, provider failure, malformed response, quota and timeout tested; only aggregates sent |
| **M3 Deployment** | Pricing/free-tier verified from official sources; IaC validated; least privilege; budget alert; deployed endpoints verified, **or** a precise checklist and the exact blocker |
| **M4 Handover** | Tests, type checks, lint and build run; docs match the implementation; known gaps listed |
