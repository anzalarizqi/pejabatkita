# Session Archive — Peta Pejabat Indonesia

Sessions 1–7 archived from CLAUDE.md to keep the main file lean.

---

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

Final DB: wilayah 514 rows, pejabat+jabatan seeded.

### Session 3 — 2026-05-06 / 2026-05-07 (Cleanup + Phase 7)
- **A1–A3:** investigated + recovered 113 orphan pejabat (all had correct kode_bps, were stale-import artifacts). Added `coerce_date()` for Indonesian date formats. Migration `005_cleanup_orphans.sql` (idempotent). Decision: keep `[LLM Error]`-prefixed pejabat with valid jabatan — filter in web layer.
- **A4 Quality report:** `scripts/report_data_quality.py` → `output/_quality_report.json`. Found 306 placeholder names + 54 `[LLM Error]` + 23 with >2 jabatan.
- **B0 GeoJSON:** `scripts/build_country_geojson.py` → `web/public/indonesia-provinces.json` (~2 MB, 38 features). Source: assai-id/nemesis.
- **B1 Query layer:** `web/lib/queries.ts` — `listProvinceCounts()`, `listPejabat()`. Fixed postgrest `.in()` URL-length bug by fetching jabatan-by-wilayah first.
- **B2 /pejabat browse page:** server+client split, editorial style (Fraunces + DM Mono), confidence bars, pagination via URL `?page=`.
- **B3 IndonesiaMap:** bare d3-geo (rejected react-simple-maps for React 19 conflict). `geoIdentity().reflectY(true)` instead of geoMercator (winding-order/antimeridian issue). ResizeObserver guarded at `size.w >= 200`.
- **B4–B5:** map wired on homepage + /pejabat. Playwright-tested: all 38 provinces, choropleth, pagination.

Final DB: wilayah 552, pejabat 1096, jabatan 1246.

### Session 4 — 2026-05-07 (rescraping investigation, admin/review fix, Phase 8 drill-down map)
- **Rescraping:** `--force` flag added to run_scraper.py. Found scraper bug when Wikipedia "Daftar kabupaten" page missing — added `fetch_canonical_districts()` fallback from Supabase. Net yield over backup: +1 real name. Confirmed LLM/sources are the bottleneck, not orchestration.
- **Admin review fix:** `/admin/review` showed 0 flags — wrong postgrest query (jabatan as FK sibling of pejabat on flags, but flags has no FK to jabatan). Fixed: nested jabatan under pejabat. Now shows 391 pending flags.
- **Phase 8 kab/kota drill-down:** `scripts/build_kabkota_geojson.py` → 38 files in `web/public/kabkota/`. 514/514 features written. 6 unmatched (renamed since source). Three name-normalization bugs fixed (level-homonym collapse, None vs missing key, single-strip regex). `KabKotaMap.tsx` mirrors IndonesiaMap. URL contract: `?provinsi=X&wilayah=Y`.

### Session 5 — 2026-05-07/08 (Phase 9A pilot + polish v1 + v2)
- **Built `scraper/agent.py`:** `research_pejabat()` runs 6 stratified search queries, gathers up to 7 clean pages, hands to LLM. `verify_citations()` re-fetches each URL — trust tiers: `.go.id`/wikipedia/top-news need name only; untrusted need 30-char kutipan. Acceptance: ≥2 verified OR 1 verified `.go.id`.
- **Built `scripts/run_agent_backfill.py`:** resumable, logs to `scripts/agent_backfill_log.json`. Args: `--provinsi`, `--dry-run`, `--resume`, `--limit`, `--rate`.
- **Model:** GLM 4.7 (thinking) → GLM 4.5-air. Thinking models burn token budget on CoT for simple extraction — stick to non-thinking models for agent.
- **Robustness:** JS-comment stripping, `_extract_json()` bracket-count parser, `_looks_like_captcha()`, 20-candidate URL pool, Playwright retry for `.go.id` captchas.
- **Stale-loop bug fixed** in `scraper/pipeline/browser.py`: track loop on browser creation, discard on loop change.
- **Unresolved cases → flags:** `type='agent_unresolved'` inserted into `flags` table for admin triage.
- **Migration `006_flag_type_agent.sql`** — added enum value. `FlagCard.tsx` styled badge.
- **Pilot result (DIY + Kalsel, cumulative v0+v1+v2):** 21 placeholders → 17 verified (81%) + 4 flagged-for-manual. Zero silent failures.

### Session 6 — 2026-05-08 (Phase 10 homepage + 9A scale-out)
- **Phase 10 homepage:** `app/page.tsx` → `HomeShell.tsx` (~1100 lines). `listLeaderRoster()`, `getSiteStats()`. Map colour-mode toggle (4 modes: Tercatat live + 3 mock with `hash01`). Honesty layer: PRATINJAU label, red stamp "DATA ILUSTRASI · Q2 2026", italic legend. Disclaimer modal (localStorage key `pejabatkita_disclaimer_v1`). Leader rail paginated (`PAGE_SIZE=30`).
- **Layout learnings:** use `height: 100vh` not `min-height` for grid rows with overflow. Stats strip above map (not floating overlay). Tercatat colour = `count/expected`, not raw count.
- **Bugs fixed:** leader card link `/pejabat/<id>` → `/<id>`. `suppressHydrationWarning` on 5 form elements.
- **9A scale-out:** ran overnight. DB grew ~763 → 846+ real names (~76.6% coverage).

### Session 7 — 2026-05-08 (post-9A polish: alias map, proxy, profile, partai queued)
- **9A wrapped:** 866/1104 real names = 78.4%. All 38 provinces ≥65%. Snapshot: `output/_province_coverage.json`.
- **Kab/kota alias map** (commit `0976122`): `ALIASES` dict in `build_kabkota_geojson.py`, raw nemesis name → canonical seed name. Rebuilt 5 provinces, 0 missing canonical entries.
- **Middleware → proxy** (commit `d0756a2`): `web/middleware.ts` deleted, `web/proxy.ts` using Next 16 convention.
- **Profile page polish** (commit `e43dd7a`): editorial header, deep-link crumb, PRATINJAU LHKPN+Rekam Bersih sections, partai chip, biodata auto-collapse, `generateMetadata()`, JSON-LD Person schema, 720px mobile breakpoint.
- **Partai prompt queued (uncommitted):** `ResearchResult.partai` field, schema description in agent prompt, `jabatan_patch` dict in `apply_research()`. **Correction:** `partai` lives on `jabatan`, NOT `pejabat` — confirmed `001_schema.sql:51` and `core/schema.py:54`.

DB state at end of Session 7: pejabat 1096, jabatan 1246 (unchanged from S3).

### Session 8 — (Gemini CSV workflow, jabatan cleanup)
Leader names ~95%+ filled via Gemini CSV workflow. Jabatan cleanup done (171 stray rows removed, all provinces ≤100% coverage). Public data priority and map mode policy locked (see main CLAUDE.md).

### Session 9 — 2026-05-27 (Pejabat Pusat complete + feature vision locked)

**Pejabat Pusat (COMPLETE):**
- Built `scripts/scrape_kabinet.py` — fixed two Wikipedia parser bugs (3-cell party-group rows skipped, section end cut off at blank lines between party groups). Added `SUPPLEMENT` hardcoded list of 55+ officials Wikipedia omits.
- DB now has 111 pusat pejabat: Presiden, Wapres, ~34 Menteri, ~34 Wakil Menteri, Seskab, and Kepala Badan. Reflects post-April 2026 reshuffle (Jumhur Hidayat as Menteri LH; Hanif Faisol Nurofiq as Wamenko Pangan). 2 legacy entries remain: Juda Agung, Benjamin Paulus Octavianus.
- `KabinetGrid.tsx` built — featured row (Presiden/Wapres), alphabetical grid, partai + corruption badges. Label bug fixed: "Kementerian" → "Pejabat".
- Daerah/Pusat toggle on homepage wired and working.
- Cleanup pending (Supabase dashboard): Afriansyah Noor has 2 jabatan rows (old typo "Ketenangakerjaan" + correct "Ketenagakerjaan").

**Feature vision decisions (brainstormed this session):**

*Pejabat Pusat UI:* Toggle A — Daerah tab shows existing choropleth map; Pusat tab replaces map with kabinet grid. No URL change, client-side state. `pejabat.level = 'pusat' | 'daerah'`.

*Rekam Jejak Korupsi scope:* Tersangka and above (KPK/Kejagung formal naming). Status tracked: tersangka → terdakwa → terpidana. Schema: separate `kasus` table (kasus_id, pejabat_id, jenis, lembaga, status, tahun, ringkasan, url_sumber). Sources accepted: KPK.go.id, SIPP Pengadilan, Tempo/Kompas/Detik with tipikor keywords. Two-pass enrichment: LLM CSV screen (Y/N/maybe) → verifier on Y/maybe only → import verified rows → flag failures for `/admin/korupsi` review.

*Daily Hotspot (`/pulse`):* Fully separate from Rekam Jejak — not a korupsi intake queue. Democracy pulse map covering ALL controversy types: korupsi, pernyataan kontroversial, keputusan absurd, demonstrasi, kritik publik, dll. Each event = dot on IndonesiaMap per province. Clickable dot → summary + source link. Admin can add manual keyword → LLM searches + adds dots. Sidebar with full archived event feed, searchable. Time filter: 24h / 7 hari / 30 hari / 90 hari / semua (no date slider). Full archive — events stored permanently.

**Priority order confirmed:** Rekam Bersih (real `kasus` data) → Pulse (`/pulse`) → LHKPN → Pendidikan.

Full implementation plans: `docs/superpowers/plans/2026-05-26-plan2-rekam-jejak-korupsi.md` and `docs/superpowers/plans/2026-05-26-plan3-daily-hotspot.md`.
