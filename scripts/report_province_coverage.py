"""
Per-province coverage audit: how many real (non-placeholder) pejabat we have
vs. how many we'd expect (1 governor + 1 vice + 2 per kab/kota).

Output: output/_province_coverage.json (sorted worst → best).
Console: human-readable table flagging provinces that need re-scraping.
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")


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
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def fetch_all(table, supabase, columns: str, page_size: int = 1000) -> list[dict]:
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
    supabase = get_supabase()
    wilayah = fetch_all("wilayah", supabase, "id, kode_bps, nama, level, parent_id")
    pejabat = fetch_all("pejabat", supabase, "id, nama_lengkap")
    jabatan = fetch_all("jabatan", supabase, "pejabat_id, wilayah_id")

    w_by_id = {w["id"]: w for w in wilayah}
    provinces = {w["id"]: w for w in wilayah if w["level"] == "provinsi"}

    kab_count: dict[str, int] = defaultdict(int)
    for w in wilayah:
        if w["parent_id"] in provinces:
            kab_count[w["parent_id"]] += 1

    is_ph = {p["id"]: is_placeholder(p["nama_lengkap"]) for p in pejabat}

    real_in: dict[str, set[str]] = defaultdict(set)
    ph_in: dict[str, set[str]] = defaultdict(set)
    for j in jabatan:
        w = w_by_id.get(j["wilayah_id"])
        if not w:
            continue
        prov_id = w["id"] if w["level"] == "provinsi" else w["parent_id"]
        if prov_id not in provinces:
            continue
        bucket = ph_in if is_ph.get(j["pejabat_id"], False) else real_in
        bucket[prov_id].add(j["pejabat_id"])

    rows: list[dict] = []
    for pid, prov in provinces.items():
        n_kab = kab_count[pid]
        # Expected: gubernur + wakil + (bupati+wakil) per kab/kota
        expected = 2 + 2 * n_kab
        real = len(real_in[pid])
        ph = len(ph_in[pid])
        coverage = real / expected if expected else 0
        if coverage < 0.5:
            tier = "critical"
        elif coverage < 0.65:
            tier = "warning"
        else:
            tier = "ok"
        rows.append({
            "provinsi": prov["nama"],
            "kode_bps": prov["kode_bps"],
            "kab_kota_count": n_kab,
            "expected_pejabat": expected,
            "real_pejabat": real,
            "placeholder_pejabat": ph,
            "total_scraped": real + ph,
            "coverage_pct": round(coverage * 100, 1),
            "tier": tier,
        })

    rows.sort(key=lambda r: r["coverage_pct"])

    out = ROOT / "output" / "_province_coverage.json"
    out.write_text(json.dumps({
        "summary": {
            "total_provinces": len(rows),
            "critical": sum(1 for r in rows if r["tier"] == "critical"),
            "warning": sum(1 for r in rows if r["tier"] == "warning"),
            "ok": sum(1 for r in rows if r["tier"] == "ok"),
        },
        "provinces": rows,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{'TIER':>9s}  {'PROVINCE':30s} {'REAL':>5s}/{'EXP':<5s} {'PLACE':>6s}  {'COV':>5s}")
    print("-" * 70)
    for r in rows:
        marker = {"critical": "[CRIT]", "warning": "[WARN]", "ok": "  ok  "}[r["tier"]]
        print(f"{marker:>9s}  {r['provinsi']:30s} {r['real_pejabat']:>5d}/{r['expected_pejabat']:<5d} "
              f"{r['placeholder_pejabat']:>6d}  {r['coverage_pct']:>4.0f}%")
    print()
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
