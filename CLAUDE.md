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

### Pejabat Pusat — COMPLETE (111 officials)

`scripts/scrape_kabinet.py` imports from Wikipedia + hardcoded supplement (post-April 2026 reshuffle + Kompas Sept 2025 full Wakil Menteri list). DB has 111 pusat pejabat (109 current + 2 predecessors still in DB: Juda Agung, Benjamin Paulus Octavianus). Re-run scraper periodically as Wikipedia catches up — it's idempotent.

UI: `KabinetGrid.tsx` + Daerah/Pusat toggle on homepage is wired and working.

Minor cleanup (optional): Afriansyah Noor may have 2 jabatan rows (typo "Ketenangakerjaan" + correct "Ketenagakerjaan"). Juda Agung and Benjamin Paulus Octavianus in DB but not in current cabinet — delete via Supabase dashboard if needed.

### Priority 1 — Rekam Bersih (corruption map mode, real data)

Goal: swap `hash01` mock in "Rekam Bersih" map mode for real `kasus` data. Full plan at `docs/superpowers/plans/2026-05-26-plan2-rekam-jejak-korupsi.md`.

Two-pass enrichment:
1. **LLM CSV screen** — export all ~1,100 pejabat as CSV, send to LLM (Gemini or Claude chunked by provinsi): `name → has_record (Y/N/maybe), jenis, lembaga, status, tahun, url_sumber, ringkasan`
2. **Verifier pass** — run `verifier/verifier.py` on Y/maybe rows only. Accepted sources: KPK.go.id, SIPP Pengadilan, Tempo/Kompas/Detik with tipikor keywords.
3. **Import** — verified rows → `kasus` table via `scripts/import_kasus.py` (to be built). Failures → `/admin/korupsi` review queue.

Schema: `kasus` table already defined in spec (`docs/superpowers/specs/2026-05-26-pusat-korupsi-hotspot-design.md`), migration not yet applied.

Profile page: add Rekam Jejak section to `/[pejabat-id]` — empty state ("Tidak ditemukan rekam jejak") or collapsible kasus cards.

Map swap: one-line change in `HomeShell.tsx` once data is in DB.

### Priority 2 — Daily Hotspot (`/pulse`)

Full plan at `docs/superpowers/plans/2026-05-26-plan3-daily-hotspot.md` — 8 tasks, all code scaffolded.

Summary: Supabase Edge Function `crawl-hotspot` (Deno) calls Jina search daily at 09:00 WIB, LLM extracts judul/ringkasan/kategori/lokasi, inserts to `hotspot_events`. `/pulse` page shows IndonesiaMap dots per province colored by kategori + searchable sidebar + event modal. Admin `/admin/hotspot` for manual crawl trigger.

Route confirmed: `/pulse`.

### Deferred

- Partai enrichment: `/admin/enrichment` → download CSV → process → upload (~1,005 null rows)
- Phase 9C — LHKPN (after Rekam Bersih)
- Phase 9D — Pendidikan (after LHKPN)
- Mobile responsiveness pass + OG cards / sitemap.xml

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth:** `web/proxy.ts` gates `/admin/*` on `admin_session` cookie. (`middleware.ts` was deleted in Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
