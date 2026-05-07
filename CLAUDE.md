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

### Session 4 — 2026-05-07 (rescraping investigation, admin/review fix, Phase 8 drill-down map)
- **Rescraping investigation (DI Yogyakarta as test case):** added `--force` flag to `scripts/run_scraper.py` that backs up existing `pejabat.json` to `.bak` before re-running. Surfaced two scraper bugs: (1) Wikipedia's "Daftar kabupaten dan kota di X" page can be missing/unparseable (DIY), in which case the scraper skipped *all* kab/kota; (2) the Supabase wilayah list was never used as a fallback. Fixed by adding `fetch_canonical_districts(kode_provinsi)` to `scraper/core/wilayah.py` and wiring it as the fallback in `scraper/scraper.py`. With the fix, DIY rescrape produced 12 entries (was 0 → 5 originally with placeholder fill). **Net real-name yield: +1 over the backup**, with one corrupted entry (Wakil Bupati Bantul incorrectly inheriting Bupati's name). Restored backup and stopped chasing rescrapes — confirmed the LLM/sources are the bottleneck, not orchestration.
- **Admin review query fix:** smoke-tested the public flag flow end-to-end. Submission and rate-limiting (1/IP/pejabat/24h) work. Found `/admin/review` rendering "0 pending" despite hundreds of flags — `web/app/admin/review/page.tsx` had `jabatan:pejabat_id (...)` as a sibling of `pejabat`, but flags has no FK to jabatan. Postgrest 400'd silently. Nested `jabatan` under `pejabat` and updated `FlagWithPejabat` type + `FlagCard` access path (`flag.jabatan` → `flag.pejabat?.jabatan`). Page now shows 391 pending flags correctly.
- **Phase 8 — kab/kota drill-down map (commit `6030bee`):**
  - `scripts/build_kabkota_geojson.py` pulls per-province kab/kota geometries from `assai-id/nemesis` (`with-districts/*.geojson`) and writes 38 simplified files to `web/public/kabkota/<slug>.json`. Total ~14 MB across 38 files. Result: **514/514 features written**, 6 unmatched canonical entries — all are renamed-since-source cases (Mamuju Utara→Pasangkayu, Toba Samosir→Toba, Maluku Tenggara Barat→Tanimbar, Padangsidimpuan spelling, Mahakam Hulu newly created, Siau Tagulandang Biaro→Sitaro). Fixable later with a per-province alias map; not blocking.
  - Three name-normalization bugs surfaced during the build and got fixed:
    1. Stripping both "Kota " from raw and "Kabupaten " from canonical collapsed kota/kabupaten homonyms in Jawa Tengah (Kota Magelang ≡ Kabupaten Magelang). Fixed by tracking `(level, stem)` pairs and only matching same-level pairs first.
    2. `dict.get("WADMKK", "")` doesn't substitute the default when the key exists with `None` value — crashed Sumatera Utara onward in the original all-rebuild. Switched to `props.get("WADMKK") or ""`.
    3. The prefix-strip regex used `+` quantifier, collapsing "Kabupaten Kota Baru" to "Baru". Switched to single-strip.
  - `web/lib/queries.ts`: added `listWilayahCounts(provinsi)`. `listPejabat` accepts `opts.wilayah` for single-kab/kota narrowing.
  - `web/app/_components/KabKotaMap.tsx`: mirror of `IndonesiaMap`, lazy-fetches `/kabkota/<slug>.json`. Click-same-wilayah-twice deselects.
  - `/pejabat`: when `?provinsi=X` is set, swaps in `KabKotaMap`. Added Kab/Kota dropdown next to the Provinsi dropdown. URL contract: `?provinsi=X&wilayah=Y`.
  - **Smoke-tested via Playwright:** DI Yogyakarta loads 5/5 with correct counts (Bantul 2, GK 1, KP 1, Kota Yogyakarta 1, Sleman 0). Click on Bantul → URL updates → 2/2 cards. Jawa Tengah loads 35/35 with no duplicate-key warnings.

DB state unchanged this session.

## Next Session Should Start With

**Phase 7 + Phase 8 #2 (kab/kota drill-down) DONE.** Phase 8 #3 (public flag flow) was already wired in Phase 4 — smoke-tested end-to-end this session, found and fixed a stale postgrest query in `/admin/review` that was hiding all flags.

Live URLs (when `npm run dev` in `web/`):
- `http://localhost:3001/` — editorial hero + interactive Indonesia map
- `http://localhost:3001/pejabat` — full browse with country map, search, province dropdown, paginated cards
- `http://localhost:3001/pejabat?provinsi=Jawa%20Tengah` — country map → province kab/kota map drill-down (35 entries, choropleth)
- `http://localhost:3001/pejabat?provinsi=Jawa%20Tengah&wilayah=Kabupaten%20Klaten` — narrow to a single kab/kota
- `http://localhost:3001/admin/review` — admin flag triage (works correctly now; was returning 0 due to broken query before)

**Phase 8 progress:**
- ✅ #2 Drill-down kab/kota map (commit `6030bee`)
- ✅ #3 Flag flow (already shipped in Phase 4; smoke-tested + admin/review query bug fixed in commit `3648a71`)
- ⏳ #1 Pejabat profile page polish — verify `/[pejabat-id]/page.tsx` still renders well; not yet revisited
- ⏳ #4 SEO + sitemap + OG cards — not started
- ⏳ #5 `--older-than 30d` rescrape flag — not started; rescraping ROI is bad anyway (see Session 4 note above)

**Late-session bug fix (after browser test):** `listProvinceCounts` was hitting postgrest's default 1000-row cap on the `jabatan` query (we have 1246 rows), silently truncating ~250 entries. Provinces inserted later in the table appeared empty (Sumatera Utara = 1, Sumatera Barat = 0, Sulawesi Utara = 0). Fixed by adding a `fetchAll()` helper that paginates via `.range()`. Real counts now: Sumatera Utara 44, Sumatera Barat 25, Sulawesi Utara 20.

**Late-session filter widening:** original placeholder regex required a qualifier word (`Bupati Kabupaten X`, `Walikota Kota X`, `Gubernur Provinsi X`). Missed cases like `Gubernur Jawa Tengah` where the LLM emitted the title directly followed by the province name. Broadened to `^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S` — no real Indonesian official has a name starting with these titles, so the broad match is safe.

**Open polish items (not blocking):**
- `web/public/indonesia-provinces.json` is ~2 MB. Acceptable for SSR-once load but a TopoJSON conversion would roughly halve it. Worth doing if homepage Lighthouse score matters.
- `web/public/kabkota/*.json` totals ~14 MB across 38 files (largest is Sulawesi Tenggara at ~592KB; Papua Barat Daya 592KB). Each is lazy-loaded so per-page payload is small. TopoJSON would help here too if needed.
- **6 kab/kota polygons render uncoloured** because nemesis uses old/different names: Toba Samosir (now Toba), Padangsidimpuan (canonical: Padang Sidempuan), Mamuju Utara (now Pasangkayu), Maluku Tenggara Barat (now Tanimbar), Siau Tagulandang Biaro (Sitaro abbrev), Mahakam Hulu (newly created, not in nemesis snapshot). Fix: add a `RAW_TO_CANONICAL` per-province alias map in `scripts/build_kabkota_geojson.py`.
- 381 placeholder-name pejabat are filtered from public view but still in DB. Filtered out by `isPlaceholderName()` in `web/lib/queries.ts`. Could hard-delete after the rescrape priority list (below) is acted on.
- Mobile: the maps shrink responsively but aren't optimized for touch on small screens. Dropdowns are the practical fallback. Could add a touch-friendly hover-tooltip handler later.
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

**Remaining Phase 8 directions (pick next):**
1. **Pejabat profile page polish** — `/[pejabat-id]/page.tsx` already exists from Phase 4; verify it renders well with the new data and links from cards.
2. **SEO + sharing** — sitemap.xml of all 1096 pejabat pages, OpenGraph cards per pejabat, structured data.
3. **Per-province alias map** for the 6 unmatched kab/kota polygons (see Open polish items).
4. **`--older-than 30d` rescrape flag** — low priority since Session 4 confirmed rescraping yields ~+1 real name per province at the cost of corrupting some existing entries. Better lever: focus on improving the LLM extraction prompts in `scraper/`.

Stack notes (still valid):
- Check `web/AGENTS.md` — this Next.js (16.2.4 + React 19.2) has breaking changes vs training data. Read relevant docs from `web/node_modules/next/dist/docs/` before writing route/layout code.
- `searchParams` and `params` in pages are `Promise` types — must `await`.
- `web/middleware.ts` is deprecated → "proxy" file convention. Not blocking but worth a chore item.
- Use `frontend-design` skill for any new UI work to keep editorial consistency.
