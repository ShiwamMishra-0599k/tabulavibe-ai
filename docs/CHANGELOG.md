# Changelog

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
