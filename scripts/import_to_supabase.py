"""
Bulk-import scraper/verifier output into Supabase.

Reads output/<province-slug>/pejabat_verified.json (falls back to pejabat.json)
and upserts pejabat + jabatan rows, auto-flags needs_review entries, and
inserts a scrape_run record per province.

Usage:
    python scripts/import_to_supabase.py                         # all output/ folders
    python scripts/import_to_supabase.py --provinsi "DKI Jakarta"
    python scripts/import_to_supabase.py --dry-run               # preview only
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
import os

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", s.lower())).strip()


def get_supabase():
    from supabase import create_client
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def build_wilayah_maps(supabase) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (kode_bps → id, normalized_nama → id)."""
    res = supabase.table("wilayah").select("id, kode_bps, nama").execute()
    by_kode: dict[str, str] = {}
    by_name: dict[str, str] = {}
    for w in res.data or []:
        by_kode[w["kode_bps"]] = w["id"]
        by_name[normalize(w["nama"])] = w["id"]
    return by_kode, by_name


def build_pejabat_map(supabase) -> dict[str, str]:
    """Returns normalized_nama → pejabat_id for existing rows."""
    res = supabase.table("pejabat").select("id, nama_lengkap").execute()
    return {normalize(p["nama_lengkap"]): p["id"] for p in res.data or []}


def import_province(
    supabase,
    slug: str,
    provinsi_name: str,
    by_kode: dict[str, str],
    by_name: dict[str, str],
    pejabat_map: dict[str, str],
    dry_run: bool,
) -> dict:
    output_dir = ROOT / "output" / slug

    # Prefer verified output
    json_file = output_dir / "pejabat_verified.json"
    if not json_file.exists():
        json_file = output_dir / "pejabat.json"
    if not json_file.exists():
        logger.warning("No output file found for %s — skipping", slug)
        return {"inserted": 0, "updated": 0, "flagged": 0, "errors": []}

    pejabat_list: list[dict] = json.loads(json_file.read_text(encoding="utf-8"))
    logger.info("%s: %d pejabat", provinsi_name, len(pejabat_list))

    inserted, updated, flagged = 0, 0, 0
    errors: list[str] = []

    for p in pejabat_list:
        nama = p.get("nama_lengkap", "")
        key = normalize(nama)
        existing_id = pejabat_map.get(key)

        try:
            if dry_run:
                action = "UPDATE" if existing_id else "INSERT"
                logger.info("  [dry-run] %s %s", action, nama)
                if not existing_id:
                    inserted += 1
                else:
                    updated += 1
                continue

            if not existing_id:
                # INSERT
                new_id = p.get("id") or str(uuid.uuid4())
                res = supabase.table("pejabat").insert({
                    "id": new_id,
                    "nama_lengkap": p.get("nama_lengkap"),
                    "gelar_depan": p.get("gelar_depan"),
                    "gelar_belakang": p.get("gelar_belakang"),
                    "biodata": p.get("biodata", {}),
                    "pendidikan": p.get("pendidikan", []),
                    "metadata": p.get("metadata", {}),
                }).execute()
                if not res.data:
                    errors.append(f"Insert failed: {nama}")
                    continue
                pejabat_id = new_id
                pejabat_map[key] = pejabat_id
                inserted += 1
            else:
                # UPDATE
                supabase.table("pejabat").update({
                    "nama_lengkap": p.get("nama_lengkap"),
                    "gelar_depan": p.get("gelar_depan"),
                    "gelar_belakang": p.get("gelar_belakang"),
                    "biodata": p.get("biodata", {}),
                    "pendidikan": p.get("pendidikan", []),
                    "metadata": p.get("metadata", {}),
                }).eq("id", existing_id).execute()
                pejabat_id = existing_id
                updated += 1

            # Upsert jabatan rows
            jabatan_list = p.get("jabatan", [])
            if not jabatan_list:
                errors.append(f"No jabatan entries for {nama} — pejabat written with no jabatan")
            for j in jabatan_list:
                wilayah_id = (
                    by_kode.get(j.get("kode_wilayah", ""))
                    or by_name.get(normalize(j.get("wilayah", "")))
                )
                if not wilayah_id:
                    errors.append(f"Wilayah not found: {j.get('wilayah')} ({j.get('kode_wilayah')}) for {nama}")
                    continue
                try:
                    supabase.table("jabatan").upsert(
                        {
                            "pejabat_id": pejabat_id,
                            "wilayah_id": wilayah_id,
                            "posisi": j.get("posisi"),
                            "partai": j.get("partai"),
                            "mulai_jabatan": j.get("mulai_jabatan"),
                            "selesai_jabatan": j.get("selesai_jabatan"),
                            "status": j.get("status", "aktif"),
                        },
                        on_conflict="pejabat_id,wilayah_id,posisi",
                    ).execute()
                except Exception as je:
                    errors.append(f"Jabatan upsert failed for {nama} / {j.get('posisi')}: {je}")

            # Auto-flag needs_review
            if p.get("metadata", {}).get("needs_review"):
                supabase.table("flags").insert({
                    "pejabat_id": pejabat_id,
                    "type": "system",
                    "reason": "Perlu tinjauan manual — skor kepercayaan rendah atau data tidak lengkap.",
                    "status": "pending",
                }).execute()
                flagged += 1

        except Exception as e:
            errors.append(f"Error for {nama}: {e}")

    # Insert scrape_run record
    if not dry_run:
        metadata_file = output_dir / "metadata.json"
        meta = json.loads(metadata_file.read_text(encoding="utf-8")) if metadata_file.exists() else {}

        # Find province wilayah id
        prov_wilayah = supabase.table("wilayah").select("kode_bps").ilike("nama", f"%{provinsi_name}%").eq("level", "provinsi").limit(1).execute()
        kode_provinsi = prov_wilayah.data[0]["kode_bps"] if prov_wilayah.data else ""

        supabase.table("scrape_runs").insert({
            "provinsi": provinsi_name,
            "kode_provinsi": kode_provinsi,
            "started_at": meta.get("generated_at") or __import__("datetime").datetime.now().isoformat(),
            "finished_at": __import__("datetime").datetime.now().isoformat(),
            "status": "done",
            "total_pejabat": inserted + updated,
            "avg_confidence": meta.get("avg_confidence"),
            "needs_review_count": flagged,
        }).execute()

    return {"inserted": inserted, "updated": updated, "flagged": flagged, "errors": errors}


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


# slug → canonical province name (e.g. "dki-jakarta" → "DKI Jakarta")
SLUG_TO_PROVINCE = {_slug(p): p for p in PROVINCES}


def main() -> None:
    parser = argparse.ArgumentParser(description="Import scraper output into Supabase")
    parser.add_argument("--provinsi", help="Import only this province")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    supabase = get_supabase()

    logger.info("Building wilayah + pejabat maps...")
    by_kode, by_name = build_wilayah_maps(supabase)
    pejabat_map = build_pejabat_map(supabase)
    logger.info("  %d wilayah, %d existing pejabat", len(by_kode), len(pejabat_map))

    output_root = ROOT / "output"
    if not output_root.exists():
        logger.error("No output/ directory found. Run run_scraper.py first.")
        sys.exit(1)

    if args.provinsi:
        slug = _slug(args.provinsi)
        folders = [(slug, args.provinsi)]
    else:
        # Discover all output folders that have pejabat*.json
        folders = []
        for d in sorted(output_root.iterdir()):
            if d.is_dir() and (
                (d / "pejabat_verified.json").exists() or (d / "pejabat.json").exists()
            ):
                # Use canonical name from PROVINCES list; fall back to title-cased slug
                display = SLUG_TO_PROVINCE.get(d.name) or d.name.replace("-", " ").title()
                folders.append((d.name, display))

    total_inserted = total_updated = total_flagged = 0
    all_errors: list[str] = []

    for slug, display in folders:
        result = import_province(
            supabase, slug, display, by_kode, by_name, pejabat_map, args.dry_run
        )
        total_inserted += result["inserted"]
        total_updated += result["updated"]
        total_flagged += result["flagged"]
        all_errors.extend(result["errors"])
        logger.info(
            "  %s: +%d inserted, ~%d updated, ⚑%d flagged",
            display, result["inserted"], result["updated"], result["flagged"],
        )
        if result["errors"]:
            for e in result["errors"][:3]:
                logger.warning("    ⚠ %s", e)
            if len(result["errors"]) > 3:
                logger.warning("    ... and %d more errors", len(result["errors"]) - 3)

    logger.info("")
    logger.info("Total: +%d inserted, ~%d updated, ⚑%d flagged", total_inserted, total_updated, total_flagged)
    if all_errors:
        logger.warning("%d errors total (wilayah not found is common for placeholder kode_bps)", len(all_errors))
    if args.dry_run:
        logger.info("[dry-run] Nothing was written.")


if __name__ == "__main__":
    main()
