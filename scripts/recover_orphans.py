"""
Insert jabatan rows for orphan pejabat using the resolved wilayah_ids
in output/_orphan_report.json (produced by investigate_orphans.py).

Usage:
    python scripts/recover_orphans.py --dry-run
    python scripts/recover_orphans.py
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
from pathlib import Path
from datetime import date

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


_BULAN = {
    "januari": 1, "februari": 2, "maret": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "agustus": 8, "september": 9, "oktober": 10, "november": 11, "desember": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "agu": 8,
    "sep": 9, "okt": 10, "nov": 11, "des": 12,
}


def coerce_date(s):
    """Return ISO YYYY-MM-DD or None. Accepts ISO, '2025', '20 Februari 2025'."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    # Already ISO
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    # Bare year
    if re.fullmatch(r"\d{4}", s):
        return f"{s}-01-01"
    # "20 Februari 2025" / "Februari 2025"
    m = re.fullmatch(r"(?:(\d{1,2})\s+)?([A-Za-zÀ-ÿ]+)\s+(\d{4})", s)
    if m:
        day, month_name, year = m.groups()
        month = _BULAN.get(month_name.lower())
        if month:
            try:
                return date(int(year), month, int(day) if day else 1).isoformat()
            except ValueError:
                return None
    return None


def get_supabase():
    from supabase import create_client
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    report_path = ROOT / "output" / "_orphan_report.json"
    if not report_path.exists():
        logger.error("Run scripts/investigate_orphans.py first.")
        return

    report = json.loads(report_path.read_text(encoding="utf-8"))
    recoverable = report.get("recoverable", [])
    logger.info("%d recoverable orphans, total jabatan to insert: %d",
                len(recoverable), sum(len(r["resolved"]) for r in recoverable))

    if args.dry_run:
        for r in recoverable[:10]:
            for j in r["resolved"]:
                logger.info("  [dry] %s -> %s (%s)", r["nama_lengkap"], j["source"]["wilayah"], j["posisi"])
        logger.info("[dry-run] Nothing written. %d orphans would be recovered.", len(recoverable))
        return

    supabase = get_supabase()
    inserted = 0
    failed: list[str] = []

    for r in recoverable:
        for j in r["resolved"]:
            row = {
                "pejabat_id": r["pejabat_id"],
                "wilayah_id": j["wilayah_id"],
                "posisi": j["posisi"],
                "partai": j.get("partai"),
                "mulai_jabatan": coerce_date(j.get("mulai_jabatan")),
                "selesai_jabatan": coerce_date(j.get("selesai_jabatan")),
                "status": j.get("status", "aktif"),
            }
            try:
                supabase.table("jabatan").upsert(
                    row, on_conflict="pejabat_id,wilayah_id,posisi"
                ).execute()
                inserted += 1
            except Exception as e:
                failed.append(f"{r['nama_lengkap']} / {j['posisi']}: {e}")

    logger.info("Inserted/upserted %d jabatan rows", inserted)
    if failed:
        logger.warning("%d failures:", len(failed))
        for f in failed[:10]:
            logger.warning("  %s", f)


if __name__ == "__main__":
    main()
