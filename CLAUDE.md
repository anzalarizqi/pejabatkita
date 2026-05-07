# Peta Pejabat Indonesia

CLI scraper tool that aggregates public data on Indonesian government officials (Presiden → Bupati/Walikota) from multiple sources into structured JSON with confidence scoring.

## Tech Stack

- **Language:** Python 3.11+
- **HTTP:** `httpx` (async)
- **Browser automation:** `playwright` (Python) — for JS-heavy Pemda sites
- **LLM abstraction:** custom thin wrapper (not litellm — keep it simple, no extra deps)
- **Config:** `config.yaml` + `.env` for API keys
- **CLI:** `argparse`
- **Output:** JSON files per provinsi

## Key Architecture Rules

- **Schema is non-negotiable** — every output must match the JSON schema in the PRD exactly
- **Multi-LLM with fallback** — providers read from `config.yaml`, active provider switchable via `ACTIVE_LLM_PROVIDER` env var
- **Web search stack** (ported from SEMAR): DDG via Jina reader (primary) → SearXNG public instance (fallback) — both free, no auth
- **Scraping pipeline order:** Wikipedia API → web search + Jina read-url → browser (Playwright) for JS-heavy sites
- **No mocking** — tests hit real APIs unless explicitly offline mode
- **No hardcoded API keys** — all via env vars referenced in config.yaml

## Reference Project

`C:\Users\anzal\PROJECT\semarproject` — personal AI agent (Node.js/SEMAR). Key files to reference:
- `tools/search.js` — DDG via Jina + SearXNG search implementation
- `tools/browser.js` — Playwright lazy browser pattern
- `tools/security.js` — SSRF protection patterns

Port logic to Python, do not call SEMAR as subprocess.

## Project Structure (target)

```
pejabatkita/
├── scraper.py           ← CLI entrypoint
├── config.yaml          ← LLM providers + scraper config
├── .env.example         ← API key template
├── pipeline/
│   ├── wikipedia.py     ← Wikipedia API integration
│   ├── websearch.py     ← DDG/Jina + SearXNG (ported from SEMAR)
│   ├── browser.py       ← Playwright page extraction
│   └── llm.py           ← Multi-provider LLM abstraction
├── core/
│   ├── schema.py        ← Pydantic models matching PRD JSON schema
│   ├── confidence.py    ← Confidence score calculation
│   └── output.py        ← JSON file writer
└── output/              ← Generated per-run output (gitignored)
```

## Commands

**Scraping**
```bash
python scripts/run_scraper.py --resume                        # all provinces, resume
python scripts/run_scraper.py --provinsi "Aceh"               # single province
python scripts/run_scraper.py --resume --skip-verify          # scrape only, no verifier
python scripts/run_scraper.py --verify-only                   # verify all scraped provinces, skip scraping
```

**Verifier (manual)**
```bash
python verifier/verifier.py --file output/aceh/pejabat.json
python verifier/verifier.py --file output/aceh/pejabat.json --only-needs-review
```

**Import to Supabase**
```bash
python scripts/import_to_supabase.py --dry-run
python scripts/import_to_supabase.py
python scripts/import_to_supabase.py --provinsi "DKI Jakarta"
```

**Check status**
```bash
cat scripts/run_log.json
```

**LLM provider override**
```bash
ACTIVE_LLM_PROVIDER=zhipu python scripts/run_scraper.py --resume
```

## Session Log

### Session 1 — 2026-04-26
- Reviewed and refined PRD (`PRD-peta-pejabat-indonesia.md`)
- Identified SEMAR project tools reusable for this project (search, browser, LLM config pattern)
- Updated PRD: fixed model version, added Groq/Moonshot providers, added web search stack spec, added `ACTIVE_LLM_PROVIDER` env override
- Created `CLAUDE.md`

### Session 2 — 2026-04-30 / 2026-05-01 (Phase 6 fixes + import)
- Audited Phase 6 scraper output: found 3 root-cause bugs
  1. `_matches` substring fallback in `scraper/core/wilayah.py` made "Riau" match "Kepulauan Riau" and "Papua" match every Papua split → wrong province kode lookup
  2. Supabase `wilayah` seed was corrupted: old `002_wilayah_kabkota.py` used the same loose Wikipedia regex as the scraper, dumping foreign cities into many provinces (DIY had 0, Kepri had 44 incl. all-Sumatra cities, Bengkulu/Babel/Banten/Jateng overcounted)
  3. `fetch_province_wilayah` keyed its in-memory map by name only, collapsing `Kabupaten Serang` and `Kota Serang` (and other homonyms) — fixed to `(level, name)` tuple key
- Replaced seeder with canonical-snapshot pipeline (`build_wilayah_snapshot.py` pulls from emsifa/api-wilayah-indonesia for the 34 pre-split provinces + hardcoded post-2022 Papua family). `wilayah_kabkota.json` snapshot is in repo (514 rows). Re-seeded Supabase: deleted 676 bad rows, inserted 514 correct rows.
- Wrote `scripts/reconcile_output.py` to compare existing scrape output against canonical and drop phantoms / remap kode_wilayah / report gaps. Avoided full re-scrape — saved ~78% of work.
- Wrote `scripts/run_gap_fill.py` resumable orchestrator for missing kab/kota only. Filled ~248 gaps.
- Cleaned up 16 garbage entries (6 empty-`jabatan` legacy + 10 gap-fill artifacts).
- Re-verified affected provinces with `verifier/verifier.py --only-needs-review`.
- Found schema bug at import: `import_to_supabase.py` upserts on `(pejabat_id, wilayah_id, posisi)` but no UNIQUE constraint existed → all jabatan upserts failed. Added migration `004_jabatan_unique.sql`. Re-imported successfully.
- Final DB state captured in "Next Session Should Start With" block.

### Session 3 — 2026-05-06 / 2026-05-07 (Cleanup + Phase 7)
- **A1 Investigate orphans:** wrote `scripts/investigate_orphans.py`. Result: all 113 orphans recoverable via clean `kode_bps` match. The original "wilayah not found" failures were stale-import artifacts from before the canonical wilayah re-seed in Session 2 — codes were always correct, but the wilayah table was wrong at import time.
- **A2 Recover orphans:** wrote `scripts/recover_orphans.py`. Inserted 118 jabatan rows. Hit `invalid input syntax for type date` errors from raw scraper outputs like `"2025"` and `"20 Februari 2025"` — added `coerce_date()` helper that maps bare year → `YYYY-01-01` and Indonesian month names → ISO. Orphans → 0.
- **A3 Cleanup migration:** added `005_cleanup_orphans.sql` (idempotent `DELETE pejabat WHERE id NOT IN (SELECT pejabat_id FROM jabatan)`). Currently a no-op; kept for safety on future imports. **Decision:** preserve `[LLM Error]`-prefixed pejabat that now have valid jabatan — they hold "this seat exists" data; the web layer filters them from public view instead.
- **A4 Quality report:** wrote `scripts/report_data_quality.py` → `output/_quality_report.json`. Found 306 placeholder names + 54 `[LLM Error]` + 23 with >2 jabatan (importer dedup-by-name collapse). Read-only report for human review.
- **B0 Country GeoJSON:** found `assai-id/nemesis` repo has all 38 post-2022-split provinces (incl. Papua Pegunungan / Selatan / Tengah / Barat Daya). Wrote `scripts/build_country_geojson.py` — downloads 38 province-only files, normalizes name-map (`Daerah_Istimewa_Yogyakarta` → `DI Yogyakarta` etc.), runs through `npx mapshaper` for topology-preserving simplification → `web/public/indonesia-provinces.json` (~2 MB, 38 features).
- **B1 Query layer:** `web/lib/queries.ts` — `listProvinceCounts()` for choropleth, `listPejabat({provinsi, search, page})` for cards. Placeholder filter built-in (chained `.not('nama_lengkap', 'ilike', pat)`). **Bug found:** original implementation passed hundreds of pejabat IDs to postgrest `.in()`, exceeding URL length limit and silently returning empty. Refactored: when province filter active, fetch jabatan by wilayah_filter_ids first (small set), get distinct pejabat_ids, then load pejabat — pagination via postgrest `.range()` instead of in-memory slicing.
- **B2 /pejabat browse page:** server component (`page.tsx`) reads `searchParams: Promise<...>` (this Next.js requires await), delegates to client `PejabatBrowse.tsx` for search/filter/pagination interactivity. Editorial style matches homepage (Fraunces + DM Mono + paper/ink/accent palette). Card grid with confidence bars, primary-jabatan ranking (Gubernur > Bupati/Walikota > wakil), pagination via URL `?page=`.
- **B3 IndonesiaMap component:** initially tried `react-simple-maps` — abandoned due to React 19 peer-dep conflicts. Switched to bare `d3-geo`. **Two bugs encountered:** (1) ResizeObserver firing with width=0 produced NaN coords → guarded with `size.w >= 200` check; (2) `geoMercator()` triggered spherical antimeridian clipping that filled the whole canvas with one giant red rectangle (winding-order issue from mapshaper simplification). Switched to `geoIdentity().reflectY(true)` which treats coords as Cartesian — no clipping, no winding sensitivity. For Indonesia's latitude range the visual difference is negligible.
- **B4 Wired both pages:** map on homepage as hero centerpiece (replacing admin CTA), and on `/pejabat` as primary filter (selected province highlighted with thicker stroke). Click on map navigates to `/pejabat?provinsi=X` (or back to `/pejabat` if same province clicked again to deselect).
- **B5 Browser-tested via Playwright:** map renders all 38 provinces with choropleth. Click on Jawa Tengah → URL updates → 24/55 cards on page 1. Pagination 1/3 → 2/3 (Menampilkan 25–48). All confidence bars rendering. Footer attribution to assai-id/nemesis present.

Final DB state at end of session:
- `wilayah`: 552 (unchanged)
- `pejabat`: 1096 (0 orphans, was 113)
- `jabatan`: 1246 (was 1128, +118 from orphan recovery)

## Next Session Should Start With

**Phase 7 (Public Web App) is DONE** — `/` (homepage with map) and `/pejabat` (browse + filter + map) both work end-to-end against live Supabase data.

Live URLs (when `npm run dev` in `web/`):
- `http://localhost:3001/` — editorial hero + interactive Indonesia map (555 real pejabat across 38 provinces, choropleth coloring)
- `http://localhost:3001/pejabat` — full browse with map filter, search by name, province dropdown, paginated cards
- `http://localhost:3001/pejabat?provinsi=Jawa%20Tengah` — pre-filtered URL (deep-linkable)

**Late-session bug fix (after browser test):** `listProvinceCounts` was hitting postgrest's default 1000-row cap on the `jabatan` query (we have 1246 rows), silently truncating ~250 entries. Provinces inserted later in the table appeared empty (Sumatera Utara = 1, Sumatera Barat = 0, Sulawesi Utara = 0). Fixed by adding a `fetchAll()` helper that paginates via `.range()`. Real counts now: Sumatera Utara 44, Sumatera Barat 25, Sulawesi Utara 20.

**Late-session filter widening:** original placeholder regex required a qualifier word (`Bupati Kabupaten X`, `Walikota Kota X`, `Gubernur Provinsi X`). Missed cases like `Gubernur Jawa Tengah` where the LLM emitted the title directly followed by the province name. Broadened to `^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S` — no real Indonesian official has a name starting with these titles, so the broad match is safe.

**Open polish items (not blocking):**
- `web/public/indonesia-provinces.json` is ~2 MB. Acceptable for SSR-once load but a TopoJSON conversion would roughly halve it. Worth doing if homepage Lighthouse score matters.
- 381 placeholder-name pejabat are filtered from public view but still in DB. Filtered out by `isPlaceholderName()` in `web/lib/queries.ts`. Could hard-delete after the rescrape priority list (below) is acted on.
- Mobile: the map shrinks responsively but isn't optimized for touch on small screens. Province dropdown is the practical fallback. Could add a touch-friendly hover-tooltip handler later.
- `react-simple-maps` was rejected for React 19 peer-dep issues. If we ever need pan/zoom or markers, evaluate `react-leaflet` (heavier but battle-tested) or just bolt minimal pan/zoom onto the existing d3-geo SVG.

**Rescrape priority list (`scripts/report_province_coverage.py` → `output/_province_coverage.json`):**

Coverage = `real_pejabat / expected_min` where expected_min = 2 (gubernur+wakil) + 2 × kab/kota count. **Critical** (<50%) provinces almost certainly have most seats unrecovered. **Warning** (50-65%) have around half the wakil seats missing.

| Tier | Province | Real / Expected | Placeholders | Coverage |
|------|----------|-----------------|--------------|----------|
| 🔴 critical | DI Yogyakarta | 5 / 12 | 7 | 42% |
| 🔴 critical | Kalimantan Selatan | 13 / 28 | 14 | 46% |
| 🟡 warning | Bengkulu | 11 / 22 | 11 | 50% |
| 🟡 warning | DKI Jakarta | 7 / 14 | 7 | 50% |
| 🟡 warning | Kalimantan Utara | 6 / 12 | 5 | 50% |
| 🟡 warning | Maluku Utara | 11 / 22 | 9 | 50% |
| 🟡 warning | Papua Tengah | 9 / 18 | 7 | 50% |
| 🟡 warning | Papua Barat Daya | 7 / 14 | 4 | 50% |
| 🟡 warning | Sulawesi Selatan | 27 / 50 | 23 | 54% |
| 🟡 warning | Aceh | 26 / 48 | 20 | 54% |
| 🟡 warning | Maluku | 13 / 24 | 12 | 54% |
| 🟡 warning | Nusa Tenggara Barat | 12 / 22 | 10 | 54% |
| 🟡 warning | Kalimantan Barat | 17 / 30 | 16 | 57% |
| 🟡 warning | Jambi | 14 / 24 | 9 | 58% |
| 🟡 warning | Banten | 11 / 18 | 7 | 61% |
| 🟡 warning | Sumatera Barat | 25 / 40 | 9 | 62% |
| 🟡 warning | Sulawesi Utara | 20 / 32 | 8 | 62% |
| 🟡 warning | Papua Barat | 10 / 16 | 10 | 62% |
| 🟡 warning | Nusa Tenggara Timur | 29 / 46 | 17 | 63% |
| 🟡 warning | Kalimantan Tengah | 19 / 30 | 11 | 63% |
| 🟡 warning | Sulawesi Tengah | 18 / 28 | 7 | 64% |
| 🟡 warning | Sumatera Utara | 44 / 68 | 25 | 65% |

22 provinces are below the 65% coverage threshold. The remaining 16 (Sulawesi Tenggara through Kepulauan Riau) are at 67-94% — acceptable; defer.

**To re-scrape (when ready):**
```bash
# Critical only (2 provinces, ~30 minutes)
python scripts/run_scraper.py --provinsi "DI Yogyakarta"
python scripts/run_scraper.py --provinsi "Kalimantan Selatan"
# Then re-import:
python scripts/import_to_supabase.py --provinsi "DI Yogyakarta"
python scripts/import_to_supabase.py --provinsi "Kalimantan Selatan"
# Re-verify everything via:
python scripts/report_province_coverage.py
```

Or batch all 22 below 65% — leave overnight and run `report_province_coverage.py` next morning to confirm coverage rose.

**Possible Phase 8 directions (pick later):**
1. **Pejabat profile page polish** — `/[pejabat-id]/page.tsx` already exists from Phase 4; verify it renders well with the new data and links from cards.
2. **Drill-down to kab/kota map** — nemesis repo has `seed/geo/02-provinces/with-districts/*.geojson`. Clicking a province on the map could open a province view with kab/kota choropleth (would need `/pejabat?provinsi=X&wilayah=Y` filter support in queries.ts).
3. **Public flag-this-pejabat flow** — `flags` table + `LaporkanModal.tsx` already exist; wire end-to-end with reCAPTCHA-equivalent rate limiting on the `/api/flags` route.
4. **SEO + sharing** — sitemap.xml of all 1096 pejabat pages, OpenGraph cards per pejabat, structured data.
5. **Re-scrape stale provinces** — `scrape_runs` shows when each province was last touched. Add `--older-than 30d` flag to `run_scraper.py` for periodic refresh.

Stack notes (still valid):
- Check `web/AGENTS.md` — this Next.js (16.2.4 + React 19.2) has breaking changes vs training data. Read relevant docs from `web/node_modules/next/dist/docs/` before writing route/layout code.
- `searchParams` and `params` in pages are `Promise` types — must `await`.
- `web/middleware.ts` is deprecated → "proxy" file convention. Not blocking but worth a chore item.
- Use `frontend-design` skill for any new UI work to keep editorial consistency.
