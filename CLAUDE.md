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

### Deploy `/pulse` — code complete, needs Supabase wiring

Session 2026-05-28: All 8 tasks in `docs/superpowers/plans/2026-05-26-plan3-daily-hotspot.md` implemented. `tsc --noEmit` clean.

**Files created this session:**
- `supabase/functions/crawl-hotspot/{index.ts,llm.ts,resolve.ts}` — edge function (Deno)
- `supabase/migrations/011_pg_cron_hotspot.sql` — daily 09:00 WIB schedule
- `web/app/pulse/{page.tsx,PulseShell.tsx}` — public hotspot page
- `web/app/_components/{HotspotMap,HotspotSidebar,HotspotModal}.tsx`
- `web/app/api/hotspot/route.ts` — client-side filter API
- `web/app/admin/hotspot/page.tsx` — manual crawl trigger
- `web/app/admin/settings/page.tsx` — LLM provider/model/keyword settings
- `web/app/api/admin/{hotspot/crawl,settings}/route.ts`
- HomeShell nav: added `Denyut` link
- AdminLayout NAV: added `Denyut Crawler` + `Pengaturan LLM`

**To deploy (in order):**
1. Apply migration `010_kasus_screened.sql` if not already (kasus_screened table)
2. Backfill `kasus_screened` from existing kasus rows (one-time, see SQL in prior session)
3. Enable `pg_cron` + `pg_net` extensions in Supabase dashboard
4. Set DB GUCs: `ALTER DATABASE postgres SET app.supabase_url = '...'; app.service_role_key = '...';`
5. Set Supabase Secret: `supabase secrets set LLM_API_KEY=<key>`
6. Deploy edge fn: `supabase functions deploy crawl-hotspot`
7. Apply migration `011_pg_cron_hotspot.sql`
8. Test: visit `/admin/hotspot` → click "Jalankan Crawl" → check `hotspot_events` table → visit `/pulse`

**Design trade-off worth noting:**
- Plan called for province dots colored by dominant kategori. I shipped intensity-based red coloring (matches Rekam Bersih aesthetic) with kategori-color badges in sidebar instead. Cleaner visual consistency but loses at-a-glance kategori signal from map. Revisit after first real data lands.
- `HotspotMap.tsx` intercepts clicks via `aria-label` parsing — brittle but avoids modifying `IndonesiaMap`. Consider adding an `onProvinceClick` prop to IndonesiaMap later.

### Rekam Bersih Pipeline — IN PROGRESS

Full pipeline is built and working. Scripts:
- `scripts/screen_kasus_llm.py` — Kimi `$web_search` + Keyword B, auto-inserts to `kasus` table
- `scripts/verify_kasus.py` — Kimi thinking mode, sets `verified=true/false` + `verified_note`

**DB migrations applied:** 007 (kasus table), 008 (kasus RLS anon read), 009 (verified columns)

**Data status as of 2026-05-27:**
- DKI Jakarta screened — 0 confirmed kasus (Rano Karno rejected: only mentioned in Atut/Wawan trial, never formally charged)
- Jawa Tengah screening IN PROGRESS (user running now)
- All other provinces: not yet screened

**Run order for remaining provinces:**
```bash
# Screen all remaining (resume-safe)
python scripts/screen_kasus_llm.py --resume --log

# Verify all unverified kasus rows
python scripts/verify_kasus.py

# Re-run verify if errors
python scripts/verify_kasus.py --all
```

**Profile page:** KasusSection handles 3 states:
1. No kasus → green badge only
2. `verified=false` → green badge + neutral "Pernah disebut" note (combined ringkasan + verified_note)
3. `verified=true/null` → red kasus card with status badge

**Map:** Rekam Bersih is now default mode (leftmost). Filters `verified != false` for province counts.

**Known issue:** Map tooltip still clips for some lower provinces (Sulawesi/Papua area) — `overflow: visible` added to container but may need deeper fix in `IndonesiaMap.tsx`.

### UI Decision — Homepage Left Rail

**Current:** Left sidebar shows a scrollable list of 552 officials (search + sort). User finds this not useful on homepage.

**Proposed:** Replace the left rail with a **live news feed** — latest `hotspot_events` from `/pulse`, shown as a compact ticker/card stack with a CTA button "Lihat semua → /pulse". This makes the homepage more dynamic and gives `/pulse` a natural entry point.

**Needs brainstorming before implementing:**
- How many headlines to show? (3–5 latest)
- Auto-scroll ticker vs static card stack?
- Where does the official directory list go — only on `/pejabat`?
- What shows when `hotspot_events` is empty (before /pulse is built)?

Block: requires `/pulse` + `hotspot_events` data to exist first. Build `/pulse` (Priority 2) before reworking the rail.

### Priority 2 — Daily Hotspot (`/pulse`)

Full plan at `docs/superpowers/plans/2026-05-26-plan3-daily-hotspot.md` — 8 tasks, all code scaffolded.

Summary: Supabase Edge Function `crawl-hotspot` (Deno) calls Jina search daily at 09:00 WIB, LLM extracts judul/ringkasan/kategori/lokasi, inserts to `hotspot_events`. `/pulse` page shows IndonesiaMap dots per province colored by kategori + searchable sidebar + event modal. Admin `/admin/hotspot` for manual crawl trigger.

Route confirmed: `/pulse`.

### Deferred

- Partai enrichment: `/admin/enrichment` → download CSV → process → upload (~1,005 null rows)
- Phase 9C — LHKPN (after Rekam Bersih)
- Phase 9D — Pendidikan (after LHKPN)
- Mobile responsiveness pass + OG cards / sitemap.xml

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth:** `web/proxy.ts` gates `/admin/*` on `admin_session` cookie. (`middleware.ts` was deleted in Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
