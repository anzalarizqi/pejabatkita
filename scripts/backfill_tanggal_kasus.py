#!/usr/bin/env python3
"""
Task 8 one-off: backfill kasus.tanggal_kasus for the 13 Prabowo-era verified cases.

Dates sourced from our own verified ringkasan (9) + web research from KPK/reputable
media (4: Gatut Sunu, Suyono, Ade Kuswara, Abdul Azis). Pre-2024 verified cases
(Surya Darmadi, Hasan Aminuddin, Sanusi, Ismet Mile, Dedy Yon, Zulkifli H. Adam)
intentionally stay null -> excluded from Keranjang Koruptor by design.

REQUIRES migration 016 applied first (the tanggal_kasus column must exist).

    python scripts/backfill_tanggal_kasus.py --dry-run
    python scripts/backfill_tanggal_kasus.py
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

# kasus_id -> (nama, tanggal_kasus, date source)
BACKFILL = {
    "1fae05c3-0bbd-4b2e-a0a9-46cb6830c8b8": ("Maidi",                  "2026-01-20", "ringkasan"),
    "5570511c-9552-4437-a93f-d4d4f651c771": ("Chyntia I. Kalangit",    "2026-05-06", "ringkasan"),
    "ef6c6e8f-73ab-4095-8519-79a10a3fe534": ("M. Fikri Thobari",       "2026-03-09", "ringkasan"),
    "68a405ac-ce26-481c-91a4-1b6f54cfe9f2": ("Syamsul A. Rachman",     "2026-03-14", "ringkasan"),
    "e432105c-39f3-474d-879d-9c81bdfdff0a": ("Sudewo",                 "2026-01-20", "ringkasan"),
    "87ea7562-d464-4237-b298-80574da082dd": ("Fadia Arafiq",          "2026-03-04", "ringkasan"),
    "6009558e-e8d0-4483-9a15-9cb9ba27472c": ("Gatut Sunu Wibowo",      "2026-04-11", "research: kompas/hukumonline, penetapan 11 Apr 2026 (OTT 10 Apr)"),
    # ab553ba0 (Abdul Suyono kades Pati) intentionally EXCLUDED — that kasus is
    # misattributed to pejabat "Suyono" (Wakil Bupati Batang), a different person.
    # Set verified=false instead; do not give it a tanggal_kasus.
    "513f8816-11d6-44aa-bc35-4228460b304e": ("Abdul Wahid",            "2025-11-03", "ringkasan"),
    "5e4b5dd4-a214-484b-b3b0-6516724da47b": ("Sugiri Sancoko",         "2025-11-07", "ringkasan"),
    "94403e91-e0e0-45be-9f62-059f17f578b3": ("Ade Kuswara Kunang",     "2025-12-20", "research: kompas/hukumonline, penetapan 20 Des 2025 (OTT 18 Des)"),
    "d801ce8c-a61e-438d-a50d-53fc2764edc7": ("Abdul Azis",             "2025-08-09", "research: kompas/cnn, penetapan resmi 9 Agu 2025 (OTT 7 Agu)"),
    "f7fad79c-c276-4c54-b907-fcccb10cd90a": ("Ardito Wijaya",          "2025-12-11", "ringkasan/source article 11 Des 2025"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with httpx.Client(timeout=30) as c:
        # Guard: column must exist
        probe = c.get(f"{U}/rest/v1/kasus", params={"select": "kasus_id,tanggal_kasus", "limit": "1"}, headers=H)
        if probe.status_code != 200:
            sys.exit(f"ERROR: kasus.tanggal_kasus not queryable ({probe.status_code}) — apply migration 016 first.\n{probe.text[:200]}")

        # Fetch current values so we can skip already-set rows (idempotent)
        ids = ",".join(BACKFILL.keys())
        cur = c.get(f"{U}/rest/v1/kasus", params={"select": "kasus_id,tanggal_kasus", "kasus_id": f"in.({ids})"}, headers=H)
        cur.raise_for_status()
        current = {r["kasus_id"]: r.get("tanggal_kasus") for r in cur.json()}

        patched = skipped = missing = 0
        for kid, (nama, tgl, src) in BACKFILL.items():
            if kid not in current:
                print(f"  MISSING in DB: {nama} ({kid[:8]}) — skipped")
                missing += 1
                continue
            if current[kid] == tgl:
                print(f"  = {nama:24} already {tgl}")
                skipped += 1
                continue
            if args.dry_run:
                print(f"  [DRY] {nama:24} -> {tgl}   ({src})")
                patched += 1
                continue
            r = c.patch(f"{U}/rest/v1/kasus", params={"kasus_id": f"eq.{kid}"},
                        json={"tanggal_kasus": tgl},
                        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"})
            if r.status_code == 204:
                print(f"  + {nama:24} -> {tgl}")
                patched += 1
            else:
                print(f"  ! {nama:24} FAILED {r.status_code}: {r.text[:160]}")

        print(f"\n{'(dry-run) ' if args.dry_run else ''}patched={patched} skipped={skipped} missing={missing}")


if __name__ == "__main__":
    main()
