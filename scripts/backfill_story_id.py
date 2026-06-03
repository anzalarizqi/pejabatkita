#!/usr/bin/env python3
"""One-time backfill: cluster existing hotspot_events into stories.

Walks every event oldest-first. For each event, looks for an EARLIER event
(already processed this run) that is the same real-world story (same kategori +
same pejabat OR same wilayah, within +/-5 days) and confirms with Kimi. If
matched, the event inherits that story's story_id; otherwise it stays its own
canonical (story_id = event_id, already set by migration 015).

Only operates on inserted events (everything in hotspot_events is inserted).

Usage:
    python scripts/backfill_story_id.py --dry-run
    python scripts/backfill_story_id.py
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.crawl_hotspot import (
    SUPABASE_URL, SB_HEADERS, _kimi_creds, fetch_all,
    kimi_match_story,
)

WINDOW_DAYS = 5


def _parse_dt(s: str) -> datetime:
    """Parse an ISO timestamp, treating a naive value as UTC so all comparisons
    are tz-consistent (PostgREST normally returns +00:00-aware strings)."""
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="No DB writes")
    args = ap.parse_args()

    base_url, model, api_key = _kimi_creds()
    if not api_key:
        print("ERROR: MOONSHOT_API_KEY not set"); sys.exit(1)

    with httpx.Client(timeout=30) as db, httpx.Client(timeout=120) as llm:
        rows = fetch_all(
            db, "hotspot_events",
            "event_id,story_id,judul,ringkasan,kategori,pejabat_id,wilayah_id,crawled_at",
        )
        rows.sort(key=lambda r: r["crawled_at"])  # oldest first
        print(f"Loaded {len(rows)} events")

        processed: list[dict] = []  # events with a finalized story_id this run
        regrouped = 0

        for r in rows:
            base_dt = _parse_dt(r["crawled_at"])
            lo = base_dt - timedelta(days=WINDOW_DAYS)
            # O(N²) scan over processed rows — fine for ~1k events; LLM latency dominates.
            cands = [
                p for p in processed
                if p["kategori"] == r["kategori"]
                and (
                    (r["pejabat_id"] and p["pejabat_id"] == r["pejabat_id"]) or
                    (r["wilayah_id"] and p["wilayah_id"] == r["wilayah_id"])
                )
                and _parse_dt(p["crawled_at"]) >= lo
            ][-20:]

            story_id = r["event_id"]  # default canonical
            if cands:
                matched = kimi_match_story(
                    llm, base_url, model, api_key,
                    r["judul"], r.get("ringkasan") or "", cands,
                )
                if matched:
                    by_id = {c["event_id"]: c for c in cands}
                    story_id = by_id[matched]["story_id"]

            if story_id != r["event_id"]:
                regrouped += 1
                print(f"  ↳ {r['judul'][:64]}  →  story {story_id[:8]}")
                if not args.dry_run:
                    resp = db.patch(
                        f"{SUPABASE_URL}/rest/v1/hotspot_events",
                        params={"event_id": f"eq.{r['event_id']}"},
                        json={"story_id": story_id},
                        headers={**SB_HEADERS, "Prefer": "return=minimal"},
                    )
                    if resp.status_code not in (200, 204):
                        print(f"  ! patch failed {resp.status_code}: {resp.text[:160]}", file=sys.stderr)

            r["story_id"] = story_id
            processed.append(r)

        print(f"\nDone. {regrouped} of {len(rows)} events regrouped into earlier stories.")
        if args.dry_run:
            print("(dry-run — no DB writes)")


if __name__ == "__main__":
    main()
