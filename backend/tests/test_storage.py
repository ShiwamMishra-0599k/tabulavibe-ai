"""Saved reports and profiles, against an in-memory fake of Supabase's REST API.

The fake mimics Row Level Security: each access token maps to one user, and a user only ever
sees, creates or deletes their own rows.
"""

import base64
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app, get_report_store
from app.storage import ReportStore

ANON_KEY = "sb_publishable_test"
USERS = {"token-alice": "a1a1a1a1-0000-0000-0000-000000000001", "token-bob": "b2b2b2b2-0000-0000-0000-000000000002"}
SPEC = {"measures": [{"column": "revenue", "aggregation": "sum"}], "group_by": "region"}


class FakeSupabase:
    def __init__(self) -> None:
        self.reports: list[dict] = []
        self.profiles = {
            uid: {
                "id": uid,
                "email": f"{t[6:]}@example.com",
                "full_name": t[6:].title(),
                "avatar_url": None,
                "provider": "github",
                "created_at": "2026-10-21T00:00:00Z",
            }
            for t, uid in USERS.items()
        }
        self.requests: list[httpx.Request] = []
        self.fail_with: int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("apikey") != ANON_KEY:
            return httpx.Response(401, json={"message": "Invalid API key"})
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        user = USERS.get(token)
        if user is None:
            return httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"})
        if self.fail_with:
            return httpx.Response(self.fail_with, json={"message": "boom"})
        table = request.url.path.rsplit("/", 1)[-1]
        params = request.url.params
        if table == "profiles":
            return httpx.Response(200, json=[self.profiles[user]] if user in self.profiles else [])

        own = [r for r in self.reports if r["user_id"] == user]
        if "id" in params:
            own = [r for r in own if r["id"] == params["id"].removeprefix("eq.")]
        columns = params.get("select", "*")

        def pick(row: dict) -> dict:
            return row if columns == "*" else {c: row[c] for c in columns.split(",")}

        if request.method == "POST":
            row = {**json.loads(request.content), "id": str(uuid.uuid4()), "user_id": user, "created_at": "2026-10-21T10:00:00Z"}
            self.reports.append(row)
            return httpx.Response(201, json=[pick(row)])
        if request.method == "DELETE":
            self.reports = [r for r in self.reports if r not in own]
            return httpx.Response(200, json=[pick(r) for r in own])
        return httpx.Response(200, json=[pick(r) for r in sorted(own, key=lambda r: r["created_at"], reverse=True)])


@pytest.fixture
def fake() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def storage_client(fake: FakeSupabase) -> TestClient:
    settings = Settings(app_env="test", supabase_url="https://demo.supabase.co", supabase_anon_key=ANON_KEY, _env_file=None)
    app = create_app(settings)
    store = ReportStore(settings.supabase_url, ANON_KEY, 5, transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_report_store] = lambda: store
    return TestClient(app)


def auth(token: str = "token-alice") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def save(client: TestClient, data: bytes, token: str = "token-alice", **fields):
    form = {"spec": json.dumps(SPEC), "title": "Revenue by region", **fields}
    return client.post("/api/reports", files={"file": ("sales.csv", data, "text/csv")}, data=form, headers=auth(token))


def test_config_exposes_only_public_supabase_values(storage_client):
    cfg = storage_client.get("/api/config").json()
    assert cfg["storage"] == {
        "enabled": True,
        "supabase_url": "https://demo.supabase.co",
        "supabase_anon_key": ANON_KEY,
        "sign_in_required": False,
    }


def test_storage_disabled_by_default(client, sales_bytes):
    assert client.get("/api/config").json()["storage"] == {
        "enabled": False,
        "supabase_url": None,
        "supabase_anon_key": None,
        "sign_in_required": False,
    }
    res = client.get("/api/reports", headers=auth())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "storage_disabled"


def test_save_recalculates_on_the_server_and_stores_aggregates_only(storage_client, fake, sales_bytes):
    res = save(storage_client, sales_bytes, title="  Revenue   by region ")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["title"] == "Revenue by region"
    assert (body["source_name"], body["row_count"], body["column_count"]) == ("sales.csv", 10, 7)

    stored = fake.reports[0]
    # Hand-checked fixture totals (see conftest): South 190, North 135, East 20, West 10.
    assert stored["result"]["kpis"][0]["value"] == 355
    assert {r["group"]: r["values"]["sum__revenue"] for r in stored["result"]["rows"]} == {
        "South": 190,
        "North": 135,
        "East": 20,
        "West": 10,
    }
    assert stored["quality"]["dataset"]["duplicate_row_count"] == 1
    assert stored["narrative"] is None
    assert "user_id" not in json.loads(fake.requests[0].content)  # set by Postgres from the token
    # No raw rows: the cell values in the notes column never reach the database.
    assert "HYPERLINK" not in json.dumps(stored)
    assert "preview" not in stored["quality"]["dataset"]


def test_save_keeps_validated_ai_narrative(storage_client, fake, sales_bytes):
    narrative = {
        "provider": "gemini",
        "model": "m",
        "text": "- Up",
        "generated_at": "2026-10-21T10:00:00Z",
        "disclaimer": "AI",
        "shared_payload": {"kpis": []},
    }
    assert save(storage_client, sales_bytes, narrative=json.dumps(narrative)).status_code == 201
    assert fake.reports[0]["narrative"] == narrative
    bad = save(storage_client, sales_bytes, narrative=json.dumps({**narrative, "extra": 1}))
    assert bad.status_code == 422


def test_users_only_see_and_delete_their_own_reports(storage_client, sales_bytes):
    alice_id = save(storage_client, sales_bytes).json()["id"]
    save(storage_client, sales_bytes, token="token-bob", title="Bob's report")

    alice_list = storage_client.get("/api/reports", headers=auth()).json()
    assert [r["title"] for r in alice_list] == ["Revenue by region"]
    assert "result" not in alice_list[0]  # the list is a summary

    full = storage_client.get(f"/api/reports/{alice_id}", headers=auth()).json()
    assert full["result"]["kpis"][0]["value"] == 355

    assert storage_client.get(f"/api/reports/{alice_id}", headers=auth("token-bob")).status_code == 404
    assert storage_client.delete(f"/api/reports/{alice_id}", headers=auth("token-bob")).status_code == 404
    assert storage_client.delete(f"/api/reports/{alice_id}", headers=auth()).status_code == 204
    assert storage_client.get("/api/reports", headers=auth()).json() == []


def test_account_returns_the_signed_in_users_profile(storage_client):
    profile = storage_client.get("/api/account", headers=auth("token-bob")).json()
    assert (profile["email"], profile["full_name"], profile["provider"]) == ("bob@example.com", "Bob", "github")


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer "}])
def test_requests_without_a_bearer_token_are_rejected(storage_client, headers, sales_bytes):
    assert storage_client.get("/api/reports", headers=headers).json()["error"]["code"] == "auth_required"
    res = storage_client.post(
        "/api/reports", files={"file": ("s.csv", sales_bytes)}, data={"spec": json.dumps(SPEC), "title": "x"}, headers=headers
    )
    assert res.status_code == 401


def test_expired_token_and_database_errors_are_reported_safely(storage_client, fake):
    res = storage_client.get("/api/reports", headers=auth("expired"))
    assert res.status_code == 401
    assert "sign in again" in res.json()["error"]["message"]
    fake.fail_with = 500
    res = storage_client.get("/api/reports", headers=auth())
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "storage_error"
    assert "boom" not in res.text


def test_invalid_ids_and_titles_are_rejected(storage_client, sales_bytes):
    assert storage_client.get("/api/reports/not-a-uuid", headers=auth()).status_code == 422
    assert save(storage_client, sales_bytes, title="   ").json()["error"]["code"] == "invalid_request"


def test_cors_allows_authorization_and_delete(storage_client):
    res = storage_client.options(
        "/api/reports/x",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert res.status_code == 200
    assert "DELETE" in res.headers["access-control-allow-methods"]


def _jwt(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    return f"{enc({'alg': 'HS256'})}.{enc(claims)}.sig"


@pytest.mark.parametrize("key", ["sb_secret_abc", _jwt({"role": "service_role"})])
def test_privileged_keys_are_refused(key):
    with pytest.raises(ValueError, match="anon/publishable"):
        Settings(supabase_url="https://demo.supabase.co", supabase_anon_key=key, _env_file=None)


def test_anon_jwt_key_and_plain_http_rules():
    assert (
        Settings(supabase_url="https://x.supabase.co/", supabase_anon_key=_jwt({"role": "anon"}), _env_file=None).supabase_url
        == "https://x.supabase.co"
    )
    assert Settings(supabase_url="http://127.0.0.1:54321", supabase_anon_key="k", _env_file=None).storage_enabled
    with pytest.raises(ValueError, match="https"):
        Settings(supabase_url="http://evil.example", _env_file=None)
