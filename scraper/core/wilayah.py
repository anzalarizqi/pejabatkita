from __future__ import annotations

import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)


def _normalize(name: str) -> str:
    """Strip common prefixes and normalize for fuzzy matching."""
    name = name.lower()
    for prefix in ("kabupaten administrasi ", "kota administrasi ", "kabupaten ", "kota "):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    return re.sub(r"\s+", " ", name).strip()


def _matches(wiki_name: str, supabase_name: str) -> bool:
    a = _normalize(wiki_name)
    b = _normalize(supabase_name)
    return a == b or a in b or b in a


def fetch_province_kode(provinsi_name: str) -> str | None:
    """
    Look up the BPS kode for a province by name from Supabase.
    Returns the kode_bps string (e.g. "31") or None if not found.
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None

    try:
        resp = httpx.get(
            f"{url}/rest/v1/wilayah",
            params={
                "select": "nama,kode_bps",
                "level": "eq.provinsi",
            },
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=10.0,
        )
        if resp.status_code != 200:
            return None
        rows = resp.json()
        for r in rows:
            if _matches(provinsi_name, r["nama"]):
                return r["kode_bps"]
        return None
    except Exception as e:
        logger.warning("Province kode lookup error: %s", e)
        return None


def fetch_province_wilayah(kode_provinsi: str) -> dict[str, str] | None:
    """
    Fetch kab/kota rows for a province from Supabase.
    Returns {normalized_nama: kode_bps} or None if unreachable.
    kode_provinsi is the BPS code prefix, e.g. "31" for DKI Jakarta.
    """
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        logger.warning("Supabase env vars not set — skipping wilayah validation")
        return None

    try:
        resp = httpx.get(
            f"{url}/rest/v1/wilayah",
            params={
                "select": "nama,kode_bps",
                "level": "in.(kabupaten,kota)",
                "kode_bps": f"like.{kode_provinsi}.%",
            },
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
            },
            timeout=10.0,
        )
        if resp.status_code != 200:
            logger.warning("Supabase wilayah fetch failed: HTTP %d", resp.status_code)
            return None

        rows = resp.json()
        if not rows:
            logger.warning("No wilayah rows found for kode_provinsi=%s", kode_provinsi)
            return None

        return {_normalize(r["nama"]): r["kode_bps"] for r in rows}

    except Exception as e:
        logger.warning("Supabase wilayah lookup error: %s", e)
        return None


def validate_districts(
    wiki_districts: list[str],
    kode_provinsi: str,
) -> list[tuple[str, str]]:
    """
    Cross-check Wikipedia-extracted district names against Supabase wilayah.
    Returns list of (district_name, kode_bps) for valid matches only.
    Falls back to all wiki_districts with placeholder kode if Supabase unavailable.
    """
    supabase_map = fetch_province_wilayah(kode_provinsi)

    if supabase_map is None:
        logger.warning("Wilayah validation skipped — using Wikipedia list as-is")
        return [(d, f"{kode_provinsi}.XX") for d in wiki_districts]

    validated: list[tuple[str, str]] = []
    for district in wiki_districts:
        matched_kode = None
        for supabase_norm, kode_bps in supabase_map.items():
            if _matches(district, supabase_norm):
                matched_kode = kode_bps
                break
        if matched_kode:
            validated.append((district, matched_kode))
        else:
            logger.warning("District not in wilayah table, skipping: %s", district)

    logger.info("Wilayah validation: %d/%d districts matched", len(validated), len(wiki_districts))
    return validated
