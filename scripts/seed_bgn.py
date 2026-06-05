#!/usr/bin/env python3
"""
One-off: seed the 3 arrested BGN officials (pejabat + jabatan + verified kasus +
kasus_screened) and apply the Kepala BGN succession (deactivate Dadan, add Nanik).

FILL the DATA blocks below from real news sources, then:
    python scripts/seed_bgn.py --dry-run
    python scripts/seed_bgn.py
"""
import argparse
import os
import sys
import httpx
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
U = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
K = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}"}
HJ = {**H, "Content-Type": "application/json"}

# ── FILL FROM NEWS ───────────────────────────────────────────────────────────
# Each arrested official. tanggal_kasus / lembaga / ringkasan / url_sumber are real.
BGN = [
    {"nama": "Dadan Hindayana", "posisi": "Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
    {"nama": "Sonjaya", "posisi": "Wakil Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
    {"nama": "Lodewyk Pusung", "posisi": "Pejabat Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
]
# Replacement for Kepala BGN. status = "penjabat" if Plt else "aktif".
SUCCESSION = {"nama": "Nanik S. Deyang", "posisi": "Kepala Badan Gizi Nasional",
              "status": "aktif", "mulai_jabatan": "YYYY-MM-DD"}
# ─────────────────────────────────────────────────────────────────────────────


def get_indonesia_wilayah_id(c):
    r = c.get(f"{U}/rest/v1/wilayah", params={"kode_bps": "eq.00", "select": "id"}, headers=H)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        sys.exit("ERROR: nasional wilayah (kode_bps='00') not found — run migration 007.")
    return rows[0]["id"]


def find_pejabat(c, nama):
    r = c.get(f"{U}/rest/v1/pejabat", params={"nama_lengkap": f"ilike.{nama}", "select": "id"}, headers=H)
    r.raise_for_status()
    rows = r.json()
    return rows[0]["id"] if len(rows) == 1 else None


def insert(c, table, row, dry):
    if dry:
        print(f"  [DRY] INSERT {table}: {row}")
        return "DRY-ID"
    r = c.post(f"{U}/rest/v1/{table}", json=row, headers={**HJ, "Prefer": "return=representation"})
    if r.status_code not in (200, 201):
        sys.exit(f"ERROR {table} {r.status_code}: {r.text[:300]}")
    return r.json()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run

    with httpx.Client(timeout=30) as c:
        wid = get_indonesia_wilayah_id(c)

        for off in BGN:
            pid = find_pejabat(c, off["nama"])
            if pid is None:
                p = insert(c, "pejabat", {"nama_lengkap": off["nama"], "level": "pusat"}, dry)
                pid = p["id"] if isinstance(p, dict) else "DRY-ID"
                print(f"+ pejabat {off['nama']} -> {pid}")
            else:
                print(f"= pejabat {off['nama']} exists -> {pid}")

            insert(c, "jabatan", {
                "pejabat_id": pid, "wilayah_id": wid, "posisi": off["posisi"],
                "status": off["status_jabatan"], "selesai_jabatan": off["selesai_jabatan"],
            }, dry)

            kr = {"pejabat_id": pid, "verified": True, **off["kasus"]}
            insert(c, "kasus", kr, dry)

            if not dry:
                c.post(f"{U}/rest/v1/kasus_screened",
                       json={"pejabat_id": pid, "last_result": "found", "last_keyakinan": "tinggi"},
                       headers={**HJ, "Prefer": "resolution=merge-duplicates"})
            print(f"  kasus + screened recorded for {off['nama']}")

        # Succession: add the replacement
        spid = find_pejabat(c, SUCCESSION["nama"])
        if spid is None:
            sp = insert(c, "pejabat", {"nama_lengkap": SUCCESSION["nama"], "level": "pusat"}, dry)
            spid = sp["id"] if isinstance(sp, dict) else "DRY-ID"
        insert(c, "jabatan", {
            "pejabat_id": spid, "wilayah_id": wid, "posisi": SUCCESSION["posisi"],
            "status": SUCCESSION["status"], "mulai_jabatan": SUCCESSION["mulai_jabatan"],
        }, dry)
        print(f"+ succession: {SUCCESSION['nama']} -> {SUCCESSION['posisi']} ({SUCCESSION['status']})")

    print("\nDone." + (" (dry-run, no writes)" if dry else ""))


if __name__ == "__main__":
    main()
