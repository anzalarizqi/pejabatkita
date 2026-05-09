"""
Import Gemini-verified names from CSV back into Supabase.

Reads scripts/placeholders_export.csv (after you fill in nama_baru column),
validates each name, updates pejabat.nama_lengkap in Supabase.

Usage:
    python scripts/import_from_csv.py --dry-run   # preview only
    python scripts/import_from_csv.py             # live update

The CSV must have these columns (same file exported_placeholders.py wrote):
    pejabat_id, jabatan_id, posisi, wilayah, provinsi,
    placeholder_saat_ini, nama_baru, sumber_url, catatan

Only rows where nama_baru is non-empty and not a placeholder are updated.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

IN_FILE = Path(__file__).parent / "placeholders_export.csv"

PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)


def is_placeholder(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return bool(LLM_ERR_RE.match(name)) or bool(PLACEHOLDER_RE.match(name))


def get_supabase():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    ap.add_argument("--file", default=str(IN_FILE), help="Path to CSV file")
    args = ap.parse_args()

    csv_path = Path(args.file)
    if not csv_path.exists():
        print(f"ERROR: File not found: {csv_path}")
        sys.exit(1)

    with open(csv_path, encoding="utf-8-sig") as f:
        sample = f.read(2048)
        f.seek(0)
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        rows = list(csv.DictReader(f, delimiter=delimiter))

    print(f"Read {len(rows)} rows from {csv_path.name}")

    to_update: list[dict] = []
    skipped_empty: list[dict] = []
    skipped_placeholder: list[dict] = []

    for row in rows:
        nama = (row.get("nama_baru") or "").strip()
        if not nama:
            skipped_empty.append(row)
            continue
        if is_placeholder(nama):
            print(f"  SKIP (still placeholder): {row['posisi']} @ {row['wilayah']} → '{nama}'")
            skipped_placeholder.append(row)
            continue
        to_update.append(row)

    print(f"\nTo update:          {len(to_update)}")
    print(f"Skipped (empty):    {len(skipped_empty)}")
    print(f"Skipped (bad name): {len(skipped_placeholder)}")

    if not to_update:
        print("\nNothing to update.")
        return

    print()
    if not args.dry_run:
        supabase = get_supabase()

    updated = 0
    errors = 0
    for row in to_update:
        nama = row["nama_baru"].strip()
        pid = row["pejabat_id"]
        sumber = (row.get("sumber_url") or "").strip()
        posisi = row.get("posisi", "")
        wilayah = row.get("wilayah", "")

        prefix = "[dry-run] " if args.dry_run else ""
        print(f"  {prefix}UPDATE {posisi} @ {wilayah} -> {nama}")
        if sumber:
            print(f"           sumber: {sumber}")

        if args.dry_run:
            updated += 1
            continue

        try:
            metadata_patch = {
                "verified_by": "gemini_manual",
                "sources": [{"url": sumber, "method": "gemini_web"}] if sumber else [],
                "confidence": 0.9 if sumber else 0.7,
            }
            supabase.table("pejabat").update({
                "nama_lengkap": nama,
                "metadata": metadata_patch,
            }).eq("id", pid).execute()
            updated += 1
        except Exception as e:
            print(f"    ERROR: {e}")
            errors += 1

    print(f"\n{'='*50}")
    print(f"Done: {updated} updated, {errors} errors")
    if args.dry_run:
        print("[dry-run] Nothing was written to DB.")
    else:
        print("\nTo verify coverage after import:")
        print("  python scripts/report_province_coverage.py")


if __name__ == "__main__":
    main()
