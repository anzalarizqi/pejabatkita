"""
One-off backfill for kasus.partai (party-at-time-of-case) on existing verified cases.

Workflow mirrors the enrichment/rekam-bersih loop:
    python scripts/backfill_kasus_partai.py --export   # -> scripts/kasus_partai_backfill.csv
    # fill the `partai` column (AI/manual), then:
    python scripts/backfill_kasus_partai.py --import scripts/kasus_partai_backfill.csv

Only rows where partai is currently null are exported. Import updates kasus.partai
by pejabat_id, normalizing through the shared canonical map.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
load_dotenv(ROOT / ".env")

from _partai import normalize_partai  # noqa: E402

OUT_FILE = ROOT / "scripts" / "kasus_partai_backfill.csv"


def get_supabase():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def do_export(sb) -> None:
    kasus = sb.table("kasus").select(
        "pejabat_id, partai, tanggal_kasus, ringkasan, url_sumber"
    ).eq("verified", True).is_("partai", "null").execute().data or []

    if not kasus:
        print("Nothing to backfill: all verified cases already have partai.")
        return

    pej_ids = [k["pejabat_id"] for k in kasus]
    pejabat = sb.table("pejabat").select(
        "id, nama_lengkap, gelar_depan, gelar_belakang"
    ).in_("id", pej_ids).execute().data or []
    name_by_id = {p["id"]: p for p in pejabat}

    with open(OUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["pejabat_id", "nama", "tanggal_kasus", "ringkasan", "url_sumber", "partai"])
        for k in kasus:
            p = name_by_id.get(k["pejabat_id"], {})
            nama = " ".join(x for x in [
                (p.get("gelar_depan") or "").strip(),
                (p.get("nama_lengkap") or "").strip(),
                (p.get("gelar_belakang") or "").strip(),
            ] if x)
            w.writerow([
                k["pejabat_id"], nama, k.get("tanggal_kasus") or "",
                (k.get("ringkasan") or "")[:200], k.get("url_sumber") or "", "",
            ])
    print("Exported %d cases to %s" % (len(kasus), OUT_FILE))


def do_import(sb, path: str) -> None:
    updated = 0
    skipped = 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pid = (row.get("pejabat_id") or "").strip()
            raw = (row.get("partai") or "").strip()
            if not pid or not raw:
                skipped += 1
                continue
            value, _known = normalize_partai(raw)
            if not value:
                skipped += 1
                continue
            # Guard partai IS NULL so re-runs never clobber an already-filled sibling case
            sb.table("kasus").update({"partai": value}).eq("pejabat_id", pid).is_("partai", "null").execute()
            updated += 1
    print("Updated %d cases; skipped %d (no pejabat_id or blank partai)." % (updated, skipped))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--import", dest="import_path", metavar="CSV")
    args = ap.parse_args()

    sb = get_supabase()
    if args.export:
        do_export(sb)
    elif args.import_path:
        do_import(sb, args.import_path)
    else:
        ap.error("specify --export or --import <file>")


if __name__ == "__main__":
    main()
