#!/usr/bin/env python3
"""
Import human-verified kasus rows from CSV into Supabase kasus table.
Input CSV columns: pejabat_id, jenis, lembaga, status, tahun, tanggal_kasus, ringkasan, url_sumber
  (Optionally: nama_lengkap instead of pejabat_id — will attempt name lookup)

Usage:
  python scripts/import_kasus.py scripts/kasus_screened.csv --dry-run
  python scripts/import_kasus.py scripts/kasus_verified.csv
"""
import argparse
import csv
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
}
VALID_STATUSES = {"tersangka", "terdakwa", "terpidana"}


def resolve_pejabat_id(client: httpx.Client, nama: str) -> str | None:
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        params={"nama_lengkap": f"ilike.{nama}", "select": "id,nama_lengkap"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    rows = resp.json()
    if len(rows) == 1:
        return rows[0]["id"]
    if len(rows) > 1:
        print(f"  AMBIGUOUS: {len(rows)} matches for '{nama}' — skipping", file=sys.stderr)
    else:
        print(f"  NOT FOUND: '{nama}' — skipping", file=sys.stderr)
    return None


def upsert_kasus(client: httpx.Client, row: dict) -> bool:
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/kasus",
        headers={
            **HEADERS,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json=row,
    )
    if resp.status_code in (200, 201):
        return True
    print(f"  ERROR {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file", help="Path to verified kasus CSV")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with open(args.csv_file, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print("No rows to import.")
        return

    print(f"Importing {len(rows)} rows from {args.csv_file}")
    has_id_col = "pejabat_id" in rows[0].keys()

    ok, skipped, errors = 0, 0, 0
    with httpx.Client(timeout=30) as client:
        for i, row in enumerate(rows, 1):
            if has_id_col and row.get("pejabat_id", "").strip():
                pejabat_id = row["pejabat_id"].strip()
            elif row.get("nama_lengkap", "").strip():
                pejabat_id = resolve_pejabat_id(client, row["nama_lengkap"].strip())
            else:
                print(f"  Row {i}: no pejabat_id or nama_lengkap — skipping", file=sys.stderr)
                skipped += 1
                continue

            if not pejabat_id:
                skipped += 1
                continue

            status = (row.get("status") or "").strip().lower()
            if status not in VALID_STATUSES:
                print(f"  Row {i}: invalid status '{status}' — skipping", file=sys.stderr)
                skipped += 1
                continue

            tahun_raw = (row.get("tahun") or "").strip()
            tanggal_raw = (row.get("tanggal_kasus") or "").strip()
            tanggal_kasus = tanggal_raw if re.fullmatch(r"\d{4}-\d{2}-\d{2}", tanggal_raw) else None
            kasus_row = {
                "pejabat_id": pejabat_id,
                "jenis": (row.get("jenis") or "").strip() or None,
                "lembaga": (row.get("lembaga") or "").strip() or None,
                "status": status,
                "tahun": int(tahun_raw) if tahun_raw.isdigit() else None,
                "tanggal_kasus": tanggal_kasus,
                "ringkasan": (row.get("ringkasan") or "").strip() or None,
                "url_sumber": (row.get("url_sumber") or "").strip() or None,
            }

            if args.dry_run:
                print(f"  [DRY-RUN] Row {i}: {kasus_row['pejabat_id']} — {status}")
                ok += 1
                continue

            if upsert_kasus(client, kasus_row):
                ok += 1
            else:
                errors += 1

    print(f"\nDone: {ok} imported, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()
