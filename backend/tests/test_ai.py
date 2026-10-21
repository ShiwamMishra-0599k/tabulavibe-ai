import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import AIError, AIQuotaError, GeminiProvider, RateLimiter, build_payload, get_provider
from app.analysis import run_analysis
from app.config import Settings
from app.main import create_app, get_narrative_provider
from app.schemas import AnalysisSpec

SPEC = {"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"}


class FakeProvider:
    name = "fake"
    model = "fake-1"

    def __init__(self, reply="Summary.\n- South leads.", error: Exception | None = None):
        self.reply = reply
        self.error = error
        self.prompts: list[str] = []

    def generate(self, system: str, prompt: str) -> str:
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        return self.reply


def client_with(provider, settings=None):
    app = create_app(settings or Settings(app_env="test", _env_file=None))
    app.dependency_overrides[get_narrative_provider] = lambda: provider
    return TestClient(app)


def post(client, sales_bytes):
    return client.post("/api/narrative", files={"file": ("s.csv", sales_bytes)}, data={"spec": json.dumps(SPEC)})


def test_no_provider_without_key():
    assert get_provider(Settings(ai_provider="none", _env_file=None)) is None
    assert get_provider(Settings(ai_provider="gemini", gemini_api_key=None, _env_file=None)) is None
    assert get_provider(Settings(ai_provider="gemini", gemini_api_key="", _env_file=None)) is None
    assert isinstance(get_provider(Settings(ai_provider="gemini", gemini_api_key="k", _env_file=None)), GeminiProvider)


def test_config_reports_ai_enabled_without_leaking_key():
    client = TestClient(create_app(Settings(ai_provider="gemini", gemini_api_key="secret-key-123", _env_file=None)))
    res = client.get("/api/config")
    assert res.json()["ai"]["enabled"] is True
    assert "secret-key-123" not in res.text


def test_narrative_success_sends_only_aggregates(sales_bytes):
    provider = FakeProvider()
    res = post(client_with(provider), sales_bytes)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"] == "Summary.\n- South leads."
    assert body["provider"] == "fake"
    assert "may contain mistakes" in body["disclaimer"]
    prompt = provider.prompts[0]
    assert "190" in prompt and "South" in prompt
    # Raw row values and the file name are never sent.
    assert "HYPERLINK" not in prompt and "2025-01-05" not in prompt and "s.csv" not in prompt
    assert body["shared_payload"]["groups"][0] == {"group": "South", "rows": 3, "Sum of revenue": 190}


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AIQuotaError("ai_quota_exceeded", "quota"), 429, "ai_quota_exceeded"),
        (AIError("ai_provider_error", "boom"), 502, "ai_provider_error"),
    ],
)
def test_provider_failures_map_to_clean_errors(sales_bytes, error, status, code):
    res = post(client_with(FakeProvider(error=error)), sales_bytes)
    assert res.status_code == status
    assert res.json()["error"]["code"] == code


def test_empty_provider_reply_is_rejected(sales_bytes):
    res = post(client_with(FakeProvider(reply="   ")), sales_bytes)
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "ai_malformed_response"


def test_rate_limit(sales_bytes):
    client = client_with(FakeProvider(), Settings(ai_requests_per_minute=2, _env_file=None))
    assert post(client, sales_bytes).status_code == 200
    assert post(client, sales_bytes).status_code == 200
    res = post(client, sales_bytes)
    assert res.status_code == 429 and res.json()["error"]["code"] == "ai_rate_limited"


def test_rate_limiter_window():
    limiter = RateLimiter(1)
    limiter.check("a")
    limiter.check("b")
    with pytest.raises(AIQuotaError):
        limiter.check("a")


def test_core_features_unaffected_by_ai_failure(sales_bytes):
    client = client_with(FakeProvider(error=AIError("ai_unavailable", "down")))
    assert post(client, sales_bytes).status_code == 502
    res = client.post("/api/analyze", files={"file": ("s.csv", sales_bytes)}, data={"spec": json.dumps(SPEC)})
    assert res.status_code == 200


def test_payload_is_limited(sales_ds):
    result = run_analysis(sales_ds, AnalysisSpec.model_validate(SPEC))
    payload = build_payload(result, {"duplicate_rows_in_file": 1})
    assert set(payload) == {"rows_analyzed", "kpis", "filters", "duplicates_removed", "data_quality", "grouped_by", "groups"}


# ---------------------------------------------------------------- Gemini HTTP layer


def gemini(handler) -> GeminiProvider:
    return GeminiProvider("test-key", "gemini-test", timeout=5, transport=httpx.MockTransport(handler))


def test_gemini_success_and_request_shape():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Hello "}, {"text": "world"}]}}]})

    assert gemini(handler).generate("sys", "prompt") == "Hello world"
    assert seen["url"].endswith("/v1beta/models/gemini-test:generateContent")
    assert "key=" not in seen["url"]  # key travels in a header, not the URL
    assert seen["key"] == "test-key"
    assert seen["body"]["systemInstruction"]["parts"][0]["text"] == "sys"


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}}), "ai_quota_exceeded"),
        (httpx.Response(403, json={}), "ai_auth_failed"),
        (httpx.Response(500, text="oops"), "ai_provider_error"),
        (httpx.Response(200, text="not json"), "ai_malformed_response"),
        (httpx.Response(200, json={"candidates": []}), "ai_malformed_response"),
        (httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}), "ai_malformed_response"),
    ],
)
def test_gemini_error_mapping(response, code):
    with pytest.raises(AIError) as err:
        gemini(lambda _req: response).generate("s", "p")
    assert err.value.code == code


def test_gemini_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(AIError) as err:
        gemini(handler).generate("s", "p")
    assert err.value.code == "ai_timeout"
