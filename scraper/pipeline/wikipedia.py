from __future__ import annotations

import logging
import re
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_API_BASE = "https://id.wikipedia.org/w/api.php"
_REST_BASE = "https://id.wikipedia.org/api/rest_v1"
_TIMEOUT = 15.0
_HEADERS = {
    "User-Agent": "PejabatKita/1.0 (https://github.com/anzalarizqi/pejabatkita; anzalarizqi@gmail.com)"
}


async def search_wikipedia(query: str, limit: int = 5) -> list[dict]:
    """
    Search Indonesian Wikipedia. Returns list of {"title", "url"}.
    """
    params = {
        "action": "opensearch",
        "search": query,
        "limit": limit,
        "format": "json",
        "namespace": 0,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(_API_BASE, params=params)
        if resp.status_code != 200:
            return []
        data = resp.json()
        titles: list[str] = data[1]
        urls: list[str] = data[3]
        return [{"title": t, "url": u} for t, u in zip(titles, urls)]
    except Exception as e:
        logger.debug("Wikipedia search(%r) failed: %s", query, e)
        return []


async def get_page_text(title: str) -> tuple[str, str]:
    """
    Fetch page text for a Wikipedia title.
    Tries REST summary first, falls back to full extract.
    Returns (text, page_url).
    """
    encoded = quote(title.replace(" ", "_"), safe="")
    page_url = f"https://id.wikipedia.org/wiki/{encoded}"

    # REST summary (fast, clean)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(f"{_REST_BASE}/page/summary/{encoded}")
        if resp.status_code == 200:
            data = resp.json()
            text = data.get("extract", "")
            if text and len(text) > 100:
                logger.debug("Wikipedia summary for %r: %d chars", title, len(text))
                return text, page_url
    except Exception as e:
        logger.debug("Wikipedia REST summary failed for %r: %s", title, e)

    # Fallback: full extract via MediaWiki API
    try:
        params = {
            "action": "query",
            "titles": title,
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "format": "json",
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS) as client:
            resp = await client.get(_API_BASE, params=params)
        if resp.status_code == 200:
            pages = resp.json().get("query", {}).get("pages", {})
            for page in pages.values():
                text = page.get("extract", "")
                if text:
                    logger.debug("Wikipedia extract for %r: %d chars", title, len(text))
                    return text[:8000], page_url
    except Exception as e:
        logger.debug("Wikipedia extract failed for %r: %s", title, e)

    return "", page_url


async def get_province_districts(provinsi_name: str) -> list[str]:
    """
    Get list of kabupaten/kota names in a province.
    Uses Jina reader on the Wikipedia list page to get full rendered content incl. tables.
    Returns sorted list of district names, e.g. ["Kabupaten Bandung", "Kota Bandung", ...]
    """
    list_title = f"Daftar kabupaten dan kota di {provinsi_name}"
    results = await search_wikipedia(list_title, limit=3)

    page_url: str | None = None
    for r in results:
        if "kabupaten" in r["title"].lower() and provinsi_name.lower() in r["title"].lower():
            page_url = r["url"]
            break
    if not page_url and results:
        page_url = results[0]["url"]
    if not page_url:
        logger.warning("No Wikipedia list page found for province: %s", provinsi_name)
        return []

    # Use Jina reader to get full page including tables (extract API skips tables)
    jina_url = f"https://r.jina.ai/{page_url}"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=_HEADERS) as client:
            resp = await client.get(jina_url, headers={"Accept": "text/plain"})
        text = resp.text if resp.status_code == 200 else ""
    except Exception as e:
        logger.debug("Jina read of Wikipedia list page failed: %s", e)
        text, _ = await get_page_text(list_title)

    if not text:
        return []

    districts = _extract_district_names(text, provinsi_name)
    logger.info("Found %d districts in %s", len(districts), provinsi_name)
    return districts


def _extract_district_names(text: str, provinsi_name: str) -> list[str]:
    """
    Parse district names from Wikipedia list page text.
    Matches "Kabupaten X [Y]" and "Kota X [Y]" — up to 3 capitalised words after the prefix.
    """
    districts: list[str] = []
    seen: set[str] = set()

    # Match Kabupaten/Kota followed by 1–3 title-case words, stopping at punctuation or lowercase
    pattern = re.compile(
        r'\b((?:Kabupaten|Kota)\s+(?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+){0,2})',
        re.UNICODE,
    )

    for m in pattern.finditer(text):
        name = m.group(1).strip()
        if provinsi_name.lower() in name.lower():
            continue
        key = name.lower()
        if key not in seen:
            seen.add(key)
            districts.append(name)

    return sorted(set(districts))
