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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province")
    ap.add_argument("--no-wakil", action="store_true", help="Skip wakil roles (kepala daerah only)")
    args = ap.parse_args()

    supabase = get_supabase()

    print("Fetching data from Supabase...")

    # Province map
    prov_res = supabase.table("wilayah").select("kode_bps, nama").eq("level", "provinsi").execute()
    prov_map: dict[str, str] = {w["kode_bps"]: w["nama"] for w in (prov_res.data or [])}

    # All pejabat + jabatan
    q = (
        supabase.table("pejabat")
        .select("id, nama_lengkap, jabatan(id, posisi, wilayah:wilayah_id(id, nama, kode_bps, level))")
        .limit(5000)
        .execute()
    )

    rows: list[dict] = []
    for p in (q.data or []):
        if not is_placeholder(p.get("nama_lengkap")):
            continue
        for j in (p.get("jabatan") or []):
            w = j.get("wilayah") or {}
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
