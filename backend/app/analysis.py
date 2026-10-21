"""Authoritative KPI calculations. Every number shown in the UI comes from here."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .errors import DataError
from .profiling import Dataset, _num
from .schemas import AnalysisSpec, Filter, Measure

AGG_LABELS = {"sum": "Sum", "mean": "Average", "count": "Count", "min": "Minimum", "max": "Maximum"}
NUMERIC_AGGS = {"sum", "mean", "min", "max"}
GROUPABLE_TYPES = {"category", "boolean", "date", "text"}
MISSING_GROUP = "(missing)"
PIE_MAX_SLICES = 8


def measure_key(m: Measure) -> str:
    return f"{m.aggregation}__{m.column}" if m.column else "count__rows"


def measure_label(m: Measure) -> str:
    if m.column is None:
        return "Number of rows"
    return f"{AGG_LABELS[m.aggregation]} of {m.column}"


def _validate(ds: Dataset, spec: AnalysisSpec) -> None:
    keys = set()
    for m in spec.measures:
        key = measure_key(m)
        if key in keys:
            raise DataError("duplicate_measure", f"'{measure_label(m)}' was requested more than once.")
        keys.add(key)
        if m.column is None:
            continue
        info = ds.columns.get(m.column)
        if info is None:
            raise DataError("unknown_column", f"Column '{m.column}' does not exist in this file.")
        if m.aggregation in NUMERIC_AGGS and info.inferred_type != "number":
            raise DataError(
                "incompatible_aggregation",
                f"'{AGG_LABELS[m.aggregation]}' needs a numeric column, but '{m.column}' is {info.inferred_type}. Use 'Count' instead.",
            )
    if spec.group_by is not None:
        info = ds.columns.get(spec.group_by)
        if info is None:
            raise DataError("unknown_column", f"Column '{spec.group_by}' does not exist in this file.")
        if info.inferred_type not in GROUPABLE_TYPES:
            raise DataError(
                "incompatible_grouping",
                f"'{spec.group_by}' is a {info.inferred_type} column and cannot be used for grouping. Choose a category or date column.",
            )
    for f in spec.filters:
        info = ds.columns.get(f.column)
        if info is None:
            raise DataError("unknown_column", f"Column '{f.column}' does not exist in this file.")
        if f.values is not None and info.inferred_type not in {"category", "boolean", "text"}:
            raise DataError("invalid_filter", f"A value filter cannot be applied to the {info.inferred_type} column '{f.column}'.")
        if f.values is None and info.inferred_type != "date":
            raise DataError("invalid_filter", f"A date range filter needs a date column; '{f.column}' is {info.inferred_type}.")


def _apply_filter(ds: Dataset, frame: pd.DataFrame, f: Filter) -> pd.Series:
    col = frame[f.column]
    if f.values is not None:
        if ds.columns[f.column].inferred_type == "boolean":
            wanted = {v.strip().lower() in {"true", "yes"} for v in f.values}
            return col.isin(list(wanted)).fillna(False).astype(bool)
        return col.isin(f.values)
    mask = col.notna()
    if f.start is not None:
        mask &= col >= pd.Timestamp(f.start)
    if f.end is not None:
        mask &= col < pd.Timestamp(f.end) + pd.Timedelta(days=1)
    return mask


def _aggregate(values: pd.Series, agg: str) -> float | None:
    """Aggregate one measure. Returns None when there is nothing to aggregate (e.g. average of zero values)."""
    present = values.dropna()
    if agg == "count":
        return float(len(present))
    if len(present) == 0:
        return None
    if agg == "sum":
        result = present.sum()
    elif agg == "mean":
        result = present.sum() / len(present)
    elif agg == "min":
        result = present.min()
    else:
        result = present.max()
    value = _num(result)
    # Remove binary floating-point noise (e.g. 0.1 + 0.2) without affecting real precision.
    return round(value, 9) if value is not None else None


def _definition(m: Measure, total_rows: int, non_missing: int) -> str:
    if m.column is None:
        return f"Number of rows after filters ({total_rows:,} rows)."
    excluded = total_rows - non_missing
    excl = f"; {excluded:,} missing or invalid value(s) excluded" if excluded else ""
    if m.aggregation == "count":
        return f"Number of rows where '{m.column}' has a value ({non_missing:,} of {total_rows:,} rows)."
    text = {
        "sum": f"Total of all '{m.column}' values",
        "mean": f"Sum of '{m.column}' divided by the number of values",
        "min": f"Smallest '{m.column}' value",
        "max": f"Largest '{m.column}' value",
    }[m.aggregation]
    return f"{text} ({non_missing:,} value(s) used{excl})."


def _group_keys(ds: Dataset, frame: pd.DataFrame, column: str, grain: str) -> tuple[pd.Series, pd.Series | None]:
    """Return (label per row, sortable key per row)."""
    info = ds.columns[column]
    col = frame[column]
    if info.inferred_type == "date":
        freq = {"day": "D", "week": "W-MON", "month": "M", "quarter": "Q", "year": "Y"}[grain]
        if grain == "week":
            start = (col - pd.to_timedelta(col.dt.weekday, unit="D")).dt.normalize()
        else:
            start = col.dt.to_period(freq).dt.start_time
        fmt = {"day": "%Y-%m-%d", "week": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
        if grain == "quarter":
            labels = start.dt.year.astype("Int64").astype(str) + "-Q" + start.dt.quarter.astype("Int64").astype(str)
            labels = labels.where(start.notna(), None)
        else:
            labels = start.dt.strftime(fmt[grain])
            if grain == "week":
                labels = "Week of " + labels
        return labels, start
    if info.inferred_type == "boolean":
        labels = col.map({True: "true", False: "false"}).astype(object)
        return labels.where(col.notna(), MISSING_GROUP), None
    return col.where(col.notna(), MISSING_GROUP).astype(str), None


def _chart_advice(ds: Dataset, spec: AnalysisSpec, rows: list[dict[str, Any]], keys: list[str]) -> dict[str, Any]:
    if spec.group_by is None:
        return {
            "recommended": "kpi",
            "pie_allowed": False,
            "pie_reason": "Pick a category column to group by to compare proportions.",
            "notes": ["No grouping was selected, so results are shown as KPI cards."],
        }
    gtype = ds.columns[spec.group_by].inferred_type
    notes: list[str] = []
    if gtype == "date":
        recommended = "line"
        pie_reason = "Pie charts are not used for time periods; a line chart shows the trend instead."
        if len(rows) < 2:
            notes.append("Only one time period is present, so a trend line cannot be drawn.")
            recommended = "bar"
    else:
        recommended = "bar"
        first = spec.measures[0]
        values = [r["values"][keys[0]] for r in rows]
        if len(spec.measures) != 1:
            pie_reason = "A pie chart can show only one measure. Select a single measure to enable it."
        elif first.aggregation not in {"sum", "count"}:
            pie_reason = f"Slices of a pie must add up to a meaningful whole; '{AGG_LABELS[first.aggregation]}' values do not."
        elif any(v is None or v < 0 for v in values):
            pie_reason = "Pie charts cannot show negative or missing values."
        elif not 2 <= len(rows) <= PIE_MAX_SLICES:
            pie_reason = f"Pie charts are only readable with 2–{PIE_MAX_SLICES} categories; this grouping has {len(rows)}."
        else:
            pie_reason = None
        if len(rows) > 20:
            notes.append(f"The bar chart shows the top 20 of {len(rows)} groups; the table lists all of them.")
        return {"recommended": recommended, "pie_allowed": pie_reason is None, "pie_reason": pie_reason, "notes": notes}
    return {"recommended": recommended, "pie_allowed": False, "pie_reason": pie_reason, "notes": notes}


def run_analysis(ds: Dataset, spec: AnalysisSpec, max_groups: int = 100) -> dict[str, Any]:
    _validate(ds, spec)
    frame = ds.typed
    notes: list[str] = []
    if spec.remove_duplicates:
        keep = ~ds.raw.duplicated(keep="first")
        removed = int((~keep).sum())
        frame = frame[keep]
        notes.append(f"{removed} exact duplicate row(s) were excluded." if removed else "No duplicate rows were found.")

    mask = pd.Series(True, index=frame.index)
    for f in spec.filters:
        mask &= _apply_filter(ds, frame, f)
    frame = frame[mask]
    total_rows = len(frame)
    if total_rows == 0:
        notes.append("No rows match the selected filters.")

    keys = [measure_key(m) for m in spec.measures]
    kpis = []
    for m, key in zip(spec.measures, keys, strict=True):
        values = frame[m.column] if m.column else pd.Series(np.ones(total_rows), index=frame.index)
        non_missing = int(values.notna().sum())
        kpis.append(
            {
                "key": key,
                "label": measure_label(m),
                "column": m.column,
                "aggregation": m.aggregation,
                "value": _aggregate(values, m.aggregation),
                "values_used": non_missing,
                "values_excluded": total_rows - non_missing,
                "definition": _definition(m, total_rows, non_missing),
            }
        )

    rows: list[dict[str, Any]] = []
    grouping = None
    total_groups = 0
    if spec.group_by is not None and total_rows:
        labels, sort_key = _group_keys(ds, frame, spec.group_by, spec.time_grain)
        gtype = ds.columns[spec.group_by].inferred_type
        if gtype == "date":
            excluded = int(labels.isna().sum())
            if excluded:
                notes.append(f"{excluded} row(s) without a valid '{spec.group_by}' date are not included in the grouped results.")
        work = pd.DataFrame({"__label": labels}, index=frame.index)
        if sort_key is not None:
            work["__sort"] = sort_key
        for m, key in zip(spec.measures, keys, strict=True):
            work[key] = frame[m.column] if m.column else 1.0
        work = work[work["__label"].notna()]
        for label, group in work.groupby("__label", sort=False):
            rows.append(
                {
                    "group": str(label),
                    "row_count": int(len(group)),
                    "values": {key: _aggregate(group[key], m.aggregation) for m, key in zip(spec.measures, keys, strict=True)},
                    "_sort": group["__sort"].iloc[0] if sort_key is not None else None,
                }
            )
        total_groups = len(rows)
        if gtype == "date":
            rows.sort(key=lambda r: r["_sort"])
        else:
            rows.sort(key=lambda r: (r["values"][keys[0]] is None, -(r["values"][keys[0]] or 0), r["group"]))
        if total_groups > max_groups:
            notes.append(f"Showing the first {max_groups} of {total_groups} groups.")
            rows = rows[:max_groups]
        for r in rows:
            r.pop("_sort")
        grouping = {
            "column": spec.group_by,
            "type": gtype,
            "time_grain": spec.time_grain if gtype == "date" else None,
            "total_groups": total_groups,
            "truncated": total_groups > max_groups,
        }

    return {
        "row_count": ds.row_count,
        "rows_analyzed": total_rows,
        "kpis": kpis,
        "grouping": grouping,
        "rows": rows,
        "measures": [{"key": k, "label": measure_label(m), "aggregation": m.aggregation} for m, k in zip(spec.measures, keys, strict=True)],
        "chart": _chart_advice(ds, spec, rows, keys),
        "notes": notes,
        "spec": spec.model_dump(mode="json"),
    }


def filter_options(ds: Dataset, limit: int = 200) -> dict[str, list[str]]:
    """Distinct values for category/boolean columns, used to build filter controls."""
    options: dict[str, list[str]] = {}
    for name, info in ds.columns.items():
        if info.inferred_type == "category" and info.unique_count <= limit:
            options[name] = sorted(ds.typed[name].dropna().astype(str).unique().tolist())
        elif info.inferred_type == "boolean":
            options[name] = ["true", "false"]
    return options
