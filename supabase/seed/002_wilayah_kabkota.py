"""
Seed kabupaten/kota into the wilayah table.

Uses the existing scraper's wikipedia.py to fetch district lists per province,
then inserts into Supabase via the service role key.

Usage:
    cd pejabatkita
    python supabase/seed/002_wilayah_kabkota.py [--dry-run] [--provinsi "Jawa Barat"]

Requirements:
    pip install supabase python-dotenv httpx
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import uuid
from pathlib import Path

# Reuse scraper's wikipedia module
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scraper"))
from pipeline.wikipedia import get_province_districts  # noqa: E402

from dotenv import load_dotenv
import os

load_dotenv(Path(__file__).parent.parent.parent / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def get_supabase_client():
    from supabase import create_client
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def level_from_name(name: str) -> str:
    return "kota" if name.lower().startswith("kota") else "kabupaten"


def make_kode_placeholder(parent_kode: str, index: int) -> str:
    """Generate a placeholder BPS code. Real codes can be updated later from BPS API."""
    return f"{parent_kode}.{index:02d}"


async def seed_province(
    supabase,
    prov: dict,
    dry_run: bool,
) -> int:
    """Fetch districts for one province and upsert into wilayah. Returns count inserted."""
    prov_nama: str = prov["nama"]
    prov_id: str = prov["id"]
    prov_kode: str = prov["kode_bps"]

    logger.info("Fetching districts for %s ...", prov_nama)
    districts = await get_province_districts(prov_nama)

    if not districts:
        logger.warning("  No districts found for %s", prov_nama)
        return 0

    logger.info("  Found %d districts", len(districts))

    if dry_run:
        for d in districts:
            logger.info("  [dry-run] %s (%s)", d, level_from_name(d))
        return len(districts)

    inserted = 0
    for i, name in enumerate(districts, start=1):
        level = level_from_name(name)
        kode = make_kode_placeholder(prov_kode, i)
        row = {
            "id": str(uuid.uuid4()),
            "kode_bps": kode,
            "nama": name,
            "level": level,
            "parent_id": prov_id,
        }
        result = (
            supabase.table("wilayah")
            .insert(row)
            .execute()
        )
        if result.data:
            inserted += 1
        else:
            logger.warning("  Insert failed for %s: %s", name, result)

    return inserted


async def main(args: argparse.Namespace) -> None:
    supabase = get_supabase_client()

    # Fetch all provinces
    res = supabase.table("wilayah").select("id, kode_bps, nama").eq("level", "provinsi").order("nama").execute()
    provinces: list[dict] = res.data or []

    if not provinces:
        logger.error("No provinces found in wilayah table. Run 001_wilayah_provinsi.sql first.")
        sys.exit(1)

    # Filter to specific province if requested
    if args.provinsi:
        provinces = [p for p in provinces if args.provinsi.lower() in p["nama"].lower()]
        if not provinces:
            logger.error("Province %r not found.", args.provinsi)
            sys.exit(1)

    logger.info("Seeding kabupaten/kota for %d province(s)...", len(provinces))
    total = 0

    for prov in provinces:
        count = await seed_province(supabase, prov, dry_run=args.dry_run)
        total += count
        # Small delay to be polite to Wikipedia
        await asyncio.sleep(1)

    logger.info("Done. Total districts processed: %d", total)
    if args.dry_run:
        logger.info("[dry-run] No rows were written.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed kabupaten/kota into wilayah table")
    parser.add_argument("--dry-run", action="store_true", help="Print without inserting")
    parser.add_argument("--provinsi", help="Only seed this province (partial match)")
    asyncio.run(main(parser.parse_args()))
