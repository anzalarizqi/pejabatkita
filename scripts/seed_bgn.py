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
# Case (all 3): Kejaksaan Agung menetapkan tersangka 3 Juni 2026 atas dugaan korupsi
# tata kelola program Makan Bergizi Gratis (MBG) 2025-2026; dicopot Presiden 2 Juni 2026.
BGN = [
    {"nama": "Dadan Hindayana", "posisi": "Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "2026-06-02",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "Kejagung",
               "tahun": 2026, "tanggal_kasus": "2026-06-03",
               "ringkasan": "Eks Kepala BGN, ditetapkan tersangka oleh Kejaksaan Agung pada 3 Juni 2026 atas dugaan korupsi tata kelola program Makan Bergizi Gratis (MBG) 2025-2026 - termasuk penunjukan yayasan mitra SPPG tak memenuhi syarat yang terafiliasi serta pengadaan fiktif dan mark-up anggaran (a.l. 21.801 motor listrik senilai Rp1 triliun). Dicopot Presiden Prabowo pada 2 Juni 2026.",
               "url_sumber": "https://nasional.kompas.com/read/2026/06/03/17443981/breaking-news-eks-kepala-bgn-dadan-hindayana-jadi-tersangka-kasus-korupsi"}},
    {"nama": "Sony Sonjaya", "posisi": "Wakil Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "2026-06-02",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "Kejagung",
               "tahun": 2026, "tanggal_kasus": "2026-06-03",
               "ringkasan": "Eks Wakil Kepala BGN, ditetapkan tersangka Kejaksaan Agung pada 3 Juni 2026 dalam kasus dugaan korupsi tata kelola program Makan Bergizi Gratis (MBG) 2025-2026 bersama Dadan Hindayana dan Lodewyk Pusung.",
               "url_sumber": "https://www.cnnindonesia.com/nasional/20260603175323-12-1365043/duduk-perkara-korupsi-mbg-yang-jerat-dadan-lodewyk-dan-sony-sonjaya"}},
    {"nama": "Lodewyk Pusung", "posisi": "Wakil Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "2026-06-02",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "Kejagung",
               "tahun": 2026, "tanggal_kasus": "2026-06-03",
               "ringkasan": "Eks Wakil Kepala BGN, ditetapkan tersangka Kejaksaan Agung pada 3 Juni 2026 dalam kasus dugaan korupsi tata kelola program Makan Bergizi Gratis (MBG) 2025-2026; LHKPN November 2024 mencatat kekayaan sekitar Rp60,5 miliar.",
               "url_sumber": "https://www.cnnindonesia.com/nasional/20260603175323-12-1365043/duduk-perkara-korupsi-mbg-yang-jerat-dadan-lodewyk-dan-sony-sonjaya"}},
]
# Replacement for Kepala BGN. Nanik S. Deyang = definitif (aktif), diangkat Prabowo 2 Juni 2026.
SUCCESSION = {"nama": "Nanik S. Deyang", "posisi": "Kepala Badan Gizi Nasional",
              "status": "aktif", "mulai_jabatan": "2026-06-02"}
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


def deactivate_or_insert_jabatan(c, pid, wid, posisi, status, selesai, dry):
    """Update an existing same-posisi seat in place (avoid duplicate); else insert."""
    existing = []
    if pid != "DRY-ID":
        r = c.get(f"{U}/rest/v1/jabatan",
                  params={"pejabat_id": f"eq.{pid}", "posisi": f"eq.{posisi}", "select": "id"}, headers=H)
        r.raise_for_status()
        existing = r.json()
    if existing:
        jid = existing[0]["id"]
        if dry:
            print(f"  [DRY] UPDATE jabatan {jid[:8]}: status={status} selesai_jabatan={selesai}")
        else:
            rr = c.patch(f"{U}/rest/v1/jabatan", params={"id": f"eq.{jid}"},
                         json={"status": status, "selesai_jabatan": selesai},
                         headers={**HJ, "Prefer": "return=minimal"})
            if rr.status_code != 204:
                sys.exit(f"ERROR jabatan update {rr.status_code}: {rr.text[:200]}")
            print(f"  ~ jabatan updated ({posisi} -> {status})")
    else:
        insert(c, "jabatan", {"pejabat_id": pid, "wilayah_id": wid, "posisi": posisi,
                              "status": status, "selesai_jabatan": selesai}, dry)


def has_existing_kasus(c, pid):
    if pid == "DRY-ID":
        return False
    r = c.get(f"{U}/rest/v1/kasus", params={"pejabat_id": f"eq.{pid}", "select": "kasus_id"}, headers=H)
    r.raise_for_status()
    return bool(r.json())


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

            deactivate_or_insert_jabatan(c, pid, wid, off["posisi"],
                                         off["status_jabatan"], off["selesai_jabatan"], dry)

            if has_existing_kasus(c, pid):
                print(f"  = kasus already exists for {off['nama']} — skipped")
            else:
                kr = {"pejabat_id": pid, "verified": True, **off["kasus"]}
                insert(c, "kasus", kr, dry)
                if not dry:
                    c.post(f"{U}/rest/v1/kasus_screened",
                           json={"pejabat_id": pid, "last_result": "found", "last_keyakinan": "tinggi"},
                           headers={**HJ, "Prefer": "resolution=merge-duplicates"})
                print(f"  kasus + screened recorded for {off['nama']}")

        # Succession: add the replacement (skip if she already holds the seat)
        spid = find_pejabat(c, SUCCESSION["nama"])
        if spid is None:
            sp = insert(c, "pejabat", {"nama_lengkap": SUCCESSION["nama"], "level": "pusat"}, dry)
            spid = sp["id"] if isinstance(sp, dict) else "DRY-ID"
        already = []
        if spid != "DRY-ID":
            rr = c.get(f"{U}/rest/v1/jabatan",
                       params={"pejabat_id": f"eq.{spid}", "posisi": f"eq.{SUCCESSION['posisi']}", "select": "id"},
                       headers=H)
            rr.raise_for_status()
            already = rr.json()
        if already:
            print(f"= succession: {SUCCESSION['nama']} already holds {SUCCESSION['posisi']} — skipped")
        else:
            insert(c, "jabatan", {
                "pejabat_id": spid, "wilayah_id": wid, "posisi": SUCCESSION["posisi"],
                "status": SUCCESSION["status"], "mulai_jabatan": SUCCESSION["mulai_jabatan"],
            }, dry)
            print(f"+ succession: {SUCCESSION['nama']} -> {SUCCESSION['posisi']} ({SUCCESSION['status']})")

    print("\nDone." + (" (dry-run, no writes)" if dry else ""))


if __name__ == "__main__":
    main()
