import csv
import io
import json

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

from .conftest import make_xlsx

REVENUE_BY_REGION = {"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"}


def upload(data: bytes, name: str = "sales.csv"):
    return {"file": (name, data, "text/csv")}


def read_csv(text: str) -> list[list[str]]:
    assert text.startswith(chr(0xFEFF))
    return list(csv.reader(io.StringIO(text[1:])))


def test_health_and_config(client):
    assert client.get("/api/health").json()["status"] == "ok"
    cfg = client.get("/api/config").json()
    assert cfg["ai"] == {"enabled": False, "provider": None, "model": None}
    assert (cfg["limits"]["max_upload_mb"], cfg["limits"]["max_xlsx_mb"]) == (100, 20)
    assert (cfg["limits"]["max_rows"], cfg["limits"]["max_cells"]) == (2_000_000, 20_000_000)
    assert cfg["limits"]["supported_extensions"] == [".csv", ".xlsx"]


def test_samples_are_listed_and_profile_successfully(client):
    samples = client.get("/api/samples").json()
    assert {s["id"] for s in samples} == {"retail-sales", "service-bookings"}
    for sample in samples:
        res = client.get(f"/api/samples/{sample['id']}")
        assert res.status_code == 200
        profile = client.post("/api/profile", files=upload(res.content, sample["file_name"]))
        assert profile.status_code == 200, profile.text
        assert profile.json()["dataset"]["row_count"] > 100
    assert client.get("/api/samples/../../etc/passwd").status_code == 404
    assert client.get("/api/samples/unknown").json()["error"]["code"] == "sample_not_found"


def test_profile_endpoint(client, sales_bytes):
    res = client.post("/api/profile", files=upload(sales_bytes))
    assert res.status_code == 200
    body = res.json()
    assert body["dataset"]["row_count"] == 10
    assert body["dataset"]["duplicate_row_count"] == 1
    assert body["filter_options"]["region"] == ["East", "North", "South", "West"]


def test_profile_xlsx_endpoint(client):
    content = make_xlsx([["Region", "Sales"], ["North", 10], ["South", 20.5]])
    res = client.post("/api/profile", files={"file": ("book.xlsx", content, "application/octet-stream")})
    assert res.status_code == 200
    stats = next(c for c in res.json()["columns"] if c["name"] == "Sales")["numeric_stats"]
    assert stats["sum"] == 30.5


def test_client_content_type_is_not_trusted(client):
    # A CSV labelled as an Excel workbook is still rejected by extension/content checks.
    res = client.post("/api/profile", files={"file": ("x.exe", b"a\n1\n", "text/csv")})
    assert res.status_code == 415
    assert res.json()["error"]["code"] == "unsupported_file_type"


def test_missing_file_is_a_clean_422(client):
    res = client.post("/api/profile")
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "invalid_request"
    assert "Traceback" not in res.text


def test_oversized_upload_rejected_before_parsing():
    app = create_app(Settings(max_upload_mb=0.01, _env_file=None))
    client = TestClient(app)
    res = client.post("/api/profile", files=upload(b"a\n" + b"1234567890\n" * 5000))
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "file_too_large"


def test_empty_and_header_only_uploads(client):
    assert client.post("/api/profile", files=upload(b"")).json()["error"]["code"] == "empty_file"
    assert client.post("/api/profile", files=upload(b"a,b\n")).json()["error"]["code"] == "no_data_rows"


def test_analyze_endpoint(client, sales_bytes):
    res = client.post("/api/analyze", files=upload(sales_bytes), data={"spec": json.dumps(REVENUE_BY_REGION)})
    assert res.status_code == 200
    body = res.json()
    assert body["kpis"][0]["value"] == 355
    assert [r["group"] for r in body["rows"]] == ["South", "North", "East", "West"]


def test_analyze_rejects_malformed_spec(client, sales_bytes):
    for bad in ["not json", "{}", json.dumps({"measures": [{"column": "x", "aggregation": "median"}]})]:
        res = client.post("/api/analyze", files=upload(sales_bytes), data={"spec": bad})
        assert res.status_code == 422, bad
        assert res.json()["error"]["code"] == "invalid_request"
    res = client.post("/api/analyze", files=upload(sales_bytes))
    assert res.status_code == 422


def test_analyze_incompatible_aggregation_message(client, sales_bytes):
    spec = {"measures": [{"column": "region", "aggregation": "sum"}]}
    res = client.post("/api/analyze", files=upload(sales_bytes), data={"spec": json.dumps(spec)})
    assert res.status_code == 422
    assert "needs a numeric column" in res.json()["error"]["message"]


def test_cleaned_export_is_correct_and_injection_safe(client, sales_bytes):
    res = client.post("/api/export/cleaned", files=upload(sales_bytes), data={"options": json.dumps({"remove_duplicates": True})})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    assert res.headers["x-duplicates-removed"] == "1"
    rows = read_csv(res.text)
    assert rows[0] == ["date", "region", "product", "units", "price", "revenue", "notes"]
    assert len(rows) == 10  # header + 9 rows after removing the duplicate
    assert rows[1] == ["2025-01-05", "North", "A", "10", "5", "50", "ok"]
    assert rows[3][6] == '\'=HYPERLINK("x")'  # formula neutralised
    assert rows[4][3] == "" and rows[4][5] == "" and rows[4][6] == ""  # missing stays empty
    assert rows[5][6] == "'-cmd"
    assert rows[6][0] == "not-a-date"  # invalid value kept as uploaded, not silently fixed


def test_cleaned_export_keeps_duplicates_by_default(client, sales_bytes):
    res = client.post("/api/export/cleaned", files=upload(sales_bytes))
    assert res.status_code == 200
    assert len(read_csv(res.text)) == 11
    assert res.headers["x-duplicates-removed"] == "0"


def test_results_export_matches_analysis(client, sales_bytes):
    res = client.post("/api/export/results", files=upload(sales_bytes), data={"spec": json.dumps(REVENUE_BY_REGION)})
    assert res.status_code == 200
    assert read_csv(res.text) == [
        ["region", "row_count", "Sum of revenue"],
        ["South", "3", "190"],
        ["North", "4", "135"],
        ["East", "2", "20"],
        ["West", "1", "10"],
    ]


def test_results_export_without_grouping(client, sales_bytes):
    spec = {"measures": [{"column": "revenue", "aggregation": "mean"}]}
    res = client.post("/api/export/results", files=upload(sales_bytes), data={"spec": json.dumps(spec)})
    rows = read_csv(res.text)
    assert rows[0] == ["measure", "value", "values_used", "values_excluded", "definition"]
    assert rows[1][:4] == ["Average of revenue", repr(round(355 / 9, 9)), "9", "1"]


def test_formula_headers_are_neutralised(client):
    res = client.post("/api/export/cleaned", files=upload(b"=cmd,b\n@x,+1\n"))
    rows = read_csv(res.text)
    assert rows[0] == ["'=cmd", "b"]
    assert rows[1] == ["'@x", "1"]


def test_narrative_disabled_by_default(client, sales_bytes):
    res = client.post("/api/narrative", files=upload(sales_bytes), data={"spec": json.dumps(REVENUE_BY_REGION)})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ai_disabled"


def test_cors_allows_only_configured_origins(client):
    ok = client.options("/api/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/api/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_wildcard_origin_is_ignored():
    assert Settings(allowed_origins="*,https://app.example/", _env_file=None).origins == ["https://app.example"]


def test_docs_hidden_in_production():
    client = TestClient(create_app(Settings(app_env="production", _env_file=None)))
    assert client.get("/api/docs").status_code == 404


def test_cleaned_export_can_merge_label_variants(client):
    data = b"region,v\nNorth,1\nNorth,2\nnorth,3\n"
    res = client.post("/api/export/cleaned", files=upload(data), data={"options": json.dumps({"merge_label_variants": True})})
    assert res.headers["x-labels-merged"] == "1"
    assert [r[0] for r in read_csv(res.text)] == ["region", "North", "North", "North"]
    plain = client.post("/api/export/cleaned", files=upload(data))
    assert [r[0] for r in read_csv(plain.text)] == ["region", "North", "North", "north"]


def test_large_files_are_processed_one_at_a_time(sales_bytes):
    from app import main

    client = TestClient(create_app(Settings(app_env="test", large_file_mb=0.0001, _env_file=None)))  # ~100 bytes counts as "large"
    assert client.post("/api/profile", files=upload(sales_bytes)).status_code == 200  # slot free
    assert main._large_file_slot.acquire(blocking=False)  # simulate another large upload in progress
    try:
        res = client.post("/api/profile", files=upload(sales_bytes))
        assert res.status_code == 503 and res.json()["error"]["code"] == "server_busy"
    finally:
        main._large_file_slot.release()
    assert client.post("/api/profile", files=upload(sales_bytes)).status_code == 200
