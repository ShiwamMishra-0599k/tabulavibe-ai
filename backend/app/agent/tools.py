"""Analytical tools the agent may call. Each runs in Python and returns aggregates only.

Every successful call is recorded as numbered evidence (E1, E2, ...). Findings must cite evidence,
and phase 5 checks that every number in a finding appears in the evidence it cites.

Privacy: tools never return raw rows. Category labels are returned for category and yes/no columns;
values of free-text and identifier columns are never returned, only counts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..analysis import run_analysis
from ..errors import AppError
from ..profiling import Dataset, duplicate_row_count
from ..schemas import AnalysisSpec
from . import stats
from .stats import num

MAX_GROUPS = 10
MAX_CROSSTAB_CATEGORIES = 8
MAX_MATRIX_COLUMNS = 12
GRAINS = ("day", "week", "month", "quarter", "year")
PERIOD_FREQ = {"day": "D", "week": "W-SUN", "month": "M", "quarter": "Q", "year": "Y"}


class ToolError(Exception):
    """A tool call that cannot run (unknown column, wrong type). Returned to the agent, not raised to users."""


@dataclass
class EvidenceItem:
    id: str
    tool: str
    args: dict[str, Any]
    result: dict[str, Any]
    phase: int


@dataclass
class Evidence:
    items: list[EvidenceItem] = field(default_factory=list)

    def add(self, tool: str, args: dict[str, Any], result: dict[str, Any], phase: int) -> EvidenceItem:
        item = EvidenceItem(f"E{len(self.items) + 1}", tool, args, result, phase)
        self.items.append(item)
        return item

    def get(self, evidence_id: str) -> EvidenceItem | None:
        return next((i for i in self.items if i.id == evidence_id), None)

    def as_list(self) -> list[dict[str, Any]]:
        return [{"id": i.id, "tool": i.tool, "args": i.args, "phase": i.phase, "result": i.result} for i in self.items]


class Toolbox:
    """Binds the tools to one uploaded dataset and records evidence."""

    def __init__(self, ds: Dataset, max_groups: int = 100):
        self.ds = ds
        self.max_groups = max_groups
        self.evidence = Evidence()

    # ------------------------------------------------------------ plumbing

    def call(self, name: str, args: dict[str, Any] | None, phase: int) -> dict[str, Any]:
        """Run a tool by name. Returns {"evidence_id", "result"} or {"error"} (never raises for bad input)."""
        fn = TOOLS.get(name)
        if fn is None:
            return {"error": f"Unknown tool '{name}'."}
        args = dict(args or {})
        try:
            result = fn(self, **args)
        except TypeError as exc:
            return {"error": f"Invalid arguments for '{name}': {exc}"}
        except (ToolError, AppError) as exc:
            return {"error": getattr(exc, "message", str(exc))}
        item = self.evidence.add(name, args, result, phase)
        return {"evidence_id": item.id, "result": result}

    def _info(self, column: str, kinds: set[str] | None = None, what: str = "column"):
        info = self.ds.columns.get(column)
        if info is None:
            raise ToolError(f"Column '{column}' does not exist. Available: {', '.join(list(self.ds.columns)[:40])}")
        if kinds and info.inferred_type not in kinds:
            raise ToolError(f"'{column}' is a {info.inferred_type} column; this needs a {what}.")
        return info

    def _numeric(self, column: str) -> pd.Series:
        self._info(column, {"number"}, "numeric column")
        return self.ds.typed[column].astype("float64")

    def _labels(self, column: str) -> pd.Series:
        info = self._info(column, {"category", "boolean"}, "category or yes/no column")
        col = self.ds.typed[column]
        if info.inferred_type == "boolean":
            return col.map({True: "true", False: "false"}).astype(object)
        return col.astype(object).where(col.notna(), None)

    def _top_labels(self, labels: pd.Series, limit: int) -> list[str]:
        return [str(v) for v in labels.dropna().value_counts().head(limit).index]

    # ------------------------------------------------------------ phase 1

    def dataset_overview(self) -> dict[str, Any]:
        ds = self.ds
        cols = []
        for info in ds.columns.values():
            entry = {
                "name": info.name,
                "type": info.inferred_type,
                "role": info.role,
                "missing": info.missing_count,
                "missing_pct": num(info.missing_count / ds.row_count * 100, 2) if ds.row_count else 0,
                "invalid": info.invalid_count,
                "unique": info.unique_count,
            }
            if info.date_format:
                entry["date_format"] = info.date_format
            cols.append(entry)
        dates = {}
        for info in ds.columns.values():
            if info.inferred_type == "date":
                values = ds.typed[info.name].dropna()
                if len(values):
                    dates[info.name] = {"min": values.min().date().isoformat(), "max": values.max().date().isoformat()}
        keys = [
            {
                "column": info.name,
                "unique_values": info.unique_count,
                "rows_with_value": ds.row_count - info.missing_count,
                "is_unique": info.unique_count == ds.row_count - info.missing_count and info.missing_count == 0,
            }
            for info in ds.columns.values()
            if info.role == "identifier"
        ]
        total_cells = ds.row_count * len(ds.columns)
        missing_cells = sum(i.missing_count for i in ds.columns.values())
        invalid_cells = sum(i.invalid_count for i in ds.columns.values())
        return {
            "rows": ds.row_count,
            "columns": len(ds.columns),
            "file_type": ds.source.file_type,
            "column_details": cols,
            "date_ranges": dates,
            "candidate_keys": keys,
            "exact_duplicate_rows": duplicate_row_count(ds),
            "missing_cells": missing_cells,
            "missing_cell_pct": num(missing_cells / total_cells * 100, 2) if total_cells else 0,
            "invalid_cells": invalid_cells,
            "empty_rows_skipped": ds.source.empty_rows_dropped,
            "measures": [i.name for i in ds.columns.values() if i.role == "measure"],
            "dimensions": [i.name for i in ds.columns.values() if i.role == "dimension"],
            "dates": [i.name for i in ds.columns.values() if i.role == "time"],
            "identifiers": [i.name for i in ds.columns.values() if i.role == "identifier"],
        }

    def describe_column(self, column: str) -> dict[str, Any]:
        info = self._info(column)
        base = {
            "column": column,
            "type": info.inferred_type,
            "role": info.role,
            "missing": info.missing_count,
            "invalid": info.invalid_count,
            "invalid_examples_count": len(info.invalid_examples),
        }
        series = self.ds.typed[column]
        if info.inferred_type == "number":
            return {**base, **stats.describe_numeric(series.astype("float64"))}
        if info.inferred_type in {"category", "boolean"}:
            labels = [v for v in self._labels(column).tolist() if v is not None]
            return {**base, **stats.describe_categorical(labels, info.missing_count)}
        if info.inferred_type == "date":
            values = series.dropna()
            if values.empty:
                return {**base, "n": 0}
            weekday = values.dt.day_name().value_counts()
            return {
                **base,
                "n": int(len(values)),
                "min": values.min().date().isoformat(),
                "max": values.max().date().isoformat(),
                "span_days": int((values.max() - values.min()).days),
                "distinct_days": int(values.dt.normalize().nunique()),
                "rows_by_weekday": {
                    d: int(weekday.get(d, 0)) for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
                },
            }
        # text / identifier / empty: counts only, never values
        present = self.ds.raw[column][series.notna()] if info.inferred_type != "empty" else pd.Series(dtype=object)
        lengths = present.astype(str).str.len() if len(present) else pd.Series(dtype=float)
        return {
            **base,
            "n": int(len(present)),
            "unique": info.unique_count,
            "duplicated_values": int(len(present) - info.unique_count) if len(present) else 0,
            "mean_length": num(lengths.mean(), 1) if len(lengths) else None,
            "notes": ["Values of free-text and identifier columns are not shared; only counts are reported."],
        }

    # ------------------------------------------------------------ KPIs

    def kpi(
        self,
        measures: list[dict[str, Any]],
        group_by: str | None = None,
        time_grain: str = "month",
        filters: list[dict[str, Any]] | None = None,
        remove_duplicates: bool = False,
    ) -> dict[str, Any]:
        spec = AnalysisSpec.model_validate(
            {
                "measures": measures,
                "group_by": group_by,
                "time_grain": time_grain,
                "filters": filters or [],
                "remove_duplicates": remove_duplicates,
            }
        )
        result = run_analysis(self.ds, spec, self.max_groups)
        return {
            "rows_analyzed": result["rows_analyzed"],
            "kpis": [
                {k: v for k, v in kpi.items() if k in {"key", "label", "value", "values_used", "values_excluded", "definition"}}
                for kpi in result["kpis"]
            ],
            "grouping": result["grouping"],
            "rows": result["rows"][:30],
            "notes": result["notes"],
            "spec": result["spec"],
        }

    # ------------------------------------------------------------ bivariate

    def compare_groups(self, measure: str, group_by: str, max_groups: int = MAX_GROUPS) -> dict[str, Any]:
        values = self._numeric(measure)
        labels = self._labels(group_by)
        top = self._top_labels(labels, min(max_groups, MAX_GROUPS))
        groups = {g: values[labels == g].to_numpy() for g in top}
        out = stats.compare_groups(groups)
        out.update({"measure": measure, "group_by": group_by})
        hidden = int(labels.dropna().nunique() - len(top))
        if hidden > 0:
            out["notes"].append(f"Only the {len(top)} largest groups were compared; {hidden} smaller group(s) were left out.")
        return out

    def correlate(self, x: str, y: str) -> dict[str, Any]:
        if x == y:
            raise ToolError("Choose two different columns.")
        out = stats.correlation(self._numeric(x).to_numpy(), self._numeric(y).to_numpy())
        out.update({"x": x, "y": y})
        return out

    def crosstab(self, row: str, column: str, max_categories: int = MAX_CROSSTAB_CATEGORIES) -> dict[str, Any]:
        if row == column:
            raise ToolError("Choose two different columns.")
        a, b = self._labels(row), self._labels(column)
        limit = min(max_categories, MAX_CROSSTAB_CATEGORIES)
        ra, cb = self._top_labels(a, limit), self._top_labels(b, limit)
        keep = a.isin(ra) & b.isin(cb)
        table = pd.crosstab(a[keep], b[keep]).reindex(index=ra, columns=cb, fill_value=0)
        out = stats.chi_square(table.to_numpy().tolist(), ra, cb)
        out.update({"row": row, "column": column})
        return out

    # ------------------------------------------------------------ time series

    def trend(self, date_column: str, measure: str | None = None, aggregation: str = "sum", grain: str = "month") -> dict[str, Any]:
        self._info(date_column, {"date"}, "date column")
        if grain not in GRAINS:
            raise ToolError(f"grain must be one of {', '.join(GRAINS)}.")
        if aggregation not in {"sum", "mean", "count"}:
            raise ToolError("aggregation must be sum, mean or count.")
        dates = self.ds.typed[date_column]
        if measure is not None:
            values = self._numeric(measure)
        elif aggregation != "count":
            raise ToolError("Without a measure only aggregation='count' (number of rows) is possible.")
        else:
            values = pd.Series(1.0, index=dates.index)
        frame = pd.DataFrame({"d": dates, "v": values}).dropna(subset=["d"])
        if frame.empty:
            raise ToolError(f"'{date_column}' has no valid dates.")
        freq = PERIOD_FREQ[grain]
        frame["p"] = frame["d"].dt.to_period(freq)
        grouped = frame.groupby("p")["v"]
        agg = {"sum": grouped.sum(min_count=1), "mean": grouped.mean(), "count": grouped.count()}[aggregation]
        full = pd.period_range(frame["p"].min(), frame["p"].max(), freq=freq)
        if len(full) > 400:
            raise ToolError(f"{len(full)} periods is too many for '{grain}'; use a coarser grain.")
        agg = agg.reindex(full)
        first, last = frame["d"].min(), frame["d"].max()
        partial_first = first.normalize() > full[0].start_time
        partial_last = last.normalize() < full[-1].end_time.normalize()
        periods = []
        for i, period in enumerate(full):
            value = agg.loc[period]
            label = str(period) if grain != "week" else f"Week of {period.start_time.date().isoformat()}"
            periods.append(
                {
                    "period": label,
                    "start": period.start_time.date().isoformat(),
                    "value": num(value) if pd.notna(value) else (0 if aggregation == "count" else None),
                    "rows": int(grouped.count().get(period, 0)),
                    "partial": bool((i == 0 and partial_first) or (i == len(full) - 1 and partial_last)),
                }
            )
        complete = [p for p in periods if not p["partial"] and p["value"] is not None]
        out: dict[str, Any] = {
            "date_column": date_column,
            "measure": measure,
            "aggregation": aggregation,
            "grain": grain,
            "periods": periods,
            "missing_periods": [p["period"] for p in periods if p["rows"] == 0],
            "partial_periods": [p["period"] for p in periods if p["partial"]],
            "trend": stats.linear_trend([p["value"] for p in complete]),
            "notes": [],
        }
        if len(complete) >= 2:
            prev, cur = complete[-2], complete[-1]
            change = (cur["value"] or 0) - (prev["value"] or 0)
            out["period_over_period"] = {
                "current_period": cur["period"],
                "current_value": cur["value"],
                "previous_period": prev["period"],
                "previous_value": prev["value"],
                "absolute_change": num(change),
                "percent_change": num(change / prev["value"] * 100, 2) if prev["value"] else None,
            }
        if grain == "month" and len(complete) >= 13:
            cur = complete[-1]
            year_ago = next(
                (p for p in complete if p["start"][:4] == str(int(cur["start"][:4]) - 1) and p["start"][5:7] == cur["start"][5:7]), None
            )
            if year_ago and year_ago["value"]:
                change = (cur["value"] or 0) - year_ago["value"]
                out["year_over_year"] = {
                    "current_period": cur["period"],
                    "previous_period": year_ago["period"],
                    "absolute_change": num(change),
                    "percent_change": num(change / year_ago["value"] * 100, 2),
                }
        if out["partial_periods"]:
            out["notes"].append("Partial first/last periods are excluded from trend and period-over-period comparisons.")
        if out["missing_periods"]:
            out["notes"].append(
                f"{len(out['missing_periods'])} period(s) have no rows: check whether the extract is complete before reading these as real drops."
            )
        if grain == "month" and len(complete) >= 24:
            by_month = frame.assign(m=frame["d"].dt.month).groupby("m")["v"].agg(aggregation if aggregation != "count" else "count")
            out["month_of_year"] = {int(k): num(v) for k, v in by_month.items()}
        return out

    # ------------------------------------------------------------ segments and multivariate

    def segment_contribution(self, measure: str, dimension: str) -> dict[str, Any]:
        values, labels = self._numeric(measure), self._labels(dimension)
        frame = pd.DataFrame({"g": labels, "v": values}).dropna()
        totals = frame.groupby("g")["v"].agg(["sum", "count"]).sort_values("sum", ascending=False)
        grand = float(totals["sum"].sum())
        segments = [
            {"segment": str(k), "total": num(r["sum"]), "rows": int(r["count"]), "share": num(r["sum"] / grand, 4) if grand else None}
            for k, r in totals.iterrows()
        ]
        out = {
            "measure": measure,
            "dimension": dimension,
            "grand_total": num(grand),
            "segments": segments[:30],
            "segment_count": len(segments),
            **stats.concentration([s["total"] for s in segments]),
            "notes": [],
        }
        if any((s["total"] or 0) < 0 for s in segments):
            out["notes"].append("Some segments are negative (e.g. refunds or losses); shares of the total should be read with care.")
        return out

    def two_way_breakdown(self, measure: str, dim_a: str, dim_b: str, aggregation: str = "sum") -> dict[str, Any]:
        if aggregation not in {"sum", "mean", "count"}:
            raise ToolError("aggregation must be sum, mean or count.")
        values, a, b = self._numeric(measure), self._labels(dim_a), self._labels(dim_b)
        ra, cb = self._top_labels(a, MAX_CROSSTAB_CATEGORIES), self._top_labels(b, MAX_CROSSTAB_CATEGORIES)
        frame = pd.DataFrame({"a": a, "b": b, "v": values})
        frame = frame[frame["a"].isin(ra) & frame["b"].isin(cb)]
        table = frame.pivot_table(index="a", columns="b", values="v", aggfunc=aggregation if aggregation != "count" else "count").reindex(
            index=ra, columns=cb
        )
        return {
            "measure": measure,
            "aggregation": aggregation,
            "rows": ra,
            "columns": cb,
            "values": [[num(v) if pd.notna(v) else None for v in row] for row in table.to_numpy()],
            "notes": ["Only the largest categories on each side are shown."]
            if a.dropna().nunique() > len(ra) or b.dropna().nunique() > len(cb)
            else [],
        }

    def _numeric_columns(self, columns: list[str] | None) -> dict[str, np.ndarray]:
        names = columns or [i.name for i in self.ds.columns.values() if i.role == "measure"]
        names = [n for n in names if self.ds.columns.get(n) and self.ds.columns[n].role != "identifier"][:MAX_MATRIX_COLUMNS]
        return {n: self._numeric(n).to_numpy() for n in names}

    def correlation_matrix(self, columns: list[str] | None = None) -> dict[str, Any]:
        cols = self._numeric_columns(columns)
        if len(cols) < 2:
            raise ToolError("A correlation matrix needs at least two numeric (non-identifier) columns.")
        return stats.correlation_matrix(cols)

    def pca(self, columns: list[str] | None = None) -> dict[str, Any]:
        return stats.pca(self._numeric_columns(columns))

    def regression(self, target: str, predictors: list[str]) -> dict[str, Any]:
        if target in predictors or not predictors:
            raise ToolError("Give a target and at least one different predictor.")
        y = self._numeric(target).to_numpy()
        out = stats.regression(y, {p: self._numeric(p).to_numpy() for p in predictors[:6]})
        out["target"] = target
        return out

    # ------------------------------------------------------------ phase 5

    def verify_total(self, measure: str, aggregation: str = "sum") -> dict[str, Any]:
        """Independent recomputation of a KPI with plain numpy (not the analysis engine), with and without duplicates."""
        if aggregation not in {"sum", "mean", "count"}:
            raise ToolError("aggregation must be sum, mean or count.")
        series = self._numeric(measure)

        def compute(values: np.ndarray) -> float | None:
            values = values[np.isfinite(values)]
            if aggregation == "count":
                return float(values.size)
            if values.size == 0:
                return None
            return float(values.sum() if aggregation == "sum" else values.sum() / values.size)

        all_rows = compute(series.to_numpy())
        unique_mask = ~self.ds.raw.duplicated(keep="first")
        dedup = compute(series[unique_mask].to_numpy())
        engine = run_analysis(self.ds, AnalysisSpec.model_validate({"measures": [{"column": measure, "aggregation": aggregation}]}))[
            "kpis"
        ][0]["value"]
        return {
            "measure": measure,
            "aggregation": aggregation,
            "independent_value": num(all_rows),
            "engine_value": engine,
            "reconciled": all_rows is not None and engine is not None and abs(all_rows - engine) <= max(1e-6, abs(engine) * 1e-9),
            "value_without_duplicates": num(dedup),
            "duplicate_effect_pct": num((all_rows - dedup) / dedup * 100, 2) if all_rows is not None and dedup else None,
        }


TOOLS = {
    "dataset_overview": Toolbox.dataset_overview,
    "describe_column": Toolbox.describe_column,
    "kpi": Toolbox.kpi,
    "compare_groups": Toolbox.compare_groups,
    "correlate": Toolbox.correlate,
    "crosstab": Toolbox.crosstab,
    "trend": Toolbox.trend,
    "segment_contribution": Toolbox.segment_contribution,
    "two_way_breakdown": Toolbox.two_way_breakdown,
    "correlation_matrix": Toolbox.correlation_matrix,
    "pca": Toolbox.pca,
    "regression": Toolbox.regression,
    "verify_total": Toolbox.verify_total,
}
