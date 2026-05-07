"""
Build a single combined+simplified GeoJSON of Indonesia's 38 provinces.

Source: assai-id/nemesis (seed/geo/02-provinces/province-only/*.geojson)
Output: web/public/indonesia-provinces.json

Uses mapshaper (via npx) for topology-preserving simplification so adjacent
provinces don't develop gaps. Each feature's properties.name is set to the
canonical wilayah.nama used in our Supabase wilayah table.

Requires: Node.js + npx (mapshaper auto-installed via npx).
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "indonesia-provinces.json"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# nemesis filename slug → canonical wilayah.nama
PROVINCE_MAP: dict[str, str] = {
    "Aceh": "Aceh",
    "Sumatera_Utara": "Sumatera Utara",
    "Sumatera_Barat": "Sumatera Barat",
    "Riau": "Riau",
    "Kepulauan_Riau": "Kepulauan Riau",
    "Jambi": "Jambi",
    "Bengkulu": "Bengkulu",
    "Sumatera_Selatan": "Sumatera Selatan",
    "Kepulauan_Bangka_Belitung": "Kepulauan Bangka Belitung",
    "Lampung": "Lampung",
    "DKI_Jakarta": "DKI Jakarta",
    "Jawa_Barat": "Jawa Barat",
    "Banten": "Banten",
    "Jawa_Tengah": "Jawa Tengah",
    "Daerah_Istimewa_Yogyakarta": "DI Yogyakarta",
    "Jawa_Timur": "Jawa Timur",
    "Bali": "Bali",
    "Nusa_Tenggara_Barat": "Nusa Tenggara Barat",
    "Nusa_Tenggara_Timur": "Nusa Tenggara Timur",
    "Kalimantan_Barat": "Kalimantan Barat",
    "Kalimantan_Tengah": "Kalimantan Tengah",
    "Kalimantan_Selatan": "Kalimantan Selatan",
    "Kalimantan_Timur": "Kalimantan Timur",
    "Kalimantan_Utara": "Kalimantan Utara",
    "Sulawesi_Utara": "Sulawesi Utara",
    "Gorontalo": "Gorontalo",
    "Sulawesi_Tengah": "Sulawesi Tengah",
    "Sulawesi_Barat": "Sulawesi Barat",
    "Sulawesi_Selatan": "Sulawesi Selatan",
    "Sulawesi_Tenggara": "Sulawesi Tenggara",
    "Maluku": "Maluku",
    "Maluku_Utara": "Maluku Utara",
    "Papua": "Papua",
    "Papua_Barat": "Papua Barat",
    "Papua_Selatan": "Papua Selatan",
    "Papua_Tengah": "Papua Tengah",
    "Papua_Pegunungan": "Papua Pegunungan",
    "Papua_Barat_Daya": "Papua Barat Daya",
}

BASE_URL = "https://raw.githubusercontent.com/assai-id/nemesis/main/seed/geo/02-provinces/province-only"


def download_all(work: Path) -> list[Path]:
    work.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        for slug, canonical in PROVINCE_MAP.items():
            url = f"{BASE_URL}/{slug}.geojson"
            dest = work / f"{slug}.geojson"
            if not dest.exists():
                logger.info("Downloading %s ...", slug)
                r = client.get(url)
                r.raise_for_status()
                dest.write_bytes(r.content)
            # Rewrite properties.name to canonical
            data = json.loads(dest.read_text(encoding="utf-8"))
            features = data.get("features") or ([data] if data.get("type") == "Feature" else [])
            if not features and data.get("type") == "FeatureCollection":
                features = data["features"]
            for f in features:
                f.setdefault("properties", {})
                f["properties"]["name"] = canonical
                f["properties"]["slug"] = slug
            normalized = {
                "type": "FeatureCollection",
                "features": features,
            }
            dest.write_text(json.dumps(normalized), encoding="utf-8")
            paths.append(dest)
    return paths


def find_npx() -> str:
    npx = shutil.which("npx")
    if not npx:
        logger.error("npx not found on PATH. Install Node.js.")
        sys.exit(1)
    return npx


def run_mapshaper(inputs: list[Path], out: Path) -> None:
    npx = find_npx()
    # Combine all 38 inputs, simplify with topology preservation, write GeoJSON.
    # Visvalingam weighted with 5% retention → ~1-2MB total, still recognizable.
    cmd = [
        npx, "-y", "mapshaper@0.6.105",
        *[str(p) for p in inputs],
        "combine-files",
        "-merge-layers", "force",
        "-simplify", "1%", "weighted", "keep-shapes",
        "-clean",
        "-o", str(out), "format=geojson", "precision=0.001",
    ]
    logger.info("Running mapshaper... (will install on first run)")
    subprocess.run(cmd, check=True)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="pejabat-geo-") as tmp:
        work = Path(tmp)
        inputs = download_all(work)
        logger.info("Downloaded %d province files", len(inputs))

        OUT.parent.mkdir(parents=True, exist_ok=True)
        run_mapshaper(inputs, OUT)

    size_kb = OUT.stat().st_size / 1024
    data = json.loads(OUT.read_text(encoding="utf-8"))
    feat_count = len(data.get("features", []))
    names = sorted({f["properties"].get("name") for f in data.get("features", [])})
    logger.info("Wrote %s (%.1f KB, %d features)", OUT, size_kb, feat_count)
    logger.info("Provinces: %s", names)


if __name__ == "__main__":
    main()
