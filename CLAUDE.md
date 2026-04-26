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

**Phase 4 is COMPLETE** — all web app files built and build passes clean.

Phase 4 summary (what was built):
- `web/middleware.ts` — admin auth guard (ADMIN_PASSWORD cookie)
- `web/app/api/auth/route.ts` — POST login / DELETE logout
- `web/app/admin/login/page.tsx` — newspaper-aesthetic login page
- `web/app/admin/layout.tsx` — sidebar nav (Pantauan / Impor Data / Ulasan Bendera)
- `web/app/admin/dashboard/page.tsx` + `DashboardClient.tsx` — coverage monitoring, collapsible provinces
- `web/app/admin/import/page.tsx` + `DiffPreview.tsx` — upload JSON, 3-step diff preview → confirm
- `web/app/admin/review/page.tsx` + `ReviewClient.tsx` + `FlagCard.tsx` — flag queue with dismiss/re-scrape
- `web/app/admin/review/EditModal.tsx` — (not built — descoped, re-scrape covers use case)
- `web/app/[pejabat-id]/page.tsx` + `ProfileClient.tsx` + `LaporkanModal.tsx` — public profile + flag form
- `web/app/api/import/preview/route.ts` — diff logic (new/updated/unchanged)
- `web/app/api/import/confirm/route.ts` — upsert to Supabase + auto-flag needs_review
- `web/app/api/flags/route.ts` — rate-limited public flagging (POST) + admin resolve (PATCH)
- `web/app/api/rescrape/route.ts` — shell-out to Python scraper
- `web/app/page.tsx` — basic public homepage
- `supabase/migrations/002_flags_reporter_ip.sql` — reporter_ip_hash column

**Phase 5 is COMPLETE** — RLS, service-role fixes, security headers, kab/kota seed script, all built. Build passes.

Phase 5 summary:
- `supabase/migrations/003_rls_policies.sql` — RLS enabled, anon read on wilayah/pejabat/jabatan/scrape_runs
- `supabase/seed/002_wilayah_kabkota.py` — seeds ~514 kab/kota via wikipedia.py, run once locally
- `web/next.config.ts` — security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- `web/app/admin/dashboard/page.tsx` + `review/page.tsx` — switched to service role
- `web/app/admin/review/FlagCard.tsx` — rescrape local-only note when NEXT_PUBLIC_IS_VERCEL=true

**Next: Deploy**
1. Run `003_rls_policies.sql` in Supabase SQL editor
2. Run `python supabase/seed/002_wilayah_kabkota.py` locally (needs `.env` with service role key)
3. Push to GitHub → Vercel: root dir = `web/`, add 5 env vars (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, NEXT_PUBLIC_IS_VERCEL=true)
4. Verify: login → dashboard shows provinces with kab/kota → import JSON → public profile
