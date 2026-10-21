"""Column type inference, typed conversion and data-quality profiling.

Inference works on trimmed strings so CSV and XLSX follow the same rules:
- missing: empty cell or a common placeholder (NA, N/A, null, none, nan, -, --, #N/A)
- number: optional sign, optional currency prefix (₹ Rs INR $ € £), digits with optional
  thousands separators (1,234,567 or Indian 12,34,567), optional decimals, optional trailing %
- date: one consistent format from a fixed list (day-first preferred when ambiguous)
- boolean: true/false/yes/no
- category: text with a limited number of distinct values; otherwise text
A column gets a numeric/date/boolean type when at least 90% of its non-missing values
parse. The remaining values are reported as invalid and excluded from calculations;
they are never silently altered.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from .ingest import RawTable

TYPE_THRESHOLD = 0.9
SAMPLE_SIZE = 1000
MISSING_TOKENS = frozenset({"", "na", "n/a", "null", "none", "nan", "-", "--", "#n/a", "nil"})
BOOLEAN_TRUE = frozenset({"true", "yes"})
BOOLEAN_FALSE = frozenset({"false", "no"})

_CURRENCY_PREFIX = re.compile(r"^([+-]?)\s*(?:₹|rs\.?|inr|\$|€|£)\s*", re.IGNORECASE)
_NUMBER = re.compile(r"[+-]?(?:\d{1,3}(?:,\d{2,3})*,\d{3}|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?")
_HAS_DIGIT = re.compile(r"\d")
_ID_NAME = re.compile(r"(^|[_\s-])(id|no|code|zip|pin|pincode|phone|mobile)$|^id[_\s-]", re.IGNORECASE)
_CAMEL_ID = re.compile(r"[a-z]I[dD]$")

# Ordered: earlier formats win ties (day-first before month-first).
DATE_FORMATS = [
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%m-%d-%Y",
    "%d.%m.%Y",
    "%Y/%m/%d",
    "%d/%m/%Y %H:%M",
    "%m/%d/%Y %H:%M",
    "%d %b %Y",
    "%d-%b-%Y",
    "%b %d, %Y",
    "%d %B %Y",
    "%B %d, %Y",
    "%Y-%m",
    "%b %Y",
    "%B %Y",
]
_AMBIGUOUS_PAIRS = {("%d/%m/%Y", "%m/%d/%Y"), ("%d-%m-%Y", "%m-%d-%Y"), ("%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M")}


@dataclass
class ColumnInfo:
    name: str
    inferred_type: str  # number | date | boolean | category | text | empty
    role: str  # measure | dimension | time | identifier | other
    missing_count: int
    invalid_count: int
    unique_count: int
    date_format: str | None = None
    invalid_examples: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class Dataset:
    raw: pd.DataFrame  # trimmed strings
    typed: pd.DataFrame  # float64 / datetime64 / boolean / object
    columns: dict[str, ColumnInfo]
    source: RawTable

    @property
    def row_count(self) -> int:
        return len(self.raw)


def _missing_mask(series: pd.Series) -> pd.Series:
    return series.str.lower().isin(MISSING_TOKENS)


def parse_numbers(values: pd.Series) -> pd.Series:
    """Vectorised number parsing. Unparseable values become NaN."""
    text = values.astype(str)
    text = text.str.replace(_CURRENCY_PREFIX, r"\1", regex=True)
    text = text.str.replace(r"\s*%$", "", regex=True)
    valid = text.str.fullmatch(_NUMBER) & text.str.contains(_HAS_DIGIT)
    cleaned = text.where(valid).str.replace(",", "", regex=False)
    return pd.to_numeric(cleaned, errors="coerce").astype("float64")


def _parse_dates(values: pd.Series, fmt: str) -> pd.Series:
    return pd.to_datetime(values, format=fmt, errors="coerce")


def _best_date_format(sample: pd.Series) -> tuple[str | None, float, bool]:
    best_fmt, best_rate, ambiguous = None, 0.0, False
    rates: dict[str, float] = {}
    for fmt in DATE_FORMATS:
        rate = float(_parse_dates(sample, fmt).notna().mean())
        rates[fmt] = rate
        if rate > best_rate:
            best_fmt, best_rate = fmt, rate
    if best_fmt:
        for a, b in _AMBIGUOUS_PAIRS:
            if best_fmt == a and rates.get(b, 0) >= TYPE_THRESHOLD:
                ambiguous = True
    return best_fmt, best_rate, ambiguous


def _is_identifier(name: str, numeric: pd.Series | None, unique: int, present: int) -> bool:
    if _ID_NAME.search(name.strip()) or _CAMEL_ID.search(name.strip()):
        return True
    if numeric is not None and present >= 20 and unique == present:
        # Unique, consecutive whole numbers (1, 2, 3, ...) look like row or record numbers.
        whole = numeric.dropna().sort_values()
        return bool((whole == whole.round()).all()) and bool((whole.diff().dropna() == 1).all())
    return False


def _examples(series: pd.Series, mask: pd.Series, limit: int = 3) -> list[str]:
    return [v[:60] for v in series[mask].drop_duplicates().head(limit).tolist()]


def build_dataset(table: RawTable) -> Dataset:
    raw = table.frame.astype(str)
    typed_columns: dict[str, pd.Series] = {}
    infos: dict[str, ColumnInfo] = {}

    for name in raw.columns:
        series = raw[name]
        missing = _missing_mask(series)
        present_values = series[~missing]
        present = int(len(present_values))
        unique = int(present_values.nunique())
        info_kwargs: dict[str, Any] = {"missing_count": int(missing.sum()), "unique_count": unique}

        if present == 0:
            typed_columns[name] = pd.Series([np.nan] * len(series), index=series.index, dtype="float64")
            infos[name] = ColumnInfo(name, "empty", "other", invalid_count=0, **info_kwargs)
            continue

        sample = present_values.head(SAMPLE_SIZE)
        lowered = sample.str.lower()

        # boolean
        if lowered.isin(BOOLEAN_TRUE | BOOLEAN_FALSE).mean() >= TYPE_THRESHOLD:
            low_all = series.str.lower()
            typed = pd.Series(pd.NA, index=series.index, dtype="boolean")
            typed[low_all.isin(BOOLEAN_TRUE)] = True
            typed[low_all.isin(BOOLEAN_FALSE)] = False
            invalid = ~missing & typed.isna()
            typed_columns[name] = typed
            infos[name] = ColumnInfo(
                name,
                "boolean",
                "dimension",
                invalid_count=int(invalid.sum()),
                invalid_examples=_examples(series, invalid),
                **info_kwargs,
            )
            continue

        # number
        if parse_numbers(sample).notna().mean() >= TYPE_THRESHOLD:
            numbers = parse_numbers(series.where(~missing, ""))
            invalid = ~missing & numbers.isna()
            role = "identifier" if _is_identifier(name, numbers, unique, present) else "measure"
            notes = []
            if series[~missing].str.contains(r"%$", regex=True).any():
                notes.append("Percent signs were removed; values are kept on their original scale (12% → 12).")
            typed_columns[name] = numbers
            infos[name] = ColumnInfo(
                name,
                "number",
                role,
                invalid_count=int(invalid.sum()),
                invalid_examples=_examples(series, invalid),
                notes=notes,
                **info_kwargs,
            )
            continue

        # date (skip quickly when the sample has no digits at all)
        if sample.str.contains(_HAS_DIGIT).mean() >= TYPE_THRESHOLD:
            fmt, rate, ambiguous = _best_date_format(sample)
            if fmt and rate >= TYPE_THRESHOLD:
                dates = _parse_dates(series.where(~missing, None), fmt)
                invalid = ~missing & dates.isna()
                notes = []
                if ambiguous:
                    notes.append("Dates such as 03/04/2024 are ambiguous; they were read as day/month/year.")
                typed_columns[name] = dates
                infos[name] = ColumnInfo(
                    name,
                    "date",
                    "time",
                    invalid_count=int(invalid.sum()),
                    date_format=fmt,
                    invalid_examples=_examples(series, invalid),
                    notes=notes,
                    **info_kwargs,
                )
                continue

        # category / text
        typed_columns[name] = series.where(~missing, None).astype(object)
        is_category = unique <= 200 or unique / present <= 0.2
        notes = []
        normalised = present_values.str.lower().str.replace(r"\s+", " ", regex=True)
        variant_count = unique - int(normalised.nunique())
        if variant_count > 0:
            notes.append(
                f"{variant_count} value(s) differ from another value only by letter case or spacing "
                "(for example 'North' and 'north'); they are treated as separate values."
            )
        if is_category:
            role = "identifier" if _is_identifier(name, None, unique, present) else "dimension"
        else:
            role = "identifier" if _is_identifier(name, None, unique, present) or unique / present > 0.95 else "other"
        infos[name] = ColumnInfo(
            name,
            "category" if is_category else "text",
            role,
            invalid_count=0,
            notes=notes,
            **info_kwargs,
        )

    typed = pd.DataFrame(typed_columns, index=raw.index)
    return Dataset(raw=raw, typed=typed, columns=infos, source=table)


# ---------------------------------------------------------------------- profile


def _num(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if np.isfinite(out) else None


def column_profile(ds: Dataset, name: str) -> dict[str, Any]:
    info = ds.columns[name]
    n = ds.row_count
    typed = ds.typed[name]
    profile: dict[str, Any] = {
        "name": name,
        "inferred_type": info.inferred_type,
        "role": info.role,
        "missing_count": info.missing_count,
        "missing_pct": round(info.missing_count / n * 100, 2) if n else 0.0,
        "invalid_count": info.invalid_count,
        "invalid_examples": info.invalid_examples,
        "unique_count": info.unique_count,
        "date_format": info.date_format,
        "notes": info.notes,
        "numeric_stats": None,
        "date_range": None,
        "top_values": None,
    }
    if info.inferred_type == "number":
        values = typed.dropna()
        if len(values):
            profile["numeric_stats"] = {
                "count": int(len(values)),
                "sum": _num(values.sum()),
                "mean": _num(values.mean()),
                "median": _num(values.median()),
                "std": _num(values.std(ddof=1)) if len(values) > 1 else None,
                "min": _num(values.min()),
                "max": _num(values.max()),
            }
    elif info.inferred_type == "date":
        values = typed.dropna()
        if len(values):
            profile["date_range"] = {"min": values.min().isoformat(), "max": values.max().isoformat()}
    elif info.inferred_type in {"category", "boolean", "text"}:
        counts = ds.raw[name][~_missing_mask(ds.raw[name])].value_counts().head(5)
        if info.inferred_type == "boolean":
            counts = typed.dropna().map({True: "true", False: "false"}).value_counts().head(5)
        profile["top_values"] = [{"value": str(k)[:80], "count": int(v)} for k, v in counts.items()]
    return profile


def duplicate_row_count(ds: Dataset) -> int:
    return int(ds.raw.duplicated(keep="first").sum())


def suggestions(ds: Dataset) -> dict[str, list[str]]:
    measures = [c.name for c in ds.columns.values() if c.role == "measure"]
    dates = [c.name for c in ds.columns.values() if c.role == "time"]
    dimensions = sorted(
        (c for c in ds.columns.values() if c.role == "dimension" and c.unique_count >= 2),
        key=lambda c: (c.unique_count > 30, c.unique_count),
    )
    return {"measures": measures, "dimensions": [c.name for c in dimensions], "dates": dates}


def build_profile(ds: Dataset, filename: str | None, preview_rows: int = 50) -> dict[str, Any]:
    columns = [column_profile(ds, name) for name in ds.raw.columns]
    duplicates = duplicate_row_count(ds)
    total_cells = ds.row_count * len(columns)
    missing_cells = sum(c["missing_count"] for c in columns)
    issues: list[dict[str, str]] = []
    if duplicates:
        issues.append(
            {
                "severity": "warning",
                "code": "duplicate_rows",
                "message": f"{duplicates} row(s) are exact duplicates of an earlier row. They are kept unless you choose to remove them.",
            }
        )
    for c in columns:
        if c["missing_count"] and c["inferred_type"] != "empty":
            issues.append(
                {
                    "severity": "info" if c["missing_pct"] < 20 else "warning",
                    "code": "missing_values",
                    "message": f"'{c['name']}' has {c['missing_count']} missing value(s) ({c['missing_pct']}%). They are left empty and excluded from calculations.",
                }
            )
        if c["invalid_count"]:
            issues.append(
                {
                    "severity": "warning",
                    "code": "invalid_values",
                    "message": f"'{c['name']}' has {c['invalid_count']} value(s) that are not a valid {c['inferred_type']} (e.g. {', '.join(repr(e) for e in c['invalid_examples'])}). They are excluded from calculations.",
                }
            )
        if c["inferred_type"] == "empty":
            issues.append({"severity": "info", "code": "empty_column", "message": f"'{c['name']}' is completely empty."})
        for note in c["notes"]:
            issues.append({"severity": "info", "code": "column_note", "message": f"'{c['name']}': {note}"})

    preview = ds.raw.head(preview_rows)
    return {
        "dataset": {
            "file_name": (filename or "")[:200],
            "file_type": ds.source.file_type,
            "sheet_name": ds.source.sheet_name,
            "row_count": ds.row_count,
            "column_count": len(columns),
            "duplicate_row_count": duplicates,
            "missing_cell_count": missing_cells,
            "missing_cell_pct": round(missing_cells / total_cells * 100, 2) if total_cells else 0.0,
            "empty_rows_skipped": ds.source.empty_rows_dropped,
        },
        "columns": columns,
        "issues": issues,
        "notes": ds.source.notes,
        "preview": {"columns": list(ds.raw.columns), "rows": preview.values.tolist(), "total_rows": ds.row_count},
        "suggestions": suggestions(ds),
    }
