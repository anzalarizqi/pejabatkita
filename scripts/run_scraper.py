"""
Orchestrate scraper + verifier for all 38 provinces (or a single one).

Usage:
    python scripts/run_scraper.py                      # all provinces
    python scripts/run_scraper.py --provinsi "Aceh"    # single province
    python scripts/run_scraper.py --resume             # skip already-completed provinces
    python scripts/run_scraper.py --skip-verify        # scrape only, no verifier pass

Progress is saved to scripts/run_log.json so interrupted runs can be resumed with --resume.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
LOG_FILE = Path(__file__).parent / "run_log.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PROVINCES = [
    "Aceh", "Sumatera Utara", "Sumatera Barat", "Riau", "Kepulauan Riau",
    "Jambi", "Bengkulu", "Sumatera Selatan", "Kepulauan Bangka Belitung",
    "Lampung", "DKI Jakarta", "Jawa Barat", "Banten", "Jawa Tengah",
    "DI Yogyakarta", "Jawa Timur", "Bali", "Nusa Tenggara Barat",
    "Nusa Tenggara Timur", "Kalimantan Barat", "Kalimantan Tengah",
    "Kalimantan Selatan", "Kalimantan Timur", "Kalimantan Utara",
    "Sulawesi Utara", "Gorontalo", "Sulawesi Tengah", "Sulawesi Barat",
    "Sulawesi Selatan", "Sulawesi Tenggara", "Maluku", "Maluku Utara",
    "Papua", "Papua Barat", "Papua Selatan", "Papua Tengah",
    "Papua Pegunungan", "Papua Barat Daya",
]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_log() -> dict:
    if LOG_FILE.exists():
        return json.loads(LOG_FILE.read_text(encoding="utf-8"))
    return {}


def save_log(log: dict) -> None:
    LOG_FILE.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def is_done(provinsi: str, log: dict) -> bool:
    return log.get(provinsi, {}).get("status") == "done"


def run_province(provinsi: str, skip_verify: bool, log: dict) -> bool:
    slug = _slug(provinsi)
    output_dir = ROOT / "output"
    pejabat_json = output_dir / slug / "pejabat.json"
    verified_json = output_dir / slug / "pejabat_verified.json"

    logger.info("═══ %s ═══", provinsi)

    # Step 1: Scrape
    if pejabat_json.exists():
        logger.info("  Scraper output exists — skipping scrape")
    else:
        logger.info("  Running scraper...")
        result = subprocess.run(
            [sys.executable, "scraper/scraper.py", "--provinsi", provinsi],
            cwd=ROOT,
        )
        if result.returncode != 0:
            logger.error("  Scraper failed for %s (exit %d)", provinsi, result.returncode)
            log[provinsi] = {"status": "scrape_failed", "at": datetime.now().isoformat()}
            save_log(log)
            return False
        logger.info("  Scraper done")

    # Step 2: Verify
    if skip_verify:
        logger.info("  Skipping verifier (--skip-verify)")
    elif verified_json.exists():
        logger.info("  Verified output exists — skipping verify")
    else:
        logger.info("  Running verifier...")
        result = subprocess.run(
            [
                sys.executable, "verifier/verifier.py",
                "--file", str(pejabat_json),
                "--only-needs-review",
            ],
            cwd=ROOT,
        )
        if result.returncode != 0:
            logger.warning("  Verifier failed for %s — continuing with unverified data", provinsi)
        else:
            logger.info("  Verifier done")

    log[provinsi] = {"status": "done", "at": datetime.now().isoformat()}
    save_log(log)
    logger.info("  [done] %s complete", provinsi)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Run scraper + verifier for all provinces")
    parser.add_argument("--provinsi", help="Run only this province")
    parser.add_argument("--resume", action="store_true", help="Skip already-completed provinces")
    parser.add_argument("--skip-verify", action="store_true", help="Skip verifier pass")
    args = parser.parse_args()

    log = load_log()
    provinces = [args.provinsi] if args.provinsi else PROVINCES

    done, failed, skipped = 0, 0, 0

    for provinsi in provinces:
        if args.resume and is_done(provinsi, log):
            logger.info("Skipping %s (already done)", provinsi)
            skipped += 1
            continue

        success = run_province(provinsi, args.skip_verify, log)
        if success:
            done += 1
        else:
            failed += 1

    logger.info("")
    logger.info("Summary: %d done, %d failed, %d skipped", done, failed, skipped)
    if failed:
        logger.info("Re-run with --resume to retry failed provinces")
        sys.exit(1)


if __name__ == "__main__":
    main()
