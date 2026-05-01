"""
Build a canonical kabupaten/kota snapshot for the wilayah table.

Sources:
  - emsifa/api-wilayah-indonesia (BPS-aligned, covers the 34 pre-split provinces)
  - Hardcoded Papua family (91-96) for the 2022 split (Papua Selatan / Tengah / Pegunungan / Barat Daya
    are not in emsifa's pre-split data).

Output: supabase/seed/wilayah_kabkota.json — list of {provinsi_kode, nama, level}

Usage:
    python supabase/seed/build_wilayah_snapshot.py
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

EMSIFA_PROVINCES = "https://emsifa.github.io/api-wilayah-indonesia/api/provinces.json"
EMSIFA_REGENCIES = "https://emsifa.github.io/api-wilayah-indonesia/api/regencies/{id}.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; pejabatkita-seeder)"}

# Provinsi codes we will pull from emsifa. Excludes 91 (Papua Barat) and 94 (Papua) because
# those are pre-2022 boundaries; the Papua family is hardcoded below.
EMSIFA_KODES = {
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
    "31", "32", "33", "34", "35", "36",
    "51", "52", "53",
    "61", "62", "63", "64", "65",
    "71", "72", "73", "74", "75", "76",
    "81", "82",
}

# Papua family — current (2022+) administrative structure, per BPS / UU pemekaran.
# Names use Title Case to match Indonesian convention (matches existing wilayah_provinsi seed).
PAPUA_HARDCODED: dict[str, list[tuple[str, str]]] = {
    # Papua Barat (induk, post-2022 — only retains the western tip)
    "91": [
        ("Kabupaten Fakfak", "kabupaten"),
        ("Kabupaten Kaimana", "kabupaten"),
        ("Kabupaten Manokwari", "kabupaten"),
        ("Kabupaten Manokwari Selatan", "kabupaten"),
        ("Kabupaten Pegunungan Arfak", "kabupaten"),
        ("Kabupaten Teluk Bintuni", "kabupaten"),
        ("Kabupaten Teluk Wondama", "kabupaten"),
    ],
    # Papua (induk, post-2022 — northern coast)
    "92": [
        ("Kabupaten Biak Numfor", "kabupaten"),
        ("Kabupaten Jayapura", "kabupaten"),
        ("Kabupaten Keerom", "kabupaten"),
        ("Kabupaten Kepulauan Yapen", "kabupaten"),
        ("Kabupaten Mamberamo Raya", "kabupaten"),
        ("Kabupaten Sarmi", "kabupaten"),
        ("Kabupaten Supiori", "kabupaten"),
        ("Kabupaten Waropen", "kabupaten"),
        ("Kota Jayapura", "kota"),
    ],
    # Papua Selatan (DOB 2022)
    "93": [
        ("Kabupaten Asmat", "kabupaten"),
        ("Kabupaten Boven Digoel", "kabupaten"),
        ("Kabupaten Mappi", "kabupaten"),
        ("Kabupaten Merauke", "kabupaten"),
    ],
    # Papua Tengah (DOB 2022)
    "94": [
        ("Kabupaten Deiyai", "kabupaten"),
        ("Kabupaten Dogiyai", "kabupaten"),
        ("Kabupaten Intan Jaya", "kabupaten"),
        ("Kabupaten Mimika", "kabupaten"),
        ("Kabupaten Nabire", "kabupaten"),
        ("Kabupaten Paniai", "kabupaten"),
        ("Kabupaten Puncak", "kabupaten"),
        ("Kabupaten Puncak Jaya", "kabupaten"),
    ],
    # Papua Pegunungan (DOB 2022)
    "95": [
        ("Kabupaten Jayawijaya", "kabupaten"),
        ("Kabupaten Lanny Jaya", "kabupaten"),
        ("Kabupaten Mamberamo Tengah", "kabupaten"),
        ("Kabupaten Nduga", "kabupaten"),
        ("Kabupaten Pegunungan Bintang", "kabupaten"),
        ("Kabupaten Tolikara", "kabupaten"),
        ("Kabupaten Yahukimo", "kabupaten"),
        ("Kabupaten Yalimo", "kabupaten"),
    ],
    # Papua Barat Daya (DOB 2022)
    "96": [
        ("Kabupaten Maybrat", "kabupaten"),
        ("Kabupaten Raja Ampat", "kabupaten"),
        ("Kabupaten Sorong", "kabupaten"),
        ("Kabupaten Sorong Selatan", "kabupaten"),
        ("Kabupaten Tambrauw", "kabupaten"),
        ("Kota Sorong", "kota"),
    ],
}


def _normalize_emsifa_name(raw: str) -> str:
    """
    emsifa names are ALL CAPS and sometimes spaced ('KOTA B A T A M', 'KOTA BANDAR LAMPUNG').
    Convert to Title Case and collapse single-letter spacing.
    """
    parts = raw.split()
    # Collapse runs of single letters: ['B','A','T','A','M'] -> ['BATAM']
    collapsed: list[str] = []
    buf: list[str] = []
    for part in parts:
        if len(part) == 1:
            buf.append(part)
        else:
            if buf:
                collapsed.append("".join(buf))
                buf = []
            collapsed.append(part)
    if buf:
        collapsed.append("".join(buf))
    return " ".join(w.capitalize() for w in collapsed)


def _level_from_name(name: str) -> str:
    return "kota" if name.lower().startswith("kota ") else "kabupaten"


def fetch_emsifa() -> list[dict]:
    rows: list[dict] = []
    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=20) as c:
        for kode in sorted(EMSIFA_KODES):
            r = c.get(EMSIFA_REGENCIES.format(id=kode))
            r.raise_for_status()
            for entry in r.json():
                nama = _normalize_emsifa_name(entry["name"])
                rows.append({
                    "provinsi_kode": kode,
                    "nama": nama,
                    "level": _level_from_name(nama),
                })
            logger.info("  %s: %d rows", kode, len([x for x in rows if x['provinsi_kode'] == kode]))
    return rows


def build_papua() -> list[dict]:
    rows: list[dict] = []
    for kode, items in PAPUA_HARDCODED.items():
        for nama, level in items:
            rows.append({"provinsi_kode": kode, "nama": nama, "level": level})
        logger.info("  %s (Papua family): %d rows", kode, len(items))
    return rows


def main() -> None:
    out = Path(__file__).parent / "wilayah_kabkota.json"

    logger.info("Fetching from emsifa...")
    rows = fetch_emsifa()
    logger.info("Adding hardcoded Papua family...")
    rows.extend(build_papua())

    rows.sort(key=lambda r: (r["provinsi_kode"], r["nama"]))

    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Wrote %d rows to %s", len(rows), out)

    by_prov: dict[str, int] = {}
    for r in rows:
        by_prov[r["provinsi_kode"]] = by_prov.get(r["provinsi_kode"], 0) + 1
    logger.info("By province:")
    for k in sorted(by_prov):
        logger.info("  %s: %d", k, by_prov[k])


if __name__ == "__main__":
    main()
