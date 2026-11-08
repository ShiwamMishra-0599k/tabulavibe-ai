"""Repeatable benchmark for dataset build time (ingest + type detection).

It generates a synthetic CSV from a fixed seed (no real data), then times
`load_table` + `build_dataset` several times and reports the median.

Run from the backend folder:
    .venv\\Scripts\\python.exe scripts\\benchmark_build.py --rows 300000 --runs 5

To compare two versions, run the same command in a git worktree of each commit
(see docs/BENCHMARKS.md). Only compare numbers taken on the same machine.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import platform
import random
import statistics
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from app.config import Settings  # noqa: E402
from app.ingest import load_table  # noqa: E402
from app.profiling import build_dataset  # noqa: E402

REGIONS = ["North", "South", "East", "West", "north", "NORTH ", "Sout h"]
CATEGORIES = ["Beverages", "Snacks", "Household", "Personal Care", "Stationery"]
MISSING = ["", "NA", "n/a", "-", "null"]


def make_csv(rows: int, seed: int) -> bytes:
    """Mixed-type table with deliberate mess: missing tokens, label variants, % and currency."""
    rng = random.Random(seed)
    start = date(2025, 1, 1)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "order_id",
            "order_date",
            "region",
            "category",
            "channel",
            "units",
            "unit_price",
            "revenue",
            "discount_pct",
            "returned",
            "customer_rating",
            "notes",
        ]
    )
    for i in range(rows):
        units = rng.randint(1, 40)
        price = round(rng.uniform(10, 500), 2)
        w.writerow(
            [
                f"ORD-{i:07d}",
                (start + timedelta(days=rng.randrange(365))).isoformat(),
                rng.choice(REGIONS),
                rng.choice(CATEGORIES),
                rng.choice(["Store", "Online", "online"]),
                units if rng.random() > 0.01 else rng.choice(MISSING),
                f"₹{price:,.2f}" if rng.random() < 0.3 else price,
                round(units * price, 2) if rng.random() > 0.02 else rng.choice(MISSING),
                f"{rng.choice([0, 5, 10, 15])}%",
                rng.choice(["yes", "no", "Yes", "N", "Y"]),
                rng.choice(["1", "2", "3", "4", "5", "", "n/a"]),
                rng.choice(["", "", "gift wrap", "late delivery", "damaged box"]),
            ]
        )
    return buf.getvalue().encode("utf-8")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--rows", type=int, default=300_000)
    p.add_argument("--runs", type=int, default=5)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--json", action="store_true", help="print one JSON line instead of text")
    args = p.parse_args()

    content = make_csv(args.rows, args.seed)
    settings = Settings()
    load_table("bench.csv", content, settings)  # warm-up (imports, caches)

    times = []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        ds = build_dataset(load_table("bench.csv", content, settings))
        times.append(time.perf_counter() - t0)

    result = {
        "rows": args.rows,
        "columns": 12,
        "csv_mb": round(len(content) / 1e6, 1),
        "seed": args.seed,
        "runs": args.runs,
        "median_s": round(statistics.median(times), 3),
        "min_s": round(min(times), 3),
        "max_s": round(max(times), 3),
        "column_types": {n: c.inferred_type for n, c in ds.columns.items()},
        # Same fingerprint on two versions = same detected types, counts and examples.
        "result_fingerprint": hashlib.sha256(
            json.dumps(
                {
                    n: [c.inferred_type, c.role, c.missing_count, c.invalid_count, c.unique_count, c.date_format, c.invalid_examples]
                    for n, c in ds.columns.items()
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()[:16],
        "python": platform.python_version(),
        "pandas": pd.__version__,
        "machine": f"{platform.system()} {platform.release()} / {platform.processor() or platform.machine()} / {os.cpu_count()} logical CPUs",
    }
    if args.json:
        print(json.dumps(result))
    else:
        for k, v in result.items():
            print(f"{k:>14}: {v}")


if __name__ == "__main__":
    main()
