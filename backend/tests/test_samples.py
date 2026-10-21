"""Cross-check the analysis engine against an independent calculation with the csv module."""

import csv
import io
import json

from app.samples import SAMPLES_DIR


def test_retail_sample_totals_match_independent_calculation(client):
    content = (SAMPLES_DIR / "retail_sales.csv").read_bytes()
    expected: dict[str, float] = {}
    total = 0.0
    for row in csv.DictReader(io.StringIO(content.decode("utf-8"))):
        if row["revenue"]:
            expected[row["region"]] = expected.get(row["region"], 0.0) + float(row["revenue"])
            total += float(row["revenue"])

    spec = {"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"}
    res = client.post("/api/analyze", files={"file": ("retail_sales.csv", content)}, data={"spec": json.dumps(spec)})
    body = res.json()
    assert abs(body["kpis"][0]["value"] - total) < 1e-6
    got = {r["group"]: r["values"]["sum__revenue"] for r in body["rows"]}
    assert set(got) == set(expected)  # includes lower-case variants: they are not merged silently
    for region, value in expected.items():
        assert abs(got[region] - value) < 1e-6
