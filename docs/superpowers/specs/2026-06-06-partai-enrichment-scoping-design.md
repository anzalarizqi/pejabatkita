# Spec: Scoped Partai Enrichment + Coverage Report

**Date:** 2026-06-06
**Branch (proposed):** `feat/partai-enrichment-scoping`
**Status:** Approved design — ready for implementation plan

## Problem

Partai is the next locked data priority and the prerequisite for any future
"corruption per partai" view. Live coverage (queried 2026-06-06):

| | count |
|---|---|
| Total `jabatan` | 1,219 |
| `partai` filled | 158 (13%) |
| `partai` null | 1,061 (87%) |

The enrichment workflow already exists (`/admin/enrichment` + `export_enrichment.py`),
but it is **unusable at scale**: the export dumps **all 1,061 null-`partai` rows in one
CSV**, which is too large to paste into Gemini/Claude web. By contrast,
`/admin/rekam-bersih` works because it scopes each export to one province (or a 40-row
Pusat batch), keeping each AI-fill CSV small.

We want the partai enrichment to use the **exact same workflow as rekam-bersih**:

1. Export a **scoped** CSV (one province, or one Pusat batch)
2. AI fills it with a canned prompt
3. Upload the filled CSV (import)
4. A terminal step to understand completeness

The corruption flow needs LLM re-verification because a corruption claim is high-stakes.
Partai is **public record** (KPU data), low-ambiguity, so it does **not** warrant LLM
re-verification. Its real failure modes are (1) non-standard/typo'd names, (2) blanks,
(3) wrong-but-real attributions. We defend against (1) and (2) cheaply; (3) is accepted
as residual risk (mitigated by a no-guessing prompt + required source URL).

A rigid party allow-list would fight reality (parties form, merge, rename), so validation
**flags unknowns, never rejects them.**

## Goals

- Scope the enrichment export by province and by Pusat batch, mirroring
  `export-kasus-csv` exactly.
- Replace the single Export button on `/admin/enrichment` with the rekam-bersih dropdown.
- Make the canned AI prompt bulletproof and self-adapting for partai.
- Normalize known party-name aliases at import; flag unknown/new parties for review
  without rejecting them.
- Add `python scripts/export_enrichment.py --report` to print partai coverage
  (per province + Pusat) plus a "non-canonical partai in DB" review list.

## Non-Goals (YAGNI)

- **No masa-jabatan / nama / kasus dimensions in `--report`** — partai only. Masa jabatan
  later.
- **No LLM re-verification** of partai (rejected: overkill for a public-record field).
- **No schema change** — partai stays a plain text column on `jabatan`; no
  pending/verified state.
- **No per-province sub-batching** — only Pusat is batched (40/batch), matching
  rekam-bersih. A ~100-row province CSV is still AI-manageable. Revisit only if a real
  province proves too big.
- **No new `verify_partai.py` script** — validation lives at import + in `--report`.

## Components

### A. Scoped enrichment export (web)

**`web/app/api/admin/export-enrichment/route.ts`** — adopt the `export-kasus-csv` scoping
contract:

- `GET ?provinsi=<nama>` → only that province's null-`partai` jabatan rows.
- `GET ?bucket=pusat&meta=1` → `{ unscreened, batchSize, batches }` (JSON), where
  candidates are `level='pusat'` jabatan with null `partai`.
- `GET ?bucket=pusat&batch=N` → one slice of `PUSAT_BATCH_SIZE = 40`, deterministically
  sorted (so batch boundaries are stable across calls).
- No `provinsi` and no `bucket` → `400` (forces a selection, like rekam-bersih).

Behavior preserved from today's export:
- Only null-`partai` jabatan are exported.
- Placeholder rows (`is_placeholder=Y`) are **included** (enrichment also fills names).
- CSV columns unchanged:
  `pejabat_id, jabatan_id, nama_lengkap, posisi, wilayah, provinsi, mulai_jabatan,
  selesai_jabatan, is_placeholder, partai, mulai_jabatan_baru, selesai_jabatan_baru,
  nama_baru, sumber_url, catatan`
- Within a province export, real names sort before placeholders, then by wilayah → posisi.

Province scoping reuses the row's already-computed `provinsi` field (filter
`entries` by `provinsi === selected`). **Pusat is identified by `pejabat.level === 'pusat'`**
— the same definition `export-kasus-csv` uses — not by wilayah. These are the null-`partai`
jabatan whose pejabat is a central-government official (and which currently export with an
empty `provinsi`). The implementer must join pejabat.level, since the current enrichment
export does not fetch it.

**`web/app/admin/enrichment/page.tsx`** — replace the single Export button with the
rekam-bersih dropdown pattern:
- On mount, `fetch('/api/admin/export-enrichment?bucket=pusat&meta=1')` to learn pusat
  batch count.
- `<select>` lists `Pusat · Kabinet (n/N)` options (if any) then the 38 provinces.
- Download href: `?bucket=pusat&batch=N` for pusat options, else
  `?provinsi=<encoded>`.
- Reuse existing rekam-bersih styles (`.province-row`, `.province-select`, `.btn-primary`)
  so the page looks identical.

### B. Bulletproof adaptive prompt (web)

Replace the partai portion of the canned prompt on `/admin/enrichment` with:

> Ini daftar jabatan pejabat Indonesia yang belum ada data partai. Untuk setiap baris,
> cari di web partai politik pengusung pejabat tersebut saat dilantik.
>
> Isi kolom:
> - **partai** — gunakan SINGKATAN RESMI (PDIP, Golkar, Gerindra, PKB, NasDem, PPP, PKS,
>   Demokrat, PAN, PSI, Perindo, Hanura, PBB, dll).
>   - Jalur perseorangan/independen → tulis **"Independen"**.
>   - Partai baru yang tidak ada di contoh → tetap gunakan nama/singkatan RESMI partai itu.
>   - Tidak yakin atau tanpa sumber kredibel → **BIARKAN KOSONG. Jangan menebak.**
> - **sumber_url** — WAJIB diisi jika partai diisi (KPU, situs resmi pemda, berita
>   kredibel).
> - mulai_jabatan_baru / selesai_jabatan_baru / nama_baru — opsional; isi hanya jika tahu.
>
> ATURAN KETAT:
> - Satu pejabat = satu partai pengusung utama saat pemilihan. Jika diusung koalisi, tulis
>   partai asal/kader pejabat.
> - JANGAN menebak dari kemiripan nama atau asumsi. Tanpa sumber = kosong.
> - Gunakan singkatan resmi yang konsisten (PDIP, bukan "PDI-P" atau "PDI Perjuangan").
> - Kembalikan seluruh tabel CSV dalam format yang sama persis (header + semua baris,
>   termasuk yang tidak diubah).

Adaptive: new parties are allowed; guessing is forbidden.

### C. Flag-not-reject validation (shared + web import)

A single shared canonical map — alias (lowercased, normalized) → canonical short name:

```
PDIP      ← pdip, pdi-p, pdi perjuangan, partai pdip
Golkar    ← golkar, partai golkar
Gerindra  ← gerindra, partai gerindra
PKB       ← pkb, partai kebangkitan bangsa
NasDem    ← nasdem, nasional demokrat, partai nasdem
PPP       ← ppp, partai persatuan pembangunan
PKS       ← pks, partai keadilan sejahtera
Demokrat  ← demokrat, partai demokrat
PAN       ← pan, partai amanat nasional
PSI       ← psi, partai solidaritas indonesia
Perindo   ← perindo
Hanura    ← hanura
PBB       ← pbb, partai bulan bintang
Independen ← independen, perseorangan, non-partai, jalur independen
```

(Starter set — extend by appending one line.) Lives in **one place**, shared by the web
import route and the report script. For TypeScript: `web/lib/partai.ts`. For Python:
mirror the same constant in `export_enrichment.py` (or a small `scripts/_partai.py` if
clean) — kept in sync manually; the list is short and changes rarely.

**`web/app/api/admin/import-enrichment/route.ts`** — at line 87 (`if (partai)
jabatanPatch['partai'] = partai`):
- Normalize `partai` via the canonical map (case-insensitive, trim, collapse spaces).
- Known alias → write the canonical form.
- Unknown non-empty value → write it **as-is** (never reject) and add it to a
  `reviewPartai: string[]` list returned in the JSON result so the admin sees
  "N partai perlu ditinjau: …".
- Empty → unchanged (skip, as today).

Add `reviewPartai` to the `ImportResult` type and surface it in the page result card.

### D. `--report` coverage + review (terminal)

**`python scripts/export_enrichment.py --report`** — when present, fetch **all** jabatan
(`id, wilayah_id, partai`) plus wilayah, group by province (+ a single `Pusat · Kabinet`
bucket for `level='pusat'`/national seats), and print:

```
PARTAI COVERAGE
                        total  filled  remaining    %
  Aceh                     34       8        26    24%
  ...
  Pusat · Kabinet         118      40        78    34%
  ─────────────────────────────────────────────────
  TOTAL                  1219     158      1061    13%

NON-CANONICAL PARTAI (perlu ditinjau):
  "PDI-P"            (3 jabatan)   → mungkin maksudnya PDIP?
  "Partai Buruh"     (1 jabatan)   → tidak dikenal, cek apakah partai baru
```

- `filled` = `partai IS NOT NULL AND trim != ''`.
- Denominator = **all** jabatan rows (including `nonaktif`); matches the 1,219 total.
- `--report` **writes no CSV** and exits after printing.
- The non-canonical list = distinct DB `partai` values not in the canonical set (after
  normalization), with counts — the eyeball-review surface. Does not modify data.

## Data Flow (end-to-end, mirrors rekam-bersih)

```
[admin] pick province / Pusat batch
   → GET export-enrichment (scoped)         → small CSV
   → paste into Gemini/Claude + bulletproof prompt
   → AI fills partai (+ optional masa jabatan / nama)
   → upload CSV → POST import-enrichment
        → normalize known aliases → write partai
        → unknown party written as-is + listed in reviewPartai
   → terminal: export_enrichment.py --report
        → coverage % per province + Pusat
        → non-canonical partai list to eyeball
```

## Error Handling

- Export with unknown `provinsi` → `404` (reuse existing pattern); pusat `batch` out of
  range → `400`.
- Import: malformed dates already warn (unchanged). Unknown partai never errors — it is
  flagged, not rejected.
- `--report`: if Supabase env missing, fail with the existing `KeyError`/clear message
  (same as the rest of the script).

## Testing / Verification

- **Export route**: province param returns only that province's null-partai rows; pusat
  `meta=1` returns a batch count; `batch=N` returns ≤40 rows; no-param → 400. Verify
  against live DB counts.
- **Page**: dropdown shows provinces + Pusat batches; selecting each builds the correct
  href and downloads a non-empty CSV. Browser-verified (Playwright MCP), matching the
  rekam-bersih verification done previously.
- **Import normalization**: upload a CSV with `PDI-P` and a fake `Partai XYZ` → DB stores
  `PDIP`; result JSON lists `Partai XYZ` under `reviewPartai`.
- **`--report`**: totals reconcile with direct DB counts (1,219 / 158 / 1,061 at time of
  writing); non-canonical list surfaces any seeded bad value.

## Files Touched

- `web/app/api/admin/export-enrichment/route.ts` — add provinsi + pusat-batch scoping.
- `web/app/admin/enrichment/page.tsx` — dropdown + bulletproof prompt + reviewPartai UI.
- `web/app/api/admin/import-enrichment/route.ts` — normalize + flag unknown partai.
- `web/lib/partai.ts` *(new)* — canonical alias map + `normalizePartai()`.
- `scripts/export_enrichment.py` — `--report` flag + mirrored canonical map.

## Open Risks (accepted)

- **Wrong-but-real attribution** (failure mode 3) is not caught by validation. Mitigated
  by the no-guessing prompt + required `sumber_url`; accepted as residual for a
  public-record field.
- **TS/Python canonical map drift** — two copies of a short list, synced by hand.
  Acceptable; a single party addition is one line in each.
```
