# Rekam Bersih CSV Workflow — Design Spec

**Date:** 2026-05-30  
**Status:** Approved

## Overview

Manual kasus screening workflow via Gemini/Claude web as a cost-free alternative to running `screen_kasus_llm.py` with Kimi. Admin exports unscreened pejabat as CSV, pastes into Gemini/Claude web with a canned prompt, AI fills corruption data, admin re-uploads. Import writes to the same DB tables and in the same shape as the Kimi screener — so `--report`, `verify_kasus.py`, and the public pejabat profile badges all behave identically regardless of which path produced the data.

## Affected Tables

### `kasus_screened` (upsert on import)
```
pejabat_id        UUID PK
last_screened_at  TIMESTAMPTZ  ← set to now()
last_result       TEXT         ← 'found' | 'bersih'
last_keyakinan    TEXT         ← from CSV column
```

### `kasus` (insert on import, found rows only)
```
pejabat_id  UUID
status      TEXT  ← tersangka | terdakwa | terpidana  (required for found)
jenis       TEXT  ← nullable
lembaga     TEXT  ← nullable
tahun       INT   ← nullable
ringkasan   TEXT  ← nullable
url_sumber  TEXT  ← nullable
verified    BOOLEAN  ← NOT SET (NULL) — verifier picks these up
```

`verified` is intentionally omitted on insert so `verify_kasus.py` (`WHERE verified IS NULL`) processes imported rows identically to Kimi output.

## CSV Format

### Export columns (fixed order)
```
pejabat_id, nama, jabatan, provinsi,
kasus_found, status, jenis, lembaga, tahun, ringkasan, url_sumber, keyakinan
```

- First 4 columns are read-only context for the AI.
- Last 8 columns are blank on export; AI fills them.
- `kasus_found`: `1` = found, `0` = bersih
- `status`: one of `tersangka | terdakwa | terpidana` — required if `kasus_found=1`
- `keyakinan`: one of `tinggi | sedang | rendah`

### Filename
`kasus_export_<provinsi-slug>.csv` — e.g. `kasus_export_jawa_tengah.csv`

## Import Logic (mirrors `screen_kasus_llm.py`)

```
for each row:
  skip if pejabat_id empty or invalid UUID
  skip if pejabat_id already in kasus table  → skipped_existing++

  if kasus_found = 0:
    upsert kasus_screened(last_result='bersih', last_keyakinan, last_screened_at=now())
    bersih++

  if kasus_found = 1:
    if status blank:
      upsert kasus_screened(last_result='bersih', ...)   ← mirrors "tidak terbukti (no status)" branch
      warn in errors[]
      bersih++
    else:
      INSERT kasus(pejabat_id, status, jenis, lembaga, tahun, ringkasan, url_sumber)
      upsert kasus_screened(last_result='found', last_keyakinan, last_screened_at=now())
      found++
```

Result payload: `{ found, bersih, skipped_existing, errors: string[], total }`

## Export Logic

Query: pejabat where province matches selection AND pejabat_id NOT already in `kasus` table AND NOT in `kasus_screened` with `last_result IN ('found','bersih')`.  
Rows with `last_result='error'` are re-exported (need retry).  
Joins: `pejabat → jabatan → wilayah` for posisi + province name.

## Components

### New files
| Path | Role |
|---|---|
| `web/app/admin/rekam-bersih/page.tsx` | Client component — export + import UI |
| `web/app/api/admin/export-kasus-csv/route.ts` | GET — returns CSV download |
| `web/app/api/admin/import-kasus-csv/route.ts` | POST — multipart CSV → DB writes |

### Modified files
| Path | Change |
|---|---|
| `web/app/admin/layout.tsx` | Add nav entry `{ href: '/admin/rekam-bersih', label: 'Rekam Bersih', icon: '⦿' }` between Partai & Masa Jabatan and Impor Scraper |

## UI Structure (`/admin/rekam-bersih`)

Mirrors `/admin/placeholders` visual style exactly (same CSS variables, `.ph-section`, `.btn`, `.upload-zone`, `.result-card` classes).

**Langkah 1 — Unduh daftar pejabat**
- Province `<select>` (38 provinces, hardcoded in page from BPS 2024 list, alphabetical, placeholder "Pilih provinsi...")
- Download button (disabled until province selected) → `GET /api/admin/export-kasus-csv?provinsi=<name>`
- Copy-on-click Gemini/Claude prompt block (Indonesian)

**Gemini/Claude prompt (Indonesian)**
```
Ini adalah daftar pejabat Indonesia. Untuk setiap baris, cari di web apakah pejabat tersebut
pernah ditetapkan sebagai tersangka, terdakwa, atau terpidana dalam kasus korupsi/tipikor.

Isi kolom berikut:
- kasus_found: 1 jika ada kasus, 0 jika tidak
- status: tersangka / terdakwa / terpidana (kosongkan jika kasus_found=0)
- jenis: korupsi / suap / gratifikasi / pencucian_uang / lainnya
- lembaga: KPK / Kejagung / Kejati / Pengadilan Tipikor
- tahun: tahun penetapan tersangka/vonis (angka)
- ringkasan: 1-2 kalimat ringkasan kasus
- url_sumber: URL artikel/sumber terpercaya
- keyakinan: tinggi / sedang / rendah

ATURAN KETAT:
- Hanya laporkan jika nama pejabat DISEBUTKAN EKSPLISIT sebagai tersangka/terdakwa/terpidana.
- Sumber valid: kpk.go.id, Kejagung, Kejati, Tempo, Kompas, Detik, CNN Indonesia.
- Jangan laporkan jika hanya saksi, terindikasi, atau sudah SP3/bebas.
- Kalau tidak ada kasus, isi kasus_found=0 dan kosongkan kolom lainnya.
- Kembalikan seluruh tabel dalam format CSV yang sama persis.
```

**Langkah 2 — Unggah hasil**
- Upload zone (CSV only, `.csv` accept)
- POST to `/api/admin/import-kasus-csv`
- Result card: Found / Bersih / Skipped / Errors (4-column grid, same dark card style)

## Auth

Both API routes check `admin_session` cookie — same pattern as all other admin routes.

## Playwright Test Plan

Use MCP Playwright (not a separate test file). Steps after implementation:

1. Log in via `/admin/login` form (or set cookie directly)
2. Navigate to `/admin/rekam-bersih` → assert two `.ph-section` elements visible
3. Select a province → click export button → assert response `Content-Type: text/csv`
4. Prepare fixture CSV: 2 rows — one `kasus_found=0`, one `kasus_found=1, status=tersangka, lembaga=KPK, tahun=2023, ringkasan=..., url_sumber=..., keyakinan=tinggi`
5. Upload fixture CSV via upload zone
6. Assert result card shows `found=1, bersih=1, skipped_existing=0`
7. Navigate to the "found" pejabat's profile page → assert `● KASUS` badge is visible

## What `--report` Sees After Import

`screen_kasus_llm.py --report` reads:
- Found count: `kasus` table rows for that pejabat_id → import inserts here ✓
- Bersih count: `kasus_screened` rows with `last_result='bersih'` → import upserts here ✓
- Screened %: union of kasus + kasus_screened → import covers both ✓

Import is fully transparent to `--report` and `verify_kasus.py`.
