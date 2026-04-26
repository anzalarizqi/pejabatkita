from __future__ import annotations

import ipaddress
import logging
import re
from pathlib import Path
from urllib.parse import quote, unquote

import httpx
import yaml

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent.parent / "config.yaml"


def _search_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f).get("search", {})


# ─── SSRF protection ─────────────────────────────────────────────────────────

def is_private_url(url: str) -> bool:
    """Return True if the URL points to a private/local address (block it)."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return True
        host = parsed.hostname or ""
        if not host:
            return True
        if host in ("localhost",) or host.endswith(".local"):
            return True
        addr = ipaddress.ip_address(host)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return False  # not an IP address — domain names are allowed
    except Exception:
        return True


# ─── DDG via Jina ────────────────────────────────────────────────────────────

async def _ddg_via_jina(query: str, timeout: float) -> str | None:
    ddg_url = f"https://html.duckduckgo.com/html/?q={quote(query)}"
    jina_url = f"https://r.jina.ai/{ddg_url}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(jina_url, headers={"Accept": "application/json"})
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data.get("data", {}).get("content") or None
    except Exception as e:
        logger.debug("DDG via Jina failed: %s", e)
        return None


_TITLE_RE = re.compile(
    r'^\[([^\]!][^\]]*)\]\(https://duckduckgo\.com/l/\?uddg=([^&)\s]+)[^)]*\)\s*$',
    re.MULTILINE,
)
_SNIPPET_RE = re.compile(r'\[([^\]]*\s[^\]]{15,})\]\(https://duckduckgo\.com/l/[^)]+\)')


def _parse_ddg_markdown(markdown: str, max_results: int) -> list[dict]:
    results: list[dict] = []
    seen: set[str] = set()

    for m in _TITLE_RE.finditer(markdown):
        if len(results) >= max_results:
            break
        title = m.group(1).replace("**", "").strip()
        try:
            url = unquote(m.group(2))
        except Exception:
            continue
        if not url.startswith("http") or url in seen:
            continue
        seen.add(url)

        snippet = ""
        after = markdown[m.end(): m.end() + 1200]
        for sm in _SNIPPET_RE.finditer(after):
            candidate = sm.group(1).replace("**", "").strip()
            if " " in candidate and not candidate.startswith("http"):
                snippet = candidate
                break

        results.append({"title": title, "url": url, "snippet": snippet})

    return results


# ─── SearXNG fallback ────────────────────────────────────────────────────────

async def _searxng_search(query: str, timeout: float, searxng_url: str) -> list[dict] | None:
    url = f"{searxng_url}/search?q={quote(query)}&format=json&categories=general&language=auto"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
        if resp.status_code != 200:
            return None
        data = resp.json()
        results = []
        for r in data.get("results", []):
            if not r.get("url") or not r.get("title"):
                continue
            results.append({
                "title": r["title"].replace("**", "").strip(),
                "url": r["url"],
                "snippet": (r.get("content") or "").replace("**", "").strip(),
            })
        return results or None
    except Exception as e:
        logger.debug("SearXNG search failed: %s", e)
        return None


# ─── Public API ──────────────────────────────────────────────────────────────

async def search(query: str) -> list[dict]:
    """
    Search the web for query. Returns list of {"title", "url", "snippet"}.
    Primary: DDG via Jina. Fallback: SearXNG.
    """
    cfg = _search_config()
    timeout = cfg.get("timeout_ms", 20000) / 1000
    max_results = cfg.get("max_results", 5)
    searxng_url = cfg.get("searxng_url", "https://searx.be")

    markdown = await _ddg_via_jina(query, timeout)
    if markdown:
        results = _parse_ddg_markdown(markdown, max_results)
        if results:
            logger.debug("search(%r): %d results via DDG/Jina", query, len(results))
            return results

    results = await _searxng_search(query, timeout, searxng_url) or []
    logger.debug("search(%r): %d results via SearXNG", query, len(results))
    return results[:max_results]


async def read_url(url: str) -> str:
    """
    Fetch and return plain text content of a URL via Jina reader.
    Returns empty string on failure. Truncated to 8000 chars.
    """
    if is_private_url(url):
        logger.warning("Blocked private URL: %s", url)
        return ""

    cfg = _search_config()
    jina_base = cfg.get("jina_base_url", "https://r.jina.ai")
    timeout = cfg.get("read_timeout_ms", 30000) / 1000

    jina_url = f"{jina_base}/{url}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(jina_url, headers={"Accept": "text/plain"})
        if resp.status_code != 200:
            return ""
        text = resp.text
        if len(text) > 8000:
            return text[:8000] + "\n\n[...truncated]"
        return text
    except Exception as e:
        logger.debug("read_url(%s) failed: %s", url, e)
        return ""
