"""Sign-in enforcement on the data endpoints, against a fake Supabase Auth server."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import CACHE_SECONDS, TokenVerifier, get_token_verifier
from app.config import Settings
from app.main import create_app

ANON_KEY = "sb_publishable_test"
USERS = {"good-token": {"id": "u-1", "email": "shiwam@gmail.com"}, "other-token": {"id": "u-2", "email": "shashank@gmail.com"}}
SPEC = json.dumps({"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"})


class FakeAuth:
    def __init__(self):
        self.calls = 0
        self.status: int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        assert request.url.path == "/auth/v1/user"
        assert request.headers["apikey"] == ANON_KEY
        if self.status:
            return httpx.Response(self.status, json={"msg": "boom"})
        user = USERS.get(request.headers.get("authorization", "").removeprefix("Bearer "))
        return httpx.Response(200, json=user) if user else httpx.Response(401, json={"msg": "invalid JWT"})


class Clock:
    now = 100.0

    def __call__(self):
        return self.now


@pytest.fixture
def fake():
    return FakeAuth()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def locked(fake, clock):
    settings = Settings(
        app_env="test", supabase_url="https://demo.supabase.co", supabase_anon_key=ANON_KEY, require_sign_in=True, _env_file=None
    )
    app = create_app(settings)
    verifier = TokenVerifier(settings.supabase_url, ANON_KEY, 5, transport=httpx.MockTransport(fake.handler), clock=clock)
    app.dependency_overrides[get_token_verifier] = lambda: verifier
    return TestClient(app)


def bearer(token="good-token"):
    return {"Authorization": f"Bearer {token}"}


def upload(data):
    return {"file": ("sales.csv", data, "text/csv")}


DATA_ENDPOINTS = [
    ("/api/profile", {}),
    ("/api/analyze", {"spec": SPEC}),
    ("/api/export/results", {"spec": SPEC}),
    ("/api/export/cleaned", {"options": "{}"}),
    ("/api/narrative", {"spec": SPEC}),
]


@pytest.mark.parametrize(("path", "form"), DATA_ENDPOINTS)
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic x"}, {"Authorization": "Bearer "}])
def test_every_data_endpoint_requires_sign_in(locked, fake, sales_bytes, path, form, headers):
    res = locked.post(path, files=upload(sales_bytes), data=form, headers=headers)
    assert res.status_code == 401
    assert res.json()["error"] == {"code": "auth_required", "message": "Sign in to upload and analyse files."}
    assert fake.calls == 0  # rejected before contacting Supabase


@pytest.mark.parametrize(("path", "form"), DATA_ENDPOINTS[:4])
def test_signed_in_users_can_upload_and_analyse(locked, sales_bytes, path, form):
    res = locked.post(path, files=upload(sales_bytes), data=form, headers=bearer())
    assert res.status_code == 200, res.text


def test_analysis_figures_are_unchanged_when_signed_in(locked, sales_bytes):
    body = locked.post("/api/analyze", files=upload(sales_bytes), data={"spec": SPEC}, headers=bearer()).json()
    assert body["kpis"][0]["value"] == 355  # hand-checked fixture total (conftest)


def test_invalid_or_expired_tokens_are_rejected(locked, sales_bytes):
    res = locked.post("/api/profile", files=upload(sales_bytes), headers=bearer("forged"))
    assert res.status_code == 401
    assert "sign in again" in res.json()["error"]["message"]


def test_auth_outage_is_reported_without_details(locked, fake, sales_bytes):
    fake.status = 500
    res = locked.post("/api/profile", files=upload(sales_bytes), headers=bearer())
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "auth_error"
    assert "boom" not in res.text


def test_verified_tokens_are_cached_for_a_minute(locked, fake, clock, sales_bytes):
    for _ in range(3):
        assert locked.post("/api/profile", files=upload(sales_bytes), headers=bearer()).status_code == 200
    assert fake.calls == 1
    clock.now += CACHE_SECONDS + 1
    locked.post("/api/profile", files=upload(sales_bytes), headers=bearer())
    assert fake.calls == 2
    locked.post("/api/profile", files=upload(sales_bytes), headers=bearer("other-token"))
    assert fake.calls == 3  # each token is verified separately


def test_public_endpoints_stay_open(locked):
    assert locked.get("/api/health").status_code == 200
    assert locked.get("/api/samples").status_code == 200
    assert locked.get("/api/samples/retail-sales").status_code == 200
    cfg = locked.get("/api/config").json()
    assert cfg["storage"]["sign_in_required"] is True


def test_sign_in_is_off_by_default(client, sales_bytes):
    assert client.post("/api/profile", files=upload(sales_bytes)).status_code == 200
    assert client.get("/api/config").json()["storage"]["sign_in_required"] is False


def test_requiring_sign_in_without_supabase_refuses_to_start():
    with pytest.raises(ValueError, match="REQUIRE_SIGN_IN"):
        Settings(require_sign_in=True, _env_file=None)
