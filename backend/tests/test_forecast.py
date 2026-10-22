"""NVIDIA Kumo Relational forecasting, against a fake of the hosted predictions API (no network, no key)."""

import calendar
import json

import httpx
import pytest

from app.agent.forecast import KUMO_URL, KumoForecaster, choose_series
from app.agent.workflow import BusinessContext, RulesAnalyst, run_best
from app.ai import AIError
from app.config import Settings
from app.ingest import load_table
from app.main import get_forecaster
from app.profiling import build_dataset

# Hand-checked monthly fixture: Jan-Oct 2025, revenue 10, 20, ..., 100 (each month complete: rows on the
# 1st and on the last day, the second with 0 revenue).
REVENUE = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]


@pytest.fixture
def monthly_ds(settings):
    lines = ["date,region,revenue"]
    for m, v in enumerate(REVENUE, 1):
        last = calendar.monthrange(2025, m)[1]
        lines += [f"2025-{m:02d}-01,North,{v}", f"2025-{m:02d}-{last},South,0"]
    return build_dataset(load_table("monthly.csv", ("\n".join(lines) + "\n").encode(), settings))


class FakeKumo:
    """Answers each predict row with the last history value + 10 (a perfect model for this fixture)."""

    def __init__(self, status=200, problem=None):
        self.bodies = []
        self.status = status
        self.problem = problem

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url) == KUMO_URL
        assert request.headers["authorization"] == "Bearer nvapi-test"
        body = json.loads(request.content)
        self.bodies.append(body)
        if self.status != 200:
            return httpx.Response(self.status, json=self.problem or {}, headers={"content-type": "application/problem+json"})
        hist = body["predict"]["related_tables"]["history"]
        preds = []
        for i, row in enumerate(body["predict"]["instance_table"]["rows"]):
            values = [h[4] for h in hist["rows"] if h[0] == row[0]]
            preds.append({"row_index": i, "id": str(row[0]), "prediction": values[-1] + 10})
        return httpx.Response(
            200, json={"id": "p1", "model": "kumo-relational", "predictions": preds[::-1], "metadata": {"task_kind": "regression"}}
        )

    def forecaster(self) -> KumoForecaster:
        return KumoForecaster("nvapi-test", transport=httpx.MockTransport(self.handler))


def test_series_uses_complete_months_of_the_primary_measure(monthly_ds):
    series, reason = choose_series(monthly_ds, "revenue")
    assert reason == "" and (series.grain, series.aggregation, series.date_column) == ("month", "sum", "date")
    assert series.values == REVENUE


def test_forecast_backtest_and_request_shape(monthly_ds):
    fake = FakeKumo()
    out = fake.forecaster().forecast(monthly_ds, "revenue")
    assert out["status"] == "ok" and (out["provider"], out["model"]) == ("nvidia", "kumo-relational")
    # n = 10 months -> horizon min(6, 10 // 4) = 2; one backtest call + one call per horizon.
    assert len(fake.bodies) == 3
    assert [(f["period"], f["value"]) for f in out["forecast"]] == [("2025-11", 110), ("2025-12", 110)]
    # Backtest holds out Aug-Oct: Kumo 80, 90, 100 (exact) vs naive 70, 80, 90 -> MAE 0 vs 10.
    bt = out["backtest"]
    assert [(p["period"], p["actual"], p["kumo"], p["naive"]) for p in bt["periods"]] == [
        ("2025-08", 80, 80, 70),
        ("2025-09", 90, 90, 80),
        ("2025-10", 100, 100, 90),
    ]
    assert (bt["kumo_mae"], bt["naive_mae"], bt["kumo_better"]) == (0, 10, True)

    backtest, k1, k2 = fake.bodies
    for body in fake.bodies:
        assert set(body) == {"model", "task", "schema", "context", "predict", "output", "inference"}
        assert body["task"] == {
            "kind": "regression",
            "target": {"column_name": "TARGET", "dtype": "float64"},
            "entity_table_names": ["series"],
            "anchor_time_column": "__kumo_anchor_time",
        }
        assert body["schema"]["instance_table"]["primary_key"] == "instance_id"
        for name, table in body["schema"]["related_tables"].items():
            assert "instance_id" in table["columns"] and table["primary_key"][0] == "instance_id", name
        assert "TARGET" not in body["predict"]["instance_table"]["columns"]
    # Backtest context ends before the held-out months: anchors Mar..Jul, targets 30..70.
    assert [r[3] for r in backtest["context"]["instance_table"]["rows"]] == [30, 40, 50, 60, 70]
    # Horizon 2: the anchor at the start of March (2 months seen) is labelled with April (40).
    first = k2["context"]["instance_table"]["rows"][0]
    assert first[2] == "2025-03-01T00:00:00.000000Z" and first[3] == 40
    assert k1["context"]["instance_table"]["rows"][0][3] == 30
    # The prediction is anchored at 1 Nov and sees exactly the 10 months before it.
    pred = k1["predict"]["instance_table"]["rows"][0]
    assert pred[2] == "2025-11-01T00:00:00.000000Z"
    hist = [h for h in k1["predict"]["related_tables"]["history"]["rows"] if h[0] == pred[0]]
    assert [h[4] for h in hist] == REVENUE and hist[-1][3] == "2025-10-01T00:00:00.000000Z"


def test_only_period_totals_are_sent(monthly_ds):
    fake = FakeKumo()
    fake.forecaster().forecast(monthly_ds, "revenue")
    sent = json.dumps(fake.bodies)
    assert "North" not in sent and "South" not in sent and "2025-01-31" not in sent
    assert "nvapi-test" not in sent


def test_short_history_is_skipped_without_calling_nvidia(sales_ds):
    fake = FakeKumo()
    out = fake.forecaster().forecast(sales_ds, "revenue")
    assert out["status"] == "skipped" and "fewer than 8 complete periods" in out["note"]
    assert fake.bodies == []


@pytest.mark.parametrize(
    ("status", "problem", "code", "text"),
    [
        (
            422,
            {"type": "/problems/validation-failed", "status": 422, "title": "Validation failed", "code": "VALIDATION_FAILED"},
            "forecast_rejected",
            "HTTP 422 (Validation failed)",
        ),
        (429, {}, "forecast_rate_limited", "rate limit"),
        (401, {}, "forecast_auth_failed", "rejected"),
    ],
)
def test_errors_are_mapped(monthly_ds, status, problem, code, text):
    with pytest.raises(AIError) as err:
        FakeKumo(status, problem).forecaster().forecast(monthly_ds, "revenue")
    assert err.value.code == code and text in err.value.message


def test_run_best_attaches_the_forecast_and_survives_failures(monthly_ds):
    ctx = BusinessContext()
    report = list(run_best(monthly_ds, "monthly.csv", ctx, RulesAnalyst(ctx), forecaster=FakeKumo().forecaster()))[-1]["report"]
    assert report["primary_measure"] == "revenue"
    assert report["forecast"]["status"] == "ok" and len(report["forecast"]["forecast"]) == 2
    assert "### Forecast (NVIDIA Kumo Relational)" in report["handover_markdown"]

    failed = list(run_best(monthly_ds, "monthly.csv", ctx, RulesAnalyst(ctx), forecaster=FakeKumo(429).forecaster()))[-1]["report"]
    assert failed["forecast"] == {
        "status": "failed",
        "provider": "nvidia",
        "model": "kumo-relational",
        "note": "No forecast: the NVIDIA rate limit was reached.",
    }
    assert failed["findings"]  # the analysis itself is unaffected


def test_forecaster_needs_the_switch_and_an_nvidia_key():
    assert get_forecaster(Settings(_env_file=None)) is None
    assert get_forecaster(Settings(forecast_provider="kumo", _env_file=None)) is None
    assert isinstance(get_forecaster(Settings(forecast_provider="kumo", nvidia_api_key="nvapi-x", _env_file=None)), KumoForecaster)
    assert "nvapi-x" not in repr(KumoForecaster("nvapi-x"))


def test_exports_include_the_forecast_and_the_evaluation(monthly_ds):
    from pptx import Presentation

    from app.report_export import agent_doc, render_pdf, render_pptx

    ctx = BusinessContext()
    report = list(run_best(monthly_ds, "monthly.csv", ctx, RulesAnalyst(ctx), forecaster=FakeKumo().forecaster()))[-1]["report"]
    doc = agent_doc(report)
    titles = [s.title for s in doc.sections]
    assert "Forecast (NVIDIA Kumo Relational)" in titles and "Which analysis built this dashboard" in titles
    deck = Presentation(__import__("io").BytesIO(render_pptx(doc)))
    text = " ".join(
        [sh.text_frame.text for slide in deck.slides for sh in slide.shapes if sh.has_text_frame]
        + [c.text for slide in deck.slides for sh in slide.shapes if sh.has_table for row in sh.table.rows for c in row.cells]
    )
    assert "Forecast (NVIDIA Kumo Relational)" in text and "Backtest on the last 3 period(s)" in text
    assert render_pdf(doc)[:5] == b"%PDF-"
