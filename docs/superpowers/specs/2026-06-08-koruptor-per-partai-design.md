# Koruptor per Partai — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorming) → next: implementation plan
**Surface:** Panel on `/keranjang-koruptor` (locked plan: "panel first, graduate to `/partai`")

## Goal

Turn `partai` from a decorative per-official label into a **party-accountability axis**: show the public *how many pejabat from each party are corrupt*, so a party that cannot keep its members clean is visible. The "clean" side is context, not the headline.

## Metric (settled)

Per party, the **count** of pejabat with a verified corruption case, attributed to the party the official belonged to **at the time of that case**, displayed beside the number of current officials whose party we know:

```
PDIP · 4 koruptor · dari 19 pejabat terdata
```

- **Count, not a rate.** No percentage is computed or displayed.
- **Ranked by count** descending.
- **Numerator party** = snapshot on the case (party-at-time-of-case).
- **Denominator "terdata"** = current officials per party from active `jabatan.partai`.
- Both sources pass through the canonical map (`web/lib/partai.ts` / `scripts/_partai.py`) so labels align.
- A party-switcher can appear in one party's numerator and another's denominator. Acceptable for a count; copy stays honest about what each number means.

### Decisions captured during brainstorming
1. **Attribution = party at time of case** (fairest; a party isn't blamed for someone who joined later). Chosen over "current party only" and "every party ever a member of."
2. **Capture = snapshot party onto the case** (new `kasus.partai` column filled at screen/verify time). Chosen over auto-derive-from-jabatan-dates (breaks on null dates, conflates designation date with crime date) and a normalized `kasus.jabatan_id` link (overkill at ~20 cases).
3. **Display = count + members-as-context** (count headline, tracked total beside it). Chosen over bare count (big party always looks worst) and a forced rate.

## Why this ships now

The **numerator — the ranking itself — needs only the ~20 existing verified cases tagged with a party.** That is a one-afternoon backfill, independent of the national partai enrichment. The national fill improves denominator context and profiles over time but is **not a prerequisite** for the ranking.

## Current state (gap)

- `partai` shows **only** on the profile page (`ProfileClient.tsx:358,419`) — a chip on the active jabatan + a column in the history table. Decorative, per-person.
- `/keranjang-koruptor` is **party-blind**: lists corrupt officials by posisi/wilayah/lembaga, no party, no aggregation (`KeranjangShell.tsx`).
- `kasus` links only to `pejabat_id` (migration `007`); has `tanggal_kasus` (migration `016`); **no party, no jabatan link.**
- `partai` lives on `jabatan` (locked rule); many jabatan rows have null `mulai_jabatan`/`selesai_jabatan`.
- `kasus_screened` keyed by `pejabat_id` (migration `010`) tracks who was screened.

## Components

### 1. Data model — migration `017_kasus_partai.sql`
```sql
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS partai varchar;
```
No index (small table). Nullable. A case with no party tagged falls into a "belum dikaitkan" bucket — never silently dropped.

### 2. Capture (write paths)
- **`web/app/api/admin/import-kasus-csv/route.ts`** (live admin rekam-bersih loop): read a new `partai` CSV column → `normalizePartai` → set `kasusRow.partai` when non-empty. Mirrors how `tanggal_kasus` is already handled (`route.ts:131-138`).
- **`web/app/api/admin/export-kasus-csv/route.ts`**: add a `partai` column to the exported CSV.
- **Screening prompt** (on `/admin/rekam-bersih`): add a line — *"partai: keanggotaan/partai pengusung pejabat saat kasus ini terjadi, singkatan resmi (PDIP, Golkar, …); kosongkan jika tidak yakin."*
- CLI mirror (`scripts/import_kasus.py`) is a nice-to-have, **not** required for the first slice.

### 3. Backfill existing verified cases
One-off `scripts/backfill_kasus_partai.py` (or manual export → tag → re-import): for each verified kasus, set `partai` = party-at-case, researched manually or via one AI pass, run through `normalize_partai`. Small N (~20). This is what lights up the ranking.

### 4. Query — `listPartaiKoruptor()` in `web/lib/queries.ts`
- **Numerator:** verified kasus since `PRABOWO_START`. Count is in **distinct pejabat** (a person = one koruptor, even with multiple cases). Group each pejabat under `normalizePartai(kasus.partai)`. A pejabat with at least one tagged party counts under that party; a pejabat whose verified cases are **all** null/empty partai → "Belum dikaitkan" bucket (also counted in distinct pejabat). At ~20 cases, a single pejabat spanning two tagged parties is theoretical; if it occurs, attribute to the most recent case's party.
- **Denominator (context):** current officials per party from active `jabatan.partai` (status `aktif`), normalized.
- **Returns:** `{ partai: string, koruptorCount: number, koruptorList: {pejabat_id, nama, posisi, status}[], terdataCount: number }[]`, sorted by `koruptorCount` desc. Plus a separate `belumDikaitkanCount: number`.
- Server supabase (verified kasus + jabatan are public-readable).
- Add the return type to `web/lib/types.ts`.

### 5. UI — `PartaiKoruptorPanel` on `/keranjang-koruptor`
Ranked panel above the existing case list, matching `kk-` editorial style (DM Mono / Fraunces):

```
KORUPTOR PER PARTAI                    (partai saat kasus)
─────────────────────────────────────────────────────────
Gerindra   ███████  3 koruptor · dari 24 pejabat terdata   ▸
PDIP       █████    2 koruptor · dari 19 pejabat terdata   ▸
PKB        ██       1 koruptor · dari 8 pejabat terdata    ▸
─────────────────────────────────────────────────────────
Belum dikaitkan ke partai: 4 kasus
```

- Each row expands (`▸`) to its named officials → link to `/${pejabat_id}` profiles.
- The "belum dikaitkan" footnote keeps the panel reconciled with the case list below.
- Server component fetches via `listPartaiKoruptor()`, passes to the (client) panel for expand/collapse; or a `<details>` element to stay server-only. Implementation plan decides.

### 6. Legal / copy posture
- Headline label: **"Koruptor per Partai · jumlah pejabat dengan kasus terverifikasi"** — never "partai paling korup."
- Extend the existing praduga-tak-bersalah disclaimer (`KeranjangShell.tsx:190-201`) with one line: attribution reflects party membership **at the time of the case**; counts only verified cases.
- "pejabat terdata" defined inline: officials whose party is recorded — not all party members.

### 7. Testing
- Query unit test: seed cases across ≥2 parties, include one **null-partai** case (→ belum dikaitkan) and one **party-switcher** (numerator party ≠ current jabatan party) → assert counts land in the right buckets and the switcher does not double-count.
- Normalization test: `PDI-P`, `Partai Golkar` etc. collapse to canonical before grouping.
- Browser-verify on `/keranjang-koruptor`: panel renders, expands, and `Σ koruptorCount + belumDikaitkanCount == total distinct pejabat with verified cases` (all three in the same unit — distinct pejabat).

## Out of scope (YAGNI)

- Standalone `/partai` page (the "graduate to" step).
- Profile-page party-accountability widgets.
- Homepage party rollup.
- Any rate / percentage.
- `kasus.jabatan_id` normalized link.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/017_kasus_partai.sql` | new — add `kasus.partai` |
| `web/app/api/admin/import-kasus-csv/route.ts` | read + normalize `partai` column |
| `web/app/api/admin/export-kasus-csv/route.ts` | add `partai` column |
| `web/app/admin/rekam-bersih/page.tsx` | add `partai` line to screening prompt |
| `web/lib/queries.ts` | new `listPartaiKoruptor()` |
| `web/lib/types.ts` | new return type |
| `web/app/keranjang-koruptor/page.tsx` | fetch + pass party data |
| `web/app/keranjang-koruptor/KeranjangShell.tsx` (or new `PartaiKoruptorPanel.tsx`) | render panel + extend disclaimer |
| `scripts/backfill_kasus_partai.py` | new — one-off backfill of ~20 cases |
| query test | new |
