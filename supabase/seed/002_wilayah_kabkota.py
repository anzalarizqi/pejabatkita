"""
Seed kabupaten/kota into the wilayah table from the canonical snapshot.

Reads supabase/seed/wilayah_kabkota.json (built by build_wilayah_snapshot.py).
Replaces existing kabupaten+kota rows. Province rows are untouched.

Usage:
    python supabase/seed/002_wilayah_kabkota.py --dry-run
    python supabase/seed/002_wilayah_kabkota.py            # actually writes
    python supabase/seed/002_wilayah_kabkota.py --provinsi "Kepulauan Riau"

Requirements:
    pip install supabase python-dotenv
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
SNAPSHOT = Path(__file__).parent / "wilayah_kabkota.json"

load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def get_supabase_client():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def load_snapshot() -> list[dict]:
    if not SNAPSHOT.exists():
        logger.error("Snapshot not found: %s", SNAPSHOT)
        logger.error("Run: python supabase/seed/build_wilayah_snapshot.py")
        sys.exit(1)
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def fetch_provinces(supabase) -> dict[str, dict]:
    """Return {kode_bps: {id, nama}} for every provinsi row."""
    res = (
        supabase.table("wilayah")
        .select("id, kode_bps, nama")
        .eq("level", "provinsi")
        .execute()
    )
    return {r["kode_bps"]: r for r in (res.data or [])}


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed kab/kota from canonical snapshot")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    parser.add_argument("--provinsi", help="Only re-seed this province (matches by kode_bps or name substring)")
    args = parser.parse_args()

    snapshot = load_snapshot()
    supabase = get_supabase_client()
    provinces = fetch_provinces(supabase)

    if not provinces:
        logger.error("No provinces in wilayah table. Run 001_wilayah_provinsi.sql first.")
        sys.exit(1)

    # Filter snapshot if --provinsi given
    target_kodes: set[str] | None = None
    if args.provinsi:
        q = args.provinsi.lower()
        matched = {k: v for k, v in provinces.items() if q in v["nama"].lower() or q == k.lower()}
        if not matched:
            logger.error("No province matched %r", args.provinsi)
            sys.exit(1)
        target_kodes = set(matched.keys())
        logger.info("Filtering to province(s): %s", ", ".join(f"{k}={v['nama']}" for k, v in matched.items()))

    # Group snapshot rows by province kode
    by_prov: dict[str, list[dict]] = {}
    for row in snapshot:
        kode = row["provinsi_kode"]
        if target_kodes and kode not in target_kodes:
            continue
        by_prov.setdefault(kode, []).append(row)

    total_deleted = 0
    total_inserted = 0
    skipped_provinces: list[str] = []

    for prov_kode in sorted(by_prov):
        prov = provinces.get(prov_kode)
        if not prov:
            logger.warning("Province kode %s in snapshot but not in supabase — skipping", prov_kode)
            skipped_provinces.append(prov_kode)
            continue

        rows = by_prov[prov_kode]
        logger.info("=== %s (%s) ===", prov["nama"], prov_kode)
        logger.info("  Snapshot: %d rows", len(rows))

        if args.dry_run:
            for i, r in enumerate(rows, start=1):
                kode = f"{prov_kode}.{i:02d}"
                logger.info("    [dry] %s  %-40s  (%s)", kode, r["nama"], r["level"])
            continue

        # Delete existing kab/kota under this province prefix
        del_res = (
            supabase.table("wilayah")
            .delete()
            .like("kode_bps", f"{prov_kode}.%")
            .in_("level", ["kabupaten", "kota"])
            .execute()
        )
        deleted = len(del_res.data or [])
        total_deleted += deleted
        logger.info("  Deleted: %d existing rows", deleted)

        # Insert fresh
        new_rows = [
            {
                "id": str(uuid.uuid4()),
                "kode_bps": f"{prov_kode}.{i:02d}",
                "nama": r["nama"],
                "level": r["level"],
                "parent_id": prov["id"],
            }
            for i, r in enumerate(rows, start=1)
        ]
        ins_res = supabase.table("wilayah").insert(new_rows).execute()
        inserted = len(ins_res.data or [])
        total_inserted += inserted
        logger.info("  Inserted: %d rows", inserted)

    logger.info("")
    logger.info("Summary: deleted=%d, inserted=%d", total_deleted, total_inserted)
    if skipped_provinces:
        logger.warning("Skipped (no provinsi row): %s", ", ".join(skipped_provinces))
    if args.dry_run:
        logger.info("[dry-run] No changes written.")


if __name__ == "__main__":
    main()
