"""
Import Claude-filled enrichment CSV back into Supabase.

Updates per row:
  - jabatan.partai            if `partai` column is non-empty
  - jabatan.mulai_jabatan     if `mulai_jabatan_baru` column is non-empty
  - jabatan.selesai_jabatan   if `selesai_jabatan_baru` column is non-empty
  - pejabat.nama_lengkap      if `nama_baru` column is non-empty and not a placeholder
                               (for rows where is_placeholder=Y)

Usage:
    python scripts/import_enrichment.py --dry-run
    python scripts/import_enrichment.py
    python scripts/import_enrichment.py --file scripts/enrichment_jawa_barat.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

IN_FILE = Path(__file__).parent / "enrichment_export.csv"

PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_placeholder(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return bool(LLM_ERR_RE.match(name)) or bool(PLACEHOLDER_RE.match(name))


def is_valid_date(s: str) -> bool:
    if not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False


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

    if not args.dry_run:
        supabase = get_supabase()

    prefix = "[dry-run] " if args.dry_run else ""
    stats = {"jabatan_updated": 0, "pejabat_updated": 0, "skipped": 0, "errors": 0}

    for row in rows:
        jabatan_id = (row.get("jabatan_id") or "").strip()
        pejabat_id = (row.get("pejabat_id") or "").strip()
        posisi = row.get("posisi", "")
        wilayah = row.get("wilayah", "")

        partai = (row.get("partai") or "").strip()
        mulai_baru = (row.get("mulai_jabatan_baru") or "").strip()
        selesai_baru = (row.get("selesai_jabatan_baru") or "").strip()
        nama_baru = (row.get("nama_baru") or "").strip()

        jabatan_patch: dict = {}

        if partai:
            jabatan_patch["partai"] = partai

        if mulai_baru:
            if is_valid_date(mulai_baru):
                jabatan_patch["mulai_jabatan"] = mulai_baru
            else:
                print(f"  WARN invalid date mulai_jabatan_baru={mulai_baru!r} — {posisi} @ {wilayah}")

        if selesai_baru:
            if is_valid_date(selesai_baru):
                jabatan_patch["selesai_jabatan"] = selesai_baru
            else:
                print(f"  WARN invalid date selesai_jabatan_baru={selesai_baru!r} — {posisi} @ {wilayah}")

        if not jabatan_patch and not nama_baru:
            stats["skipped"] += 1
            continue

        label = f"{posisi} @ {wilayah}"

        if jabatan_patch:
            print(f"  {prefix}JABATAN {label}: {jabatan_patch}")
            if not args.dry_run:
                try:
                    supabase.table("jabatan").update(jabatan_patch).eq("id", jabatan_id).execute()
                    stats["jabatan_updated"] += 1
                except Exception as e:
                    print(f"    ERROR jabatan update: {e}")
                    stats["errors"] += 1
                    continue
            else:
                stats["jabatan_updated"] += 1

        if nama_baru and not is_placeholder(nama_baru):
            print(f"  {prefix}PEJABAT {label}: nama → {nama_baru!r}")
            if not args.dry_run:
                try:
                    supabase.table("pejabat").update({
                        "nama_lengkap": nama_baru,
                        "last_updated": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", pejabat_id).execute()
                    stats["pejabat_updated"] += 1
                except Exception as e:
                    print(f"    ERROR pejabat update: {e}")
                    stats["errors"] += 1
        elif nama_baru:
            print(f"  SKIP nama still placeholder: {nama_baru!r} — {label}")

    print(f"\n{'='*50}")
    print(f"jabatan updated:  {stats['jabatan_updated']}")
    print(f"pejabat updated:  {stats['pejabat_updated']}")
    print(f"skipped (empty):  {stats['skipped']}")
    print(f"errors:           {stats['errors']}")
    if args.dry_run:
        print("[dry-run] Nothing was written to DB.")


if __name__ == "__main__":
    main()
