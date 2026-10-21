import math

import pandas as pd
import pytest

from app.ingest import load_table
from app.profiling import build_dataset, build_profile, parse_numbers


def ds_from(settings, text: str):
    return build_dataset(load_table("x.csv", text.encode(), settings))


def test_parse_numbers_handles_currency_grouping_and_rejects_ambiguous():
    values = pd.Series(["₹1,20,000", "$1,234.50", "-5", "12%", "1,2", "abc", "1e3", "Rs. 99", "", "1,234"])
    out = parse_numbers(values).tolist()
    expected = [120000.0, 1234.5, -5.0, 12.0, None, None, 1000.0, 99.0, None, 1234.0]
    for got, want in zip(out, expected, strict=True):
        if want is None:
            assert math.isnan(got)
        else:
            assert got == want


def test_type_inference_on_fixture(sales_ds):
    types = {name: info.inferred_type for name, info in sales_ds.columns.items()}
    assert types == {
        "date": "date",
        "region": "category",
        "product": "category",
        "units": "number",
        "price": "number",
        "revenue": "number",
        "notes": "category",
    }
    assert sales_ds.columns["date"].invalid_count == 1
    assert sales_ds.columns["date"].invalid_examples == ["not-a-date"]
    assert sales_ds.columns["units"].missing_count == 1
    assert sales_ds.columns["notes"].missing_count == 6  # 5 blanks + "n/a"


def test_profile_counts_and_stats(sales_ds):
    profile = build_profile(sales_ds, "sales.csv")
    assert profile["dataset"]["row_count"] == 10
    assert profile["dataset"]["column_count"] == 7
    assert profile["dataset"]["duplicate_row_count"] == 1
    units = next(c for c in profile["columns"] if c["name"] == "units")
    assert units["missing_pct"] == 10.0
    stats = units["numeric_stats"]
    assert stats["count"] == 9 and stats["sum"] == 45 and stats["mean"] == 5
    assert stats["min"] == 1 and stats["max"] == 10 and stats["median"] == 5
    assert stats["std"] == pytest.approx(pd.Series([10, 5, 3, 7, 7, 2, 4, 1, 6]).std())
    date = next(c for c in profile["columns"] if c["name"] == "date")
    assert date["date_range"] == {"min": "2025-01-05T00:00:00", "max": "2025-05-30T00:00:00"}
    codes = [i["code"] for i in profile["issues"]]
    assert "duplicate_rows" in codes and "invalid_values" in codes and "missing_values" in codes
    assert profile["suggestions"]["dates"] == ["date"]
    assert set(profile["suggestions"]["measures"]) == {"units", "price", "revenue"}
    assert profile["preview"]["rows"][0][:2] == ["2025-01-05", "North"]


def test_day_first_dates_and_ambiguity_note(settings):
    ds = ds_from(settings, "d,v\n03/04/2024,1\n05/06/2024,2\n01/02/2024,3\n")
    info = ds.columns["d"]
    assert info.inferred_type == "date" and info.date_format == "%d/%m/%Y"
    assert ds.typed["d"].iloc[0] == pd.Timestamp("2024-04-03")
    assert any("ambiguous" in n for n in info.notes)


def test_month_first_dates_when_unambiguous(settings):
    ds = ds_from(settings, "d\n12/25/2024\n01/31/2024\n")
    assert ds.columns["d"].date_format == "%m/%d/%Y"
    assert ds.columns["d"].notes == []


def test_boolean_and_text_and_identifier(settings):
    rows = "\n".join(f"C{i:03d},{'yes' if i % 2 else 'no'},note number {i}" for i in range(250))
    ds = ds_from(settings, "customer_id,active,comment\n" + rows)
    assert ds.columns["active"].inferred_type == "boolean"
    assert ds.typed["active"].sum() == 125
    assert ds.columns["customer_id"].role == "identifier"
    assert ds.columns["comment"].inferred_type == "text"


def test_numeric_id_column_is_not_a_measure(settings):
    rows = "\n".join(f"{1000 + i},{i * 2}" for i in range(30))
    ds = ds_from(settings, "invoice no,amount\n" + rows)
    assert ds.columns["invoice no"].role == "identifier"
    assert ds.columns["amount"].role == "measure"


def test_consecutive_numbers_are_identifiers(settings):
    rows = "\n".join(f"{i},{i * 3 % 7}" for i in range(1, 31))
    ds = ds_from(settings, "row,score\n" + rows)
    assert ds.columns["row"].role == "identifier"
    assert ds.columns["score"].role == "measure"


def test_mostly_text_column_stays_text_not_number(settings):
    ds = ds_from(settings, "v\n1\nabc\ndef\n2\n")
    assert ds.columns["v"].inferred_type == "category"


def test_empty_column_and_case_variants(settings):
    ds = ds_from(settings, "region,blank\nNorth,\nnorth,\nSouth,\n")
    assert ds.columns["blank"].inferred_type == "empty"
    assert any("letter case" in n for n in ds.columns["region"].notes)
