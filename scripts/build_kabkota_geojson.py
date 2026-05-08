"""
Build per-province kab/kota GeoJSON files for the drill-down map.

Source: assai-id/nemesis (seed/geo/02-provinces/with-districts/*.geojson)
Output: web/public/kabkota/<slug>.json (one file per province)

Each output feature has properties.name set to the canonical wilayah.nama
("Kabupaten X" / "Kota X") so the client can choropleth by joining against
listWilayahCounts() output.

Requires: Node.js + npx (mapshaper auto-installed via npx).
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).parent.parent
OUT_DIR = ROOT / "web" / "public" / "kabkota"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# nemesis filename slug → (canonical provinsi nama, output slug used by web)
PROVINCE_MAP: dict[str, tuple[str, str]] = {
    "Aceh": ("Aceh", "aceh"),
    "Sumatera_Utara": ("Sumatera Utara", "sumatera-utara"),
    "Sumatera_Barat": ("Sumatera Barat", "sumatera-barat"),
    "Riau": ("Riau", "riau"),
    "Kepulauan_Riau": ("Kepulauan Riau", "kepulauan-riau"),
    "Jambi": ("Jambi", "jambi"),
    "Bengkulu": ("Bengkulu", "bengkulu"),
    "Sumatera_Selatan": ("Sumatera Selatan", "sumatera-selatan"),
    "Kepulauan_Bangka_Belitung": ("Kepulauan Bangka Belitung", "kepulauan-bangka-belitung"),
    "Lampung": ("Lampung", "lampung"),
    "DKI_Jakarta": ("DKI Jakarta", "dki-jakarta"),
    "Jawa_Barat": ("Jawa Barat", "jawa-barat"),
    "Banten": ("Banten", "banten"),
    "Jawa_Tengah": ("Jawa Tengah", "jawa-tengah"),
    "Daerah_Istimewa_Yogyakarta": ("DI Yogyakarta", "di-yogyakarta"),
    "Jawa_Timur": ("Jawa Timur", "jawa-timur"),
    "Bali": ("Bali", "bali"),
    "Nusa_Tenggara_Barat": ("Nusa Tenggara Barat", "nusa-tenggara-barat"),
    "Nusa_Tenggara_Timur": ("Nusa Tenggara Timur", "nusa-tenggara-timur"),
    "Kalimantan_Barat": ("Kalimantan Barat", "kalimantan-barat"),
    "Kalimantan_Tengah": ("Kalimantan Tengah", "kalimantan-tengah"),
    "Kalimantan_Selatan": ("Kalimantan Selatan", "kalimantan-selatan"),
    "Kalimantan_Timur": ("Kalimantan Timur", "kalimantan-timur"),
    "Kalimantan_Utara": ("Kalimantan Utara", "kalimantan-utara"),
    "Sulawesi_Utara": ("Sulawesi Utara", "sulawesi-utara"),
    "Gorontalo": ("Gorontalo", "gorontalo"),
    "Sulawesi_Tengah": ("Sulawesi Tengah", "sulawesi-tengah"),
    "Sulawesi_Barat": ("Sulawesi Barat", "sulawesi-barat"),
    "Sulawesi_Selatan": ("Sulawesi Selatan", "sulawesi-selatan"),
    "Sulawesi_Tenggara": ("Sulawesi Tenggara", "sulawesi-tenggara"),
    "Maluku": ("Maluku", "maluku"),
    "Maluku_Utara": ("Maluku Utara", "maluku-utara"),
    "Papua": ("Papua", "papua"),
    "Papua_Barat": ("Papua Barat", "papua-barat"),
    "Papua_Selatan": ("Papua Selatan", "papua-selatan"),
    "Papua_Tengah": ("Papua Tengah", "papua-tengah"),
    "Papua_Pegunungan": ("Papua Pegunungan", "papua-pegunungan"),
    "Papua_Barat_Daya": ("Papua Barat Daya", "papua-barat-daya"),
}

BASE_URL = "https://raw.githubusercontent.com/assai-id/nemesis/main/seed/geo/02-provinces/with-districts"

# Per-province alias map: nemesis WADMKK (lowercased) → canonical wilayah.nama.
# Used when nemesis snapshot uses different naming than the canonical wilayah seed.
# Direction is canonical-name-stable: the wilayah seed is the source of truth, and
# we re-label the polygon to whatever the seed says. Six known mismatches as of
# 2026-05-08 — see CLAUDE.md Phase 8 #2 notes.
ALIASES: dict[str, dict[str, str]] = {
    "Sumatera_Utara": {
        "toba": "Kabupaten Toba Samosir",
        "kota padang sidempuan": "Kota Padangsidimpuan",
    },
    "Sulawesi_Barat": {
        "pasangkayu": "Kabupaten Mamuju Utara",
    },
    "Maluku": {
        "kepulauan tanimbar": "Kabupaten Maluku Tenggara Barat",
    },
    "Sulawesi_Utara": {
        "kep. siau tagulandang biaro": "Kabupaten Siau Tagulandang Biaro",
    },
    "Kalimantan_Timur": {
        "mahakam ulu": "Kabupaten Mahakam Hulu",
    },
}


def _norm(name: str) -> tuple[str, str]:
    """Return (level, normalized_stem). level is 'kota' for kota entries, else 'kabupaten'."""
    s = name.lower().strip()
    # Expand abbreviations used by nemesis (Adm. = Administrasi, Kep. = Kepulauan)
    s = re.sub(r"\badm\.?\s+", "administrasi ", s)
    s = re.sub(r"\bkep\.?\s+", "kepulauan ", s)
    level = "kabupaten"
    # Detect kota status before stripping any prefixes
    has_kota = bool(re.match(r"^(kota administrasi |kota )", s))
    has_kabupaten = bool(re.match(r"^(kabupaten administrasi |kabupaten )", s))
    if has_kota:
        level = "kota"
    # Strip exactly one prefix layer ("Kabupaten Kota Baru" must not collapse to "baru")
    s = re.sub(r"^(kabupaten administrasi |kota administrasi |kabupaten |kota |administrasi )", "", s)
    # Heuristic: if "Adm." was present without explicit Kota/Kabupaten, it's a Jakarta-style kota
    if not (has_kota or has_kabupaten) and "administrasi" in name.lower():
        level = "kota" if not name.lower().startswith("adm. kep") and not name.lower().startswith("kep") else "kabupaten"
    # If raw started with "Adm. Kep." treat as kabupaten (Kepulauan Seribu)
    if name.lower().startswith("adm. kep") or name.lower().startswith("kep "):
        level = "kabupaten"
    return level, re.sub(r"[^a-z]+", "", s)


def fetch_canonical_kabkota(provinsi_nama: str) -> list[tuple[str, str]]:
    """Return [(canonical_nama, level)] for a province from Supabase wilayah."""
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    # Look up provinsi kode first
    r = httpx.get(
        f"{url}/rest/v1/wilayah",
        params={"select": "kode_bps", "level": "eq.provinsi", "nama": f"eq.{provinsi_nama}"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=15,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return []
    kode = rows[0]["kode_bps"]
    r = httpx.get(
        f"{url}/rest/v1/wilayah",
        params={
            "select": "nama,level",
            "level": "in.(kabupaten,kota)",
            "kode_bps": f"like.{kode}.%",
        },
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=15,
    )
    r.raise_for_status()
    return [(row["nama"], row["level"]) for row in r.json()]


def _match_to_canonical(raw_name: str, canonical: list[tuple[str, str]]) -> str | None:
    """Find the canonical wilayah.nama for a nemesis WADMKK string."""
    raw_level, raw_stem = _norm(raw_name)
    # Pass 1: exact level match
    for nama, can_level in canonical:
        n_level, n_stem = _norm(nama)
        if n_stem == raw_stem and n_level == raw_level and can_level == raw_level:
            return nama
    # Pass 2: stem match with canonical level (in case raw has no prefix at all
    # — e.g. "Magelang" with no "Kabupaten "/"Kota " prefix should match the
    # kabupaten canonical, since kota always has explicit "Kota " prefix in nemesis)
    if raw_level == "kabupaten":
        for nama, can_level in canonical:
            _, n_stem = _norm(nama)
            if n_stem == raw_stem and can_level == "kabupaten":
                return nama
    return None


def find_npx() -> str:
    npx = shutil.which("npx")
    if not npx:
        logger.error("npx not found. Install Node.js.")
        sys.exit(1)
    return npx


def build_one(slug: str, provinsi_nama: str, web_slug: str, work: Path) -> tuple[int, int]:
    """Download + normalize names + simplify; return (features_kept, missing_count)."""
    raw_url = f"{BASE_URL}/{slug}.geojson"
    raw_path = work / f"{slug}.geojson"
    if not raw_path.exists():
        with httpx.Client(timeout=120, follow_redirects=True) as client:
            resp = client.get(raw_url)
            resp.raise_for_status()
            raw_path.write_bytes(resp.content)

    data = json.loads(raw_path.read_text(encoding="utf-8"))
    features = data.get("features", [])

    canonical = fetch_canonical_kabkota(provinsi_nama)
    canonical_set = {nama for nama, _ in canonical}
    aliases = ALIASES.get(slug, {})
    matched: set[str] = set()
    kept = []
    for f in features:
        props = f.setdefault("properties", {})
        wadmkk = props.get("WADMKK") or ""
        if not wadmkk:
            continue
        canon = aliases.get(wadmkk.lower())
        if canon and canon not in canonical_set:
            logger.warning("  alias %s → %s, but canonical missing", wadmkk, canon)
            canon = None
        if not canon:
            canon = _match_to_canonical(wadmkk, canonical)
        if not canon:
            logger.warning("  no canonical match for %s/%s", provinsi_nama, wadmkk)
            continue
        # Reset properties to just what the map needs
        f["properties"] = {"name": canon, "raw": wadmkk}
        matched.add(canon)
        kept.append(f)

    missing = sorted(canonical_set - matched)
    if missing:
        logger.warning("  %s missing canonical entries: %s", provinsi_nama, missing)

    normalized = {"type": "FeatureCollection", "features": kept}
    pre_path = work / f"{slug}.normalized.geojson"
    pre_path.write_text(json.dumps(normalized), encoding="utf-8")

    out_path = OUT_DIR / f"{web_slug}.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    npx = find_npx()
    cmd = [
        npx, "-y", "mapshaper@0.6.105",
        str(pre_path),
        "-simplify", "5%", "weighted", "keep-shapes",
        "-clean",
        "-o", str(out_path), "format=geojson", "precision=0.0001",
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return len(kept), len(missing)


def main() -> None:
    if "--one" in sys.argv:
        idx = sys.argv.index("--one") + 1
        only = sys.argv[idx]
        items = [(s, n, w) for s, (n, w) in PROVINCE_MAP.items() if s == only or n == only or w == only]
        if not items:
            logger.error("--one %s not in PROVINCE_MAP", only)
            sys.exit(1)
    else:
        items = [(s, n, w) for s, (n, w) in PROVINCE_MAP.items()]

    with tempfile.TemporaryDirectory(prefix="pejabat-kk-") as tmp:
        work = Path(tmp)
        total_features, total_missing = 0, 0
        for slug, provinsi_nama, web_slug in items:
            logger.info("→ %s", provinsi_nama)
            try:
                kept, missing = build_one(slug, provinsi_nama, web_slug, work)
                total_features += kept
                total_missing += missing
                size_kb = (OUT_DIR / f"{web_slug}.json").stat().st_size / 1024
                logger.info("  ok: %d features, %.1f KB", kept, size_kb)
            except Exception as e:
                logger.error("  FAILED %s: %s", provinsi_nama, e)

    logger.info("Total: %d features written, %d missing canonical entries", total_features, total_missing)


if __name__ == "__main__":
    main()
