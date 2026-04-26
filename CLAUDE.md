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

## Session Log

### Session 1 — 2026-04-26
- Reviewed and refined PRD (`PRD-peta-pejabat-indonesia.md`)
- Identified SEMAR project tools reusable for this project (search, browser, LLM config pattern)
- Updated PRD: fixed model version, added Groq/Moonshot providers, added web search stack spec, added `ACTIVE_LLM_PROVIDER` env override
- Created `CLAUDE.md`

## Next Session Should Start With

**Phase 6 (Data Population) is IN PROGRESS** — scraper pipeline is hardened and DKI Jakarta runs end-to-end cleanly. Ready to run all 38 provinces.

Phase 6 summary so far:
- `scripts/run_scraper.py` — orchestrates scraper + verifier for all provinces, resume support
- `scripts/import_to_supabase.py` — bulk imports output/ folders into Supabase (built but not yet run)
- `scraper/core/wilayah.py` — Supabase-backed district validation; `fetch_province_kode()` + `validate_districts()`
- `scraper/scraper.py` — hardened against LLM null quirks: `_n()` sanitizes string "null", `_date()` fixes bare years and zero month/day

**LLM provider:** Moonshot (`moonshot-v1-8k`), priority 6 in config.yaml. ZhipuAI hit weekly limit.

**Bugs fixed this session (all in scraper/verifier):**
- LLM returning string `"null"` instead of JSON null — fixed via `_n()` helper on all nullable fields
- LLM returning bare year `"2008"` for date fields — fixed via `_date()` helper
- LLM returning `"2025-00-00"` (month 0) — fixed in `_date()` by clamping to min 1
- PostgREST filter syntax wrong: `level=eq.kabupaten,eq.kota` -> `level=in.(kabupaten,kota)`
- Province kode was hardcoded `"XX"` — now looked up from Supabase via `fetch_province_kode()`
- Windows CP1252 UnicodeEncodeError on Unicode chars — replaced all `✓`, `→`, `—`, `⚠` with ASCII in scraper, verifier, run_scraper
- `run_scraper.py` was passing `--verbose` to subprocess causing httpcore debug flood — removed

**DKI Jakarta verified output:** `output/dki-jakarta/pejabat_verified.json` — 14 pejabat, kode BPS 31, 6/6 districts matched.

**Next: Run all 38 provinces**
```bash
python scripts/run_scraper.py --resume
```
Then import to Supabase:
```bash
python scripts/import_to_supabase.py --dry-run
python scripts/import_to_supabase.py
```
