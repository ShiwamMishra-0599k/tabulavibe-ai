import pytest

from app.analysis import run_analysis
from app.errors import DataError
from app.schemas import AnalysisSpec


def spec(**kwargs) -> AnalysisSpec:
    return AnalysisSpec.model_validate(kwargs)


def kpi(result, key):
    return next(k for k in result["kpis"] if k["key"] == key)


def test_overall_aggregations_match_hand_calculation(sales_ds):
    result = run_analysis(
        sales_ds,
        spec(
            measures=[
                {"column": "units", "aggregation": "sum"},
                {"column": "units", "aggregation": "mean"},
                {"column": "units", "aggregation": "min"},
                {"column": "units", "aggregation": "max"},
                {"column": "units", "aggregation": "count"},
                {"aggregation": "count"},
            ]
        ),
    )
    assert kpi(result, "sum__units")["value"] == 45
    assert kpi(result, "mean__units")["value"] == 5
    assert kpi(result, "min__units")["value"] == 1
    assert kpi(result, "max__units")["value"] == 10
    assert kpi(result, "count__units")["value"] == 9
    assert kpi(result, "count__rows")["value"] == 10
    assert kpi(result, "sum__units")["values_excluded"] == 1
    assert "1 missing or invalid" in kpi(result, "sum__units")["definition"]
    assert result["chart"]["recommended"] == "kpi"


def test_group_by_category_sorted_by_first_measure(sales_ds):
    result = run_analysis(
        sales_ds,
        spec(
            measures=[{"column": "revenue", "aggregation": "sum"}, {"aggregation": "count"}],
            group_by="region",
        ),
    )
    rows = [(r["group"], r["values"]["sum__revenue"], r["row_count"]) for r in result["rows"]]
    assert rows == [("South", 190, 3), ("North", 135, 4), ("East", 20, 2), ("West", 10, 1)]
    assert result["grouping"]["total_groups"] == 4
    assert result["chart"]["recommended"] == "bar"
    assert result["chart"]["pie_allowed"] is False  # two measures


def test_pie_allowed_for_single_sum_of_non_negative_values(sales_ds):
    result = run_analysis(sales_ds, spec(measures=[{"column": "revenue", "aggregation": "sum"}], group_by="region"))
    assert result["chart"]["pie_allowed"] is True
    result = run_analysis(sales_ds, spec(measures=[{"column": "revenue", "aggregation": "mean"}], group_by="region"))
    assert result["chart"]["pie_allowed"] is False
    assert "add up" in result["chart"]["pie_reason"]


def test_remove_duplicates_changes_results(sales_ds):
    result = run_analysis(
        sales_ds,
        spec(
            measures=[{"column": "revenue", "aggregation": "sum"}],
            group_by="region",
            remove_duplicates=True,
        ),
    )
    assert result["rows_analyzed"] == 9
    assert result["rows"][1] == {"group": "South", "row_count": 2, "values": {"sum__revenue": 120}}
    assert kpi(result, "sum__revenue")["value"] == 285
    assert "1 exact duplicate" in result["notes"][0]


def test_monthly_grouping_excludes_invalid_dates(sales_ds):
    result = run_analysis(sales_ds, spec(measures=[{"column": "revenue", "aggregation": "sum"}], group_by="date", time_grain="month"))
    assert [(r["group"], r["values"]["sum__revenue"]) for r in result["rows"]] == [
        ("2025-01", 100),
        ("2025-02", 15),
        ("2025-03", 140),
        ("2025-04", 30),
        ("2025-05", 30),
    ]
    assert result["chart"]["recommended"] == "line"
    assert any("without a valid 'date'" in n for n in result["notes"])
    # KPI cards still cover every row, including the one with an invalid date.
    assert kpi(result, "sum__revenue")["value"] == 355


@pytest.mark.parametrize(
    ("grain", "expected"),
    [
        ("quarter", [("2025-Q1", 255), ("2025-Q2", 60)]),
        ("year", [("2025", 315)]),
        (
            "week",
            [
                ("Week of 2024-12-30", 50),
                ("Week of 2025-01-20", 50),
                ("Week of 2025-02-03", 15),
                ("Week of 2025-02-10", None),
                ("Week of 2025-02-24", 140),
                ("Week of 2025-04-07", 30),
                ("Week of 2025-05-26", 30),
            ],
        ),
    ],
)
def test_other_time_grains(sales_ds, grain, expected):
    result = run_analysis(sales_ds, spec(measures=[{"column": "revenue", "aggregation": "sum"}], group_by="date", time_grain=grain))
    assert [(r["group"], r["values"]["sum__revenue"]) for r in result["rows"]] == expected


def test_value_and_date_filters(sales_ds):
    result = run_analysis(
        sales_ds,
        spec(
            measures=[{"column": "revenue", "aggregation": "sum"}],
            filters=[{"column": "region", "values": ["North", "West"]}, {"column": "date", "start": "2025-02-01", "end": "2025-05-30"}],
        ),
    )
    # North rows 3 (15) and 10 (30), West row 9 (10); the invalid-date North row is excluded by the date range.
    assert result["rows_analyzed"] == 3
    assert kpi(result, "sum__revenue")["value"] == 55


def test_average_with_no_values_is_none_not_zero(sales_ds):
    result = run_analysis(
        sales_ds,
        spec(
            measures=[{"column": "revenue", "aggregation": "mean"}, {"column": "revenue", "aggregation": "count"}],
            filters=[{"column": "region", "values": ["East"]}, {"column": "product", "values": ["C"]}],
        ),
    )
    assert kpi(result, "mean__revenue")["value"] is None
    assert kpi(result, "count__revenue")["value"] == 0


def test_filters_matching_nothing(sales_ds):
    result = run_analysis(
        sales_ds, spec(measures=[{"aggregation": "count"}], group_by="region", filters=[{"column": "region", "values": ["Nowhere"]}])
    )
    assert result["rows_analyzed"] == 0
    assert result["rows"] == []
    assert kpi(result, "count__rows")["value"] == 0


def test_mean_value_precision(sales_ds):
    result = run_analysis(sales_ds, spec(measures=[{"column": "revenue", "aggregation": "mean"}]))
    assert kpi(result, "mean__revenue")["value"] == pytest.approx(355 / 9)


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"measures": [{"column": "region", "aggregation": "sum"}]}, "incompatible_aggregation"),
        ({"measures": [{"column": "missing", "aggregation": "sum"}]}, "unknown_column"),
        ({"measures": [{"aggregation": "count"}], "group_by": "revenue"}, "incompatible_grouping"),
        ({"measures": [{"aggregation": "count"}], "group_by": "nope"}, "unknown_column"),
        ({"measures": [{"aggregation": "count"}], "filters": [{"column": "units", "values": ["1"]}]}, "invalid_filter"),
        ({"measures": [{"aggregation": "count"}], "filters": [{"column": "region", "start": "2025-01-01"}]}, "invalid_filter"),
        ({"measures": [{"column": "units", "aggregation": "sum"}, {"column": "units", "aggregation": "sum"}]}, "duplicate_measure"),
    ],
)
def test_invalid_specs_are_rejected(sales_ds, payload, code):
    with pytest.raises(DataError) as err:
        run_analysis(sales_ds, spec(**payload))
    assert err.value.code == code


@pytest.mark.parametrize(
    "payload",
    [
        {"measures": []},
        {"measures": [{"column": "units", "aggregation": "median"}]},
        {"measures": [{"aggregation": "sum"}]},
        {"measures": [{"aggregation": "count"}], "time_grain": "hour"},
        {"measures": [{"aggregation": "count"}], "filters": [{"column": "date", "start": "2025-05-01", "end": "2025-01-01"}]},
        {"measures": [{"aggregation": "count"}], "unexpected": True},
    ],
)
def test_malformed_specs_fail_validation(payload):
    with pytest.raises(ValueError):
        AnalysisSpec.model_validate(payload)


def test_group_truncation(settings):
    from app.ingest import load_table
    from app.profiling import build_dataset

    text = "name,v\n" + "\n".join(f"n{i},{i}" for i in range(30))
    ds = build_dataset(load_table("x.csv", text.encode(), settings))
    result = run_analysis(ds, spec(measures=[{"column": "v", "aggregation": "sum"}], group_by="name"), max_groups=10)
    assert len(result["rows"]) == 10
    assert result["grouping"]["truncated"] is True
    assert result["rows"][0]["group"] == "n29"
