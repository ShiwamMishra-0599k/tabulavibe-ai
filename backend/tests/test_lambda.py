"""Exercise the Lambda entry point with Function URL (payload format 2.0) events."""

import base64
import csv
import io
import json

from app.lambda_handler import handler


class Context:
    function_name = "test"
    aws_request_id = "req-1"
    memory_limit_in_mb = 1024

    @staticmethod
    def get_remaining_time_in_millis() -> int:
        return 20_000


def event(method: str, path: str, body: bytes = b"", headers: dict | None = None) -> dict:
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"host": "abc.lambda-url.ap-south-1.on.aws", **(headers or {})},
        "requestContext": {
            "domainName": "abc.lambda-url.ap-south-1.on.aws",
            "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "203.0.113.5", "userAgent": "pytest"},
            "requestId": "req-1",
            "routeKey": "$default",
            "stage": "$default",
            "time": "21/Oct/2026:10:00:00 +0000",
            "timeEpoch": 0,
        },
        "body": base64.b64encode(body).decode(),
        "isBase64Encoded": True,
    }


def multipart(fields: dict[str, str], file_name: str, content: bytes) -> tuple[bytes, str]:
    boundary = "----tabulavibe"
    parts = []
    for key, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: text/csv\r\n\r\n'.encode()
        + content
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def test_health_via_function_url():
    res = handler(event("GET", "/api/health"), Context())
    assert res["statusCode"] == 200
    assert json.loads(res["body"])["status"] == "ok"


def test_analyze_with_base64_multipart_body(sales_bytes):
    spec = json.dumps({"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"})
    body, content_type = multipart({"spec": spec}, "sales.csv", sales_bytes)
    res = handler(event("POST", "/api/analyze", body, {"content-type": content_type, "content-length": str(len(body))}), Context())
    assert res["statusCode"] == 200, res["body"]
    result = json.loads(res["body"])
    assert result["kpis"][0]["value"] == 355
    assert result["rows"][0] == {"group": "South", "row_count": 3, "values": {"sum__revenue": 190}}


def test_csv_export_via_function_url(sales_bytes):
    body, content_type = multipart({}, "sales.csv", sales_bytes)
    res = handler(event("POST", "/api/export/cleaned", body, {"content-type": content_type}), Context())
    assert res["statusCode"] == 200
    text = base64.b64decode(res["body"]).decode("utf-8") if res.get("isBase64Encoded") else res["body"]
    rows = list(csv.reader(io.StringIO(text.lstrip(chr(0xFEFF)))))
    assert len(rows) == 11


def test_error_shape_via_function_url():
    body, content_type = multipart({}, "bad.txt", b"hello")
    res = handler(event("POST", "/api/profile", body, {"content-type": content_type}), Context())
    assert res["statusCode"] == 415
    assert json.loads(res["body"])["error"]["code"] == "unsupported_file_type"
