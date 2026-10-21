"""The analytics workflow (phases 0-8) with the rules-based analyst, on the hand-checked fixture."""

import pytest

from app.agent.tools import Toolbox
from app.agent.workflow import (
    BusinessContext,
    RulesAnalyst,
    default_aggregation,
    fmt,
    fmt_p,
    ground_finding,
    pick_primary_measure,
    run_workflow,
)
from app.config import Settings
from app.ingest import load_table
from app.profiling import build_dataset


def run(ds, context=None):
    context = context or BusinessContext()
    events = list(run_workflow(ds, "sales.csv", context, RulesAnalyst(context)))
    assert events[0]["type"] == "start" and events[-1]["type"] == "report"
    return events, events[-1]["report"]


def by_title(report, prefix):
    return next(f for f in report["findings"] if f["title"].startswith(prefix))


def test_every_phase_passes_its_gate_on_the_fixture(sales_ds):
    _, report = run(sales_ds)
    status = {p["id"]: p["status"] for p in report["phases"]}
    assert status == {
        0: "passed_with_assumptions",
        1: "passed",
        2: "passed",
        3: "passed",
        4: "passed",
        5: "passed",
        6: "passed",
        7: "passed",
        8: "passed",
    }
    assert report["mode"] == "rules" and report["model"] is None


def test_phase0_documents_assumptions_when_no_context_is_given(sales_ds):
    _, report = run(sales_ds)
    charter = report["charter"]
    assert charter["provided_by_user"] is False
    assert any("No specific business problem" in a for a in charter["assumptions"])
    assert any("'revenue' is treated as the primary measure" in a for a in charter["assumptions"])


def test_context_from_the_user_drives_the_charter_and_primary_kpi(sales_ds):
    ctx = BusinessContext(domain="Retail store sales", audience="Store manager", objective="Decide which region to support", kpis="units")
    _, report = run(sales_ds, ctx)
    charter = report["charter"]
    assert charter["provided_by_user"] is True and charter["assumptions"] == []
    assert charter["business_context"] == "Retail store sales"
    assert report["preparation"]["primary_measure"] == "units"


def test_phase1_profile_grain_and_quality(sales_ds):
    _, report = run(sales_ds)
    du = report["data_understanding"]
    assert du["grain"].startswith("One row per record or event")  # the fixture has no identifier column
    issues = {i["issue"] for i in du["quality_issues"]}
    assert "Exact duplicate rows" in issues
    assert "Invalid values in 'date'" in issues
    assert {d["column"] for d in du["data_dictionary"]} == {"date", "region", "product", "units", "price", "revenue", "notes"}
    assert all("confirm with the data owner" in d["meaning"] for d in du["data_dictionary"])


def test_phase2_questions_and_hypotheses_use_real_columns(sales_ds):
    _, report = run(sales_ds)
    assert report["questions"][0]["priority"] == "high"
    assert "revenue" in report["questions"][0]["question"]
    assert all(q["status"] == "answered" for q in report["questions"])
    assert all(h["question_id"] in {q["id"] for q in report["questions"]} for h in report["hypotheses"])


def test_phase3_is_non_destructive_and_defines_each_kpi_once(sales_ds):
    _, report = run(sales_ds)
    prep = report["preparation"]
    assert prep["raw_data_preserved"] is True
    dup = next(s for s in prep["cleaning_log"] if s["step"] == "Exact duplicates")
    assert dup["applied"] is False  # kept, not removed
    names = [m["name"] for m in prep["metric_definitions"]]
    assert len(names) == len(set(names))
    assert "Total revenue" in names and "Total price" not in names  # a total of prices is meaningless
    assert "Average price per row" in names


def test_phase5_reconciles_and_quantifies_duplicates(sales_ds):
    _, report = run(sales_ds)
    rec = report["validation"]["reconciliation"][0]
    # hand-checked: revenue 355 with duplicates; the duplicate row adds 70, so 285 without
    assert (rec["measure"], rec["engine_value"], rec["independent_value"], rec["reconciled"]) == ("revenue", 355, 355, True)
    assert rec["value_without_duplicates"] == 285
    f = by_title(report, "Duplicate rows change total revenue by 24.56%")  # 70 / 285
    assert f["grounded"] and f["kind"] == "data_quality"


def test_segment_findings_match_hand_totals(sales_ds):
    _, report = run(sales_ds)
    product = by_title(report, "'B' (product) contributes 56.3% of revenue")  # 200 / 355
    region = by_title(report, "'South' (region) contributes 53.5% of revenue")  # 190 / 355
    assert product["grounded"] and region["grounded"]
    assert "2,00" not in product["what_happened"]  # Indian grouping only applies above 999
    assert "200" in product["what_happened"] and "355" in product["what_happened"]


def test_trend_finding_excludes_partial_months(sales_ds):
    _, report = run(sales_ds)
    # complete months Feb 15, Mar 140, Apr 30 (Jan and May are partial; the invalid date is excluded)
    f = by_title(report, "revenue down 78.57% in 2025-04 vs 2025-03")
    assert f["grounded"] and "Partial: 2025-01, 2025-05." in f["limitations"]


def test_every_finding_is_grounded_and_dashboard_uses_only_validated_results(sales_ds):
    _, report = run(sales_ds)
    assert report["findings"] and all(f["grounded"] for f in report["findings"])
    assert all(f["evidence_ids"] for f in report["findings"])
    kpis = {k["label"]: k["value"] for k in report["dashboard"]["kpis"]}
    assert kpis["Total revenue"] == 355 and kpis["Rows analysed"] == 10
    assert kpis["Average price"] == pytest.approx(10.0)  # (5+10+5+20+10+10+20+5+10+5)/10


def test_holm_correction_is_applied_to_every_test(sales_ds):
    _, report = run(sales_ds)
    tests = report["validation"]["multiple_testing"]["tests"]
    assert tests and all(t["adjusted_p_value"] >= t["p_value"] for t in tests)


def test_progress_events_cover_all_phases(sales_ds):
    events, _ = run(sales_ds)
    assert {e["phase"] for e in events if e["type"] == "phase"} == set(range(9))
    assert any(e["type"] == "tool" for e in events)


def test_handover_document_has_the_required_sections(sales_ds):
    _, report = run(sales_ds)
    md = report["handover_markdown"]
    for heading in [
        "Executive summary",
        "Business objectives and scope",
        "Data sources and dictionary",
        "Data-quality findings",
        "Cleaning and transformation",
        "KPI definitions",
        "Validated findings",
        "Statistical methods and validation",
        "Limitations",
    ]:
        assert heading in md


def test_report_never_contains_raw_rows_or_invalid_examples(sales_ds):
    import json

    _, report = run(sales_ds)
    text = json.dumps(report)
    assert "2025-02-14,East" not in text  # no raw rows
    assert "not-a-date" not in text  # invalid example values are counted, never shown


def test_sparse_columns_are_not_preferred_as_dimensions(sales_ds):
    _, report = run(sales_ds)
    asked = " ".join(q["question"] for q in report["questions"][:5])
    assert "region" in asked and "product" in asked
    assert "Which notes values" not in asked  # 'notes' is 60% missing


def test_file_without_measures_or_categories_stops_safely_at_phase_1(settings):
    ds = build_dataset(load_table("ids.csv", b"id\n1\n2\n3\n4\n5\n", settings))
    _, report = run(ds)
    status = {p["id"]: p["status"] for p in report["phases"]}
    assert status[1] == "blocked"
    assert all(status[p] == "skipped" for p in (4, 5, 6, 7))
    assert report["findings"] == []


# ------------------------------------------------------------------ helpers


def test_grounding_flags_invented_numbers(sales_ds):
    tb = Toolbox(sales_ds)
    eid = tb.call("verify_total", {"measure": "revenue"}, 5)["evidence_id"]
    ok = ground_finding(
        {"title": "Revenue is 355", "what_happened": "Total revenue is 355 (24.56% from duplicates).", "evidence_ids": [eid]}, tb.evidence
    )
    assert ok["grounded"] is True
    bad = ground_finding({"title": "Revenue is 400", "what_happened": "Revenue could grow to 1,234.5.", "evidence_ids": [eid]}, tb.evidence)
    assert bad["grounded"] is False and bad["unverified_numbers"] == ["1,234.5", "400"]
    none = ground_finding({"title": "Something", "evidence_ids": []}, tb.evidence)
    assert none["grounded"] is False


def test_grounding_ignores_dates_years_thresholds_and_small_counts(sales_ds):
    tb = Toolbox(sales_ds)
    eid = tb.call("verify_total", {"measure": "revenue"}, 5)["evidence_id"]
    f = ground_finding({"title": "Top 3 in 2025-Q1 and 2025-03-01, since 2024, p < 0.0001", "evidence_ids": [eid]}, tb.evidence)
    assert f["grounded"] is True


@pytest.mark.parametrize(
    ("value", "text"), [(1645592.43, "16,45,592.43"), (355, "355"), (-1234.5, "-1,234.5"), (0.1, "0.1"), (None, "n/a")]
)
def test_fmt_uses_indian_grouping(value, text):
    assert fmt(value) == text


def test_fmt_p():
    assert (fmt_p(0.00001), fmt_p(0.04512), fmt_p(None)) == ("< 0.0001", "0.0451", "n/a")


@pytest.mark.parametrize(
    ("name", "agg"),
    [
        ("revenue", "sum"),
        ("Amount (INR)", "sum"),
        ("Duration (min)", "sum"),
        ("unit_price", "mean"),
        ("UnitPrice", "mean"),
        ("discount_pct", "mean"),
        ("Rating", "mean"),
    ],
)
def test_default_aggregation(name, agg):
    assert default_aggregation(name) == agg


def test_pick_primary_measure():
    assert pick_primary_measure(["units", "unit_price", "revenue"], BusinessContext()) == "revenue"
    assert pick_primary_measure(["units", "unit_price"], BusinessContext()) == "units"  # prices are not additive
    assert pick_primary_measure(["units", "revenue"], BusinessContext(kpis="Units sold")) == "units"
    assert pick_primary_measure([], BusinessContext()) is None


def test_settings_fixture_available(settings):
    assert isinstance(settings, Settings)
