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

Begin implementation. Start with:
1. `core/schema.py` — Pydantic models for the PRD JSON schema (foundation everything else builds on)
2. `pipeline/llm.py` — multi-provider LLM abstraction with fallback
3. `pipeline/websearch.py` — port DDG/Jina + SearXNG from SEMAR `tools/search.js`

No blockers — PRD is finalized and reference implementations exist in SEMAR.
