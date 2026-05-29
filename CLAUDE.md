# Peta Pejabat Indonesia

CLI scraper + web app aggregating public data on Indonesian government officials (Presiden → Bupati/Walikota) with confidence scoring.

Session history: see `session_archive.md`.

## Tech Stack

- **Language:** Python 3.11+
- **HTTP:** `httpx` (async)
- **Browser automation:** `playwright` (Python) — for JS-heavy Pemda sites
- **LLM abstraction:** custom thin wrapper (not litellm — keep it simple, no extra deps)
- **Config:** `config.yaml` + `.env` for API keys
- **CLI:** `argparse`
- **Output:** JSON files per provinsi
- **Web:** Next.js 16.2.4 + React 19.2, Supabase (postgres + postgrest)

## Key Architecture Rules

- **Schema is non-negotiable** — every output must match the JSON schema in the PRD exactly
- **Multi-LLM with fallback** — providers read from `config.yaml`, active provider switchable via `ACTIVE_LLM_PROVIDER` env var
- **Web search stack:** DDG via Jina reader (primary) → SearXNG public instance (fallback) — both free, no auth
- **Scraping pipeline order:** Wikipedia API → web search + Jina read-url → browser (Playwright) for JS-heavy sites
- **Agent model:** use non-thinking models (currently `glm-4.5-air`) — thinking models burn token budget on simple extraction
- **`partai` lives on `jabatan`**, NOT `pejabat` — confirmed `001_schema.sql:51`, `core/schema.py:54`
- **No mocking** — tests hit real APIs unless explicitly offline mode
- **No hardcoded API keys** — all via env vars referenced in config.yaml

## Reference Project

`C:\Users\anzal\PROJECT\semarproject` — personal AI agent (Node.js/SEMAR). Key files to reference:
- `tools/search.js` — DDG via Jina + SearXNG search implementation
- `tools/browser.js` — Playwright lazy browser pattern
- `tools/security.js` — SSRF protection patterns

Port logic to Python, do not call SEMAR as subprocess.

## Project Structure

```
pejabatkita/
├── scraper/
│   ├── agent.py         ← LLM-agent backfill (research_pejabat + verify_citations)
│   ├── core/            ← schema.py, confidence.py, wilayah.py, output.py
│   └── pipeline/        ← wikipedia.py, websearch.py, browser.py, llm.py
├── scripts/
│   ├── run_scraper.py          ← CLI entrypoint (--resume, --force, --provinsi)
│   ├── run_agent_backfill.py   ← resumable backfill (--provinsi, --dry-run, --resume)
│   ├── import_to_supabase.py   ← DB import
│   ├── agent_backfill_log.json ← source of truth for backfill progress
│   └── report_province_coverage.py
├── verifier/verifier.py
├── web/                 ← Next.js app
│   ├── app/             ← routes: / (homepage), /pejabat, /[pejabat-id], /admin
│   ├── lib/queries.ts   ← listProvinceCounts, listPejabat, listLeaderRoster, getSiteStats
│   └── public/          ← indonesia-provinces.json, kabkota/*.json
└── output/              ← per-province pejabat.json (gitignored)
```

## Commands

**Scraping**
```bash
python scripts/run_scraper.py --resume                        # all provinces, resume
python scripts/run_scraper.py --provinsi "Aceh"               # single province
python scripts/run_scraper.py --resume --skip-verify          # scrape only, no verifier
python scripts/run_scraper.py --verify-only                   # verify all scraped, skip scraping
python scripts/run_scraper.py --provinsi "DI Yogyakarta" --force  # re-scrape, backup existing
```

**Agent backfill**
```bash
python scripts/run_agent_backfill.py --provinsi "Aceh" --dry-run
python scripts/run_agent_backfill.py --resume                 # skip already-processed
```

**Verifier (manual)**
```bash
python verifier/verifier.py --file output/aceh/pejabat.json --only-needs-review
```

**Import to Supabase**
```bash
python scripts/import_to_supabase.py --dry-run
python scripts/import_to_supabase.py --provinsi "DKI Jakarta"
```

**Status + coverage**
```bash
cat scripts/run_log.json
python scripts/report_province_coverage.py   # → output/_province_coverage.json
```

**LLM provider override**
```bash
ACTIVE_LLM_PROVIDER=zhipu python scripts/run_scraper.py --resume
```

## Public Data Priority (locked)

After all leader names are filled, public-facing enrichment follows this fixed order:

1. **Rekam Jejak Korupsi** — corruption history first. Source: KPK case archive, ICW, news filtered to `tersangka|vonis|tipikor`. Strict verification (KPK / pengadilan / major news only).
2. **LHKPN** — asset declarations second. Every kepala daerah is legally required to file. Source: `elhkpn.kpk.go.id`. Enables the LHKPN map mode.
3. **Pendidikan** — education background third. Source: Wikipedia, official bio, KPU calon data.

## Map Mode Policy (locked)

**"Terlengkap" (coverage %) is admin-only** — belongs on `/admin/dashboard`, not the public homepage. Public map has exactly three modes (redder = worse):

| Mode | What red means |
|---|---|
| **Rekam Bersih** | More leaders with corruption history |
| **LHKPN** | Lower % of leaders who filed asset declarations |
| **Pendidikan** | Lower average education level of leaders |

All modes: inverted polarity (red = bad), consistent legend. `hash01` mock stays until real data lands — swap is one-line per mode in `HomeShell.tsx` and profile page.

## Next Session Should Start With

### Current state (end of 2026-05-29)

Denyut Demokrasi pipeline + homepage redesign **shipped** (see archive Session 9 for the journey). What runs:

**Daily crawl — local Python, not Supabase:**
```bash
python scripts/crawl_hotspot.py            # 8 RSS feeds, last 24h, watchdog gate, ~10–15 events kept
python scripts/crawl_hotspot.py --keyword "OTT KPK Pati"   # keyword path via Kimi $web_search
python scripts/crawl_hotspot.py --dry-run  # preview, no DB write
```

Supabase edge function `crawl-hotspot` and `pg_cron` were abandoned (150s timeout, 503 crashes). Code kept in repo for reference. Run the unschedule when convenient:
```sql
SELECT cron.unschedule('crawl-hotspot-daily');
```

**Homepage now has 5 mode tabs:** Rekam Bersih (default), **Denyut** (live dots), Tercatat, Pendidikan (mock), LHKPN (mock). Right rail is HotspotRail (officials list moved fully to `/pejabat`).

**Admin runbook at `/admin/runbook`** — copy-on-click CLI reference for all 3 scripts.

### What shipped this session (2026-05-29)

**Web (Next.js):**
- Homepage coverage stat fixed: `getSiteStats` now counts distinct pejabat (not jabatan rows) and excludes `nasional`-level jabatan — was showing 109.9%
- Rekam Bersih map → percentage coloring, normalized to observed max ratio, full 0→red scale
- Denyut dots capped at 10 per province (DKI was overcrowded)
- Sidebar card click → switches map to Denyut tab (`onActivate` prop on `HotspotRail`)
- Homepage FeatureStrip removed (was overlapping map, showed stale mock data)
- `/pejabat` IndonesiaMap + KabKotaMap color by kasus %, not completeness. New `listWilayahKasusCounts(provinsi)` query
- Pejabat cards: `● KASUS` badge for pejabat with confirmed kasus. `has_kasus` joined server-side per page

**Scripts:**
- `screen_kasus_llm.py --report`: per-province screening progress table with progress bar
- `screen_kasus_llm.py`: error no longer written to `kasus_screened` — `--resume` retries timeouts automatically
- GLM screener attempt abandoned: all 3 approaches (builtin search_pro_jina, Zhipu REST API, DDG+GLM) hit 429s or hallucinated. Kimi at ~$0.005/pejabat is the only reliable option.
- Deleted 6 duplicate kasus rows from double-running screener without `--resume`

**Kasus screening progress (end of session):**
```
✓ Aceh          48/48   9 found
✓ Jawa Barat    56/56   7 found
  Jawa Tengah   15/72  12 found  ← incomplete, needs full run
✓ Jawa Timur    78/78  16 found
✓ Kalimantan Tengah 30/30  2 found
✓ Kalimantan Timur  22/22  1 found
✓ Sulawesi Tengah   28/28  7 found
✓ Sumatera Selatan  36/36  4 found
✓ Sumatera Utara    68/68 23 found
  DKI Jakarta    1/14   1 found  ← incomplete
  (28 provinces at 0%)
```

### Next Session Should Start With

**1. Complete Rekam Bersih screening:**
```bash
# Check progress
python scripts/screen_kasus_llm.py --report

# Complete Jawa Tengah (was 15/72 last session)
python scripts/screen_kasus_llm.py --provinsi "Jawa Tengah" --resume --log

# Complete DKI Jakarta
python scripts/screen_kasus_llm.py --provinsi "DKI Jakarta" --resume --log

# All remaining provinces (resumable)
python scripts/screen_kasus_llm.py --resume --log

# After all provinces screened, verify found cases
python scripts/verify_kasus.py
```

**2. Map zoom/pan** — pending. Add D3 zoom to `IndonesiaMap` + `KabKotaMap` with recenter button. Approach: apply `d3-zoom` to SVG `<g>` element, expose +/- and recenter buttons.

**3. DPR / DPD / MPR officials backlog.**
- `pejabat.level = 'pusat'` currently only ~111 kabinet ministers
- Need: 580 DPR anggota + ~136 DPD anggota + MPR pimpinan
- Source: `dpr.go.id/anggota` (best), KPU calon data, Wikipedia

**4. Optional: cleanup 8 Denyut events with null `wilayah_id`:**
```sql
UPDATE hotspot_events
SET wilayah_id = (SELECT id FROM wilayah WHERE nama = 'DKI Jakarta'),
    lokasi_nama = COALESCE(lokasi_nama, 'DKI Jakarta')
WHERE wilayah_id IS NULL;
```

### Known follow-ups / non-blockers

- **Google News URLs** (Kompas/Tirto/Kumparan via `news.google.com/rss/articles/CBMi…`). Clicks redirect through Google to real article. Acceptable; `sumber_nama` parsed from title suffix so cards show "kompas.com" correctly. Resolving real URL would require an extra HEAD request per article.
- **Daily schedule for `crawl_hotspot.py`** — can be wired to Windows Task Scheduler. No code work, just config.
- **Mobile responsiveness pass** on `/pulse` and homepage (rail stacks below map at <920px but not deeply tested).
- **Pejabat name resolution** is fuzzy `ilike '%name%'` — occasionally hits wrong person if 2 officials share a first name. Out of scope unless it causes a visible bug.

### Deferred (still)

- Partai enrichment: `/admin/enrichment` CSV flow (~1,005 null rows)
- LHKPN scraper (Phase 9C, after Rekam Bersih runs are done nationwide)
- Pendidikan enrichment (Phase 9D)
- OG cards / sitemap.xml

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth:** `web/proxy.ts` gates `/admin/*` on `admin_session` cookie. (`middleware.ts` was deleted in Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
