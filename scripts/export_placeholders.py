"""
Export all placeholder-named pejabat to CSV for manual verification.

Usage:
    python scripts/export_placeholders.py
    python scripts/export_placeholders.py --provinsi "Sulawesi Tenggara"
    python scripts/export_placeholders.py --no-wakil   # kepala daerah only

Output: scripts/placeholders_export.csv
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

OUT_FILE = Path(__file__).parent / "placeholders_export.csv"

PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)
WAKIL_RE = re.compile(r"wakil", re.IGNORECASE)


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


def fetch_all(supabase, table: str, columns: str, page_size: int = 1000) -> list[dict]:
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province")
    ap.add_argument("--no-wakil", action="store_true", help="Skip wakil roles (kepala daerah only)")
    args = ap.parse_args()

    supabase = get_supabase()

    print("Fetching data from Supabase...")

    # Separate queries — avoids PostgREST nested-join row drops
    wilayah_rows = fetch_all(supabase, "wilayah", "id, kode_bps, nama, level")
    pejabat_rows = fetch_all(supabase, "pejabat", "id, nama_lengkap")
    jabatan_rows = fetch_all(supabase, "jabatan", "id, pejabat_id, wilayah_id, posisi")

    wilayah_by_id: dict[str, dict] = {w["id"]: w for w in wilayah_rows}
    prov_map: dict[str, str] = {
        w["kode_bps"]: w["nama"] for w in wilayah_rows if w["level"] == "provinsi"
    }

    # Index jabatan by pejabat_id
    jab_by_pejabat: dict[str, list[dict]] = {}
    for j in jabatan_rows:
        jab_by_pejabat.setdefault(j["pejabat_id"], []).append(j)

    rows: list[dict] = []
    for p in pejabat_rows:
        if not is_placeholder(p.get("nama_lengkap")):
            continue
        for j in jab_by_pejabat.get(p["id"], []):
            w = wilayah_by_id.get(j["wilayah_id"]) or {}
            kode = w.get("kode_bps", "")
            provinsi_nama = prov_map.get(kode[:2], "")

            if args.provinsi and args.provinsi.lower() not in provinsi_nama.lower():
                continue
            if args.no_wakil and WAKIL_RE.search(j.get("posisi", "")):
                continue

            rows.append({
                "pejabat_id": p["id"],
                "jabatan_id": j["id"],
                "posisi": j.get("posisi", ""),
                "wilayah": w.get("nama", ""),
                "provinsi": provinsi_nama,
                "placeholder_saat_ini": p["nama_lengkap"],
                "nama_baru": "",       # Gemini fills this
                "sumber_url": "",      # Gemini fills this
                "catatan": "",         # optional notes
            })

    # Sort: kepala daerah first, then by province + wilayah
    rows.sort(key=lambda r: (
        1 if WAKIL_RE.search(r["posisi"]) else 0,
        r["provinsi"],
        r["wilayah"],
    ))

    with open(OUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nExported {len(rows)} placeholder rows to:")
    print(f"  {OUT_FILE}")
    print(f"\nBreakdown:")
    kepala = sum(1 for r in rows if not WAKIL_RE.search(r["posisi"]))
    wakil = len(rows) - kepala
    print(f"  Kepala daerah: {kepala}")
    print(f"  Wakil:         {wakil}")
    provinces = sorted(set(r["provinsi"] for r in rows))
    print(f"  Provinces:     {len(provinces)}")
    for prov in provinces:
        n = sum(1 for r in rows if r["provinsi"] == prov)
        print(f"    {prov}: {n}")


if __name__ == "__main__":
    main()
