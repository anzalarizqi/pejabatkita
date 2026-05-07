"""
Phase 9A — backfill placeholder pejabat using the LLM-research agent.

For each (wilayah, posisi) tied to a placeholder-named pejabat, call
scraper.agent.research_pejabat() and verify_citations(). On accept, update
the existing pejabat row in-place (nama_lengkap, gelar_*, metadata.sources,
metadata.confidence). On reject, leave the placeholder.

Resumable via scripts/agent_backfill_log.json — one entry per (wilayah_id,
posisi) target with status: verified | rejected_no_sources |
rejected_unverifiable | error | skipped_resume.

Usage:
    python scripts/run_agent_backfill.py --provinsi "DI Yogyakarta"
    python scripts/run_agent_backfill.py --provinsi "Kalimantan Selatan" --dry-run
    python scripts/run_agent_backfill.py --provinsi "DI Yogyakarta" --resume
    python scripts/run_agent_backfill.py --provinsi "DI Yogyakarta" --limit 5
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from scraper.agent import research_pejabat, verify_citations  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("backfill")
# Quiet noisy deps
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


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
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def get_province_wilayah(supabase, provinsi: str) -> dict | None:
    res = (
        supabase.table("wilayah")
        .select("id, kode_bps, nama, level")
        .eq("level", "provinsi")
        .ilike("nama", provinsi)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_targets(supabase, provinsi: str) -> list[dict]:
    """Return list of {wilayah_id, wilayah_nama, level, posisi, pejabat_id, current_name}
    where current_name is a placeholder."""
    prov = get_province_wilayah(supabase, provinsi)
    if not prov:
        raise SystemExit(f"Province not found: {provinsi}")

    # All wilayah for this province (province row + its kab/kota children)
    children = (
        supabase.table("wilayah")
        .select("id, kode_bps, nama, level")
        .eq("parent_id", prov["id"])
        .execute()
    ).data or []
    all_wilayah = [prov] + children
    wilayah_ids = [w["id"] for w in all_wilayah]
    wilayah_by_id = {w["id"]: w for w in all_wilayah}

    # Jabatan rows for these wilayah (paginated — may be > 1000)
    jabatan_rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        chunk = (
            supabase.table("jabatan")
            .select("id, pejabat_id, wilayah_id, posisi, status")
            .in_("wilayah_id", wilayah_ids)
            .range(offset, offset + page - 1)
            .execute()
        ).data or []
        jabatan_rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page

    if not jabatan_rows:
        return []

    pejabat_ids = list({j["pejabat_id"] for j in jabatan_rows})
    pejabat_by_id: dict[str, dict] = {}
    for i in range(0, len(pejabat_ids), 200):
        chunk_ids = pejabat_ids[i : i + 200]
        chunk = (
            supabase.table("pejabat")
            .select("id, nama_lengkap, gelar_depan, gelar_belakang, metadata")
            .in_("id", chunk_ids)
            .execute()
        ).data or []
        for p in chunk:
            pejabat_by_id[p["id"]] = p

    targets = []
    for j in jabatan_rows:
        p = pejabat_by_id.get(j["pejabat_id"])
        if not p:
            continue
        if not is_placeholder(p["nama_lengkap"]):
            continue
        w = wilayah_by_id[j["wilayah_id"]]
        targets.append({
            "jabatan_id": j["id"],
            "pejabat_id": j["pejabat_id"],
            "wilayah_id": j["wilayah_id"],
            "wilayah_nama": w["nama"],
            "level": w["level"],
            "posisi": j["posisi"],
            "current_name": p["nama_lengkap"],
            "current_metadata": p.get("metadata") or {},
        })

    # Stable order: province first, then alphabetical wilayah, then posisi
    targets.sort(key=lambda t: (t["level"] != "provinsi", t["wilayah_nama"], t["posisi"]))
    return targets


# ─── Resumable log ───────────────────────────────────────────────────────────

LOG_PATH = ROOT / "scripts" / "agent_backfill_log.json"


def load_log() -> dict:
    if LOG_PATH.exists():
        return json.loads(LOG_PATH.read_text(encoding="utf-8"))
    return {"runs": [], "results": {}}


def save_log(log: dict) -> None:
    LOG_PATH.write_text(json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8")


def target_key(t: dict) -> str:
    return f"{t['wilayah_id']}::{t['posisi']}"


# ─── Update Supabase ─────────────────────────────────────────────────────────


def flag_unresolved(supabase, target: dict, result, dry_run: bool) -> None:
    """Insert an admin-review row when the agent gives up on a target.
    Captures URL list + per-URL failure reason so a human can scan and
    either insert manually or close out as 'no public info available'."""
    fetch_failures = getattr(result, "fetch_failures", {}) if result else {}
    candidates = getattr(result, "candidates_tried", []) if result else []
    fail_summary: dict[str, int] = {}
    for reason in fetch_failures.values():
        fail_summary[reason] = fail_summary.get(reason, 0) + 1

    parts = [
        f"[agent_unresolved] {target['posisi']} @ {target['wilayah_nama']}.",
        f"Tried {len(candidates)} candidate URLs.",
    ]
    if fail_summary:
        parts.append(
            "Fetch failures: "
            + ", ".join(f"{r}={n}" for r, n in sorted(fail_summary.items()))
            + "."
        )
    if result and getattr(result, "nama", ""):
        parts.append(
            f"Model proposed name {result.nama!r} but verification rejected."
        )
    parts.append("URLs tried:\n" + "\n".join(f"  - {u}" for u in candidates[:25]))
    reason_text = "\n".join(parts)

    if dry_run:
        logger.info("  [dry-run] FLAG agent_unresolved on pejabat %s",
                    target["pejabat_id"])
        return

    # Avoid duplicate open flags for the same pejabat (we tag via reason
    # prefix since flag_type enum is still 'system'/'public' — see migration
    # 006_flag_type_agent.sql for the eventual proper enum value).
    existing = (
        supabase.table("flags")
        .select("id, reason")
        .eq("pejabat_id", target["pejabat_id"])
        .eq("type", "system")
        .eq("status", "pending")
        .execute()
    ).data or []
    if any((f.get("reason") or "").startswith("[agent_unresolved]") for f in existing):
        logger.info("  flag already pending — skipping insert")
        return
    supabase.table("flags").insert({
        "pejabat_id": target["pejabat_id"],
        "type": "system",
        "reason": reason_text[:4000],
        "status": "pending",
    }).execute()


def apply_research(supabase, target: dict, result, dry_run: bool) -> None:
    """Update existing pejabat row in-place with verified data."""
    sources_payload = [
        {
            "url": c.url,
            "domain": (urlparse(c.url).hostname or "").lower(),
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "type": "agent",
            "kutipan": c.kutipan,
            "verified": True,
        }
        for c in result.verified_sources
    ]

    metadata = dict(target.get("current_metadata") or {})
    existing_sources = list(metadata.get("sources") or [])
    metadata["sources"] = existing_sources + sources_payload
    metadata["confidence"] = {
        "score": min(1.0, max(0.0, result.confidence)),
        "completeness": 0.6,
        "corroboration": min(1.0, len(result.verified_sources) / 2.0),
        "notes": f"Phase 9A agent backfill ({len(result.verified_sources)} verified sources)",
    }
    metadata["last_updated"] = datetime.now(timezone.utc).isoformat()
    metadata["needs_review"] = result.confidence < 0.7
    metadata["agent_backfill"] = {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "previous_name": target["current_name"],
        "status": result.status,
        "mulai_jabatan": result.mulai_jabatan,
    }

    update_body = {
        "nama_lengkap": result.nama,
        "gelar_depan": (result.gelar_depan or None),
        "gelar_belakang": (result.gelar_belakang or None),
        "metadata": metadata,
    }

    if dry_run:
        logger.info(
            "  [dry-run] UPDATE pejabat %s: %r → %r (%d verified sources)",
            target["pejabat_id"], target["current_name"], result.nama,
            len(result.verified_sources),
        )
        return

    supabase.table("pejabat").update(update_body).eq("id", target["pejabat_id"]).execute()

    # Also write a fresh jabatan row update if mulai_jabatan was returned
    if result.mulai_jabatan:
        try:
            supabase.table("jabatan").update({
                "mulai_jabatan": result.mulai_jabatan,
            }).eq("id", target["jabatan_id"]).execute()
        except Exception as e:
            logger.warning("    jabatan mulai_jabatan update failed: %s", e)


# ─── Main loop ───────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provinsi", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true",
                        help="Skip targets already in the log (any status)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Stop after N targets attempted (0 = no limit)")
    parser.add_argument("--rate", type=float, default=1.0,
                        help="Seconds to sleep between targets")
    args = parser.parse_args()

    supabase = get_supabase()

    logger.info("Loading targets for %s ...", args.provinsi)
    targets = list_targets(supabase, args.provinsi)
    logger.info("  %d placeholder jabatan rows to backfill", len(targets))
    if not targets:
        return

    log = load_log()
    run_entry = {
        "provinsi": args.provinsi,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": args.dry_run,
        "targets_total": len(targets),
        "verified": 0,
        "rejected": 0,
        "errors": 0,
    }

    attempted = 0
    for t in targets:
        key = target_key(t)
        if args.resume and key in log["results"]:
            prev = log["results"][key]
            prev_status = prev.get("status")
            if prev_status in ("verified", "flagged_unresolved"):
                logger.info("  ↩  skip (%s): %s @ %s",
                            prev_status, t["posisi"], t["wilayah_nama"])
                continue

        if args.limit and attempted >= args.limit:
            logger.info("Reached --limit %d; stopping.", args.limit)
            break
        attempted += 1

        logger.info("[%d/%d] %s @ %s",
                    attempted, len(targets), t["posisi"], t["wilayah_nama"])

        entry: dict = {
            "wilayah_nama": t["wilayah_nama"],
            "posisi": t["posisi"],
            "ran_at": datetime.now(timezone.utc).isoformat(),
            "dry_run": args.dry_run,
        }

        try:
            result = research_pejabat(t["posisi"], t["wilayah_nama"])
        except Exception as e:
            logger.warning("  research_pejabat raised: %s", e)
            entry["status"] = "error"
            entry["error"] = str(e)[:300]
            log["results"][key] = entry
            run_entry["errors"] += 1
            save_log(log)
            time.sleep(args.rate)
            continue

        if result is None or not result.nama:
            # Hard failure: either no clean sources or model couldn't pick a
            # name. Flag for manual triage so the user can review the URLs
            # the agent tried.
            try:
                flag_unresolved(supabase, t, result, args.dry_run)
            except Exception as e:
                logger.warning("  flag_unresolved failed: %s", e)
            entry["status"] = "flagged_unresolved"
            entry["candidates_tried"] = (
                getattr(result, "candidates_tried", []) if result else []
            )
            entry["fetch_failures"] = (
                getattr(result, "fetch_failures", {}) if result else {}
            )
            log["results"][key] = entry
            run_entry["rejected"] += 1
            logger.info("  ⚑ flagged unresolved (no name from sources)")
            save_log(log)
            time.sleep(args.rate)
            continue

        entry["proposed_name"] = result.nama
        entry["claimed_sources"] = [c.to_dict() for c in result.sumber]
        entry["confidence"] = result.confidence

        verified = verify_citations(result)
        if verified is None:
            try:
                flag_unresolved(supabase, t, result, args.dry_run)
            except Exception as e:
                logger.warning("  flag_unresolved failed: %s", e)
            entry["status"] = "flagged_unresolved"
            entry["verified_count"] = len(result.verified_sources)
            entry["candidates_tried"] = result.candidates_tried
            entry["fetch_failures"] = result.fetch_failures
            log["results"][key] = entry
            run_entry["rejected"] += 1
            logger.info(
                "  ⚑ flagged %r — only %d verified sources (need >=2 or 1 .go.id)",
                result.nama, len(result.verified_sources),
            )
            save_log(log)
            time.sleep(args.rate)
            continue

        try:
            apply_research(supabase, t, verified, args.dry_run)
        except Exception as e:
            logger.warning("  apply_research failed: %s", e)
            entry["status"] = "error"
            entry["error"] = f"apply: {e}"
            log["results"][key] = entry
            run_entry["errors"] += 1
            save_log(log)
            time.sleep(args.rate)
            continue

        entry["status"] = "verified"
        entry["verified_sources"] = [c.to_dict() for c in verified.verified_sources]
        log["results"][key] = entry
        run_entry["verified"] += 1
        logger.info(
            "  ✓ %r (%d verified sources, confidence=%.2f)",
            result.nama, len(verified.verified_sources), result.confidence,
        )
        save_log(log)
        time.sleep(args.rate)

    run_entry["finished_at"] = datetime.now(timezone.utc).isoformat()
    log["runs"].append(run_entry)
    save_log(log)

    logger.info("")
    logger.info("Run summary: %d verified, %d rejected, %d errors (of %d attempted)",
                run_entry["verified"], run_entry["rejected"], run_entry["errors"], attempted)
    if args.dry_run:
        logger.info("[dry-run] Nothing was written.")


if __name__ == "__main__":
    main()
