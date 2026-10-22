import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import CHAT_URLS, AIError, AIQuotaError, ChainProvider, ChatBackend, RateLimiter, build_payload, chat_backends, get_provider
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
    assert get_provider(Settings(ai_provider="nvidia", nvidia_api_key=None, _env_file=None)) is None
    assert get_provider(Settings(ai_provider="nvidia", nvidia_api_key="", _env_file=None)) is None
    assert get_provider(Settings(ai_provider="nvidia", nvidia_api_key="   ", _env_file=None)) is None
    provider = get_provider(Settings(ai_provider="nvidia", nvidia_api_key="k", _env_file=None))
    assert isinstance(provider, ChainProvider) and provider.model == "meta/llama-3.3-70b-instruct"


def test_provider_order_and_keys():
    both = Settings(ai_provider=" Groq , nvidia ", groq_api_key="gsk-test-secret", nvidia_api_key="nvapi-test-secret", _env_file=None)
    assert both.ai_provider == "groq,nvidia"
    assert [(b.name, b.model) for b in chat_backends(both)] == [
        ("groq", "llama-3.3-70b-versatile"),
        ("nvidia", "meta/llama-3.3-70b-instruct"),
    ]
    only_nvidia_key = Settings(ai_provider="groq,nvidia", nvidia_api_key="n", _env_file=None)
    assert [b.name for b in chat_backends(only_nvidia_key)] == ["nvidia"]  # Groq has no key, so it is skipped
    assert "secret" not in repr(chat_backends(both))  # keys never appear in a repr
    for bad in ("openai", "groq,groq"):
        with pytest.raises(ValueError):
            Settings(ai_provider=bad, _env_file=None)


def test_retired_gemini_setting_starts_with_ai_off():
    settings = Settings(ai_provider="gemini", _env_file=None)
    assert settings.ai_provider == "none" and get_provider(settings) is None


def test_config_reports_ai_enabled_without_leaking_key():
    settings = Settings(ai_provider="groq,nvidia", groq_api_key="gsk-secret-1", nvidia_api_key="nvapi-secret-2", _env_file=None)
    res = TestClient(create_app(settings)).get("/api/config")
    assert res.json()["ai"] == {"enabled": True, "provider": "groq", "model": "llama-3.3-70b-versatile"}
    assert res.json()["agent"]["chain"] == [
        {"provider": "groq", "label": "Groq", "model": "llama-3.3-70b-versatile"},
        {"provider": "nvidia", "label": "NVIDIA", "model": "meta/llama-3.3-70b-instruct"},
    ]
    assert "secret" not in res.text
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


# ---------------------------------------------------------------- chat providers (Groq, NVIDIA) HTTP layer


def backend(handler, name="nvidia") -> ChatBackend:
    return ChatBackend(name, f"{name}-test", "test-key", 5, httpx.MockTransport(handler))


def nvidia(handler) -> ChainProvider:
    return ChainProvider([backend(handler)])


def chat(message: dict) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"index": 0, "message": message, "finish_reason": "stop"}]})


@pytest.mark.parametrize("name", ["groq", "nvidia"])
def test_chat_success_and_request_shape(name):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return chat({"role": "assistant", "content": "Hello world"})

    provider = ChainProvider([backend(handler, name)])
    assert provider.generate("sys", "prompt") == "Hello world"
    assert (provider.name, provider.model) == (name, f"{name}-test")
    assert seen["url"] == CHAT_URLS[name]
    assert "test-key" not in seen["url"]  # the key travels in a header, not the URL
    assert seen["auth"] == "Bearer test-key"
    assert seen["body"]["model"] == f"{name}-test"
    assert seen["body"]["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "prompt"}]


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(429, json={"status": 429, "title": "Too Many Requests"}), "ai_quota_exceeded"),
        (httpx.Response(413, json={"error": {"message": "Request too large"}}), "ai_request_too_large"),
        (httpx.Response(401, json={}), "ai_auth_failed"),
        (httpx.Response(403, json={}), "ai_auth_failed"),
        (httpx.Response(404, json={"detail": "model not found"}), "ai_provider_error"),
        (httpx.Response(500, text="oops"), "ai_provider_error"),
        (httpx.Response(200, text="not json"), "ai_malformed_response"),
        (httpx.Response(200, json={"choices": []}), "ai_malformed_response"),
        (httpx.Response(200, json={"choices": [{"message": None}]}), "ai_malformed_response"),
        (chat({"role": "assistant", "content": ["not", "text"]}), "ai_malformed_response"),
    ],
)
def test_nvidia_error_mapping(response, code):
    with pytest.raises(AIError) as err:
        nvidia(lambda _req: response).generate("s", "p")
    assert err.value.code == code


def test_nvidia_empty_reply_is_reported_by_the_narrative(sales_bytes):
    provider = nvidia(lambda _req: chat({"role": "assistant", "content": None}))
    res = post(client_with(provider), sales_bytes)
    assert res.status_code == 502 and res.json()["error"]["code"] == "ai_malformed_response"


def test_nvidia_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(AIError) as err:
        nvidia(handler).generate("s", "p")
    assert err.value.code == "ai_timeout"


def test_commentary_falls_back_from_groq_to_nvidia():
    groq = backend(lambda _req: httpx.Response(413, json={}), "groq")
    nvidia_ok = backend(lambda _req: chat({"role": "assistant", "content": "From NVIDIA."}))
    provider = ChainProvider([groq, nvidia_ok])
    assert provider.generate("s", "p") == "From NVIDIA."
    assert (provider.name, provider.model) == ("nvidia", "nvidia-test")


def test_commentary_reports_the_last_error_when_every_provider_fails():
    provider = ChainProvider(
        [backend(lambda _req: httpx.Response(413, json={}), "groq"), backend(lambda _req: httpx.Response(401, json={}))]
    )
    with pytest.raises(AIError) as err:
        provider.generate("s", "p")
    assert err.value.code == "ai_auth_failed"
