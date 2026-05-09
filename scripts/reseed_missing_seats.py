"""
Find (wilayah, tier) seats that have no jabatan row at all and re-insert
placeholder pejabat + jabatan so export_placeholders.py can pick them up.

Usage:
    python scripts/reseed_missing_seats.py --dry-run   # preview only
    python scripts/reseed_missing_seats.py             # live insert
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

CANONICAL_KEPALA = {"provinsi": "Gubernur", "kabupaten": "Bupati", "kota": "Walikota"}
CANONICAL_WAKIL  = {"provinsi": "Wakil Gubernur", "kabupaten": "Wakil Bupati", "kota": "Wakil Walikota"}

KEPALA_RE_TERMS = {"gubernur", "bupati", "walikota", "wali kota"}
WAKIL_RE_TERMS  = {"wakil gubernur", "wakil bupati", "wakil walikota", "wakil wali kota"}


def posisi_tier(posisi: str) -> str | None:
    p = posisi.strip().lower()
    if any(p.startswith(t) for t in WAKIL_RE_TERMS):
        return "wakil"
    if any(p.startswith(t) for t in KEPALA_RE_TERMS):
        return "kepala"
    return None


def fetch_all(sb, table: str, columns: str, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        res = sb.table(table).select(columns).range(offset, offset + page_size - 1).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


def main(dry_run: bool) -> None:
    from supabase import create_client
    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    print("Fetching wilayah and jabatan...")
    wilayah_rows = fetch_all(sb, "wilayah", "id,nama,level")
    jabatan_rows = fetch_all(sb, "jabatan", "id,wilayah_id,posisi")

    # Only care about provinsi/kabupaten/kota — skip nasional
    wilayah = [w for w in wilayah_rows if w["level"] in ("provinsi", "kabupaten", "kota")]

    # Build set of (wilayah_id, tier) that already exist in jabatan
    filled: set[tuple[str, str]] = set()
    for j in jabatan_rows:
        tier = posisi_tier(j["posisi"])
        if tier:
            filled.add((j["wilayah_id"], tier))

    # Find gaps
    gaps: list[dict] = []
    for w in wilayah:
        level = w["level"]
        for tier, canon_map in [("kepala", CANONICAL_KEPALA), ("wakil", CANONICAL_WAKIL)]:
            if (w["id"], tier) not in filled:
                posisi = canon_map[level]
                placeholder_name = f"{posisi} {w['nama']}"
                gaps.append({
                    "wilayah_id": w["id"],
                    "wilayah_nama": w["nama"],
                    "level": level,
                    "tier": tier,
                    "posisi": posisi,
                    "placeholder_name": placeholder_name,
                })

    print(f"\nTotal wilayah: {len(wilayah)}")
    print(f"Filled (wilayah, tier) pairs: {len(filled)}")
    print(f"Missing seats to reseed: {len(gaps)}")

    if not gaps:
        print("\nNothing to do.")
        return

    # Print breakdown
    kepala_gaps = [g for g in gaps if g["tier"] == "kepala"]
    wakil_gaps  = [g for g in gaps if g["tier"] == "wakil"]
    print(f"  Kepala missing: {len(kepala_gaps)}")
    print(f"  Wakil missing:  {len(wakil_gaps)}")
    print()

    for g in sorted(gaps, key=lambda x: (x["tier"], x["wilayah_nama"])):
        print(f"  MISSING  {g['posisi']:25s}  {g['wilayah_nama']}")

    if dry_run:
        print(f"\n[dry-run] Would insert {len(gaps)} pejabat + {len(gaps)} jabatan rows.")
        print("Re-run without --dry-run to apply.")
        return

    print(f"\nInserting {len(gaps)} missing seats...")
    inserted_pejabat = 0
    inserted_jabatan = 0
    errors = 0

    for g in gaps:
        pejabat_id = str(uuid.uuid4())
        try:
            # Insert placeholder pejabat
            sb.table("pejabat").insert({
                "id": pejabat_id,
                "nama_lengkap": g["placeholder_name"],
                "metadata": {"source": "reseed_missing_seats", "confidence": 0.0},
            }).execute()
            inserted_pejabat += 1
        except Exception as e:
            print(f"  ERROR inserting pejabat for {g['posisi']} {g['wilayah_nama']}: {e}")
            errors += 1
            continue

        try:
            # Insert jabatan
            sb.table("jabatan").insert({
                "pejabat_id": pejabat_id,
                "wilayah_id": g["wilayah_id"],
                "posisi": g["posisi"],
                "status": "aktif",
            }).execute()
            inserted_jabatan += 1
        except Exception as e:
            print(f"  ERROR inserting jabatan for {g['posisi']} {g['wilayah_nama']}: {e}")
            errors += 1

    print(f"\nDone.")
    print(f"  Inserted pejabat: {inserted_pejabat}")
    print(f"  Inserted jabatan: {inserted_jabatan}")
    if errors:
        print(f"  Errors:          {errors}")
    print()
    print("Next steps:")
    print("  python scripts/export_placeholders.py")
    print("  python scripts/report_province_coverage.py")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Preview only, no DB changes")
    args = ap.parse_args()
    main(dry_run=args.dry_run)
