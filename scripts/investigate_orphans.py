"""
Investigate orphan pejabat (pejabat rows with no jabatan link).

Cross-references each orphan against the original output JSON to see if its
jabatan entries can be remapped to a valid wilayah_id via name lookup, even
when the original kode_wilayah didn't resolve at import time.

Output: output/_orphan_report.json with three buckets:
  - recoverable:     orphans whose jabatan can be re-linked via name match
  - unrecoverable:   orphans where no wilayah lookup succeeds
  - placeholder_name: orphans whose nama_lengkap is clearly a scraper artifact
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


PLACEHOLDER_PATTERNS = [
    re.compile(r"^\s*\[LLM Error\]", re.IGNORECASE),
    re.compile(r"^\s*(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+(Kabupaten|Kota|Provinsi|Kab\.?)\s+", re.IGNORECASE),
    re.compile(r"^\s*$"),
]


def is_placeholder(name: str | None) -> bool:
    if not name:
        return True
    return any(p.match(name) for p in PLACEHOLDER_PATTERNS)


def normalize(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", (s or "").lower())).strip()


PREFIX_RE = re.compile(r"^(kabupaten|kab\.?|kota|kotamadya|administrasi|adm\.?|provinsi|prov\.?)\s+", re.IGNORECASE)


def strip_prefix(s: str) -> str:
    return PREFIX_RE.sub("", s or "", count=1).strip()


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


def build_wilayah_lookups(wilayah: list[dict]) -> dict:
    by_kode: dict[str, str] = {}
    by_full_name: dict[str, str] = {}      # normalized full name (incl. prefix)
    by_stripped_name: dict[str, list[tuple[str, str]]] = {}  # stripped → [(level, id), ...]

    for w in wilayah:
        wid = w["id"]
        by_kode[w["kode_bps"]] = wid
        full_norm = normalize(w["nama"])
        by_full_name[full_norm] = wid
        stripped = normalize(strip_prefix(w["nama"]))
        by_stripped_name.setdefault(stripped, []).append((w["level"], wid))

    return {
        "by_kode": by_kode,
        "by_full_name": by_full_name,
        "by_stripped_name": by_stripped_name,
    }


def resolve_wilayah(j: dict, lookups: dict) -> tuple[str | None, str]:
    """Return (wilayah_id, strategy) or (None, reason)."""
    kode = (j.get("kode_wilayah") or "").strip()
    name = (j.get("wilayah") or "").strip()
    level = (j.get("level") or "").strip().lower()

    if kode and kode in lookups["by_kode"]:
        return lookups["by_kode"][kode], "kode_bps"

    if name:
        full_norm = normalize(name)
        if full_norm in lookups["by_full_name"]:
            return lookups["by_full_name"][full_norm], "full_name"

        stripped = normalize(strip_prefix(name))
        candidates = lookups["by_stripped_name"].get(stripped, [])
        if len(candidates) == 1:
            return candidates[0][1], "stripped_name_unique"
        if len(candidates) > 1 and level:
            level_norm = level.lower()
            level_match = [wid for lvl, wid in candidates if lvl.lower() == level_norm]
            if len(level_match) == 1:
                return level_match[0], "stripped_name_with_level"

    return None, f"no_match (kode={kode!r}, wilayah={name!r}, level={level!r})"


def load_output_index() -> dict[str, dict]:
    """Build pejabat_id → output entry map by scanning all output/*/pejabat*.json."""
    index: dict[str, dict] = {}
    output_root = ROOT / "output"
    for prov_dir in sorted(output_root.iterdir()):
        if not prov_dir.is_dir():
            continue
        json_file = prov_dir / "pejabat_verified.json"
        if not json_file.exists():
            json_file = prov_dir / "pejabat.json"
        if not json_file.exists():
            continue
        try:
            entries = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("Failed to parse %s: %s", json_file, e)
            continue
        for entry in entries:
            pid = entry.get("id")
            if pid:
                # Tag with source slug for reporting
                entry["_source_slug"] = prov_dir.name
                index[pid] = entry
    return index


def main() -> None:
    supabase = get_supabase()

    logger.info("Fetching wilayah / pejabat / jabatan...")
    wilayah = fetch_all("wilayah", supabase, "id, kode_bps, nama, level")
    pejabat = fetch_all("pejabat", supabase, "id, nama_lengkap, metadata")
    jabatan = fetch_all("jabatan", supabase, "pejabat_id")
    logger.info("  %d wilayah, %d pejabat, %d jabatan", len(wilayah), len(pejabat), len(jabatan))

    linked_pejabat_ids = {j["pejabat_id"] for j in jabatan}
    orphans = [p for p in pejabat if p["id"] not in linked_pejabat_ids]
    logger.info("  %d orphan pejabat", len(orphans))

    lookups = build_wilayah_lookups(wilayah)
    output_index = load_output_index()
    logger.info("  %d entries indexed across output/", len(output_index))

    recoverable: list[dict] = []
    unrecoverable: list[dict] = []
    placeholder_name: list[dict] = []
    no_source: list[dict] = []

    for p in orphans:
        pid = p["id"]
        name = p["nama_lengkap"]
        is_ph = is_placeholder(name)

        source = output_index.get(pid)
        if source is None:
            no_source.append({"pejabat_id": pid, "nama_lengkap": name, "placeholder_name": is_ph})
            continue

        jabatan_entries = source.get("jabatan") or []
        resolved: list[dict] = []
        unresolved: list[dict] = []
        for j in jabatan_entries:
            wid, strat = resolve_wilayah(j, lookups)
            if wid:
                resolved.append({
                    "wilayah_id": wid,
                    "strategy": strat,
                    "posisi": j.get("posisi"),
                    "partai": j.get("partai"),
                    "mulai_jabatan": j.get("mulai_jabatan"),
                    "selesai_jabatan": j.get("selesai_jabatan"),
                    "status": j.get("status", "aktif"),
                    "source": {"wilayah": j.get("wilayah"), "kode_wilayah": j.get("kode_wilayah")},
                })
            else:
                unresolved.append({
                    "reason": strat,
                    "posisi": j.get("posisi"),
                    "wilayah": j.get("wilayah"),
                    "kode_wilayah": j.get("kode_wilayah"),
                })

        record = {
            "pejabat_id": pid,
            "nama_lengkap": name,
            "placeholder_name": is_ph,
            "source_slug": source.get("_source_slug"),
            "resolved": resolved,
            "unresolved": unresolved,
        }

        if is_ph and not resolved:
            placeholder_name.append(record)
        elif resolved:
            recoverable.append(record)
        else:
            unrecoverable.append(record)

    report = {
        "summary": {
            "total_orphans": len(orphans),
            "recoverable": len(recoverable),
            "unrecoverable": len(unrecoverable),
            "placeholder_name_only": len(placeholder_name),
            "no_source_entry": len(no_source),
        },
        "recoverable": recoverable,
        "unrecoverable": unrecoverable,
        "placeholder_name": placeholder_name,
        "no_source": no_source,
    }

    out_path = ROOT / "output" / "_orphan_report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("")
    logger.info("Report written to %s", out_path)
    logger.info("Summary: %s", json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
