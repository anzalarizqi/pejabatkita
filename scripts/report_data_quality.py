"""
Data quality report for pejabat table.

Buckets:
  - placeholder_name:   nama_lengkap looks like a scraper placeholder
                        (e.g. "Wakil Bupati Kabupaten X", "[LLM Error] ...")
  - many_jabatan:       pejabat with > 2 jabatan rows (likely importer
                        dedup-by-name collapse — different real people merged)
  - empty_name:         null/empty/whitespace nama_lengkap
  - low_confidence:     metadata.confidence_score < 0.6 (if available)

Output: output/_quality_report.json — read-only, no DB writes.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


PLACEHOLDER_RE = re.compile(
    r"^\s*(?:\[LLM Error\]\s*)?"
    r"(Bupati|Walikota|Wali\s+Kota|Wakil\s+Bupati|Wakil\s+Walikota|Wakil\s+Wali\s+Kota|"
    r"Gubernur|Wakil\s+Gubernur|Penjabat|Pj\.?)\s+"
    r"(Kabupaten|Kota|Provinsi|Kab\.?|Kotamadya|DKI|DI|Daerah)",
    re.IGNORECASE,
)
LLM_ERROR_RE = re.compile(r"^\s*\[LLM Error\]", re.IGNORECASE)


def get_supabase():
    from supabase import create_client
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def fetch_all(table, supabase, columns: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        res = supabase.table(table).select(columns).range(offset, offset + page_size - 1).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


def main() -> None:
    supabase = get_supabase()

    logger.info("Fetching pejabat / jabatan / wilayah...")
    pejabat = fetch_all("pejabat", supabase, "id, nama_lengkap, metadata")
    jabatan = fetch_all("jabatan", supabase, "id, pejabat_id, wilayah_id, posisi, status")
    wilayah = fetch_all("wilayah", supabase, "id, nama")
    logger.info("  %d pejabat, %d jabatan, %d wilayah", len(pejabat), len(jabatan), len(wilayah))

    wilayah_by_id = {w["id"]: w["nama"] for w in wilayah}
    jabatan_by_pejabat: dict[str, list[dict]] = defaultdict(list)
    for j in jabatan:
        jabatan_by_pejabat[j["pejabat_id"]].append(j)

    placeholder_name: list[dict] = []
    llm_error: list[dict] = []
    many_jabatan: list[dict] = []
    empty_name: list[dict] = []
    low_confidence: list[dict] = []

    for p in pejabat:
        pid = p["id"]
        name = (p.get("nama_lengkap") or "").strip()
        meta = p.get("metadata") or {}
        confidence = meta.get("confidence_score")
        own_jabatan = jabatan_by_pejabat.get(pid, [])
        jab_summary = [
            {
                "posisi": j.get("posisi"),
                "wilayah": wilayah_by_id.get(j["wilayah_id"], "?"),
                "status": j.get("status"),
            }
            for j in own_jabatan
        ]

        record = {
            "pejabat_id": pid,
            "nama_lengkap": p.get("nama_lengkap"),
            "jabatan_count": len(own_jabatan),
            "jabatan": jab_summary,
            "confidence_score": confidence,
        }

        if not name:
            empty_name.append(record)
            continue

        if LLM_ERROR_RE.match(name):
            llm_error.append(record)
        elif PLACEHOLDER_RE.match(name):
            placeholder_name.append(record)

        if len(own_jabatan) > 2:
            many_jabatan.append(record)

        if isinstance(confidence, (int, float)) and confidence < 0.6:
            low_confidence.append(record)

    # Sort many_jabatan by count desc for reviewability
    many_jabatan.sort(key=lambda r: r["jabatan_count"], reverse=True)

    report = {
        "summary": {
            "total_pejabat": len(pejabat),
            "placeholder_name": len(placeholder_name),
            "llm_error": len(llm_error),
            "many_jabatan_gt2": len(many_jabatan),
            "empty_name": len(empty_name),
            "low_confidence": len(low_confidence),
        },
        "placeholder_name": placeholder_name,
        "llm_error": llm_error,
        "many_jabatan": many_jabatan,
        "empty_name": empty_name,
        "low_confidence": low_confidence,
    }

    out = ROOT / "output" / "_quality_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("")
    logger.info("Wrote %s", out)
    logger.info("Summary: %s", json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
