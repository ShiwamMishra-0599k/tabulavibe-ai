"""Predictive forecasting with NVIDIA Kumo Relational (hosted on build.nvidia.com, same nvapi- key).

Python computes the history (period totals from the trend tool, the same engine as the rest of the
report); Kumo Relational predicts the future periods. Only period totals are sent, never raw rows.

The request follows the hosted API's documented multi-table shape (OpenAPI example
"multitable_binary_classification"): an instance table (one row per prediction, with an anchor time and
the target), an entity table ("series") and a fact table ("history") holding the period totals before
each anchor. Each horizon k is a regression: for every past anchor (the start of a period) the target is
the value k periods later. A backtest predicts the last known periods and compares the error with a
naive forecast (the previous period's value), so the report can say whether the model helped.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import pandas as pd

from ..ai import AIError, AIQuotaError
from ..profiling import Dataset
from .stats import num
from .tools import PERIOD_FREQ, Toolbox, ToolError
from .workflow import default_aggregation

KUMO_URL = "https://ai.api.nvidia.com/v1/structured-data/nvidia/kumo-relational/predictions"
MODEL = "kumo-relational"
MIN_PERIODS = 8  # complete periods of history needed before forecasting
MAX_HISTORY = 52  # history periods sent per prediction
MAX_HORIZON = 6
BACKTEST_PERIODS = 3
MIN_CONTEXT = 3  # labelled examples per request
SERIES_ID = 1


def _ts(day: pd.Timestamp) -> str:
    return day.strftime("%Y-%m-%dT00:00:00.000000Z")


def _label(period: pd.Period, grain: str) -> str:
    return str(period) if grain != "week" else f"Week of {period.start_time.date().isoformat()}"


@dataclass
class Series:
    date_column: str
    measure: str | None
    aggregation: str
    grain: str
    periods: list[pd.Period]
    values: list[float]

    @property
    def n(self) -> int:
        return len(self.values)


def choose_series(ds: Dataset, measure: str | None) -> tuple[Series | None, str]:
    """Pick a date column and the coarsest grain with enough complete periods. Returns (series, reason)."""
    dates = sorted(
        (c for c, info in ds.columns.items() if info.inferred_type == "date"),
        key=lambda c: -int(ds.typed[c].notna().sum()),
    )
    if not dates:
        return None, "the file has no date column"
    aggregation = default_aggregation(measure) if measure else "count"
    toolbox = Toolbox(ds)
    for grain in ("month", "week", "day"):
        try:
            res = toolbox.trend(dates[0], measure, aggregation, grain)
        except ToolError:
            continue
        periods = [p for p in res["periods"] if not p["partial"]]
        if aggregation == "mean" and any(p["value"] is None for p in periods):
            continue  # an average has no value in an empty period; the series would not be regular
        if sum(1 for p in periods if p["rows"] == 0) * 2 > len(periods):
            continue  # mostly empty periods (too fine a grain for this file): a forecast would mostly predict gaps
        if len(periods) >= MIN_PERIODS:
            freq = PERIOD_FREQ[grain]
            return Series(
                dates[0],
                measure,
                aggregation,
                grain,
                [pd.Period(pd.Timestamp(p["start"]), freq=freq) for p in periods],
                [float(p["value"] or 0) for p in periods],
            ), ""
    return None, f"fewer than {MIN_PERIODS} complete periods of history with data in most of them"


def build_request(series: Series, context: list[tuple[int, int]], predict: list[int], run_mode: str = "fast") -> dict[str, Any]:
    """A Kumo Relational regression request.

    context: (anchor index, target index) pairs; predict: anchor indices. An anchor index i means the
    prediction is made at the start of period i, seeing periods i-MAX_HISTORY .. i-1 only.
    """
    first = series.periods[0]

    def start(i: int) -> pd.Timestamp:
        return (first + i).start_time if i >= series.n else series.periods[i].start_time

    instance_ctx, instance_pred, entity, history = [], [], {"ctx": [], "pred": []}, {"ctx": [], "pred": []}
    node = 0
    rows = [(a, t, "ctx") for a, t in context] + [(a, None, "pred") for a in predict]
    for iid, (anchor, target, split) in enumerate(rows):
        row = [iid, SERIES_ID, _ts(start(anchor))]
        if split == "ctx":
            instance_ctx.append([*row, series.values[target]])
        else:
            instance_pred.append(row)
        entity[split].append([iid, SERIES_ID, "all"])
        for j in range(max(0, anchor - MAX_HISTORY), anchor):
            history[split].append([iid, node, SERIES_ID, _ts(series.periods[j].start_time), series.values[j]])
            node += 1

    def split(name: str, instance_rows: list[list[Any]], with_target: bool) -> dict[str, Any]:
        columns = ["instance_id", "__kumo_entity_ref_0", "__kumo_anchor_time"] + (["TARGET"] if with_target else [])
        return {
            "instance_table": {"format": "arrays", "columns": columns, "rows": instance_rows},
            "related_tables": {
                "series": {"format": "arrays", "columns": ["instance_id", "series_id", "name"], "rows": entity[name]},
                "history": {
                    "format": "arrays",
                    "columns": ["instance_id", "__node_id", "series_id", "period_start", "value"],
                    "rows": history[name],
                },
            },
        }

    return {
        "model": MODEL,
        "task": {
            "kind": "regression",
            "target": {"column_name": "TARGET", "dtype": "float64"},
            "entity_table_names": ["series"],
            "anchor_time_column": "__kumo_anchor_time",
        },
        "schema": {
            "instance_table": {
                "columns": {
                    "instance_id": {"dtype": "int64", "stype": "ID", "nullable": False},
                    "__kumo_entity_ref_0": {"dtype": "int64", "stype": "ID"},
                    "__kumo_anchor_time": {"dtype": "timestamp[us]", "stype": "timestamp", "nullable": False},
                    "TARGET": {"dtype": "float64", "stype": "numerical"},
                },
                "primary_key": "instance_id",
            },
            "related_tables": {
                "series": {
                    "columns": {
                        "instance_id": {"dtype": "int64", "stype": "ID", "nullable": False},
                        "series_id": {"dtype": "int64", "nullable": False},
                        "name": {"dtype": "string", "stype": "categorical"},
                    },
                    "primary_key": ["instance_id", "series_id"],
                },
                "history": {
                    "columns": {
                        "instance_id": {"dtype": "int64", "stype": "ID", "nullable": False},
                        "__node_id": {"dtype": "int64", "stype": "ID", "nullable": False},
                        "series_id": {"dtype": "int64", "stype": "ID"},
                        "period_start": {"dtype": "timestamp[us]", "stype": "timestamp"},
                        "value": {"dtype": "float64", "stype": "numerical"},
                    },
                    "primary_key": ["instance_id", "__node_id"],
                },
            },
            "relationships": [
                {"source_columns": ["__kumo_entity_ref_0"], "target_table": "series", "target_columns": ["series_id"]},
                {"source_table": "history", "source_columns": ["series_id"], "target_table": "series", "target_columns": ["series_id"]},
            ],
        },
        "context": split("ctx", instance_ctx, True),
        "predict": split("pred", instance_pred, False),
        "output": {"fields": ["prediction"]},
        "inference": {"run_mode": run_mode},
    }


@dataclass
class KumoForecaster:
    api_key: str = field(repr=False)
    timeout: float = 60
    transport: httpx.BaseTransport | None = field(default=None, repr=False)
    provider: str = "nvidia"
    model: str = MODEL

    def _predict(self, body: dict[str, Any]) -> list[float]:
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.post(
                    KUMO_URL,
                    headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json", "Content-Type": "application/json"},
                    json=body,
                )
        except httpx.TimeoutException as exc:
            raise AIError("forecast_timeout", "Kumo Relational did not respond in time") from exc
        except httpx.HTTPError as exc:
            raise AIError("forecast_unavailable", "Kumo Relational could not be reached") from exc
        if response.status_code == 429:
            raise AIQuotaError("forecast_rate_limited", "the NVIDIA rate limit was reached")
        if response.status_code in (401, 403):
            raise AIError("forecast_auth_failed", "NVIDIA rejected the server's API key for Kumo Relational")
        if response.status_code >= 400:
            title = ""
            try:
                problem = response.json()
                title = str(problem.get("title") or problem.get("code") or "")[:80]
            except ValueError:
                pass
            raise AIError("forecast_rejected", f"Kumo Relational returned HTTP {response.status_code}" + (f" ({title})" if title else ""))
        try:
            items = sorted(response.json()["predictions"], key=lambda p: int(p["row_index"]))
            values = [float(p["prediction"]) for p in items]
        except (ValueError, KeyError, TypeError) as exc:
            raise AIError("forecast_malformed", "Kumo Relational returned a response that could not be read") from exc
        if len(values) != len(body["predict"]["instance_table"]["rows"]):
            raise AIError("forecast_malformed", "Kumo Relational returned the wrong number of predictions")
        return values

    def forecast(self, ds: Dataset, measure: str | None, deadline_seconds: float = 90) -> dict[str, Any]:
        started = time.monotonic()
        series, reason = choose_series(ds, measure)
        if series is None:
            return {"status": "skipped", "provider": self.provider, "model": self.model, "note": f"No forecast: {reason}."}
        n = series.n
        horizon = min(MAX_HORIZON, max(1, n // 4))
        label = series.measure or "Number of rows"
        base = {
            "provider": self.provider,
            "model": self.model,
            "date_column": series.date_column,
            "measure": label,
            "aggregation": series.aggregation,
            "grain": series.grain,
            "history": [
                {"period": _label(p, series.grain), "start": p.start_time.date().isoformat(), "value": num(v)}
                for p, v in list(zip(series.periods, series.values, strict=True))[-24:]
            ],
            "shared": f"{n} {series.grain}ly {series.aggregation} values of {label} (period totals only, never raw rows)",
        }

        # Backtest: one-step-ahead predictions for the last periods, from context that ends before them.
        hold = min(BACKTEST_PERIODS, n - MIN_PERIODS + 1)
        cut = n - hold
        ctx = [(i, i) for i in range(2, cut)]
        backtest = None
        if len(ctx) >= MIN_CONTEXT and hold >= 1:
            preds = self._predict(build_request(series, ctx, list(range(cut, n))))
            rows = []
            for i, pred in zip(range(cut, n), preds, strict=True):
                rows.append(
                    {
                        "period": _label(series.periods[i], series.grain),
                        "actual": num(series.values[i]),
                        "kumo": num(pred),
                        "naive": num(series.values[i - 1]),
                    }
                )
            kumo_mae = sum(abs(r["kumo"] - r["actual"]) for r in rows) / len(rows)
            naive_mae = sum(abs(r["naive"] - r["actual"]) for r in rows) / len(rows)
            backtest = {"periods": rows, "kumo_mae": num(kumo_mae), "naive_mae": num(naive_mae), "kumo_better": kumo_mae < naive_mae}

        forecast, notes = [], []
        for k in range(1, horizon + 1):
            if time.monotonic() - started > deadline_seconds:
                notes.append(f"Stopped after {k - 1} period(s) to stay within the time limit.")
                break
            context = [(i, i + k - 1) for i in range(2, n - k + 1)]
            if len(context) < MIN_CONTEXT:
                break
            (value,) = self._predict(build_request(series, context, [n]))
            period = series.periods[0] + (n + k - 1)
            forecast.append(
                {"step": k, "period": _label(period, series.grain), "start": period.start_time.date().isoformat(), "value": num(value)}
            )
        if backtest and not backtest["kumo_better"]:
            notes.append(
                "In the backtest the naive forecast (previous period's value) was more accurate; treat this forecast with caution."
            )
        notes.append("A forecast is an estimate from past patterns, not a guarantee; it does not know about future events.")
        return {"status": "ok", **base, "forecast": forecast, "backtest": backtest, "notes": notes}
