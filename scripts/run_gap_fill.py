"""
Gap-fill scraper. Reads output/_gaps.json (produced by reconcile_output.py),
scrapes only the missing entities, and merges results into each province's
existing pejabat.json. Writes a resumable log so interrupted runs can continue.

Usage:
    python scripts/run_gap_fill.py                             # all gaps
    python scripts/run_gap_fill.py --provinsi "Aceh"           # one province
    python scripts/run_gap_fill.py --resume                    # skip already-scraped gaps
    python scripts/run_gap_fill.py --dry-run                   # list what would scrape

After this, run the verifier separately:
    python verifier/verifier.py --file output/<slug>/pejabat.json --only-needs-review
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
GAPS_FILE = ROOT / "output" / "_gaps.json"
LOG_FILE = ROOT / "scripts" / "gap_fill_log.json"

# Reuse scraper's machinery
sys.path.insert(0, str(ROOT / "scraper"))
from scraper import scrape_official, load_scraper_config, _slug  # noqa: E402
from core.schema import Level  # noqa: E402

# Reuse province name → kode mapping
sys.path.insert(0, str(ROOT / "scripts"))
from reconcile_output import PROVINCE_KODE  # noqa: E402

SLUG_TO_NAME = {
    "aceh": "Aceh", "sumatera-utara": "Sumatera Utara", "sumatera-barat": "Sumatera Barat",
    "riau": "Riau", "jambi": "Jambi", "sumatera-selatan": "Sumatera Selatan",
    "bengkulu": "Bengkulu", "lampung": "Lampung",
    "kepulauan-bangka-belitung": "Kepulauan Bangka Belitung", "kepulauan-riau": "Kepulauan Riau",
    "dki-jakarta": "DKI Jakarta", "jawa-barat": "Jawa Barat", "jawa-tengah": "Jawa Tengah",
    "di-yogyakarta": "DI Yogyakarta", "jawa-timur": "Jawa Timur", "banten": "Banten",
    "bali": "Bali", "nusa-tenggara-barat": "Nusa Tenggara Barat",
    "nusa-tenggara-timur": "Nusa Tenggara Timur",
    "kalimantan-barat": "Kalimantan Barat", "kalimantan-tengah": "Kalimantan Tengah",
    "kalimantan-selatan": "Kalimantan Selatan", "kalimantan-timur": "Kalimantan Timur",
    "kalimantan-utara": "Kalimantan Utara",
    "sulawesi-utara": "Sulawesi Utara", "sulawesi-tengah": "Sulawesi Tengah",
    "sulawesi-selatan": "Sulawesi Selatan", "sulawesi-tenggara": "Sulawesi Tenggara",
    "gorontalo": "Gorontalo", "sulawesi-barat": "Sulawesi Barat",
    "maluku": "Maluku", "maluku-utara": "Maluku Utara",
    "papua-barat": "Papua Barat", "papua": "Papua", "papua-selatan": "Papua Selatan",
    "papua-tengah": "Papua Tengah", "papua-pegunungan": "Papua Pegunungan",
    "papua-barat-daya": "Papua Barat Daya",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def load_log() -> dict:
    return json.loads(LOG_FILE.read_text(encoding="utf-8")) if LOG_FILE.exists() else {}


def save_log(log: dict) -> None:
    LOG_FILE.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def gap_key(slug: str, wilayah: str, posisi: str) -> str:
    return f"{slug}|{wilayah}|{posisi}"


def expand_gaps(gaps_data: dict, only_slug: str | None) -> list[tuple[str, dict, str]]:
    """Returns list of (slug, gap_entry, posisi)."""
    items: list[tuple[str, dict, str]] = []
    for slug, info in gaps_data["by_province"].items():
        if only_slug and slug != only_slug:
            continue
        for entry in info.get("missing_wilayah", []):
            for posisi in entry["posisi_needed"]:
                items.append((slug, entry, posisi))
        for entry in info.get("missing_posisi", []):
            for posisi in entry["posisi_needed"]:
                items.append((slug, entry, posisi))
    return items


def append_to_province(slug: str, pejabat_obj) -> None:
    """Append a Pejabat to output/<slug>/pejabat.json."""
    path = ROOT / "output" / slug / "pejabat.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    existing.append(json.loads(pejabat_obj.model_dump_json()))
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")


async def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provinsi", help="Only fill gaps for this slug, e.g. 'aceh' or 'papua-tengah'")
    parser.add_argument("--resume", action="store_true", help="Skip gaps already in gap_fill_log.json")
    parser.add_argument("--dry-run", action="store_true", help="List what would scrape")
    args = parser.parse_args()

    if not GAPS_FILE.exists():
        logger.error("Gaps file not found: %s. Run reconcile_output.py first.", GAPS_FILE)
        sys.exit(1)

    gaps_data = json.loads(GAPS_FILE.read_text(encoding="utf-8"))
    only_slug = args.provinsi.lower().replace(" ", "-") if args.provinsi else None

    # Validate slug
    if only_slug and only_slug not in PROVINCE_KODE:
        # Try matching by display name
        for slug, name in SLUG_TO_NAME.items():
            if name.lower() == args.provinsi.lower():
                only_slug = slug
                break
        if only_slug not in PROVINCE_KODE:
            logger.error("Unknown province: %s", args.provinsi)
            sys.exit(1)

    items = expand_gaps(gaps_data, only_slug)
    logger.info("Total scrape units to fill: %d", len(items))

    if args.dry_run:
        for slug, entry, posisi in items:
            print(f"  {slug:<25} {posisi} {entry['wilayah']} ({entry['kode_bps']})")
        return

    log = load_log()
    config = load_scraper_config()
    done = failed = skipped = 0

    for i, (slug, entry, posisi) in enumerate(items, start=1):
        key = gap_key(slug, entry["wilayah"], posisi)
        if args.resume and key in log and log[key].get("status") == "done":
            skipped += 1
            continue

        wilayah = entry["wilayah"]
        kode_bps = entry["kode_bps"]
        level = Level.kota if entry["level"] == "kota" else Level.kabupaten

        logger.info("[%d/%d] %s :: %s %s (%s)", i, len(items), slug, posisi, wilayah, kode_bps)
        try:
            p = await scrape_official(posisi, wilayah, kode_bps, level, config, verbose=False)
            if p:
                append_to_province(slug, p)
                conf = p.metadata.confidence.score
                logger.info("  [OK] %s (conf %.2f)", p.nama_lengkap, conf)
                log[key] = {"status": "done", "at": datetime.now().isoformat(), "conf": conf}
                done += 1
            else:
                log[key] = {"status": "no_result", "at": datetime.now().isoformat()}
                failed += 1
        except Exception as e:
            logger.error("  Failed: %s", e)
            log[key] = {"status": "error", "at": datetime.now().isoformat(), "error": str(e)}
            failed += 1

        save_log(log)
        await asyncio.sleep(config.delay)

    logger.info("Summary: done=%d, failed=%d, skipped=%d", done, failed, skipped)
    if failed:
        logger.info("Re-run with --resume to retry failed gaps")


if __name__ == "__main__":
    asyncio.run(run())
