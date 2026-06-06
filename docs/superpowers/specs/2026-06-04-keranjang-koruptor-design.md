# Design: Keranjang Koruptor + `tanggal_kasus` + BGN data op

**Date:** 2026-06-04
**Status:** Approved (brainstorm), pending implementation plan
**Trigger:** Arrests of BGN officials (Kepala BGN Dadan, Wakil BGN Sonjaya, Lodewyk Pusung) under the Prabowo administration; idea for a public "hall of shame" of officials arrested in the Prabowo era, plus handling the Dadan → Nanik S. Deyang succession and refreshing rekam bersih screening.

## Goal

A public, dedicated page listing every official **in our database** who was **arrested for corruption during the Prabowo era** (on or after his inauguration, **2024-10-20**), regardless of position (daerah + pusat). Auto-populated from the existing `kasus` table — not a hand-curated list.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Membership rule | Everyone with a verified kasus arrested on/after 2024-10-20, any position. Auto-filter, not curated. |
| Era determination | Add a precise `tanggal_kasus DATE` column (year-only `tahun` is too coarse for the mid-2024 cutoff). |
| UI placement | Dedicated page (`/keranjang-koruptor`). Not a map mode (it's a people-list, not a choropleth). |
| Succession handling | Handle the 3 known BGN people manually now. General AI-driven succession-refresh tool → backlog. |
| Re-screening | Wire `tanggal_kasus` into the screening flow, then incremental re-screen (stale-first + news-flagged), not a full re-run. |
| Verification bar | `verified = true` only — matches the locked public-data policy (PK-H4). |

## Scope

### 1. Data model — migration `016_kasus_tanggal.sql`

```sql
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS tanggal_kasus DATE;
CREATE INDEX IF NOT EXISTS idx_kasus_tanggal ON kasus(tanggal_kasus);
```

- **Semantics:** date the person was named *tersangka* / arrested (penetapan tersangka or OTT date). Nullable — older cases may only have a year (`tahun`).
- **Keranjang membership query:** `verified = true AND tanggal_kasus >= '2024-10-20'`. Null `tanggal_kasus` = excluded, so every Prabowo-era verified case must get a date.
- **Backfill:** Only ~18 verified cases exist. Backfill `tanggal_kasus` by hand for the era-relevant ones (read each `url_sumber`). Pre-Prabowo cases may stay null (excluded anyway).

### 2. BGN data operation (manual, one-off)

A parameterized script (`scripts/seed_bgn_kasus.py`) or plain SQL snippet. The 3 officials are `level='pusat'`, wilayah = *Indonesia* (nasional, `kode_bps='00'`). For each official:

1. Add `pejabat` row if absent.
2. Add `jabatan` row (posisi, level pusat, wilayah Indonesia, status).
3. Add `kasus` row: `status='tersangka'`, `lembaga` = arresting body, `verified=true`, `tanggal_kasus` set, `ringkasan`, `url_sumber`.
4. Upsert `kasus_screened` as `last_result='found'`.

**Succession (Dadan → Nanik S. Deyang):**
- Dadan's `jabatan` → `status='nonaktif'`, `selesai_jabatan` = replacement date.
- Add **Nanik S. Deyang** as new `pejabat` (if absent) + `jabatan` Kepala BGN, `status='penjabat'` if Plt else `'aktif'`, `mulai_jabatan` set.

**Inputs supplied at build time (NOT invented — post-knowledge-cutoff news):** exact full names, arrest dates, case summaries (`ringkasan`), arresting body (KPK / Kejagung), source URLs, and whether Nanik is Plt or definitif. The user (who follows the news) provides these, or they are researched together before running the op.

### 3. Re-screening flow update (capture the date going forward)

- `web/app/admin/rekam-bersih/page.tsx` — add `tanggal_kasus` column to the export CSV and to the canned Gemini/Claude prompt ("isi tanggal penetapan tersangka / OTT, format `YYYY-MM-DD`; kosongkan jika tidak diketahui").
- `scripts/import_kasus.py` — parse `tanggal_kasus` (validate `YYYY-MM-DD`, else null) into the insert row.
- `scripts/screen_kasus_llm.py` / `scripts/verify_kasus.py` — capture/write `tanggal_kasus` wherever they write a kasus row.
- `getKasusByPejabat` (web/lib/queries.ts) — order by `tanggal_kasus desc nulls last`, fall back to `tahun`.
- **Incremental re-run (operational):** target officials with the oldest `kasus_screened.last_screened_at` first, plus any flagged from news. Not a full 1104-row sweep.

### 4. Keranjang Koruptor page — `/keranjang-koruptor`

- **Public title:** "Keranjang Koruptor" (slug `keranjang-koruptor`). Punchy and intentional; the legal note below keeps it defensible.
- **Query** `listKeranjangKoruptor()` in `web/lib/queries.ts`: verified kasus with `tanggal_kasus >= '2024-10-20'`, joined to `pejabat` + current `jabatan` + `wilayah`. Returns per row: nama_lengkap, gelar, posisi (current), partai, wilayah/level, jenis, lembaga, status (tersangka/terdakwa/terpidana), tanggal_kasus, ringkasan, url_sumber, pejabat_id.
- **UI** (built with the **frontend-design** skill for editorial consistency): text-first card gallery (no photos — `pejabat` has no foto column). **Default sort = `tanggal_kasus` desc** (newest arrests first). Filters: status, level (pusat/daerah), lembaga, name search. Header counter: *"N pejabat ditangkap era Prabowo."* Each card links to the existing `/[pejabat-id]` profile. Linked from homepage nav.
- **Legal / ethical safeguard:** most entries sit at the *tersangka* stage (suspects, not convicted). Per-card status label must be accurate ("Tersangka", not "terbukti korup") and a short disclaimer footer must clarify legal status + presumption of innocence. Consistent with the existing verified-only public policy.

### 5. Backlog (recorded, not built now)

Record in `CLAUDE.md` "Next Session Should Start With":
**AI succession-refresh admin tool** — clustered-dropdown export → Kimi/Gemini/Claude checks whether a role has a newer office-holder → import updates. A generalization of the `/admin/rekam-bersih` export→AI-fill→import loop.

## Build order

1. Migration `016_kasus_tanggal.sql` (+ apply).
2. Backfill `tanggal_kasus` for era-relevant existing verified cases.
3. BGN data op (needs user-supplied facts).
4. Re-screening wiring (CSV/prompt/import/screener/query).
5. Keranjang Koruptor page + query + nav link.
6. CLAUDE.md backlog note for the succession-refresh tool.

## Out of scope

- AI-driven succession detection (backlog).
- Photos on cards (`pejabat` has no foto column).
- Full 1104-row re-screen (incremental only).
- Map-mode integration (dedicated page only).
```