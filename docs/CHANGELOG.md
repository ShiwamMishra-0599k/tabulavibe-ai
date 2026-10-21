# Changelog

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
