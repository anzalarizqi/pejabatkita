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
│   ├── lib/auth.ts, lib/session.ts  ← admin auth: isAdmin() + HMAC session token
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

### ✅ Security hardening — COMPLETE & browser-verified (2026-05-31)

Full audit lives in-app at **`/admin/security`** (admin-gated, dual-register: plain-language + technical `<details>`). All Critical + High remediated & runtime-verified:
- **PK-C1 (critical)** — all 8 `/api/admin/*` routes used a truthy-only cookie check (any forged `admin_session` cookie = admin → fake kasus inserts, data exfil). Now use constant-time `isAdmin()` (`web/lib/auth.ts`).
- **PK-H1** — login cookie was the password; now an HMAC session token (`web/lib/session.ts`, Web Crypto so it runs in Edge proxy + Node routes) with server-side expiry + per-IP login rate-limit. **Existing admin sessions invalidated → re-login once.**
- **PK-H2** — `/api/rescrape` `exec(string)` → `execFile` (no shell) + input validation.
- **PK-H3** — RLS enabled on `settings` (migration `013`, applied).
- **PK-H4** — `kasus` anon policy → verified-only (migration `014`, applied) + `getKasusByPejabat` guard. Public shows only `verified=true` (18 of 100; 82 rejected now hidden). Homepage choropleth (service role) unaffected.

**Tahap 3 (defense-in-depth) — shipped (13/14 total):** PK-M1 JSON-LD XSS escape (`[pejabat-id]/page.tsx`, single `/[<>&]/g` replacer), PK-M2 CSP+HSTS (`next.config.ts`, env-aware), PK-M3 SSRF guard + DNS resolution in `is_private_url` (`websearch.py`) now applied to `browser.py` navigate/extract, PK-M4 `CRAWL_SECRET` gate added then **fully retired** (pg_cron `crawl-hotspot-daily` unscheduled + edge function deleted; the live crawler is local `scripts/crawl_hotspot.py`, so the edge endpoint no longer exists), PK-M5 `xlsx` → SheetJS CDN 0.20.3, PK-L1 dedicated `HASH_SALT`, PK-L3 output-dir containment, PK-L4 covered by H1 token expiry. Pre-existing lint errors fixed → green `next build`.

**Dependency bonus (from `npm audit`):** `next` 16.2.4 → **16.2.6** (closes a HIGH advisory cluster incl. middleware/proxy bypass + SSRF), `ws`/`brace-expansion` patched. Residual: 2 moderate transitive `postcss` (build-time) — optional npm `overrides` would clear it. (`next.config` is not hot-reloaded — restart `npm run dev` after pulling.)

**CSP (M2) browser-verified:** homepage, `/pejabat`, a profile (w/ kasus + JSON-LD), and `/admin`→login all loaded with **0 CSP console errors** on the dev server.

**Residual (non-code / optional — nothing blocking):**
- PK-L2 — Chromium `--no-sandbox` (`browser.py`): container-level (run scraper as non-root).
- 2 moderate `postcss` transitive — optional npm `overrides`.
- Hygiene: **rotate `ADMIN_PASSWORD`** (the pre-fix cookie *was* the password); optionally set `ADMIN_SESSION_SECRET`; add `npm audit`/Dependabot to CI.

→ **Security is done. Next actionable project work is the data roadmap below.**

### Current state (end of 2026-05-30)

See session archive for Sessions 1–9 history. Current working state:

**Daily crawl — local Python, not Supabase:**
```bash
python scripts/crawl_hotspot.py            # 8 RSS feeds, last 24h, watchdog gate
python scripts/crawl_hotspot.py --keyword "OTT KPK Pati"
python scripts/crawl_hotspot.py --dry-run
```

**Homepage: 5 mode tabs** — Rekam Bersih (default), Denyut, Tercatat, Pendidikan (mock), LHKPN (mock).

**Admin panel:** `/admin/rekam-bersih` — CSV export (by province) + import workflow for manual kasus screening via Gemini/Claude web. Exact same DB writes as `screen_kasus_llm.py`.

**Rekam Bersih map tooltip** (3 states):
- `"3 / 56 pejabat memiliki catatan korupsi (5%)"` — has verified/pending cases
- `"56 pejabat · bersih ✓"` — fully screened, 0 cases
- `"15 / 56 pejabat terskrining"` — partially screened

### What shipped this session (2026-05-30)

**`/admin/rekam-bersih`** — new admin page (spec + plan + 4-task subagent build):
- Export: province select → downloads `kasus_export_<provinsi>.csv` of unscreened pejabat
- Import: upload filled CSV → writes kasus (verified=NULL) + kasus_screened, identical to Kimi screener
- Canned Gemini/Claude prompt (copy-on-click)
- Tested end-to-end via MCP Playwright

**Map tooltip** — Rekam Bersih mode now shows `"N / total memiliki catatan korupsi (X%)"` or `"bersih ✓"` for fully-clean screened provinces. `listProvinceKasusCounts` switched to service role to read `kasus_screened` past RLS.

**Verifier fixes (`verify_kasus.py`):**
- Injects `today = date.today().isoformat()` into system prompt → prevents rejecting recent real OTTs as "belum terjadi"
- Now passes `jabatan + provinsi` in prompt → prevents wrong-person disambiguation (fixed Suroto kades vs Wakil Bupati)
- Drops `gelar_belakang` from search name (SE., M.AP breaks web queries)

**Manual kasus inserts (from Claude/Gemini CSV):**
- Abdul Azis (Bupati Kolaka Timur) — inserted
- Ardito Wijaya (Bupati Lampung Tengah) — inserted
- Abdul Wahid (Gubernur Riau) — inserted (was on wrong pejabat_id initially, fixed)
- 8 others already in DB from Kimi screener

**Screening progress (end of session):**
```
✓ 20 provinces at 100% — Aceh, Banten, DI Yogyakarta, DKI Jakarta, Gorontalo,
  Jawa Barat, Jawa Tengah, Jawa Timur, Kalimantan Tengah, Kalimantan Timur,
  Maluku, Papua, Sulawesi Tengah, Sumatera Selatan, Sumatera Utara + more
  Lampung 1/32, Sulawesi Tenggara 1/36 (Kimi partial runs)
  16 provinces still at 0%
  Total: 528/1104 screened (48%) — 16 verified=True, 81 verified=False
```

### Next Session Should Start With

**✅ Keranjang Koruptor — COMPLETE & browser-verified (branch `feat/keranjang-koruptor`, ready for PR).**
Plan: `docs/superpowers/plans/2026-06-04-keranjang-koruptor.md`. All 12 tasks done & committed:
- **T1–T7** `tanggal_kasus DATE` added (migration `016`, **applied**) + threaded through `KasusRow`/date-first ordering, CSV export (13 cols)/import (ISO-validated), AI prompt, `import_kasus.py`, `screen_kasus_llm.py`.
- **T8** `scripts/backfill_tanggal_kasus.py` (idempotent) dated 12 era cases (9 from our ringkasan + 3 researched: Gatut Sunu `2026-04-11`, Ade Kuswara `2025-12-20`, Abdul Azis `2025-08-09`). Pre-era cases stay null.
- **T9** `scripts/seed_bgn.py` (filled, idempotent) — Kejagung MBG case, penetapan 3 Jun 2026: Dadan Hindayana (existing Kepala BGN seat updated → nonaktif, not duplicated) + Sony Sonjaya + Lodewyk Pusung (new pusat pejabat, Wakil Kepala, verified kasus). Succession: **Nanik S. Deyang** added as definitif Kepala BGN (`aktif`, 2026-06-02).
- **T10/T11** `listKeranjangKoruptor()` + `/keranjang-koruptor` page/shell + homepage nav link. **Browser-verified**: 15 pejabat, BGN trio at top, status + level filters work, chips read "Tersangka/Terdakwa", disclaimer renders, source/profile links OK.
- **T12** AI succession-refresh tool on backlog (active priority #3).

**Data-integrity fixes found via the user's catch (wrong-person attributions, both set `verified=false`):**
- **Suyono** — kasus about *Abdul Suyono, Kades Karangrowo (Pati)* was attached to pejabat **Suyono, Wakil Bupati Batang** (different person). User chose: leave the kades dropped (out of kepala-daerah scope).
- **Zulkifli H. Adam** (eks Wali Kota Sabang) — 2019 land case, **divonis bebas** (acquitted, MA upheld) → violated no-SP3/bebas rule.

**Next:** push `feat/keranjang-koruptor` + open PR to `main`. Then back to the active priorities below (DPR/DPD/MPR list, LHKPN scraper).

**✅ Recently shipped (2026-06-04):**
- **Denyut event clustering** (branch `feat/denyut-event-clustering`, spec + plan in `docs/superpowers/`) — multi-source articles about one real-world event now collapse to a single map dot instead of N dots. Migration `015` adds `story_id` to `hotspot_events` (canonical row has `story_id = event_id`, FK `ON DELETE SET NULL`). Crawler matches each *inserted* article against recent candidates (same kategori + same pejabat OR wilayah, ±5 days) via a Kimi yes/no call and assigns `story_id`; read layer (`listHotspotEvents`) collapses by `story_id` into `sources[]` + `source_count`, which also de-inflates the province choropleth; modal shows "Diberitakan oleh N sumber" + source list; sidebar shows "· N sumber". One-time `scripts/backfill_story_id.py` clustered the existing backlog (**147 of 266 events regrouped**). Gotchas found in live verification: **kimi-k2.6 only accepts `temperature: 0.6`** (any other value → 400), and `crawled_at`/pubDate is RFC822 (RSS) or LLM free-form, not ISO — `_to_iso()` normalizes it before the candidate query. Pulse highlight now keys on `story_id ?? event_id` (stable across 24h/7d windows). Browser-verified on `/pulse`.

**✅ Recently shipped (2026-06-03):**
- **Re-verify suspicious rejects** — `verify_kasus.py --report-suspicious-rejects`: 82 rejected, 22 keyword-flagged. Triaged all — 21 correctly rejected (no evidence / wrong-person / election disputes / witnesses-only); only **Mohamad Sanusi** (reklamasi Teluk Jakarta 2016) genuinely wrong-rejected → fixed manually to `verified=true`. Verifier heuristic confirmed good; affirmative-keyword flag is noisy.
- **Rekam Bersih screening — COMPLETE.** All 38 provinces screened.
- **Homepage Pusat view scroll fix** (commit `831a9fb`) — `100vh` stage clipped `KabinetGrid`; wrapped in `.pv-pusat-scroll`.
- **Pusat (Kabinet) batched screening** in `/admin/rekam-bersih` (commit `5c33991`) — `Pusat · Kabinet (n/N)` dropdown options export unscreened `level='pusat'` officials in batches of 40, same AI-fill→import loop. 111 unscreened → 3 batches. (Map zoom/pan + denyut legend shipped 2026-05-30 — see session archive.)

**Active priorities (in order):**

**1. Collect DPR / DPD / MPR member list.**
- `pejabat.level = 'pusat'` currently ~111 kabinet ministers only
- Need: 580 DPR anggota + ~136 DPD anggota + MPR pimpinan
- **Start with brainstorming session** — learn from what worked:
  - "Isi nama kosong": export CSV → Gemini/Claude web fills names → import back (free, no API cost)
  - "Catatan korupsi": same CSV pattern + Kimi screener for verification
  - Apply the same export→AI fill→import loop for DPR/DPD/MPR collection
- Key questions to brainstorm: what's the seed data (KPU calon 2024? dpr.go.id scrape? Wikipedia?), how to structure the CSV for AI to fill, what verification step is needed

**2. LHKPN scraper (Phase 9C — data priority #2, locked).**
- Source: `elhkpn.kpk.go.id`. Every kepala daerah is legally required to file.
- Unlocks the **LHKPN map mode** (currently mock `hash01`) — swap is one-line per mode in `HomeShell.tsx` + profile page.

**3. AI succession-refresh admin tool (from Keranjang Koruptor session).**
- Generalize the `/admin/rekam-bersih` export→AI-fill→import loop to detect successions.
- Clustered dropdown (province / Pusat batches) → export current office-holders →
  Kimi/Gemini/Claude checks "apakah ada pejabat baru di posisi ini?" → import updates
  (deactivate old jabatan via `status='nonaktif'` + `selesai_jabatan`, insert replacement).
- Triggered by the BGN Dadan→Nanik case, which was handled manually via `scripts/seed_bgn.py`.

**4. Optional: cleanup 8 Denyut events with null `wilayah_id`:**
```sql
UPDATE hotspot_events
SET wilayah_id = (SELECT id FROM wilayah WHERE nama = 'DKI Jakarta'),
    lokasi_nama = COALESCE(lokasi_nama, 'DKI Jakarta')
WHERE wilayah_id IS NULL;
```

### Known follow-ups / non-blockers

- **Google News URLs** (via `news.google.com/rss/articles/CBMi…`) redirect to real article. Acceptable for now.
- **Daily schedule for `crawl_hotspot.py`** — Windows Task Scheduler, no code needed.
- **Mobile responsiveness** on `/pulse` and homepage not deeply tested.
- **Bulk name matcher** in manual inserts hits 1000-row PostgREST limit — use paginated fetch if re-running.

### Deferred (still)

- Partai enrichment: `/admin/enrichment` CSV flow (~1,005 null rows)
- Pendidikan enrichment (Phase 9D)
- OG cards / sitemap.xml
(LHKPN scraper promoted to active priority #2 above.)

## Stack Notes (gotchas)

- **Next.js 16:** `searchParams` and `params` in pages are `Promise` types — must `await`. Check `web/AGENTS.md` before writing route/layout code.
- **Auth (token-based, 2026-05-31):** login issues an HMAC-signed session token (`web/lib/session.ts`, Web Crypto — runs in Edge proxy + Node routes), **not** the password. `web/proxy.ts` gates `/admin/*` pages; **every `/api/admin/*` route MUST call `isAdmin()`** (`web/lib/auth.ts`) — a truthy cookie check is not auth (audit PK-C1). Login is rate-limited; optional `ADMIN_SESSION_SECRET` overrides the signing key (else derives from `ADMIN_PASSWORD`). Full audit at `/admin/security`. (`middleware.ts` deleted Session 7.)
- **Postgrest:** default 1000-row cap — use `fetchAll()` pagination helper for any query over jabatan/pejabat tables.
- **Map:** `IndonesiaMap` uses `geoIdentity().reflectY(true)` — do NOT switch to `geoMercator` (antimeridian clipping issue). `KabKotaMap` mirrors this pattern.
- **Use `frontend-design` skill** for any new UI work to keep editorial consistency.
