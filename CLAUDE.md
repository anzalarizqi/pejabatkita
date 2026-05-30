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

### Current state (end of 2026-05-30)

See session archive for Sessions 1–9 history. Current working state:

**Daily crawl — local Python, not Supabase:**
```bash
python scripts/crawl_hotspot.py            # 8 RSS feeds, last 24h, watchdog gate
python scripts/crawl_hotspot.py --keyword "OTT KPK Pati"
python scripts/crawl_hotspot.py --dry-run
```

**Homepage: 5 mode tabs** — Rekam Bersih (default), Denyut, Tercatat, Pendidikan (mock), LHKPN (mock).

**Admin panel:** `/admin/rekam-bersih` — CSV export (by province) + import workflow for manual kasus screening via Gemini/Claude web. Exact same DB writes as `screen_kasus_llm.py`.

**Rekam Bersih map tooltip** (3 states):
- `"3 / 56 pejabat memiliki catatan korupsi (5%)"` — has verified/pending cases
- `"56 pejabat · bersih ✓"` — fully screened, 0 cases
- `"15 / 56 pejabat terskrining"` — partially screened

### What shipped this session (2026-05-30)

**`/admin/rekam-bersih`** — new admin page (spec + plan + 4-task subagent build):
- Export: province select → downloads `kasus_export_<provinsi>.csv` of unscreened pejabat
- Import: upload filled CSV → writes kasus (verified=NULL) + kasus_screened, identical to Kimi screener
- Canned Gemini/Claude prompt (copy-on-click)
- Tested end-to-end via MCP Playwright

**Map tooltip** — Rekam Bersih mode now shows `"N / total memiliki catatan korupsi (X%)"` or `"bersih ✓"` for fully-clean screened provinces. `listProvinceKasusCounts` switched to service role to read `kasus_screened` past RLS.

**Verifier fixes (`verify_kasus.py`):**
- Injects `today = date.today().isoformat()` into system prompt → prevents rejecting recent real OTTs as "belum terjadi"
- Now passes `jabatan + provinsi` in prompt → prevents wrong-person disambiguation (fixed Suroto kades vs Wakil Bupati)
- Drops `gelar_belakang` from search name (SE., M.AP breaks web queries)

**Manual kasus inserts (from Claude/Gemini CSV):**
- Abdul Azis (Bupati Kolaka Timur) — inserted
- Ardito Wijaya (Bupati Lampung Tengah) — inserted
- Abdul Wahid (Gubernur Riau) — inserted (was on wrong pejabat_id initially, fixed)
- 8 others already in DB from Kimi screener

**Screening progress (end of session):**
```
✓ 20 provinces at 100% — Aceh, Banten, DI Yogyakarta, DKI Jakarta, Gorontalo,
  Jawa Barat, Jawa Tengah, Jawa Timur, Kalimantan Tengah, Kalimantan Timur,
  Maluku, Papua, Sulawesi Tengah, Sumatera Selatan, Sumatera Utara + more
  Lampung 1/32, Sulawesi Tenggara 1/36 (Kimi partial runs)
  16 provinces still at 0%
  Total: 528/1104 screened (48%) — 16 verified=True, 81 verified=False
```

### Next Session Should Start With

**1. Re-verify suspicious rejects** — 81 kasus are `verified=False`, many rejected before today's verifier fixes (date, gelar, jabatan context). Run:
```bash
python scripts/verify_kasus.py --report-suspicious-rejects
# Reset and re-run for rows flagged as affirmative-but-rejected:
UPDATE kasus SET verified=null, verified_at=null, verified_note=null WHERE kasus_id='...';
python scripts/verify_kasus.py
```

**2. Complete Rekam Bersih screening for remaining 16 provinces:**
```bash
python scripts/screen_kasus_llm.py --report
python scripts/screen_kasus_llm.py --resume --log   # picks up unscreened provinces
python scripts/verify_kasus.py                       # verify new finds
```
Or use `/admin/rekam-bersih` web UI for free (Gemini/Claude) → import CSV.

**3. Map zoom/pan** — ✅ BUILT & merged to `main` (2026-05-30), but NOT yet live on public pages.
- `d3-zoom` wrapper `useMapZoom.ts` (imperative transform, scaleExtent [1,8], reduced-motion) + `MapZoomControls.tsx` (editorial +/−/⌖). Both maps gained a `zoomable` prop, **default false** — homepage/`/pejabat` render unchanged.
- Test sandbox: `/admin/map-lab` (gated). Verified via headless browser: wheel/button/recenter zoom + drag-pan work on both maps; live pages have 0 controls.
- **TO GO LIVE (the remaining step):** add `zoomable` to `<IndonesiaMap>` in `web/app/_components/HomeShell.tsx` and to `<KabKotaMap>`/`<IndonesiaMap>` in `web/app/pejabat/PejabatBrowse.tsx` (~lines 104/113). Eyeball drag feel + dot scaling + mobile first. Spec: `docs/superpowers/specs/2026-05-30-map-zoom-pan-design.md`.

**4. Brainstorm: how to collect DPR / DPD / MPR member list.**
- `pejabat.level = 'pusat'` currently ~111 kabinet ministers only
- Need: 580 DPR anggota + ~136 DPD anggota + MPR pimpinan
- **Start with brainstorming session** — learn from what worked:
  - "Isi nama kosong": export CSV → Gemini/Claude web fills names → import back (free, no API cost)
  - "Catatan korupsi": same CSV pattern + Kimi screener for verification
  - Apply the same export→AI fill→import loop for DPR/DPD/MPR collection
- Key questions to brainstorm: what's the seed data (KPU calon 2024? dpr.go.id scrape? Wikipedia?), how to structure the CSV for AI to fill, what verification step is needed

**5. Optional: cleanup 8 Denyut events with null `wilayah_id`:**
```sql
UPDATE hotspot_events
SET wilayah_id = (SELECT id FROM wilayah WHERE nama = 'DKI Jakarta'),
    lokasi_nama = COALESCE(lokasi_nama, 'DKI Jakarta')
WHERE wilayah_id IS NULL;
```

### Known follow-ups / non-blockers

- **Google News URLs** (via `news.google.com/rss/articles/CBMi…`) redirect to real article. Acceptable for now.
- **Daily schedule for `crawl_hotspot.py`** — Windows Task Scheduler, no code needed.
- **Mobile responsiveness** on `/pulse` and homepage not deeply tested.
- **Bulk name matcher** in manual inserts hits 1000-row PostgREST limit — use paginated fetch if re-running.

### Deferred (still)

- Partai enrichment: `/admin/enrichment` CSV flow (~1,005 null rows)
- LHKPN scraper (Phase 9C)
- Pendidikan enrichment (Phase 9D)
- OG cards / sitemap.xml

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth:** `web/proxy.ts` gates `/admin/*` on `admin_session` cookie. (`middleware.ts` was deleted in Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
