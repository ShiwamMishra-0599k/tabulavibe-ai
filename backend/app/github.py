"""Star count for the project's GitHub repository, shown in the navigation bar.

Fetched by the server (not the browser) so visitors never contact GitHub directly, and cached so
the unauthenticated API limit (60 requests/hour per IP) is never approached. Failures are not
errors: the badge simply shows no count.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger("tabulavibe")

API_URL = "https://api.github.com/repos/{repo}"
REPO_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$")
CACHE_SECONDS = 600
RETRY_AFTER_FAILURE_SECONDS = 60


class StarCounter:
    def __init__(self, timeout: float = 5.0, transport: httpx.BaseTransport | None = None, clock=time.monotonic):
        self._timeout = timeout
        self._transport = transport
        self._clock = clock
        self._cache: dict[str, tuple[float, int | None]] = {}
        self._lock = threading.Lock()

    def stars(self, repo: str) -> int | None:
        now = self._clock()
        with self._lock:
            cached = self._cache.get(repo)
            if cached and cached[0] > now:
                return cached[1]
        count = self._fetch(repo)
        with self._lock:
            self._cache[repo] = (now + (CACHE_SECONDS if count is not None else RETRY_AFTER_FAILURE_SECONDS), count)
        return count

    def _fetch(self, repo: str) -> int | None:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "TabulaVibe-AI"}
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.get(API_URL.format(repo=repo), headers=headers)
        except httpx.HTTPError:
            logger.warning("GitHub star count unavailable (network error)")
            return None
        if response.status_code != 200:
            logger.warning("GitHub star count unavailable (HTTP %s)", response.status_code)
            return None
        try:
            count = response.json()["stargazers_count"]
        except (ValueError, KeyError, TypeError):
            return None
        return count if isinstance(count, int) and count >= 0 else None


def repo_info(repo: str | None, counter: StarCounter) -> dict[str, Any]:
    if not repo or not REPO_PATTERN.match(repo):
        return {"repo": None, "url": None, "stars": None}
    return {"repo": repo, "url": f"https://github.com/{repo}", "stars": counter.stars(repo)}
