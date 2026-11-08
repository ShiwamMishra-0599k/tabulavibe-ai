# Benchmarks

## Dataset build time (ingest + type detection)

**What changed:** commit `5d96a5e` (type detection checks each distinct value once instead of once per cell).
**Script:** `backend/scripts/benchmark_build.py`. It is synthetic, seeded data, so it contains no real data.

### How to reproduce
```powershell
cd backend
.\.venv\Scripts\python.exe scripts\benchmark_build.py --rows 300000 --runs 5 --json
```

To compare against the version before the change, run the same script in a worktree of `cef8c29`:
```powershell
git worktree add ..\tv_old cef8c29
copy backend\scripts\benchmark_build.py ..\tv_old\backend\scripts\
cd ..\tv_old\backend; ..\..\tabulavibe-ai\backend\.venv\Scripts\python.exe scripts\benchmark_build.py --json
```

`result_fingerprint` is a hash of every detected column type, role, missing/invalid/unique count, date format and invalid example. If two versions print the same fingerprint, they produced the same results.

### Run of 2026-11-08
Test conditions:
- 300,000 rows × 12 columns, 24.4 MB CSV, seed 42
- 5 timed runs after 1 warm-up
- Python 3.14.4, pandas 3.0.6
- Windows 11, Intel 4 logical CPUs, 8 GB RAM
- Other apps were open, so this was not a quiet machine

| Version | Median (s), session 1 | Median (s), session 2 | Min–max (s) | Fingerprint |
|---|---|---|---|---|
| `cef8c29`, before | 16.41 | 12.42 | 10.37–23.22 | `84a20c6b5212d504` |
| `5d96a5e`+, after | 6.39 | 5.77 | 4.82–14.87 | `84a20c6b5212d504` |

**Reading it:**
- The results are identical, because the fingerprints match.
- On this benchmark the median build time is roughly 2× faster.
- The spread is wide, though: the min and max overlap within single sessions.
- **Don't quote a precise percentage from this run.** First re-run it on a quiet machine with `--runs 10` and record the result here.

The older figure in PROJECT_STATUS (~7.4 s → ~4.2 s) came from a different 21 MB file that isn't in the repo, so it can't be reproduced.
