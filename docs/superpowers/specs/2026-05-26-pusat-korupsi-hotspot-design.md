# Design: Pejabat Pusat + Rekam Jejak Korupsi + Daily Hotspot

Date: 2026-05-26  
Status: Approved

## Overview

Three features added in one design cycle. They share a data model but are independent in UI and pipeline.

1. **Pejabat Pusat** — national cabinet officials (President, VP, all ministers) with toggle on homepage
2. **Rekam Jejak Korupsi** — verified corruption records (tersangka and above) for all officials
3. **Daily Hotspot (`/pulse`)** — democracy pulse map: automated daily news crawl + admin manual override, archived, searchable

Architecture: monolithic (existing Next.js + Supabase). Daily crawler runs as a Supabase Edge Function triggered by pg_cron at 09:00 WIB. No new servers.

---

## Feature 1: Pejabat Pusat

### Data Model Change

Add `level VARCHAR DEFAULT 'daerah'` to existing `pejabat` table.  
Values: `'pusat'` | `'daerah'`  
Migration: `ALTER TABLE pejabat ADD COLUMN level VARCHAR DEFAULT 'daerah';`

### Scrape Script

`scripts/scrape_kabinet.py` — re-runnable, idempotent.

Sources (in order):
1. `setkab.go.id` — official cabinet list
2. Wikipedia `Kabinet_Merah_Putih` — structured table with names, titles, photos

Behavior:
- Fetches current cabinet list
- For each official: upserts into `pejabat` (`level='pusat'`) + `jabatan` (no `provinsi_id`, `partai` if available)
- Detects additions/removals vs existing DB rows — prints diff report
- Run after reshuffles; safe to re-run anytime (upsert by name+jabatan)

Output: ~50 rows (Presiden, Wapres, ~34 menteri, ~14 wakil menteri)

### UI: Homepage Toggle

`HomeShell.tsx` gets a `Daerah | Pusat` pill toggle above the map.

- **Daerah** (default): existing choropleth map, existing map modes (Rekam Bersih, LHKPN, Pendidikan)
- **Pusat**: replaces map with a **Kabinet grid** — cards for each official grouped by ministry. Each card shows: photo, name, jabatan, partai (if available), corruption badge if kasus exists.

Route stays at `/` — toggle is client-side state, no URL change needed.

---

## Feature 2: Rekam Jejak Korupsi

### Schema

```sql
CREATE TABLE kasus (
  kasus_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pejabat_id  UUID NOT NULL REFERENCES pejabat(id),
  jenis       TEXT,           -- korupsi, gratifikasi, pencucian_uang, suap, dll
  lembaga     TEXT,           -- KPK, Kejagung, Kejati, Pengadilan Tipikor
  status      TEXT NOT NULL,  -- tersangka, terdakwa, terpidana
  tahun       INT,
  ringkasan   TEXT,
  url_sumber  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

Applies to both `pusat` and `daerah` officials.

### Enrichment Pipeline

Two-pass approach:

**Pass 1 — CSV screen (manual, using Gemini or Claude):**
- Export all pejabat (name + jabatan + provinsi) as CSV
- Send to LLM with prompt: for each row, return `has_record (Y/N/maybe), jenis, lembaga, status, tahun, url_sumber, ringkasan`
- Split by provinsi for accuracy on large batches

**Pass 2 — Verification (automated):**
- Run `verifier/verifier.py` on all Y/maybe rows
- Accepted sources: KPK.go.id, SIPP Pengadilan, Tempo/Kompas/Detik with "tipikor|tersangka|KPK|Kejagung" keywords
- Verified rows import to `kasus` table via `scripts/import_kasus.py`

**Admin review:** unverified Y/maybe rows flagged at `/admin/korupsi` for manual decision.

### Profile Page

Existing `/pejabat/[id]` page gets a **Rekam Jejak** section:
- Empty state: "Tidak ditemukan rekam jejak korupsi" (green badge)
- Has records: collapsible list of kasus cards — status badge (tersangka/terdakwa/terpidana), lembaga, tahun, ringkasan, link to source

### Map Mode

Homepage "Rekam Bersih" mode (already wired to `hash01` mock) swaps to real data: `kasus` count per provinsi aggregated from `jabatan.provinsi_id → kasus.pejabat_id`.

---

## Feature 3: Daily Hotspot (`/pulse`)

### Concept

A **democracy pulse map** — not just corruption, but anything significant affecting Indonesian democracy: controversial statements, absurd decisions, demonstrations, public criticism, new corruption cases, etc. Each event is a dot on the map tied to a location.

### Schema

```sql
CREATE TABLE hotspot_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judul         TEXT NOT NULL,
  ringkasan     TEXT,
  kategori      TEXT,         -- korupsi, pernyataan, demonstrasi, kebijakan, kritik, lainnya
  lokasi_nama   TEXT,         -- raw location string from LLM extraction
  provinsi_id   UUID REFERENCES provinsi(id),  -- nullable, resolved from lokasi_nama
  pejabat_id    UUID REFERENCES pejabat(id),   -- nullable, linked official if identified
  url_sumber    TEXT,
  sumber_nama   TEXT,
  crawled_at    TIMESTAMPTZ DEFAULT now(),
  is_manual     BOOLEAN DEFAULT false
);

CREATE INDEX ON hotspot_events(crawled_at);
CREATE INDEX ON hotspot_events(provinsi_id);
```

Events with no resolved `provinsi_id` appear in the sidebar but not on the map.  
Pusat official events default to Jakarta (DKI Jakarta provinsi_id).

### Crawler: Supabase Edge Function

`supabase/functions/crawl-hotspot/index.ts`

**Scheduled:** pg_cron at `0 2 * * *` UTC (= 09:00 WIB).  
**On-demand:** callable by admin from `/admin/hotspot` with optional keyword override.

**Flow:**
1. Build search queries: fixed daily queries (`"pejabat kontroversial site:kompas.com OR site:tempo.co OR site:detik.com"`, `"Indonesia demokrasi hari ini"`, etc.) + any active manual keywords from `settings` table
2. Search via Jina/DDG (same endpoint as existing Python scraper: `https://s.jina.ai/...`)
3. For each result: call LLM (model from `settings.llm_model`) to extract: `judul, ringkasan, kategori, lokasi_nama, pejabat_name`
4. Resolve `lokasi_nama → provinsi_id` (fuzzy match against provinsi table)
5. Resolve `pejabat_name → pejabat_id` (fuzzy match, nullable)
6. Deduplicate by `url_sumber` (skip if already in DB)
7. Batch insert to `hotspot_events`

**LLM config** read from `settings` table: `llm_provider`, `llm_model`. API key from Supabase secret `LLM_API_KEY`.

### Admin: `/admin/hotspot`

- **Manual add**: text input for keyword/topic → triggers edge function on-demand → dots appear within ~30s
- **Active keywords**: list of persistent keywords that get appended to every daily crawl (stored in `settings` as JSON array under key `hotspot_keywords`)
- View last crawl log (event count, errors)

### UI: `/pulse` Page

**Map section (top):**
- Same `IndonesiaMap` component (geoIdentity, no Mercator)
- Dots per province sized by event count, colored by kategori (red=korupsi, orange=demonstrasi, yellow=pernyataan, etc.)
- Click dot → province events panel slides in
- Click individual event → modal with: judul, ringkasan, sumber link, crawled_at, kategori badge, linked pejabat (if any)

**Time filter toggle** (above map):
`Hari Ini | 7 Hari | 30 Hari | 90 Hari | Semua`  
Default: `Hari Ini`

**Sidebar (right, always visible on desktop):**
- Scrollable feed of all events matching current time filter
- Search input (client-side filter on judul + ringkasan)
- Each item: kategori badge, judul, sumber_nama, time ago, linked pejabat name if resolved
- Click item → same modal as map dot click

**Mobile:** map stacks above sidebar (full width each).

---

## Shared: Settings Table + Admin

### Schema

```sql
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- Initial rows:
INSERT INTO settings VALUES ('llm_provider', 'zhipu');
INSERT INTO settings VALUES ('llm_model', 'glm-4.5-air');
INSERT INTO settings VALUES ('hotspot_keywords', '[]');
```

### Admin: `/admin/settings`

Form fields:
- LLM Provider (select: zhipu, openai, anthropic)
- LLM Model (text input)
- Note: "API key is managed via Supabase secrets, not here"

---

## Implementation Order

These three features can be built independently after the shared schema migration:

1. **Schema migration** — `ALTER TABLE pejabat ADD COLUMN level`, create `kasus`, `hotspot_events`, `settings` tables
2. **Pejabat Pusat** — scrape script + UI toggle + kabinet grid (unblocks korupsi badges on pusat profiles)
3. **Rekam Jejak Korupsi** — enrichment pipeline + profile section + map mode swap
4. **Daily Hotspot** — edge function + `/pulse` page + `/admin/hotspot`

Each phase is independently shippable.

---

## Assumptions

- `/pulse` is the route for the hotspot page (change if preferred)
- Hotspot dots on map are per-province aggregations (not precise lat/lng — matches existing map architecture)
- Events with no resolved province appear in sidebar only, not on map
- Pusat official hotspot events default to DKI Jakarta provinsi
- LLM for edge function uses same Jina search endpoints as Python scraper
- `use frontend-design skill` for all new UI components
