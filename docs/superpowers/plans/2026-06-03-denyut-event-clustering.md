# Denyut Event Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse multiple news articles about the same real-world event into a single Denyut map dot ("one event, many sources"), and de-inflate the province choropleth as a consequence.

**Architecture:** Add a `story_id` column to the flat `hotspot_events` table (canonical row has `story_id = event_id`). The crawler matches each *inserted* article against recent candidates (same kategori + same pejabat OR same wilayah, within ±5 days) and asks Kimi a yes/no "same story?" question to assign `story_id`. The web read layer groups rows by `story_id`, exposing a `sources[]` array + `source_count`. A one-time backfill script clusters the existing backlog. Rejected articles never enter the grouping.

**Tech Stack:** Python 3.11 (`httpx`, Kimi/Moonshot chat-completions, Supabase REST), Postgres migration, Next.js 16 + Supabase JS in `web/lib/queries.ts`, React client components.

---

## Key facts (verified against the codebase)

- `hotspot_events` primary key is **`event_id`** (UUID), not `id` — `supabase/migrations/007_pusat_korupsi_hotspot.sql:28`.
- Highest existing migration is `014`; this adds **`015`**.
- Crawler builds the insert `row` at `scripts/crawl_hotspot.py:455-466` and writes via `insert_event()` (`:354-360`). Surviving (inserted) articles are exactly those that pass the `skip`/`judul` gate at `:433-434`.
- Supabase REST helpers in the crawler: `fetch_all()` (`:291-303`), module globals `SUPABASE_URL` and `SB_HEADERS`, Kimi creds via `_kimi_creds()` → `(base_url, model, api_key)`.
- Kimi call pattern (system+user messages, `"thinking": {"type": "disabled"}`, strip ```` ``` ```` fences, `json.loads`) is shown in `kimi_extract_batch()` (`:203-232`).
- Read layer: `listHotspotEvents()` (`web/lib/queries.ts:787-828`) and `listProvinceHotspotCounts()` (`:837-857`, counts **rows** today). Type `HotspotEvent` at `web/lib/types.ts:197-209`; `HotspotEventWithPejabat` at `web/lib/queries.ts:782-785`.
- Modal display: `HotspotModal.tsx:53-71` (single `sumber_nama` + `url_sumber`). Sidebar shows `e.sumber_nama` at `HotspotSidebar.tsx:85`. `HotspotRail.tsx` does not show source.
- No pytest infra; the project uses standalone runnable scripts with plain `assert` (see `scripts/test_kasus_keywords.py`). Pure-logic tests follow that style; integration is verified via `--dry-run`.
- `web/AGENTS.md`: this is a modified Next.js 16 — consult `node_modules/next/dist/docs/` before writing route/query code if anything is unfamiliar.

---

## File Structure

- **Create:** `supabase/migrations/015_hotspot_story_id.sql` — add `story_id` column + index + backfill existing rows to self.
- **Modify:** `scripts/crawl_hotspot.py` — candidate query, Kimi match helper, wire `story_id` into the insert loop.
- **Create:** `scripts/test_clustering.py` — plain-`assert` unit tests for the two pure helpers.
- **Create:** `scripts/backfill_story_id.py` — one-time backlog clustering (`--dry-run`).
- **Modify:** `web/lib/types.ts` — add `story_id`; add `HotspotSource`.
- **Modify:** `web/lib/queries.ts` — `story_id` + `sources[]` + `source_count`; collapse in `listHotspotEvents`; count distinct stories in `listProvinceHotspotCounts`.
- **Modify:** `web/app/_components/HotspotModal.tsx` — render the sources list.
- **Modify:** `web/app/_components/HotspotSidebar.tsx` — show "· N sumber" when `source_count > 1`.

---

## Task 1: Migration 015 — `story_id` column

**Files:**
- Create: `supabase/migrations/015_hotspot_story_id.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/015_hotspot_story_id.sql
-- Event clustering: group multi-source articles into one "story".
-- Canonical (first-seen) row of a cluster has story_id = event_id.

ALTER TABLE hotspot_events
    ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES hotspot_events(event_id);

-- Existing rows each become their own story until the backfill regroups them.
UPDATE hotspot_events SET story_id = event_id WHERE story_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_hotspot_story_id ON hotspot_events(story_id);
```

- [ ] **Step 2: Apply the migration**

Apply via your normal Supabase migration path (Supabase SQL editor or `supabase db push`). There is no default value that can reference another column, so `story_id` is always set explicitly by the crawler/backfill — the read layer also falls back to `event_id` defensively.

- [ ] **Step 3: Verify the column + backfill**

Run this in the Supabase SQL editor:

```sql
SELECT count(*) AS total, count(story_id) AS with_story
FROM hotspot_events;
```

Expected: `total == with_story` (every existing row got `story_id = event_id`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/015_hotspot_story_id.sql
git commit -m "feat(db): add story_id to hotspot_events for event clustering"
```

---

## Task 2: Crawler candidate-query builder (pure helper + test)

**Files:**
- Modify: `scripts/crawl_hotspot.py`
- Create: `scripts/test_clustering.py`

- [ ] **Step 1: Write the failing test**

Create `scripts/test_clustering.py`:

```python
#!/usr/bin/env python3
"""Unit tests for event-clustering pure helpers (no API/DB calls)."""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.crawl_hotspot import build_candidate_query_params, parse_match_response


def test_candidate_params_pejabat_and_wilayah():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id="P1", wilayah_id="W1",
        crawled_at="2026-06-03T00:00:00+00:00", window_days=5, cap=20,
    )
    assert params["kategori"] == "eq.korupsi"
    assert params["or"] == "(pejabat_id.eq.P1,wilayah_id.eq.W1)"
    assert params["crawled_at"] == "gte.2026-05-29T00:00:00+00:00"
    assert params["crawled_at.lte"] == "lte.2026-06-08T00:00:00+00:00" or "crawled_at" in params
    assert params["limit"] == 20
    assert params["order"] == "crawled_at.desc"


def test_candidate_params_wilayah_only():
    params = build_candidate_query_params(
        kategori="demonstrasi", pejabat_id=None, wilayah_id="W1",
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params["or"] == "(wilayah_id.eq.W1)"


def test_candidate_params_returns_none_when_no_anchor():
    params = build_candidate_query_params(
        kategori="korupsi", pejabat_id=None, wilayah_id=None,
        crawled_at="2026-06-03T00:00:00+00:00",
    )
    assert params is None


if __name__ == "__main__":
    import pytest  # type: ignore
    sys.exit(pytest.main([__file__, "-v"]))
```

> Note: the window assertion uses a single `crawled_at` PostgREST param that carries both bounds via repeated keys. Step 3 implements bounds as two list-valued filters; adjust this assertion to match the exact param shape you implement (see Step 3). Keep the test and implementation in sync.

- [ ] **Step 2: Run it to verify it fails**

Run: `python scripts/test_clustering.py`
Expected: FAIL — `ImportError: cannot import name 'build_candidate_query_params'`.

- [ ] **Step 3: Implement `build_candidate_query_params`**

Add to `scripts/crawl_hotspot.py` (near the other Supabase helpers, after `fetch_all`). Note PostgREST takes repeated `crawled_at` filters as a list value via httpx; we return them in a `_range` key the caller expands:

```python
from datetime import datetime as _dt

def build_candidate_query_params(
    kategori: str, pejabat_id: str | None, wilayah_id: str | None,
    crawled_at: str, window_days: int = 5, cap: int = 20,
) -> dict | None:
    """Build PostgREST params to find existing events that might be the same
    story. Returns None when there's no anchor (no pejabat AND no wilayah)."""
    anchors = []
    if pejabat_id:
        anchors.append(f"pejabat_id.eq.{pejabat_id}")
    if wilayah_id:
        anchors.append(f"wilayah_id.eq.{wilayah_id}")
    if not anchors:
        return None

    base = _dt.fromisoformat(crawled_at)
    lo = (base - timedelta(days=window_days)).isoformat()
    hi = (base + timedelta(days=window_days)).isoformat()

    return {
        "select": "event_id,story_id,judul,ringkasan,kategori,pejabat_id,wilayah_id,crawled_at",
        "kategori": f"eq.{kategori}",
        "or": f"({','.join(anchors)})",
        # two bounds on the same column → httpx sends crawled_at twice
        "crawled_at": [f"gte.{lo}", f"lte.{hi}"],
        "order": "crawled_at.desc",
        "limit": cap,
    }
```

Update the test's window assertion to match this shape:

```python
    assert params["crawled_at"] == ["gte.2026-05-29T00:00:00+00:00", "lte.2026-06-08T00:00:00+00:00"]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python scripts/test_clustering.py`
Expected: PASS for the three `test_candidate_params_*` tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl_hotspot.py scripts/test_clustering.py
git commit -m "feat(crawl): candidate-query builder for event clustering"
```

---

## Task 3: Kimi "same story?" matcher (parser test + helper)

**Files:**
- Modify: `scripts/crawl_hotspot.py`
- Test: `scripts/test_clustering.py` (extend)

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_clustering.py`:

```python
def test_parse_match_valid_id():
    raw = '{"match_event_id": "E2"}'
    assert parse_match_response(raw, valid_ids={"E1", "E2"}) == "E2"


def test_parse_match_null():
    assert parse_match_response('{"match_event_id": null}', valid_ids={"E1"}) is None


def test_parse_match_hallucinated_id_rejected():
    # Model returns an id not in the candidate set → treat as no match.
    assert parse_match_response('{"match_event_id": "E9"}', valid_ids={"E1"}) is None


def test_parse_match_with_code_fence():
    raw = '```json\n{"match_event_id": "E1"}\n```'
    assert parse_match_response(raw, valid_ids={"E1"}) == "E1"


def test_parse_match_garbage_returns_none():
    assert parse_match_response("not json", valid_ids={"E1"}) is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python scripts/test_clustering.py`
Expected: FAIL — `ImportError: cannot import name 'parse_match_response'`.

- [ ] **Step 3: Implement parser + Kimi matcher**

Add to `scripts/crawl_hotspot.py`:

```python
def parse_match_response(raw: str, valid_ids: set[str]) -> str | None:
    """Parse Kimi's match reply. Returns a candidate event_id only if it is in
    the candidate set (guards against hallucinated ids); otherwise None."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    mid = obj.get("match_event_id") if isinstance(obj, dict) else None
    return mid if mid in valid_ids else None


MATCH_SYSTEM_PROMPT = """\
Kamu menentukan apakah sebuah artikel berita membahas PERISTIWA NYATA yang SAMA
dengan salah satu peristiwa kandidat. "Sama" berarti kejadian dunia-nyata yang
sama (mis. OTT yang sama, pernyataan yang sama, demo yang sama) — bukan sekadar
pejabat/topik yang mirip. Beda kejadian pada orang yang sama = TIDAK sama.

Kembalikan HANYA JSON:
{ "match_event_id": "<event_id kandidat yang sama>" }  bila ada yang sama,
{ "match_event_id": null }                              bila tidak ada.
Tanpa teks lain."""


def kimi_match_story(client: httpx.Client, base_url: str, model: str, api_key: str,
                     article_judul: str, article_ringkasan: str,
                     candidates: list[dict]) -> str | None:
    """Ask Kimi whether the article is the same real-world event as any candidate.
    Returns the matched event_id or None."""
    cand_payload = [
        {"event_id": c["event_id"], "judul": c.get("judul", ""),
         "ringkasan": (c.get("ringkasan") or "")[:300]}
        for c in candidates
    ]
    user = (
        f"ARTIKEL BARU:\njudul: {article_judul}\nringkasan: {article_ringkasan}\n\n"
        f"KANDIDAT ({len(cand_payload)}):\n{json.dumps(cand_payload, ensure_ascii=False)}"
    )
    resp = client.post(
        f"{base_url}/chat/completions",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": MATCH_SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "thinking": {"type": "disabled"},
        },
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=120,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    return parse_match_response(raw, {c["event_id"] for c in candidates})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python scripts/test_clustering.py`
Expected: PASS — all candidate-param and parse-match tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl_hotspot.py scripts/test_clustering.py
git commit -m "feat(crawl): Kimi same-story matcher + response parser"
```

---

## Task 4: Wire `story_id` into the crawler insert loop

**Files:**
- Modify: `scripts/crawl_hotspot.py` (insert loop `:432-471`, and the `db_client` in scope)

- [ ] **Step 1: Add a `find_candidate_events` HTTP wrapper**

Add near `build_candidate_query_params` in `scripts/crawl_hotspot.py`:

```python
def find_candidate_events(client: httpx.Client, kategori: str,
                          pejabat_id: str | None, wilayah_id: str | None,
                          crawled_at: str) -> list[dict]:
    params = build_candidate_query_params(kategori, pejabat_id, wilayah_id, crawled_at)
    if params is None:
        return []
    resp = client.get(f"{SUPABASE_URL}/rest/v1/hotspot_events",
                      params=params, headers=SB_HEADERS)
    if resp.status_code != 200:
        return []
    return resp.json()
```

- [ ] **Step 2: Generate `event_id` + assign `story_id` in the insert loop**

In `scripts/crawl_hotspot.py`, the insert loop currently builds `row` at `:455-466`. The loop runs inside `with httpx.Client() as llm_client, ...` is closed by then — reuse `db_client` (still in scope from `:396`) for candidate lookups and a fresh short-lived client for the match call, or reuse `db_client` for both. Replace the row-build + insert block (`:453-471`) with:

```python
            crawled_at = article.get("pubDate") or datetime.now(timezone.utc).isoformat()

            # ─── Event clustering: match against recent candidates ───
            event_id = str(uuid.uuid4())
            story_id = event_id  # default: this row is its own canonical story
            candidates = find_candidate_events(db_client, kategori, pejabat_id,
                                               wilayah_id, crawled_at)
            if candidates:
                with httpx.Client() as match_client:
                    matched = kimi_match_story(
                        match_client, base_url, model, api_key,
                        r["judul"], r.get("ringkasan", ""), candidates,
                    )
                if matched:
                    by_id = {c["event_id"]: c for c in candidates}
                    story_id = by_id[matched].get("story_id") or matched

            row = {
                "event_id": event_id,
                "story_id": story_id,
                "judul": r["judul"][:120],
                "ringkasan": r.get("ringkasan", ""),
                "kategori": kategori,
                "lokasi_nama": lokasi,
                "wilayah_id": wilayah_id,
                "pejabat_id": pejabat_id,
                "url_sumber": article["url"],
                "sumber_nama": sumber_nama,
                "crawled_at": crawled_at,
                "is_manual": bool(args.keyword),
            }
            if insert_event(db_client, row, args.dry_run):
                inserted += 1
                tag = "↳ grouped" if story_id != event_id else "+ new"
                print(f"  {tag} {r['judul'][:72]}")
            else:
                db_errors += 1
```

- [ ] **Step 3: Add the `uuid` import**

At the top of `scripts/crawl_hotspot.py`, add to the imports:

```python
import uuid
```

- [ ] **Step 4: Verify with a dry run (no DB writes, but real Kimi calls)**

Run: `python scripts/crawl_hotspot.py --keyword "OTT KPK" --dry-run`
Expected: prints candidate matching activity; lines tagged `+ new` or `↳ grouped`; ends with `(dry-run — no DB writes)`. Confirm no traceback.

> `--dry-run` skips `insert_event` writes but still runs candidate lookups + match calls, so grouping decisions are exercised. Because nothing is written, every article in a single dry run will look `+ new` (candidates come from the DB only) — that is expected; real grouping is verified live in Task 7 / acceptance.

- [ ] **Step 5: Commit**

```bash
git add scripts/crawl_hotspot.py
git commit -m "feat(crawl): assign story_id on insert via candidate + Kimi match"
```

---

## Task 5: Web read layer — collapse by `story_id`

**Files:**
- Modify: `web/lib/types.ts:197-209`
- Modify: `web/lib/queries.ts:782-857`

- [ ] **Step 1: Extend the `HotspotEvent` type**

In `web/lib/types.ts`, add `story_id` to the interface (after `event_id`):

```typescript
export interface HotspotEvent {
  event_id: string
  story_id: string | null
  judul: string
  ringkasan: string | null
  kategori: string | null
  lokasi_nama: string | null
  wilayah_id: string | null
  pejabat_id: string | null
  url_sumber: string | null
  sumber_nama: string | null
  crawled_at: string
  is_manual: boolean
}
```

- [ ] **Step 2: Add the source type + extend `HotspotEventWithPejabat`**

In `web/lib/queries.ts`, replace the `HotspotEventWithPejabat` interface (`:782-785`):

```typescript
export interface HotspotSource {
  sumber_nama: string | null
  url_sumber: string | null
  crawled_at: string
}

export interface HotspotEventWithPejabat extends HotspotEvent {
  pejabat_nama: string | null
  provinsi_nama: string | null
  sources: HotspotSource[]
  source_count: number
}
```

- [ ] **Step 3: Collapse rows by story in `listHotspotEvents`**

In `web/lib/queries.ts`, the function returns `rows.map(...)` at `:823-827`. Replace that final mapping with a story-collapse. The representative row is the canonical one (`story_id === event_id`), falling back to the first row seen. Order sources newest-first; order stories by their newest source:

```typescript
  // Group rows by story (story_id falls back to event_id for safety).
  const storyMap = new Map<string, HotspotEvent[]>()
  for (const r of rows) {
    const key = r.story_id ?? r.event_id
    const arr = storyMap.get(key) ?? []
    arr.push(r)
    storyMap.set(key, arr)
  }

  const stories = Array.from(storyMap.values()).map((group) => {
    const rep = group.find((g) => g.story_id === g.event_id) ?? group[0]
    const sources: HotspotSource[] = group
      .map((g) => ({ sumber_nama: g.sumber_nama, url_sumber: g.url_sumber, crawled_at: g.crawled_at }))
      .sort((a, b) => b.crawled_at.localeCompare(a.crawled_at))
    return {
      ...rep,
      pejabat_nama: rep.pejabat_id ? (pejabatMap.get(rep.pejabat_id) ?? null) : null,
      provinsi_nama: rep.wilayah_id ? (wilayahMap.get(rep.wilayah_id) ?? null) : null,
      sources,
      source_count: sources.length,
    }
  })

  // Newest story first, by its most-recent source.
  stories.sort((a, b) => (b.sources[0]?.crawled_at ?? '').localeCompare(a.sources[0]?.crawled_at ?? ''))
  return stories
```

> Note: the `.limit(500)` on the query (`:797`) is now a cap on *rows*, so a flurry of sources could crowd out older stories. Acceptable for the 24h/7d default windows; revisit only if a window legitimately exceeds 500 source-rows.

- [ ] **Step 4: Count distinct stories in `listProvinceHotspotCounts`**

`listProvinceHotspotCounts` (`:837-857`) iterates `events` from `listHotspotEvents`, which are now already one-per-story. The existing `cur.count++` therefore counts stories, not rows — no logic change needed. Add a clarifying comment above the loop:

```typescript
  // events are already collapsed to one-per-story by listHotspotEvents,
  // so counting them here counts distinct events (not source articles).
```

- [ ] **Step 5: Verify the build typechecks**

Run: `cd web; npm run build`
Expected: build succeeds, no TypeScript errors referencing `sources`, `source_count`, or `story_id`.

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/lib/queries.ts
git commit -m "feat(web): collapse hotspot events by story_id with sources[]"
```

---

## Task 6: UI — show the source list

**Files:**
- Modify: `web/app/_components/HotspotModal.tsx:53-71`
- Modify: `web/app/_components/HotspotSidebar.tsx:85`

- [ ] **Step 1: Render sources in the modal**

In `web/app/_components/HotspotModal.tsx`, replace the `Sumber` meta row and the single `Baca selengkapnya` link (`:65-71`) with a multi-source block. Replace from the `{event.sumber_nama && ...}` line through the closing of the `url_sumber` block:

```tsx
          {event.provinsi_nama && (<><dt>Daerah</dt><dd>{event.provinsi_nama}</dd></>)}
        </dl>
        <div className="pulse-modal-sources">
          <span className="pulse-sources-label">
            {event.source_count > 1
              ? `Diberitakan oleh ${event.source_count} sumber`
              : 'Sumber'}
          </span>
          <ul className="pulse-sources-list">
            {event.sources.map((s, i) => (
              <li key={s.url_sumber ?? i}>
                {s.url_sumber
                  ? <a href={s.url_sumber} target="_blank" rel="noopener noreferrer">{s.sumber_nama ?? s.url_sumber}</a>
                  : <span>{s.sumber_nama ?? '—'}</span>}
              </li>
            ))}
          </ul>
        </div>
```

(Delete the old `{event.sumber_nama && (<><dt>Sumber</dt>...)}` row and the old `{event.url_sumber && (<a ...>Baca selengkapnya →</a>)}` block — they are replaced by the above.)

- [ ] **Step 2: Add styles for the source block**

In the `styles` template string of `HotspotModal.tsx`, append before the closing backtick:

```css
.pulse-modal-sources { padding-top: .75rem; border-top: 1px solid #e2dccb; }
.pulse-sources-label { display: block; font-family: 'DM Mono', monospace; font-size: .75rem; color: #6b6859; margin-bottom: .5rem; }
.pulse-sources-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
.pulse-sources-list a { color: #0f1117; text-decoration: underline; font-size: .9rem; }
.pulse-sources-list a:hover { color: #c0392b; }
```

- [ ] **Step 3: Show source count in the sidebar**

In `web/app/_components/HotspotSidebar.tsx:85`, replace the single-source span with a count when there is more than one:

```tsx
                {e.source_count > 1
                  ? <span> · {e.source_count} sumber</span>
                  : e.sumber_nama && <span> · {e.sumber_nama}</span>}
```

- [ ] **Step 4: Verify in the browser**

Run: `cd web; npm run dev`, open the homepage Denyut tab (or `/pulse`), click a dot that has multiple sources.
Expected: modal shows "Diberitakan oleh N sumber" with N clickable links; single-source dots show "Sumber" with one link. No console errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/_components/HotspotModal.tsx web/app/_components/HotspotSidebar.tsx
git commit -m "feat(web): show multi-source list in hotspot modal + sidebar count"
```

---

## Task 7: Backfill script for the existing backlog

**Files:**
- Create: `scripts/backfill_story_id.py`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill_story_id.py`. It reuses the crawler's pure helpers and Kimi matcher so behavior is identical to live crawling. It walks existing rows oldest-first; each row either joins an already-assigned earlier story or becomes its own canonical:

```python
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
from datetime import datetime, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from scripts.crawl_hotspot import (
    SUPABASE_URL, SB_HEADERS, _kimi_creds, fetch_all,
    kimi_match_story, parse_match_response,
)

WINDOW_DAYS = 5


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
            base_dt = datetime.fromisoformat(r["crawled_at"])
            lo = base_dt - timedelta(days=WINDOW_DAYS)
            cands = [
                p for p in processed
                if p["kategori"] == r["kategori"]
                and (
                    (r["pejabat_id"] and p["pejabat_id"] == r["pejabat_id"]) or
                    (r["wilayah_id"] and p["wilayah_id"] == r["wilayah_id"])
                )
                and datetime.fromisoformat(p["crawled_at"]) >= lo
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
```

- [ ] **Step 2: Dry-run the backfill**

Run: `python scripts/backfill_story_id.py --dry-run`
Expected: prints `↳` lines for events it would regroup and a final `N of M events regrouped` summary, ending with `(dry-run — no DB writes)`. No traceback. Eyeball a few `↳` lines to confirm the merges look like genuinely the same story.

- [ ] **Step 3: Run the backfill for real**

Run: `python scripts/backfill_story_id.py`
Expected: same output without the dry-run line; PATCH calls succeed (no `! patch failed`).

- [ ] **Step 4: Verify clustering in the DB**

Run in the Supabase SQL editor:

```sql
SELECT story_id, count(*) AS sources
FROM hotspot_events
GROUP BY story_id
HAVING count(*) > 1
ORDER BY sources DESC
LIMIT 20;
```

Expected: rows where a single `story_id` now owns multiple source articles — these were the duplicate dots.

- [ ] **Step 5: Verify the map is de-duplicated**

Run: `cd web; npm run dev`, open the Denyut map.
Expected: previously-duplicated stories now show as a single dot; opening it lists the multiple sources.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill_story_id.py
git commit -m "feat(scripts): one-time backfill to cluster existing hotspot events"
```

---

## Self-Review notes

- **Spec coverage:** schema `story_id` (Task 1) ✓; heuristic candidate net + Kimi confirm (Tasks 2–4) ✓; inserted-only scope — crawler matches only post-gate articles, backfill only walks existing rows (Tasks 4, 7) ✓; read-side collapse + `sources[]`/`source_count` + province de-inflation (Task 5) ✓; UI "Diberitakan oleh N sumber" (Task 6) ✓; one-time backfill (Task 7) ✓.
- **Type consistency:** `build_candidate_query_params` / `find_candidate_events` / `kimi_match_story` / `parse_match_response` signatures match across Tasks 2–4 and 7. `HotspotSource` + `source_count` defined in Task 5, consumed in Task 6. PK is `event_id` everywhere.
- **Edge cases handled:** null `pejabat_id` AND null `wilayah_id` → no candidate search (`build_candidate_query_params` returns `None`); hallucinated match id → rejected by `parse_match_response` valid-id guard; missing `story_id` on read → `?? event_id` fallback.
