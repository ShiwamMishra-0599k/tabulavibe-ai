import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.github import CACHE_SECONDS, StarCounter, repo_info
from app.main import create_app

REPO = "ShiwamMishra-0599k/tabulavibe-ai"


class FakeGitHub:
    def __init__(self, status: int = 200, body: object | None = None):
        self.status = status
        self.body = {"stargazers_count": 42} if body is None else body
        self.calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        assert request.url.path == f"/repos/{REPO}"
        assert "authorization" not in request.headers  # public data, no token
        return httpx.Response(self.status, json=self.body)


class Clock:
    now = 1000.0

    def __call__(self) -> float:
        return self.now


def counter(fake: FakeGitHub, clock: Clock | None = None) -> StarCounter:
    return StarCounter(transport=httpx.MockTransport(fake.handler), clock=clock or Clock())


def test_star_count_is_cached_for_ten_minutes():
    fake, clock = FakeGitHub(), Clock()
    stars = counter(fake, clock)
    assert repo_info(REPO, stars) == {"repo": REPO, "url": f"https://github.com/{REPO}", "stars": 42}
    clock.now += CACHE_SECONDS - 1
    assert stars.stars(REPO) == 42
    assert fake.calls == 1
    fake.body = {"stargazers_count": 43}
    clock.now += 2
    assert stars.stars(REPO) == 43
    assert fake.calls == 2


@pytest.mark.parametrize(("status", "body"), [(403, {"message": "rate limit"}), (404, {}), (200, {"stargazers_count": "lots"}), (200, [])])
def test_failures_give_no_count_and_retry_later(status, body):
    fake, clock = FakeGitHub(status, body), Clock()
    stars = counter(fake, clock)
    assert stars.stars(REPO) is None
    assert stars.stars(REPO) is None
    assert fake.calls == 1  # failure is cached briefly, GitHub is not hammered
    clock.now += 61
    stars.stars(REPO)
    assert fake.calls == 2


def test_network_error_gives_no_count():
    def boom(request):
        raise httpx.ConnectError("offline")

    assert StarCounter(transport=httpx.MockTransport(boom)).stars(REPO) is None


@pytest.mark.parametrize("repo", ["", None, "not-a-repo", "../../etc/passwd", "a/b/c", "owner/name?x=1"])
def test_invalid_or_empty_repo_is_hidden_without_calling_github(repo):
    fake = FakeGitHub()
    assert repo_info(repo, counter(fake)) == {"repo": None, "url": None, "stars": None}
    assert fake.calls == 0


def test_endpoint_uses_configured_repo():
    fake = FakeGitHub()
    app = create_app(Settings(app_env="test", _env_file=None))
    app.state.star_counter = counter(fake)
    body = TestClient(app).get("/api/github").json()
    assert body == {"repo": REPO, "url": f"https://github.com/{REPO}", "stars": 42}
    hidden = create_app(Settings(app_env="test", github_repo="", _env_file=None))
    assert TestClient(hidden).get("/api/github").json()["repo"] is None
