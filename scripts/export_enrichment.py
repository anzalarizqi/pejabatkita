"""
Export all jabatan with null partai for Claude enrichment (partai + masa jabatan).

Includes current mulai/selesai_jabatan pre-filled, agent_unresolved flag context
(URLs already tried), and is_placeholder marker for rows that also need a name.

Usage:
    python scripts/export_enrichment.py
    python scripts/export_enrichment.py --provinsi "Jawa Barat"
    python scripts/export_enrichment.py --no-wakil
    python scripts/export_enrichment.py --real-names-only   # skip placeholder rows

Output: scripts/enrichment_export.csv
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

OUT_FILE = Path(__file__).parent / "enrichment_export.csv"

PLACEHOLDER_RE = re.compile(
    r"^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|"
    r"Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S",
    re.IGNORECASE,
)
LLM_ERR_RE = re.compile(r"^\[LLM Error\]", re.IGNORECASE)
WAKIL_RE = re.compile(r"wakil", re.IGNORECASE)
URLS_TRIED_RE = re.compile(r"URLs tried:\n((?:  - .+\n?)+)", re.MULTILINE)


def is_placeholder(name: str | None) -> bool:
    if not name or not name.strip():
        return True
    return bool(LLM_ERR_RE.match(name)) or bool(PLACEHOLDER_RE.match(name))


def extract_urls_from_reason(reason: str | None) -> str:
    """Extract URLs from agent_unresolved flag reason text, pipe-separated."""
    if not reason:
        return ""
    m = URLS_TRIED_RE.search(reason)
    if not m:
        return ""
    urls = [line.strip().lstrip("- ") for line in m.group(1).strip().splitlines()]
    return " | ".join(u for u in urls if u)


def fetch_all(supabase, table: str, columns: str, filters: list | None = None,
              page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = supabase.table(table).select(columns)
        if filters:
            for method, *fargs in filters:
                q = getattr(q, method)(*fargs)
        res = q.range(offset, offset + page_size - 1).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return rows


def get_supabase():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def run_report(supabase) -> None:
    """Print partai coverage per province + Pusat, then a non-canonical review list."""
    from _partai import normalize_partai

    wilayah_rows = fetch_all(supabase, "wilayah", "id, kode_bps, nama, level, parent_id")
    pejabat_rows = fetch_all(supabase, "pejabat", "id, level")
    jabatan_rows = fetch_all(supabase, "jabatan", "id, pejabat_id, wilayah_id, partai")

    wilayah_by_id = {w["id"]: w for w in wilayah_rows}
    prov_by_kode = {w["kode_bps"]: w["nama"] for w in wilayah_rows if w["level"] == "provinsi"}
    level_by_pejabat = {p["id"]: (p.get("level") or "") for p in pejabat_rows}

    def get_provinsi(w: dict | None) -> str:
        if not w:
            return ""
        if w["level"] == "provinsi":
            return w["nama"]
        parent = wilayah_by_id.get(w.get("parent_id") or "")
        if parent:
            return parent["nama"]
        return prov_by_kode.get((w.get("kode_bps") or "")[:2], "")

    pusat_label = "Pusat · Kabinet"
    stats: dict[str, list[int]] = {}   # bucket -> [total, filled]
    review: dict[str, int] = {}        # raw value -> count

    for j in jabatan_rows:
        if level_by_pejabat.get(j["pejabat_id"]) == "pusat":
            bucket = pusat_label
        else:
            bucket = get_provinsi(wilayah_by_id.get(j["wilayah_id"])) or "(tanpa provinsi)"
        s = stats.setdefault(bucket, [0, 0])
        s[0] += 1
        raw = (j.get("partai") or "").strip()
        if raw:
            s[1] += 1
            value, known = normalize_partai(raw)
            if not known or raw != value:
                review[raw] = review.get(raw, 0) + 1

    print("\nPARTAI COVERAGE")
    print(f"  {'':<24}{'total':>7}{'filled':>8}{'remaining':>11}{'':>6}")
    grand_total = grand_filled = 0
    for bucket in sorted(stats, key=lambda n: (1 if n == pusat_label else 0, n)):
        total, filled = stats[bucket]
        remaining = total - filled
        pct = round(100 * filled / total) if total else 0
        grand_total += total
        grand_filled += filled
        print(f"  {bucket:<24}{total:>7}{filled:>8}{remaining:>11}{pct:>5}%")
    grand_remaining = grand_total - grand_filled
    grand_pct = round(100 * grand_filled / grand_total) if grand_total else 0
    print("  " + "-" * 50)
    print(f"  {'TOTAL':<24}{grand_total:>7}{grand_filled:>8}{grand_remaining:>11}{grand_pct:>5}%")

    if review:
        print("\nNON-CANONICAL PARTAI (perlu ditinjau):")
        for raw in sorted(review, key=lambda r: -review[r]):
            value, known = normalize_partai(raw)
            hint = (f"-> mungkin maksudnya {value}?" if known and raw != value
                    else "-> tidak dikenal, cek apakah partai baru")
            print(f'  "{raw}"  ({review[raw]} jabatan)  {hint}')
    else:
        print("\nSemua nilai partai sudah kanonik.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province (partial match)")
    ap.add_argument("--no-wakil", action="store_true", help="Skip wakil roles")
    ap.add_argument("--real-names-only", action="store_true",
                    help="Skip rows where nama_lengkap is still a placeholder")
    ap.add_argument("--report", action="store_true",
                    help="Print partai coverage report and exit (writes no CSV)")
    args = ap.parse_args()

    supabase = get_supabase()

    if args.report:
        run_report(supabase)
        return

    print("Fetching data from Supabase...")

    wilayah_rows = fetch_all(supabase, "wilayah", "id, kode_bps, nama, level, parent_id")
    pejabat_rows = fetch_all(supabase, "pejabat", "id, nama_lengkap, gelar_depan, gelar_belakang")

    # Only jabatan with null partai
    jabatan_rows = fetch_all(
        supabase, "jabatan",
        "id, pejabat_id, wilayah_id, posisi, status, mulai_jabatan, selesai_jabatan, partai",
        filters=[("is_", "partai", "null")],
    )

    # agent_unresolved flags (pending only)
    flag_rows = fetch_all(
        supabase, "flags",
        "id, pejabat_id, type, reason, status",
        filters=[("eq", "type", "agent_unresolved"), ("eq", "status", "pending")],
    )

    # Build lookup maps
    wilayah_by_id: dict[str, dict] = {w["id"]: w for w in wilayah_rows}
    prov_by_kode: dict[str, str] = {
        w["kode_bps"]: w["nama"] for w in wilayah_rows if w["level"] == "provinsi"
    }
    # For kabkota: find province by parent_id
    prov_id_to_nama: dict[str, str] = {
        w["id"]: w["nama"] for w in wilayah_rows if w["level"] == "provinsi"
    }

    pejabat_by_id: dict[str, dict] = {p["id"]: p for p in pejabat_rows}

    # Index flags by pejabat_id (keep latest per pejabat)
    flag_by_pejabat: dict[str, dict] = {}
    for f in flag_rows:
        flag_by_pejabat[f["pejabat_id"]] = f

    def get_provinsi(w: dict) -> str:
        if w["level"] == "provinsi":
            return w["nama"]
        parent = wilayah_by_id.get(w.get("parent_id", ""))
        if parent:
            return parent["nama"]
        # Fallback: kode_bps prefix
        return prov_by_kode.get((w.get("kode_bps") or "")[:2], "")

    rows: list[dict] = []
    for j in jabatan_rows:
        p = pejabat_by_id.get(j["pejabat_id"])
        if not p:
            continue
        w = wilayah_by_id.get(j["wilayah_id"]) or {}

        nama = p.get("nama_lengkap") or ""
        placeholder = is_placeholder(nama)

        if args.real_names_only and placeholder:
            continue
        if args.no_wakil and WAKIL_RE.search(j.get("posisi", "")):
            continue

        provinsi = get_provinsi(w)
        if args.provinsi and args.provinsi.lower() not in provinsi.lower():
            continue

        flag = flag_by_pejabat.get(j["pejabat_id"])
        urls_tried = extract_urls_from_reason(flag["reason"] if flag else None)

        # Full name with gelar for context
        gelar_d = (p.get("gelar_depan") or "").strip()
        gelar_b = (p.get("gelar_belakang") or "").strip()
        nama_full = " ".join(x for x in [gelar_d, nama, gelar_b] if x)

        rows.append({
            "pejabat_id": p["id"],
            "jabatan_id": j["id"],
            "nama_lengkap": nama_full,
            "posisi": j.get("posisi", ""),
            "wilayah": w.get("nama", ""),
            "provinsi": provinsi,
            "level": w.get("level", ""),
            "mulai_jabatan": j.get("mulai_jabatan") or "",
            "selesai_jabatan": j.get("selesai_jabatan") or "",
            "is_placeholder": "Y" if placeholder else "",
            "has_unresolved_flag": "Y" if flag else "",
            "urls_tried": urls_tried,
            # Claude fills these:
            "partai": "",
            "mulai_jabatan_baru": "",
            "selesai_jabatan_baru": "",
            "sumber_url": "",
            "catatan": "",
        })

    # Sort: real names first, then by provinsi + wilayah + posisi
    rows.sort(key=lambda r: (
        1 if r["is_placeholder"] == "Y" else 0,
        r["provinsi"],
        r["wilayah"],
        r["posisi"],
    ))

    if not rows:
        print("No jabatan rows with null partai found.")
        return

    with open(OUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nExported {len(rows)} rows to:")
    print(f"  {OUT_FILE}")

    real = sum(1 for r in rows if not r["is_placeholder"])
    placeholder = len(rows) - real
    flagged = sum(1 for r in rows if r["has_unresolved_flag"])
    provinces = sorted(set(r["provinsi"] for r in rows))

    print(f"\nBreakdown:")
    print(f"  Real names:        {real}")
    print(f"  Placeholders:      {placeholder}  ← also need nama filled")
    print(f"  Has flag/URLs:     {flagged}  ← agent already tried these, help Claude avoid same dead-ends")
    print(f"  Provinces:         {len(provinces)}")
    for prov in provinces:
        n = sum(1 for r in rows if r["provinsi"] == prov)
        ph = sum(1 for r in rows if r["provinsi"] == prov and r["is_placeholder"] == "Y")
        suffix = f" ({ph} placeholder)" if ph else ""
        print(f"    {prov}: {n}{suffix}")


if __name__ == "__main__":
    main()
