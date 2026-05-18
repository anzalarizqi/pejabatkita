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

**Where we are (name verification pass, mid-session):**
- Verifying all ~1,103 pejabat in `C:\Users\anzal\Downloads\semua_pejabat_verified.csv` for name accuracy post-Pilkada 2024 (mass inauguration 20 Feb 2025).
- **Verified through line 858** (Maluku Utara/Wagub Sarbin Sehe) — batches 1–44 complete. Jawa Timur + Kalimantan + Kep. Bangka Belitung + Kep. Riau + Lampung + Maluku + Maluku Utara fully done.
- Total corrections pushed to Supabase: ~136+ across all batches; last push covered batches 42–44 (19 corrections incl. 4 salah orang: Pesawaran, Kep. Tanimbar, Halmahera Selatan, Tidore Kepulauan).
- CSV at `C:\Users\anzal\Downloads\semua_pejabat_verified.csv` has `nama_koreksi` + `verifikasi_batch` columns already appended.
- Push script: `scripts/update_verified_names.py` — update CORRECTIONS list, run `python scripts/update_verified_names.py`.

### Top priority — Continue name verification at line 743

**Resume at line 859** (first row after Maluku Utara). Remaining: ~lines 859–1100+ covering NTB → NTT → Papua → Riau → Sulawesi → Sumatra.

**Workflow per batch (20 rows):**
1. Read 20 rows from CSV
2. Spawn agent to verify each name via web search (Indonesian sources)
3. Write `nama_koreksi;batch_number` for any corrections in CSV
4. Push to Supabase every ~3 batches (~60 rows) via update script

**Watch for:**
- Incomplete single names (e.g. "Erwin", "Iin", "Dena") → find full legal name
- Bupati/Wakil confused (same pejabat_id assigned to wrong role)
- Nonaktif status on a person who is actually the current 2025 official (scraper put wrong dates)
- All-caps entries are usually cosmetically wrong, verify the person is correct
- PSU (vote recount) kabupaten had delayed inauguration (e.g. Pamekasan 19 Mar 2025, Magetan 23 Mei 2025)

### After name verification completes — partai + masa-jabatan enrichment

1. Visit `/admin/enrichment` → click **Unduh CSV Enrichment** (~1,005 rows where `jabatan.partai IS NULL`).
2. Send to Claude with the on-page prompt. Likely needs chunking (split by provinsi) for accuracy on long sheets.
3. Upload result via the same page; check the result card and any `errors[]` returned by the import.
4. After import, current partai coverage will jump from 9% (99/1,104) toward target. Re-run export for any remaining nulls.

**Watch out:** import-enrichment loops sequential `await supabase.update().eq()`. ~1,000 rows = ~1,000 sequential HTTP calls. If it's painfully slow, batch via RPC or `upsert` with array payload.

### Phase 9B — Rekam Jejak Korupsi (after partai)

Hybrid plan (per brainstorm):
1. Gemini CSV pass: `name → has_record (Y/N/maybe), source_url, jenis, tahun` on the full ~1,100 pejabat.
2. Run existing `verifier/verifier.py` (or agent `verify_citations`) only on Y/maybe rows. Sources accepted: KPK, pengadilan, major news.
3. Anything that fails verification → new flag for `/admin/review`.

Schema TBD: additions to `jabatan` or separate `kasus` table (kasus_id, jenis, lembaga, tahun, url_sumber).

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
