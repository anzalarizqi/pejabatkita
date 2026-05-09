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

**Where we are (Session 8 end):** Leader names ~95%+ filled via Gemini CSV workflow. Jabatan cleanup done (171 stray rows removed, all provinces ≤100% coverage). Public data priority locked: Korupsi → LHKPN → Pendidikan. Map modes and "Terlengkap" visibility policy decided.

### Top priority — Brainstorm: Gemini CSV vs scraping for multi-field enrichment

User observation: for enriching multiple fields per pejabat (tanggal lahir, masa jabatan, partai, LHKPN value, rekam bersih), Gemini CSV workflow has proven faster, more accurate, and cheaper than the Python scraper + agent pipeline. Next session should be a structured comparison before committing to either approach for phases 9B–9D.

**Questions to resolve:**
- For each field type (korupsi, LHKPN, pendidikan), is Gemini CSV viable at scale (~1000 rows)?
- What does a Gemini CSV template look like for multi-field enrichment vs. single-field?
- Does Gemini's web search reliably find KPK cases and LHKPN values by name?
- What's the verification/trust story for Gemini-filled data vs. agent-verified citations?
- Is there a hybrid: use Gemini CSV for discovery, agent for citation verification?
- Cost + time estimate for each approach across all 3 phases.

**Do not start implementing 9B until this comparison is done.**

### After brainstorm — partai bulk-pass

Run partai backfill pass (all ~1000 pejabat with real names, `jabatan.partai IS NULL`). The `--retry-partai` flag approach is simplest. Then wire partai chip on homepage leader rail + profile page.

### Phase 9B — Rekam Jejak Korupsi (after partai)

Search KPK case archive + ICW + news filtered to `tersangka|vonis|tipikor`. Same agent pattern as 9A. Schema TBD: additions to `jabatan` or separate `kasus` table (kasus_id, jenis, lembaga, tahun, url_sumber).

**Pre-9B:** drain `agent_unresolved` flags on `/admin/review`. Names must be clean before running.

### Phase 9C — LHKPN (after 9B)

Schema: `pejabat.kekayaan_total`, `pejabat.kekayaan_breakdown`. Source: `elhkpn.kpk.go.id`. Captcha is the hard part — start with Playwright + manual solve. Take Supabase snapshot before migrations.

When real LHKPN data lands: swap `hash01(name, 'lhkpn')` mock for real per-province aggregation. Profile page wired to `hash01(pejabat.id, ':lhkpn')` — one-line swap.

### Phase 9D — Pendidikan (after 9C)

Schema: `pejabat.pendidikan_terakhir`, `pejabat.universitas`. Source: Wikipedia, official bio, KPU calon data.

### Phase 10 follow-ups (deferred)

- Full mobile responsiveness pass on homepage + /pejabat (profile already has 720px breakpoint)
- OG cards per profile + sitemap.xml — wait until partai pass completes

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth:** `web/proxy.ts` gates `/admin/*` on `admin_session` cookie. (`middleware.ts` was deleted in Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
