# CLAUDE.md: working on TabulaVibe AI

Read `MEMORY.md` (decisions, conventions, gotchas), `PROJECT_SPEC.md`, `docs/ARCHITECTURE.md` and
`docs/PROJECT_STATUS.md` before changing anything. UI work follows `DESIGN.md`.

## Commands (Windows PowerShell)

| Task | Command |
|---|---|
| Backend tests | `cd backend; .\.venv\Scripts\python.exe -m pytest` |
| Backend lint/format | `.\.venv\Scripts\ruff.exe check .` · `.\.venv\Scripts\ruff.exe format .` |
| Backend dev server | `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000` |
| Frontend checks | `cd frontend; npm run typecheck; npm run lint; npm test; npm run build` |
| E2E (local Chrome) | `cd frontend; npm run test:e2e` |
| Validate infra | `backend\.venv\Scripts\cfn-lint.exe infra\template.yaml` |
| Regenerate samples | `cd backend; .\.venv\Scripts\python.exe scripts\generate_samples.py` |

Ports 8000/5173 may already be in use on the author's machine. Use `--port 8010` and `API_PROXY_TARGET`
(see README).

## Rules

- All numbers come from `backend/app/analysis.py`. The frontend formats values but never calculates them, and the AI only summarises them.
- Never silently change user data. Detect and report it; any cleaning is opt-in and stated in notes, headers and the report.
- Never store uploads or raw rows. The only persistence is Supabase (`profiles`, `reports`: aggregates only), via
  `app/storage.py`, using the user's own token and RLS. Never use the service-role key. Schema changes go in a new
  file in `supabase/migrations/`. Accounts stay optional: everything else must work with Supabase unset.
- New calculations need tests with hand-computed expected values (see `tests/conftest.py`).
- User-facing error messages go through `DataError`/`AppError`. Never return stack traces.
- Never log file contents, file names or cell values.
- CSV exports must go through `export.safe_cell` / `format_number`.
- Secrets live only in environment variables. Never in `VITE_*` variables, code or committed files.
- Keep the AI optional: core features and tests must pass with `TABULAVIBE_AI_PROVIDER=none`.
- UI follows `DESIGN.md`: tokens in `src/index.css`, components in `src/components/ui.tsx`, icons from lucide-react.
  Keep one measure per chart (no dual axes) and keep accessible names stable (tests depend on them).
- Never add `Co-Authored-By: Claude` or other AI attribution to commits (owner's instruction).
- Write the BOM as `chr(0xFEFF)` or `UTF8_BOM`. A formatter in this environment turned U+FEFF (byte-order-mark) escapes into invisible characters.
- Update `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md` and `MEMORY.md` with every meaningful change.
