"""CSV exports with spreadsheet formula-injection protection."""

from __future__ import annotations

import csv
import io
from typing import Any

import pandas as pd

from .profiling import MISSING_TOKENS, Dataset

# OWASP CSV injection guidance: cells starting with these characters may be run as formulas.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def safe_cell(value: Any) -> str:
    """Render a text cell, neutralising anything a spreadsheet could treat as a formula."""
    if value is None:
        return ""
    text = str(value)
    if text.startswith(_FORMULA_PREFIXES):
        return "'" + text
    return text


def format_number(value: float | None) -> str:
    """Plain, locale-independent number text (no thousands separators)."""
    if value is None or pd.isna(value):
        return ""
    if float(value).is_integer() and abs(value) < 1e15:
        return str(int(value))
    return repr(float(value))


def _to_csv(header: list[str], rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow([safe_cell(h) for h in header])
    writer.writerows(rows)
    # UTF-8 BOM so Excel opens non-ASCII text (e.g. ₹) correctly.
    return "﻿" + buffer.getvalue()


def cleaned_rows(ds: Dataset, remove_duplicates: bool) -> tuple[list[str], list[list[str]], dict[str, int]]:
    """Standardise parseable values; keep unparseable values exactly as uploaded; leave missing values empty."""
    raw = ds.raw
    typed = ds.typed
    keep = ~raw.duplicated(keep="first") if remove_duplicates else pd.Series(True, index=raw.index)
    raw = raw[keep]
    typed = typed[keep]
    columns: list[list[str]] = []
    for name in raw.columns:
        info = ds.columns[name]
        r = raw[name]
        t = typed[name]
        if info.inferred_type == "number":
            out = [format_number(v) if not pd.isna(v) else None for v in t]
        elif info.inferred_type == "date":
            has_time = bool(((t.dropna() - t.dropna().dt.normalize()) != pd.Timedelta(0)).any())
            fmt = "%Y-%m-%d %H:%M:%S" if has_time else "%Y-%m-%d"
            out = [v.strftime(fmt) if not pd.isna(v) else None for v in t]
        elif info.inferred_type == "boolean":
            out = [("true" if v else "false") if not pd.isna(v) else None for v in t]
        elif info.inferred_type in {"category", "text"}:
            out = [None if pd.isna(v) else str(v) for v in t]
        else:
            out = [None] * len(r)
        # Fall back to the original text for invalid (unparseable) values; missing stays empty.
        is_missing = r.str.lower().isin(MISSING_TOKENS)
        final = []
        for value, original, missing in zip(out, r.tolist(), is_missing.tolist(), strict=True):
            if value is not None:
                final.append(value if info.inferred_type == "number" else safe_cell(value))
            elif missing:
                final.append("")
            else:
                final.append(safe_cell(original))
        columns.append(final)
    rows = [list(row) for row in zip(*columns, strict=True)] if columns else []
    summary = {"rows_exported": len(rows), "duplicates_removed": int((~keep).sum())}
    return list(raw.columns), rows, summary


def cleaned_csv(ds: Dataset, remove_duplicates: bool) -> tuple[str, dict[str, int]]:
    header, rows, summary = cleaned_rows(ds, remove_duplicates)
    return _to_csv(header, rows), summary


def results_csv(result: dict[str, Any]) -> str:
    measures = result["measures"]
    if result["grouping"]:
        header = [result["grouping"]["column"], "row_count"] + [m["label"] for m in measures]
        rows = [
            [safe_cell(r["group"]), str(r["row_count"])] + [format_number(r["values"][m["key"]]) for m in measures] for r in result["rows"]
        ]
    else:
        header = ["measure", "value", "values_used", "values_excluded", "definition"]
        rows = [
            [safe_cell(k["label"]), format_number(k["value"]), str(k["values_used"]), str(k["values_excluded"]), safe_cell(k["definition"])]
            for k in result["kpis"]
        ]
    return _to_csv(header, rows)
