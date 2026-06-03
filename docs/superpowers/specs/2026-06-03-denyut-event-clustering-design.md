# Denyut Event Clustering — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

The hotspot crawler (`scripts/crawl_hotspot.py`) dedupes only by exact source URL
(`url_sumber`, `crawl_hotspot.py:398-401`). When multiple outlets (Detik, CNN,
Antara, …) publish their own article about the **same real-world event**, each has
a distinct URL → a distinct row in `hotspot_events` → a distinct dot on the Denyut
map. One scandal shows up as several dots.

Side effect: `listProvinceHotspotCounts` (`web/lib/queries.ts:840`) counts **rows**,
so duplicate articles also inflate the province choropleth intensity, not just the
dot count.

## Goal

One dot = one real-world event, with the dot carrying the list of N sources that
reported it ("one event, many sources"). De-inflate the province choropleth as a
consequence.

## Scope guard (locked)

Clustering operates **only on inserted events** — articles that pass the relevance
gate and land in `hotspot_events`. Rejected articles (`skip` / no `judul`) never
enter the grouping logic, in either the crawler or the backfill.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What a dot represents | One event, many sources |
| Same-event detection | Heuristic candidate net + Kimi yes/no confirm |
| Where grouping is stored | `story_id` column on flat `hotspot_events` table |
| Existing duplicates | One-time backfill script |
| Which events are grouped | **Inserted only** — never rejected articles |

## Design

### 1. Schema — migration `015`

Add to `hotspot_events`:

- `story_id uuid` — points to the canonical (first-seen) row of the cluster.
  Indexed.
- **Convention:** the canonical row has `story_id = its own id`. Grouping is a
  uniform `GROUP BY story_id` with no NULL special-casing.

No other column changes. Sources remain individual rows; the cluster is just the
shared `story_id`.

### 2. Crawler — `scripts/crawl_hotspot.py`

After extraction, **for each article that survives the relevance gate** (i.e. the
same set that would be inserted today — never rejected ones):

1. **Candidate query** — fetch existing `hotspot_events` where:
   - `kategori` matches, AND
   - (`pejabat_id` matches **OR** `wilayah_id` matches), AND
   - `crawled_at` within ±5 days.
   - Fall back to `wilayah_id + kategori + window` when `pejabat_id` is null
     (the common case).
   - Cap at ~20 most recent candidates.
2. If candidates exist → **one Kimi call** (batched per crawl run): "Does this
   article describe the same real-world event as any of these? Return the matching
   id, or null." 
3. **Match** → new row inherits the candidate's `story_id`.
   **No match / no candidates** → generate `id` client-side (uuid4) and set
   `story_id = id` in the same insert (the row is its own canonical; no second
   write).

Existing URL dedup (`crawl_hotspot.py:398-401`) stays exactly as-is — clustering is
a second layer on top.

### 3. Read side — `web/lib/queries.ts`

- `listHotspotEvents` collapses rows by `story_id`: pick the canonical row for the
  display fields, aggregate the rest into
  `sources: [{ sumber_nama, url_sumber, crawled_at }]` plus `source_count`.
- `listProvinceHotspotCounts` then counts **distinct stories**, not rows — the
  choropleth de-inflates for free.

### 4. UI

`HotspotModal` / `HotspotSidebar` / `HotspotRail` show **"Diberitakan oleh N
sumber"** with the source list. One dot per story; dot rendering otherwise
unchanged.

### 5. Backfill — `scripts/backfill_story_id.py`

One-time. Walks existing `hotspot_events` rows (inserted events only — that is all
the table contains), applies the same candidate + Kimi-confirm grouping, and
assigns `story_id` to every current row. Supports `--dry-run` (print the proposed
clusters/diff before any write). Clears the existing backlog of duplicate dots.

## Risk / trade-off

The candidate net (±5 days, "same pejabat OR same wilayah", same kategori) is
deliberately loose so Kimi makes the real call. For events with no resolved
`pejabat_id`, this can pull broad candidates — bounded by the ~20-candidate cap and
the Kimi confirm step, which is the accuracy backstop.

## Testing

- **Crawler:** feed a known multi-source event (one OTT from 3 outlets) → assert
  one `story_id` shared across 3 rows.
- **Read:** assert collapsed event count and correct `source_count` / source list.
- **Backfill:** dry-run diff reviewed before writing; re-run is idempotent.
