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

### Session 5 — 2026-05-07 (Phase 9A pilot: LLM-agent backfill on DIY + Kalsel)
- **Built `scraper/agent.py`** — `research_pejabat(jabatan, wilayah)` runs 4 search queries via existing `websearch.py` (DDG/Jina + SearXNG), fetches up to 5 pages prioritizing `.go.id` and Wikipedia, hands them to the LLM with a strict JSON schema (must include verbatim `kutipan` per source). `verify_citations()` re-fetches each cited URL via Jina and checks both the kutipan substring (first 60 chars) and the claimed name appear in the page. Acceptance rule: ≥2 verified sources OR exactly 1 verified `.go.id`. Reject otherwise → leave placeholder.
- **Built `scripts/run_agent_backfill.py`** — resumable, queries placeholder pejabat per-province, calls research+verify, updates pejabat row in-place with verified data. Log at `scripts/agent_backfill_log.json`. Args: `--provinsi`, `--dry-run`, `--resume`, `--limit`, `--rate`.
- **Model trial — GLM 4.7 (thinking) → GLM 4.5-air:**
  - First tried `glm-4.7`. Worked but **2 of 7 DIY targets burned all 4096 max_tokens on internal reasoning** (`reasoning_len=14036`, etc.) and returned empty `content`. Bumped to `max_tokens=4096`, then `360s` HTTP timeout, then realized the issue is the model itself: thinking models reason verbosely regardless of task complexity. The actual job here (extract structured data from already-fetched text) doesn't benefit from CoT — *we did the work in Python before the LLM saw anything*.
  - Switched to `glm-4.5-air` for Kalsel. Kalsel target 7 *also* burned ~12.7k tokens on reasoning despite "air" branding — this provider's "air" variant still emits CoT sometimes. Acceptable failure mode (rejection, not bad data).
- **Added robustness fixes** during the run:
  - Strip JS-style `// comments` and trailing commas from LLM output before `json.loads`.
  - `_extract_json()` walks the output with bracket counting to find the outermost balanced `{...}` block — tolerates leading prose and trailing commentary.
  - Reduced sources fed to LLM from 6 pages × 3500 chars to 5 × 2500 chars to leave more headroom for output tokens.
  - `_name_in_text()` does a windowed match (first two name tokens within 80 chars) so verification doesn't fail just because the source has gelar inserts between first/last names.
- **Pilot results (combined DIY + Kalsel):**

| province | placeholders before | verified this run | placeholders after | yield |
|---|---|---|---|---|
| DI Yogyakarta | 7 | 4 | 3 | 57% |
| Kalimantan Selatan | 14 | 5 | 9 | 36% |
| **total** | **21** | **9** | **12** | **43%** |

  Real-name pejabat: DIY 5→9, Kalsel 13→18. **Zero unverified data inserted** — the citation rule held. Rejection breakdown across 12: ~7 had only 1 non-`.go.id` verified source (would have passed if rule loosened), ~3 had 0 verified (model paraphrased the kutipan or hallucinated the quote), ~2 the model self-rejected ("not enough info as of 2026").
- **Cost:** ~21 calls × ~3 sources × Jina fetch + ~21 LLM calls (mostly `glm-4.5-air`, 2 `glm-4.7`). Negligible — well under $1 of credits.
- **Net judgment:** the `verify_citations()` rigor is the key value-add over the original scraper. Loosening to "1 source any domain" would lift yield to ~76% but reintroduces the hallucination-friendly mode the old scraper had. **Keep the strict rule, improve sourcing instead.**

### Session 5 (continued) — 2026-05-08 Phase 9A polish v1 + v2

**Polish v1 — sourcing + verification + prompt:**
- Replaced 4 generic queries with 6 stratified queries (`site:go.id`, `site:kpu.go.id`, `"dilantik sebagai"`, news-site-or'd, terpilih-2024, plain). Bumped fetched-page cap from 5 → 7.
- `_verify_one()` now branches on trust tier: `.go.id`, `wikipedia.org`, top-tier news (kompas/detik/antara/tempo/cnn/tribun/republika/liputan6) only need the name to appear in fetched text. Untrusted domains still need the kutipan probe (lowered to first 30 chars).
- Removed the "asumsikan aktif per 2026" phrasing from the research prompt — it was inviting model second-guessing. Replaced with "berikan nama yang PALING BARU disebutkan… sumber adalah otoritas, bukan pengetahuanmu."
- **v1 result on previously-rejected 12: 6 verified, lifting cumulative yield from 43% → 71%.**

**Polish v2 — captcha detection + deeper pool + Playwright fallback + flag-for-manual:**
- `_looks_like_captcha()` scans fetched text for Cloudflare/3-letter-403 markers ("performing security verification", "checking your browser", "just a moment", "cloudflare ray id", etc.). Marks affected pages as failed-fetch instead of feeding model a "security verification page" of nonsense.
- `_gather_sources` now expands to 20 candidate URLs (was 5–7), keeps fetching until either 7 *clean* pages or all 20 candidates exhausted. Diagnostics (`candidates_tried`, `fetch_failures`) plumbed through `ResearchResult` for downstream use.
- For `.go.id` URLs that come back as captcha pages, retry once via existing Playwright `browser.navigate()`. **Caveat:** Cloudflare often blocks headless Playwright too. Hit rate observed in pilot ~0% — the gov sites with strict bot fight win every time. Worth keeping for when a site has a soft challenge, but don't expect miracles.
- **Stale-loop bug in `scraper/pipeline/browser.py`:** the lazy-singleton browser was created on a previous `asyncio.run()`'s loop. By the next `asyncio.run()` the underlying transport is dead, but `_browser.is_connected()` still returned True → `Browser.new_page` exploded with `'NoneType' object has no attribute 'send'`. Fixed by tracking the loop the browser was created on and discarding when it changes.
- New script flow: when verification can't be satisfied, insert into the `flags` table (type=`agent_unresolved`, reason includes the URL list and per-URL failure reasons) so it lands on `/admin/review` for human triage. Idempotent — duplicate flags are skipped.
- `--resume` now also skips `flagged_unresolved` log entries (don't re-burn LLM tokens on hopeless cases without intent). Old "rejected_*" entries from earlier runs are retried — they pre-date the new failure modes.
- **Migration `006_flag_type_agent.sql` applied (Session 6, 2026-05-08)** — `agent_unresolved` is now a real `flag_type` enum value. `run_agent_backfill.py` inserts flags with `type='agent_unresolved'` directly; dedup checks the type column instead of a reason-prefix scan. `FlagCard.tsx` has a styled badge for the new type.
- **v2 result on previously-rejected 6: 1 verified (Herman Susilo / Wakil Bupati Barito Kuala) + 4 flagged-for-manual + 0 silent placeholders.**

**Final pilot scoreboard (cumulative across v0 + v1 + v2):**

| | placeholders before | renamed | flagged-for-manual | placeholders left |
|---|---|---|---|---|
| DI Yogyakarta | 7 | 5 | 2 | 2 |
| Kalimantan Selatan | 14 | 12 | 2 | 2 |
| **total** | **21** | **17 (81%)** | **4 (19%)** | 4 (all flagged) |

Zero silent failures. Every original placeholder has either a verified real name or a pending admin-review flag with full URL diagnostics.

DB state: pejabat 1096 → 1096 (renames in-place), real-name count +17, agent_unresolved pending flags = 4.

### Session 6 — 2026-05-08 (Phase 10 homepage shipped + 9A scale-out in parallel)

- **Phase 10 brought forward** ahead of 9B/9C per user call. Built `/preview` as parallel route, iterated through six visual reviews (v1–v6), then promoted to `/` and deleted the preview route. Old editorial homepage preserved in git history.
- **Architecture of the new homepage:** `app/page.tsx` (server, parallel fetch) → `app/_components/HomeShell.tsx` (~1100 lines, all client). New query: `listLeaderRoster()` returns gubernur/bupati/walikota with rank ordering. New: `getSiteStats()` returns `{realPejabat, expectedTotal, coveragePct, provincesCovered, provincesTotal, lastUpdated, kabKotaTotal}`. `ProvinceCount` gained an `expected` field so Tercatat can colour by completion % instead of raw count.
- **Map colour-mode toggle:** four modes — `Tercatat` (live, count/expected → 0–100% gradient) + `Pendidikan` / `LHKPN` / `Rekam Bersih` (mock, deterministic `hash01(name, salt)` with per-mode centres). Mock modes have inverted polarity so red = danger across the board. `IndonesiaMap` got optional `colorBy` and `tooltip` props that default to existing behaviour, so `/pejabat` is unchanged.
- **Honesty layer:** every mock mode triple-tagged — PRATINJAU button label, "DATA ILUSTRASI · Q2 2026" red stamp on map top-left, italic legend caption ("ilustrasi"). User explicitly approved this approach over showing fake numbers without markers.
- **Disclaimer modal** on first visit (localStorage `pejabatkita_disclaimer_v1`). The `Misi Kami` nav item dispatches a window event to reopen it — the disclaimer copy IS the mission statement so reuse > duplicate.
- **Leader rail performance:** initial render was ~34000px scroll height (all ~420 cards). Added client-side pagination (`PAGE_SIZE = 30` + "Tampilkan N lagi" button) → ~13× lighter DOM at first paint.
- **Layout iteration learnings** (worth remembering): (1) `min-height: 100vh` doesn't bound a grid row → child `overflow-y: auto` won't engage; use `height: 100vh` + `minmax(0, 1fr)` + `overflow: hidden`. (2) Floating overlays on the map covered key landmasses (Sumatra/Java) — moved stats into a strip ABOVE the map per user reference (audit-pengadaan.LKPP). (3) Legend was conflating "raw count" with "completion" — switched Tercatat colour to `count / expected` so the legend's 0%–100% lands honestly.
- **One link bug fixed at end of session:** leader cards linked to `/pejabat/<id>` but the profile route is `/[pejabat-id]` at the app root. Matched what `/pejabat/PejabatBrowse.tsx` does, link to `/<id>`.
- **Hydration-mismatch warning** from form-filler browser extensions (`fdprocessedid` injected before hydration) — added `suppressHydrationWarning` to the affected form elements (4 mode tabs, search input, clear button, sort select, Misi-kami button).
- **Migration `006_flag_type_agent.sql`** confirmed applied early in session. `run_agent_backfill.py` switched from prefix-workaround (`type='system'` + `[agent_unresolved]` reason) to native enum (`type='agent_unresolved'`). `FlagCard.tsx` got a styled badge for the new type.
- **9A scale-out ran in background** all session via the documented overnight loop. DB grew from ~763 real names → 846+ (and still climbing at session end). Cakupan crossed 76%.

DB state at session end: 38/38 provinces with at least one real pejabat, 846+ real names of 1104 expected (~76.6%). Backfill log at `scripts/agent_backfill_log.json` is the source of truth for what's been processed.

### Session 7 — 2026-05-08 (post-9A polish: alias map, proxy, profile, partai prompt queued)

- **9A backfill wrapped.** Final scoreboard via `scripts/report_province_coverage.py`: **866 real / 1104 expected = 78.4% coverage, 231 placeholders left, 0 critical/0 warning provinces** (all 38 ≥65%). Lowest tier: Kaltara, Sultra, Jatim at 67%. Highest: Banten, Kepri, Papua Barat at 94%. Snapshot in `output/_province_coverage.json`.
- **Kab/kota alias map** for the 6 nemesis-naming mismatches (commit `0976122`). Added per-province `ALIASES` dict in `scripts/build_kabkota_geojson.py` keyed on raw nemesis WADMKK string → canonical wilayah seed name. Direction is canonical-stable: the wilayah seed is the source of truth, and we re-label polygons to whatever the seed says. Rebuilt 5 affected provinces (Sumut, Sulbar, Maluku, Sulut, Kaltim) with **0 missing canonical entries**. The remaining "no canonical match" warning in Sulut is `Minahasa Selatan/Bolaang Mongondwo Timur` — a joined-polygon glitch in nemesis itself, not in our 6.
- **Middleware → proxy migration** (commit `d0756a2`). `web/middleware.ts` deleted, `web/proxy.ts` created using Next 16 file convention. Function renamed `middleware` → `proxy`. Behavior unchanged: `/admin/*` still gates on `admin_session` cookie. Verified working: dev log shows `proxy.ts: 120ms` on `/admin/review`.
- **Profile page polish** (commit `e43dd7a`).
  - Editorial header matching homepage (◐ brand mark + Beranda/Direktori/Lapor nav). Replaces the old tiny `Beranda > Name` breadcrumb.
  - Crumb under header now deep-links to `/pejabat?provinsi=...`. Province resolved by querying `wilayah` for `level=provinsi, kode_bps=<first-2-digits>` of the active jabatan's wilayah kode_bps.
  - **PRATINJAU sections for LHKPN + Rekam Bersih** with the same `DATA ILUSTRASI · Q2 2026` red-stamp pattern the homepage uses. Mock values are deterministic per pejabat (`hash01(id+':lhkpn')`, `hash01(id+':bersih')`). When 9B/9C ship, swap the hash for real values; markup stays the same.
  - Active jabatan `partai` promoted to a styled chip; biodata section auto-collapses when all four fields are empty (Sri Sultan was the test case).
  - Added dynamic `<title>`/description metadata via `generateMetadata()`, plus JSON-LD `Person` schema in `<script type="application/ld+json">` for SEO.
  - Mobile breakpoint at 720px (single-column biodata, hidden edisi label, condensed nav). Full mobile pass still deferred.
  - Type-checks clean. Smoke-tested via Playwright on Sri Sultan profile.
- **Partai prompt extension queued (uncommitted).** Working tree has the agent extension ready for next session: `scraper/agent.py` `ResearchResult` got a `partai: Optional[str]` field, system prompt now describes partai schema (singkatan resmi, "Independen" untuk perseorangan, null kalau sumber tidak menyebut — JANGAN menebak). `apply_research()` in `run_agent_backfill.py` now writes a unified `jabatan_patch` dict with whichever of `mulai_jabatan` / `partai` the model returned, so partial answers don't blank existing values. **Important schema correction:** `partai` lives on `jabatan` (varchar), NOT on `pejabat` — the prior CLAUDE.md note was wrong. Confirmed via `001_schema.sql:51` and `core/schema.py:54`.
- **Operational note:** 6 of the original 6 unmatched kab/kota polygons now resolve. `web/public/kabkota/sumatera-utara.json` etc. are checked in. No web-side change needed beyond the rebuilt geojsons.

DB state unchanged in this session (no scraper runs).

## Next Session Should Start With

**Where we are:** 9A done at 78.4% coverage. Three small polish items shipped in Session 7 (alias map, middleware→proxy migration, profile page). The partai prompt extension is sitting in the working tree, **uncommitted, untested against a live LLM call**. Bulk-pass design choice still pending.

### Top priority — finish + commit partai backfill, then bulk-pass

The diff currently in the working tree extends the agent to extract `partai` and writes it to `jabatan` when present. To finish the partai feature:

1. **Commit the queued diff** (`scraper/agent.py` + `scripts/run_agent_backfill.py`). Suggested message: "Add partai extraction to research agent + jabatan write".
2. **Smoke test** with one province: `python scripts/run_agent_backfill.py --provinsi "DI Yogyakarta" --limit 2 --dry-run`. Confirm the LLM emits a `partai` field that survives the JSON parser. If the model returns `partai: null` for everyone, loosen the prompt by adding 1-2 examples.
3. **Decide the bulk-pass design**: existing `--resume` SKIPS already-verified targets (line 329 in run_agent_backfill.py — `prev_status in ("verified", "flagged_unresolved")`). To re-visit verified pejabat just to add partai, options:
   - (a) Add a `--retry-partai` flag that overrides the skip when the corresponding `jabatan.partai IS NULL`. Rerun cost: ~860 LLM calls. ~$1-2 of credits, a few hours wall-clock.
   - (b) Write a leaner `run_partai_only_pass.py` that re-uses the already-verified `metadata.sources` URLs from `pejabat`, fetches them via Jina, and asks the LLM only for partai (no name search). Cheaper (~3 fetches/target) and faster, but a separate code path to maintain.
   - (a) is simpler and reuses tested code. Recommended unless we discover the agent yields partai on <50% of new runs, in which case (b) is needed.
4. **UI:** partai chip on the homepage leader rail (currently shows posisi+wilayah only) and a small visual treatment on the profile-page riwayat-jabatan partai column (currently grey "—" when null).

### After partai — Phase 9B (LHKPN)

Schema additions: `pejabat.kekayaan_total`, `pejabat.kekayaan_breakdown` (assets/debts), `pejabat.pendidikan_terakhir`. Source is `elhkpn.kpk.go.id`. Every kepala daerah is legally required to file. Captcha is the hard part — start with Playwright + manual solve, evaluate paid solver (2captcha/capsolver) only if a non-trivial number of high-value targets sit behind hard challenges.

**Pre-9B housekeeping:**
- Drain the `agent_unresolved` flags on `/admin/review`. Either rename manually or close as "no public info available". Important because LHKPN files by name — placeholder rows poison the lookup.
- Decide what to do with the 231 remaining placeholders: rerun a v3 sourcing pass with looser .go.id retry, or hard-delete from `pejabat`. Either is fine; just don't drag them into 9B.
- Take a Supabase snapshot before applying the 9B migrations.

When real LHKPN data lands, swap the homepage `hash01(name, 'lhkpn')` mock for the real per-province aggregation; legend/colour/UI stays the same. Same swap on the profile-page PRATINJAU section — it's wired to `hash01(pejabat.id, ':lhkpn')` exactly so the swap is one-line.

### Phase 9C — Rekam-jejak / corruption history (after 9B)

Search KPK case archive + ICW database + news filtered to `tersangka|vonis|tipikor`. Same agent pattern as 9A but with strict verification (only insert if source is KPK / pengadilan / major news). Defer until 9A+9B are stable.

### Phase 10 follow-ups (deferred)

Full mobile responsiveness pass on homepage + /pejabat (profile page already got a 720px breakpoint in Session 7). OG cards per profile + sitemap.xml of all real-name pejabat pages — wait until partai pass completes so URLs and metadata are stable. None of these are blocking.

### Operational notes

- 9A `--retry-flagged` flag still un-implemented. Probably still not worth it — the 4 cumulative flagged-unresolved cases from the pilot didn't yield even with v2 sourcing, and the bulk run produced its own flag set that hasn't been inspected.
- The map mode toggle's mock data uses `hash01(name, salt)` with per-mode centres. Real LHKPN/integrity data → swap the hash for the real per-province aggregation. Profile page does the same with `hash01(pejabat.id, salt)`.
- The leader rail is paginated client-side (`PAGE_SIZE = 30`). If the roster grows past ~1000 switch to server pagination; for now fine.

---

**Why not just keep rescraping with the old pipeline?** Session 4 confirmed: same Wikipedia, same DDG/Jina queries, same LLM extraction prompt → same blind spots. Session 5 proved the agent path works (43% yield, zero fake data) on DIY + Kalsel.

**Note on the model:** The CLAUDE.md previously named "GLM 4.7 with web search ability" as the agent backbone. In practice we don't use Z.AI's native web_search tool — `scraper/agent.py` does the search in Python (existing `websearch.py` → DDG/Jina + SearXNG) and feeds pre-fetched text to the model. Currently using `glm-4.5-air` per `config.yaml:agent_llm.model` after GLM 4.7's verbose CoT exhausted token budgets in the pilot.

**Why not skip 9A and go straight to LHKPN?** LHKPN forms are filed by name. We need the right name list first, otherwise we'll scrape LHKPN for "Bupati Kabupaten X" placeholder strings and get nothing.

---

## Earlier session context (still useful reference)

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

**Remaining Phase 8 directions (deferred — Phase 9 takes priority):**
1. **SEO + sharing** — sitemap.xml of all 1096 pejabat pages, OpenGraph cards per pejabat, structured data. Do this *after* 9A so the sitemap reflects real data.
2. **Per-province alias map** for the 6 unmatched kab/kota polygons (see Open polish items). 30-min chore, do whenever.
3. **`--older-than 30d` rescrape flag** — abandoned. Phase 9A replaces this entirely.

Stack notes (still valid):
- Check `web/AGENTS.md` — this Next.js (16.2.4 + React 19.2) has breaking changes vs training data. Read relevant docs from `web/node_modules/next/dist/docs/` before writing route/layout code.
- `searchParams` and `params` in pages are `Promise` types — must `await`.
- `web/middleware.ts` is deprecated → "proxy" file convention. Not blocking but worth a chore item.
- Use `frontend-design` skill for any new UI work to keep editorial consistency.
