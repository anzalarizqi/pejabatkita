"""
Reconcile existing output/*/pejabat.json against the canonical wilayah snapshot.

For every entry:
  - provinsi-level (Gubernur/Wakil Gubernur) → kept untouched
  - kab/kota-level whose wilayah matches a canonical row in this province → kept,
    kode_wilayah overwritten to the canonical kode_bps
  - kab/kota-level whose wilayah does NOT match → dropped (phantom from old seed bug)

Outputs:
  - output/<slug>/pejabat.json  rewritten in place (a backup is saved as pejabat.pre-reconcile.json)
  - output/_gaps.json            per-province list of canonical kab/kota that still need scraping

Usage:
    python scripts/reconcile_output.py --dry-run     # report only, no writes
    python scripts/reconcile_output.py               # writes
"""
from __future__ import annotations

import argparse
import json
import logging
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUTPUT_DIR = ROOT / "output"
SNAPSHOT = ROOT / "supabase" / "seed" / "wilayah_kabkota.json"
GAPS_FILE = OUTPUT_DIR / "_gaps.json"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Province name → BPS kode. Mirrors the canonical wilayah_provinsi seed.
PROVINCE_KODE: dict[str, str] = {
    "aceh": "11", "sumatera-utara": "12", "sumatera-barat": "13", "riau": "14",
    "jambi": "15", "sumatera-selatan": "16", "bengkulu": "17", "lampung": "18",
    "kepulauan-bangka-belitung": "19", "kepulauan-riau": "21",
    "dki-jakarta": "31", "jawa-barat": "32", "jawa-tengah": "33",
    "di-yogyakarta": "34", "jawa-timur": "35", "banten": "36",
    "bali": "51", "nusa-tenggara-barat": "52", "nusa-tenggara-timur": "53",
    "kalimantan-barat": "61", "kalimantan-tengah": "62", "kalimantan-selatan": "63",
    "kalimantan-timur": "64", "kalimantan-utara": "65",
    "sulawesi-utara": "71", "sulawesi-tengah": "72", "sulawesi-selatan": "73",
    "sulawesi-tenggara": "74", "gorontalo": "75", "sulawesi-barat": "76",
    "maluku": "81", "maluku-utara": "82",
    "papua-barat": "91", "papua": "92", "papua-selatan": "93",
    "papua-tengah": "94", "papua-pegunungan": "95", "papua-barat-daya": "96",
}


def _normalize(name: str) -> str:
    name = name.lower()
    for prefix in ("kabupaten administrasi ", "kota administrasi ", "kabupaten ", "kota "):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    return re.sub(r"\s+", " ", name).strip()


def _level_from_name(name: str) -> str:
    return "kota" if name.lower().lstrip().startswith("kota ") else "kabupaten"


def load_canonical() -> dict[str, dict[tuple[str, str], tuple[str, str]]]:
    """
    Returns: {provinsi_kode: {(level, normalized_nama): (kode_bps, canonical_nama)}}
    kode_bps assigned as {prov_kode}.{seq:02d} matching the seeder's order.
    """
    rows = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    rows.sort(key=lambda r: (r["provinsi_kode"], r["nama"]))

    by_prov: dict[str, dict[tuple[str, str], tuple[str, str]]] = defaultdict(dict)
    seq: dict[str, int] = defaultdict(int)
    for r in rows:
        prov = r["provinsi_kode"]
        seq[prov] += 1
        kode_bps = f"{prov}.{seq[prov]:02d}"
        key = (r["level"], _normalize(r["nama"]))
        by_prov[prov][key] = (kode_bps, r["nama"])
    return dict(by_prov)


def reconcile_province(slug: str, prov_kode: str, canonical: dict[tuple[str, str], tuple[str, str]],
                       dry_run: bool) -> dict:
    """Returns a per-province report dict."""
    pejabat_path = OUTPUT_DIR / slug / "pejabat.json"
    if not pejabat_path.exists():
        return {"slug": slug, "kode": prov_kode, "status": "no_output"}

    data = json.loads(pejabat_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        return {"slug": slug, "kode": prov_kode, "status": "bad_format"}

    kept: list[dict] = []
    dropped: list[str] = []
    remapped: int = 0
    covered_keys: set[tuple[str, str]] = set()

    for entry in data:
        jabs = entry.get("jabatan") or []
        if not jabs:
            # Malformed legacy entry — query string lodged in nama_lengkap, no jabatan.
            # Always garbage; drop.
            dropped.append(f"[empty-jabatan] {entry.get('nama_lengkap','')!r}")
            continue

        j0 = jabs[0]
        level = j0.get("level")
        wilayah = j0.get("wilayah", "")

        if level == "provinsi":
            kept.append(entry)
            continue

        # kab/kota — match against canonical
        wiki_level = _level_from_name(wilayah) if level not in ("kabupaten", "kota") else level
        key = (wiki_level, _normalize(wilayah))
        match = canonical.get(key)
        if not match:
            # Fallback: try the OTHER level (in case the original level field was wrong)
            other_level = "kota" if wiki_level == "kabupaten" else "kabupaten"
            match = canonical.get((other_level, _normalize(wilayah)))
            if match:
                wiki_level = other_level

        if match:
            kode_bps, canonical_nama = match
            old_kode = j0.get("kode_wilayah")
            if old_kode != kode_bps:
                j0["kode_wilayah"] = kode_bps
                remapped += 1
            j0["level"] = wiki_level
            j0["wilayah"] = canonical_nama  # normalize to canonical spelling
            kept.append(entry)
            covered_keys.add((wiki_level, _normalize(canonical_nama)))
        else:
            dropped.append(f"{j0.get('posisi','?')} {wilayah}")

    # Compute gaps: canonical entries not covered, expanded to bupati+wakil or walikota+wakil
    gaps: list[dict] = []
    for (level, norm), (kode_bps, nama) in canonical.items():
        if (level, norm) in covered_keys:
            continue
        posisi_pair = ["Walikota", "Wakil Walikota"] if level == "kota" else ["Bupati", "Wakil Bupati"]
        gaps.append({
            "wilayah": nama,
            "level": level,
            "kode_bps": kode_bps,
            "posisi_needed": posisi_pair,
        })

    # Also, gaps for missing posisi within covered wilayah (e.g. only Bupati scraped, Wakil missing)
    posisi_by_wilayah: dict[tuple[str, str], set[str]] = defaultdict(set)
    for entry in kept:
        jabs = entry.get("jabatan") or []
        if not jabs: continue
        j0 = jabs[0]
        if j0.get("level") in ("kabupaten", "kota"):
            posisi_by_wilayah[(j0["level"], _normalize(j0["wilayah"]))].add(j0.get("posisi",""))

    partial_gaps: list[dict] = []
    for (level, norm), posisi_set in posisi_by_wilayah.items():
        expected = {"Walikota","Wakil Walikota"} if level == "kota" else {"Bupati","Wakil Bupati"}
        # Allow "Wakil Wali Kota" (with space) to count as Wakil Walikota
        normalized_present = {p.replace("Wali Kota","Walikota") for p in posisi_set}
        missing = expected - normalized_present
        if missing:
            kode_bps, nama = canonical[(level, norm)]
            partial_gaps.append({
                "wilayah": nama,
                "level": level,
                "kode_bps": kode_bps,
                "posisi_needed": sorted(missing),
            })

    # Write cleaned output
    if not dry_run and (dropped or remapped or any(j0.get("wilayah") != orig for entry, orig in []) ):
        backup = OUTPUT_DIR / slug / "pejabat.pre-reconcile.json"
        if not backup.exists():
            backup.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        pejabat_path.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "slug": slug,
        "kode": prov_kode,
        "status": "ok",
        "kept": len(kept),
        "dropped": len(dropped),
        "remapped_kode": remapped,
        "dropped_entries": dropped,
        "gaps_missing_wilayah": gaps,
        "gaps_missing_posisi": partial_gaps,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    canonical = load_canonical()
    reports: list[dict] = []

    for slug, kode in sorted(PROVINCE_KODE.items(), key=lambda kv: kv[1]):
        rep = reconcile_province(slug, kode, canonical[kode], args.dry_run)
        reports.append(rep)

    # Console summary
    print(f"{'Province':<28} {'Kode':<5} {'Kept':>5} {'Drop':>5} {'Remap':>6}  Gaps")
    total_dropped = total_remapped = total_gaps_wil = total_gaps_pos = 0
    for r in reports:
        if r["status"] != "ok":
            print(f"{r['slug']:<28} {r['kode']:<5}  -- {r['status']}")
            continue
        gw = len(r["gaps_missing_wilayah"])
        gp = len(r["gaps_missing_posisi"])
        total_dropped += r["dropped"]
        total_remapped += r["remapped_kode"]
        total_gaps_wil += gw
        total_gaps_pos += gp
        flag = "  GAPS" if gw > 0 else ""
        print(f"{r['slug']:<28} {r['kode']:<5} {r['kept']:>5} {r['dropped']:>5} {r['remapped_kode']:>6}  {gw} wilayah, {gp} partial{flag}")

    print()
    print(f"TOTAL: dropped={total_dropped}  remapped={total_remapped}  "
          f"missing_wilayah={total_gaps_wil}  missing_posisi={total_gaps_pos}")

    # Write gaps file
    gaps_payload = {
        "generated_by": "scripts/reconcile_output.py",
        "by_province": {
            r["slug"]: {
                "kode": r["kode"],
                "missing_wilayah": r.get("gaps_missing_wilayah", []),
                "missing_posisi": r.get("gaps_missing_posisi", []),
            }
            for r in reports if r["status"] == "ok"
        },
    }
    if not args.dry_run:
        GAPS_FILE.write_text(json.dumps(gaps_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nGaps written to {GAPS_FILE}")
    else:
        print("\n[dry-run] No files written.")


if __name__ == "__main__":
    main()
