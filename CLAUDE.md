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

## Next Session Should Start With

**Phase 6 (Data Population) is DONE** — all 38 provinces scraped, verified, and imported to Supabase.

Final DB state:
- `wilayah`: 552 rows (38 provinces + 514 kab/kota — re-seeded from canonical BPS data)
- `pejabat`: 1096 rows (~381 with placeholder names where LLM couldn't extract a real name)
- `jabatan`: 1128 rows (constraint `jabatan_pejabat_wilayah_posisi_uniq` added in migration 004)
- `scrape_runs`: 76 rows (38 × 2 import runs)
- 113 orphan pejabat (no jabatan link) — caused by 180 "wilayah not found" errors during import

**Two cleanup tasks before Phase 7:**

1. **Orphan cleanup** — write a script (or one-shot SQL) to delete pejabat with no jabatan link:
   ```sql
   DELETE FROM pejabat WHERE id NOT IN (SELECT DISTINCT pejabat_id FROM jabatan);
   ```
   Optional: investigate the 180 "wilayah not found" cases first to see if any are recoverable (entries where `kode_wilayah` mismatches canonical but `wilayah` name does match — could be re-mapped via name lookup before deletion).

2. **Suspicious-pejabat report** — write `scripts/report_data_quality.py` listing:
   - Pejabat with placeholder names (starts with "Bupati ", "Walikota ", "[LLM Error]", etc.)
   - Pejabat with >2 jabatan (importer dedup by name collapses different real people into one row — e.g. "Muchendi Mahzareki" got 11 jabatan)
   - Output as JSON or CSV for manual review and DB cleanup.

**Then Phase 7 (Web App): Public browse + interactive map**

Plan:
1. `/pejabat` page — public browse with province filter + name search, card grid
2. Interactive Indonesia map (clickable choropleth) on homepage or `/pejabat` — use `react-simple-maps` + Indonesia GeoJSON, clicking a province navigates to filtered `/pejabat?provinsi=...`
3. Map is the standout feature; list/search is the fallback for mobile

Stack notes:
- Check `web/AGENTS.md` — this Next.js version may have breaking changes vs training data
- Read relevant docs from `node_modules/next/dist/docs/` before writing routing/layout code
- Use `frontend-design` skill for all UI work
