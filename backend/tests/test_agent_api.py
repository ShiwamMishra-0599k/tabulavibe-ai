"""POST /api/agent/run: streamed phases and report, sign-in, limits and the AI/rules switch."""

import json

import httpx
from fastapi.testclient import TestClient

from app.agent.gemini import GeminiAnalyst
from app.agent.workflow import RulesAnalyst
from app.auth import get_token_verifier
from app.config import Settings
from app.main import create_app, get_agent_factory

from .test_agent_gemini import ScriptedGemini, happy_steps
from .test_auth import ANON_KEY, FakeAuth, TokenVerifier


def events_of(res):
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in res.text.splitlines() if line.strip()]


def run(client, data, context=None, headers=None):
    form = {"context": json.dumps(context)} if context is not None else {}
    return client.post("/api/agent/run", files={"file": ("sales.csv", data, "text/csv")}, data=form, headers=headers or {})


def test_streams_every_phase_then_the_report(client, sales_bytes):
    events = events_of(run(client, sales_bytes))
    assert events[0]["type"] == "start" and events[0]["mode"] == "rules"
    assert {e["phase"] for e in events if e["type"] == "phase"} == set(range(9))
    report = events[-1]["report"]
    assert events[-1]["type"] == "report" and report["dataset"]["file_name"] == "sales.csv"
    assert report["validation"]["reconciliation"][0]["engine_value"] == 355  # hand-checked fixture total


def test_business_context_reaches_the_charter(client, sales_bytes):
    report = events_of(run(client, sales_bytes, {"domain": "Bakery sales", "kpis": "units"}))[-1]["report"]
    assert report["charter"]["business_context"] == "Bakery sales"
    assert report["preparation"]["primary_measure"] == "units"


def test_invalid_context_is_rejected(client, sales_bytes):
    res = run(client, sales_bytes, {"domain": "x", "unknown_field": 1})
    assert res.status_code == 422 and res.json()["error"]["code"] == "invalid_request"


def test_config_reports_the_agent_mode(client):
    assert client.get("/api/config").json()["agent"] == {"mode": "rules", "model": None}


def test_ai_mode_through_the_api(sales_bytes):
    app = create_app(Settings(app_env="test", _env_file=None))
    fake = ScriptedGemini(happy_steps())
    app.dependency_overrides[get_agent_factory] = lambda: (
        lambda ctx: (GeminiAnalyst("test-key", "gemini-test", ctx, transport=httpx.MockTransport(fake.handler)), RulesAnalyst(ctx))
    )
    report = events_of(run(TestClient(app), sales_bytes))[-1]["report"]
    assert report["mode"] == "ai" and all(f["grounded"] for f in report["findings"])


def test_runs_are_rate_limited(sales_bytes):
    client = TestClient(create_app(Settings(app_env="test", agent_runs_per_minute=1, _env_file=None)))
    assert run(client, sales_bytes).status_code == 200
    res = run(client, sales_bytes)
    assert res.status_code == 429 and res.json()["error"]["code"] == "agent_rate_limited"


def test_sign_in_is_required_when_enabled(sales_bytes):
    settings = Settings(
        app_env="test", supabase_url="https://demo.supabase.co", supabase_anon_key=ANON_KEY, require_sign_in=True, _env_file=None
    )
    app = create_app(settings)
    verifier = TokenVerifier(settings.supabase_url, ANON_KEY, 5, transport=httpx.MockTransport(FakeAuth().handler))
    app.dependency_overrides[get_token_verifier] = lambda: verifier
    client = TestClient(app)
    assert run(client, sales_bytes).status_code == 401
    assert run(client, sales_bytes, headers={"Authorization": "Bearer good-token"}).status_code == 200


def test_unreadable_files_fail_before_streaming(client):
    res = run(client, b"a,b\n")
    assert res.status_code == 422 and res.json()["error"]["code"] == "no_data_rows"
