# Scoped Partai Enrichment + Coverage Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make partai enrichment use the exact rekam-bersih workflow — province/Pusat-batch scoped CSV export, a bulletproof adaptive AI prompt, flag-not-reject normalization at import, and a `--report` for coverage.

**Architecture:** Two surfaces touch the same canonical party-name logic, kept in a TS module (`web/lib/partai.ts`) and a mirrored Python module (`scripts/_partai.py`). The web export route adopts the `export-kasus-csv` scoping contract (`?provinsi=` / `?bucket=pusat&batch=N`). The import route normalizes known aliases and flags unknowns. A new `--report` flag on `export_enrichment.py` prints coverage + a non-canonical review list. No schema change.

**Tech Stack:** Next.js 16 route handlers (TypeScript), React client component, Python 3.11 + Supabase Python client. Verification: standalone `python` test scripts (Python), `npx tsc --noEmit` + real curl against the dev server with a login cookie + Playwright MCP browser check (web) — matching this project's existing no-mocking, browser-verify conventions.

**Spec:** `docs/superpowers/specs/2026-06-06-partai-enrichment-scoping-design.md`

---

## File Structure

- **Create** `scripts/_partai.py` — Python canonical map + `normalize_partai()`. (Task 1)
- **Create** `scripts/test_partai_normalize.py` — standalone test. (Task 1)
- **Create** `web/lib/partai.ts` — TS canonical map + `normalizePartai()`. (Task 2)
- **Modify** `web/app/api/admin/export-enrichment/route.ts` — province + Pusat-batch scoping. (Task 3)
- **Modify** `web/app/api/admin/import-enrichment/route.ts` — normalize + flag unknown partai. (Task 4)
- **Modify** `web/app/admin/enrichment/page.tsx` — dropdown + bulletproof prompt + reviewPartai UI. (Task 5)
- **Modify** `scripts/export_enrichment.py` — `--report` flag. (Task 6)
- End-to-end browser verification + `next build`. (Task 7)

## Setup (do once before web-route tasks)

Start the dev server and capture an admin session cookie so curl can hit the gated `/api/admin/*` routes (no mocking — real auth, real DB):

```bash
cd web && npm run dev   # leave running in a separate terminal (http://localhost:3000)
```

```bash
# From repo root. ADMIN_PASSWORD is in web/.env.local.
PW=$(grep -E '^ADMIN_PASSWORD=' web/.env.local | cut -d= -f2- | tr -d '"'"'"' ')
curl -s -c /tmp/pk_cookies.txt -X POST http://localhost:3000/api/auth \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}"
# Expected: {"ok":true}
```

Use `-b /tmp/pk_cookies.txt` on subsequent curls.

---

### Task 1: Python canonical partai map + test

**Files:**
- Create: `scripts/_partai.py`
- Create: `scripts/test_partai_normalize.py`

- [ ] **Step 1: Write the failing test**

Create `scripts/test_partai_normalize.py`:

```python
"""Standalone test for partai normalization.
Run: python scripts/test_partai_normalize.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _partai import normalize_partai, CANONICAL_PARTAI


def check(raw, expected_value, expected_known):
    value, known = normalize_partai(raw)
    assert value == expected_value, f"value({raw!r}): got {value!r}, want {expected_value!r}"
    assert known == expected_known, f"known({raw!r}): got {known}, want {expected_known}"
    print(f"  ok: {raw!r} -> ({value!r}, {known})")


def main():
    check("PDI-P", "PDIP", True)
    check("  pdi perjuangan ", "PDIP", True)
    check("Partai Golkar", "Golkar", True)
    check("GERINDRA", "Gerindra", True)
    check("Perseorangan", "Independen", True)
    check("Partai Buruh", "Partai Buruh", False)   # unknown — kept as-is, not rejected
    check("", "", False)
    check(None, "", False)
    assert "PDIP" in CANONICAL_PARTAI
    assert "Independen" in CANONICAL_PARTAI
    print("\nAll partai normalization tests passed.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python scripts/test_partai_normalize.py`
Expected: FAIL — `ModuleNotFoundError: No module named '_partai'`

- [ ] **Step 3: Write the implementation**

Create `scripts/_partai.py`:

```python
"""Canonical Indonesian political-party names + alias normalization.

Shared by export_enrichment.py (--report) and test_partai_normalize.py.
Mirror of web/lib/partai.ts — keep both in sync (one line per new party).
"""
from __future__ import annotations

# Canonical short name -> aliases (lowercased, space-collapsed) mapping to it.
_PARTAI_ALIASES: dict[str, list[str]] = {
    "PDIP": ["pdip", "pdi-p", "pdi p", "pdi perjuangan", "partai pdip",
             "partai demokrasi indonesia perjuangan"],
    "Golkar": ["golkar", "partai golkar"],
    "Gerindra": ["gerindra", "partai gerindra"],
    "PKB": ["pkb", "partai kebangkitan bangsa"],
    "NasDem": ["nasdem", "nasional demokrat", "partai nasdem",
               "partai nasional demokrat"],
    "PPP": ["ppp", "partai persatuan pembangunan"],
    "PKS": ["pks", "partai keadilan sejahtera"],
    "Demokrat": ["demokrat", "partai demokrat"],
    "PAN": ["pan", "partai amanat nasional"],
    "PSI": ["psi", "partai solidaritas indonesia"],
    "Perindo": ["perindo", "partai perindo"],
    "Hanura": ["hanura", "partai hanura"],
    "PBB": ["pbb", "partai bulan bintang"],
    "Independen": ["independen", "perseorangan", "non-partai", "nonpartai",
                   "jalur independen", "jalur perseorangan"],
}

CANONICAL_PARTAI: frozenset[str] = frozenset(_PARTAI_ALIASES.keys())

_ALIAS_TO_CANONICAL: dict[str, str] = {
    alias: canon for canon, aliases in _PARTAI_ALIASES.items() for alias in aliases
}


def _key(raw: str) -> str:
    return " ".join(raw.strip().lower().split())


def normalize_partai(raw: str | None) -> tuple[str, bool]:
    """Return (value, known).

    - known alias  -> (canonical short name, True)
    - empty/None   -> ("", False)
    - unrecognized -> (original trimmed value, False)   # never rejected
    """
    if not raw or not raw.strip():
        return "", False
    canon = _ALIAS_TO_CANONICAL.get(_key(raw))
    if canon:
        return canon, True
    return raw.strip(), False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python scripts/test_partai_normalize.py`
Expected: PASS — ends with `All partai normalization tests passed.`

- [ ] **Step 5: Commit**

```bash
git add scripts/_partai.py scripts/test_partai_normalize.py
git commit -m "feat(scripts): canonical partai map + normalize (flag-not-reject)"
```

---

### Task 2: TypeScript canonical partai map

**Files:**
- Create: `web/lib/partai.ts`

- [ ] **Step 1: Write the implementation**

Create `web/lib/partai.ts`:

```typescript
// Canonical Indonesian political-party names + alias normalization.
// Mirror of scripts/_partai.py — keep both in sync (one line per new party).

const PARTAI_ALIASES: Record<string, string[]> = {
  PDIP: ['pdip', 'pdi-p', 'pdi p', 'pdi perjuangan', 'partai pdip',
    'partai demokrasi indonesia perjuangan'],
  Golkar: ['golkar', 'partai golkar'],
  Gerindra: ['gerindra', 'partai gerindra'],
  PKB: ['pkb', 'partai kebangkitan bangsa'],
  NasDem: ['nasdem', 'nasional demokrat', 'partai nasdem', 'partai nasional demokrat'],
  PPP: ['ppp', 'partai persatuan pembangunan'],
  PKS: ['pks', 'partai keadilan sejahtera'],
  Demokrat: ['demokrat', 'partai demokrat'],
  PAN: ['pan', 'partai amanat nasional'],
  PSI: ['psi', 'partai solidaritas indonesia'],
  Perindo: ['perindo', 'partai perindo'],
  Hanura: ['hanura', 'partai hanura'],
  PBB: ['pbb', 'partai bulan bintang'],
  Independen: ['independen', 'perseorangan', 'non-partai', 'nonpartai',
    'jalur independen', 'jalur perseorangan'],
}

export const CANONICAL_PARTAI: ReadonlySet<string> = new Set(Object.keys(PARTAI_ALIASES))

const ALIAS_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(PARTAI_ALIASES).flatMap(([canon, aliases]) =>
    aliases.map(a => [a, canon] as const),
  ),
)

function key(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).join(' ')
}

/**
 * Returns [value, known].
 * - known alias  -> [canonical short name, true]
 * - empty        -> ['', false]
 * - unrecognized -> [trimmed input, false]   // never rejected
 */
export function normalizePartai(raw: string | null | undefined): [string, boolean] {
  if (!raw || !raw.trim()) return ['', false]
  const canon = ALIAS_TO_CANONICAL[key(raw)]
  if (canon) return [canon, true]
  return [raw.trim(), false]
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no errors (clean exit).

- [ ] **Step 3: Commit**

```bash
git add web/lib/partai.ts
git commit -m "feat(web): canonical partai map + normalizePartai (mirror of _partai.py)"
```

---

### Task 3: Scope the enrichment export route

**Files:**
- Modify: `web/app/api/admin/export-enrichment/route.ts` (full rewrite)

This adopts the `export-kasus-csv` scoping contract: `?provinsi=<nama>` returns one province's null-partai rows; `?bucket=pusat&meta=1` returns batch counts; `?bucket=pusat&batch=N` returns one 40-row slice; neither → 400. Pusat = `pejabat.level === 'pusat'`.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `web/app/api/admin/export-enrichment/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAdmin } from '@/lib/auth'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i
const PUSAT_BATCH_SIZE = 40

function isPlaceholder(name: string | null): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function csvField(f: string | null | undefined): string {
  const s = (f ?? '').toString()
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function csvRow(fields: (string | null | undefined)[]): string {
  return fields.map(csvField).join(',')
}

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from(table).select(columns).range(offset, offset + 999)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < 1000) break
    offset += 1000
  }
  return rows
}

async function fetchJabatanNullPartai(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<{ id: string; pejabat_id: string; wilayah_id: string; posisi: string; mulai_jabatan: string | null; selesai_jabatan: string | null }[]> {
  const rows: { id: string; pejabat_id: string; wilayah_id: string; posisi: string; mulai_jabatan: string | null; selesai_jabatan: string | null }[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('jabatan')
      .select('id, pejabat_id, wilayah_id, posisi, mulai_jabatan, selesai_jabatan')
      .is('partai', null)
      .range(offset, offset + 999)
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < 1000) break
    offset += 1000
  }
  return rows
}

const CSV_HEADER = csvRow([
  'pejabat_id', 'jabatan_id', 'nama_lengkap', 'posisi', 'wilayah', 'provinsi',
  'mulai_jabatan', 'selesai_jabatan', 'is_placeholder',
  'partai', 'mulai_jabatan_baru', 'selesai_jabatan_baru', 'nama_baru', 'sumber_url', 'catatan',
])

type Entry = {
  pejabat_id: string; jabatan_id: string; nama_lengkap: string
  posisi: string; wilayah: string; provinsi: string
  mulai_jabatan: string; selesai_jabatan: string
  is_placeholder: string; level: string
}

function entryToRow(e: Entry): string {
  return csvRow([
    e.pejabat_id, e.jabatan_id, e.nama_lengkap, e.posisi, e.wilayah, e.provinsi,
    e.mulai_jabatan, e.selesai_jabatan, e.is_placeholder,
    '', '', '', '', '', '',
  ])
}

async function buildEntries(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<Entry[]> {
  const [wilayahRows, pejabatRows, jabatanRows] = await Promise.all([
    fetchAll<{ id: string; kode_bps: string; nama: string; level: string; parent_id: string | null }>(
      supabase, 'wilayah', 'id, kode_bps, nama, level, parent_id',
    ),
    fetchAll<{ id: string; nama_lengkap: string; gelar_depan: string | null; gelar_belakang: string | null; level: string | null }>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, level',
    ),
    fetchJabatanNullPartai(supabase),
  ])

  const wilayahById = new Map(wilayahRows.map(w => [w.id, w]))
  const provById = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.id, w.nama]))
  const provByKode = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.kode_bps, w.nama]))
  const pejabatById = new Map(pejabatRows.map(p => [p.id, p]))

  function getProvinsi(w: { id: string; level: string; parent_id: string | null; kode_bps: string }): string {
    if (w.level === 'provinsi') return provById.get(w.id) ?? ''
    if (w.parent_id) return provById.get(w.parent_id) ?? ''
    return provByKode.get(w.kode_bps.slice(0, 2)) ?? ''
  }

  const entries: Entry[] = []
  for (const j of jabatanRows) {
    const p = pejabatById.get(j.pejabat_id)
    if (!p) continue
    const w = wilayahById.get(j.wilayah_id)
    if (!w) continue
    const gelarD = p.gelar_depan?.trim() ?? ''
    const gelarB = p.gelar_belakang?.trim() ?? ''
    const nama = [gelarD, p.nama_lengkap, gelarB].filter(Boolean).join(' ')
    entries.push({
      pejabat_id: p.id,
      jabatan_id: j.id,
      nama_lengkap: nama,
      posisi: j.posisi ?? '',
      wilayah: w.nama,
      provinsi: getProvinsi(w),
      mulai_jabatan: j.mulai_jabatan ?? '',
      selesai_jabatan: j.selesai_jabatan ?? '',
      is_placeholder: isPlaceholder(p.nama_lengkap) ? 'Y' : '',
      level: p.level ?? '',
    })
  }
  return entries
}

function csvResponse(lines: string[], filename: string): NextResponse {
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)
  const params = req.nextUrl.searchParams
  const bucket = params.get('bucket')
  const provinsi = params.get('provinsi')?.trim()

  if (bucket !== 'pusat' && !provinsi) {
    return NextResponse.json({ error: 'provinsi atau bucket=pusat diperlukan' }, { status: 400 })
  }

  const entries = await buildEntries(supabase)

  // --- Pusat batches (pejabat.level === 'pusat') ---
  if (bucket === 'pusat') {
    const pusat = entries
      .filter(e => e.level === 'pusat')
      .sort((a, b) =>
        a.posisi.localeCompare(b.posisi, 'id') ||
        a.nama_lengkap.localeCompare(b.nama_lengkap, 'id'),
      )
    const batches = Math.ceil(pusat.length / PUSAT_BATCH_SIZE)

    if (params.get('meta')) {
      return NextResponse.json({ unscreened: pusat.length, batchSize: PUSAT_BATCH_SIZE, batches })
    }

    const batchN = parseInt(params.get('batch') ?? '1', 10)
    if (isNaN(batchN) || batchN < 1 || (batches > 0 && batchN > batches)) {
      return NextResponse.json({ error: `batch ${batchN} di luar jangkauan (1..${batches})` }, { status: 400 })
    }
    const slice = pusat.slice((batchN - 1) * PUSAT_BATCH_SIZE, batchN * PUSAT_BATCH_SIZE)
    return csvResponse([CSV_HEADER, ...slice.map(entryToRow)], `enrichment_pusat_batch${batchN}.csv`)
  }

  // --- Province ---
  const inProv = entries
    .filter(e => e.provinsi === provinsi)
    .sort((a, b) =>
      (a.is_placeholder ? 1 : 0) - (b.is_placeholder ? 1 : 0) ||
      a.wilayah.localeCompare(b.wilayah, 'id') ||
      a.posisi.localeCompare(b.posisi, 'id'),
    )
  const slug = (provinsi ?? '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return csvResponse([CSV_HEADER, ...inProv.map(entryToRow)], `enrichment_${slug}.csv`)
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 3: Verify the no-param guard returns 400**

Run (dev server + cookie from Setup):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/pk_cookies.txt \
  http://localhost:3000/api/admin/export-enrichment
```
Expected: `400`

- [ ] **Step 4: Verify Pusat meta returns a batch count**

Run:
```bash
curl -s -b /tmp/pk_cookies.txt \
  'http://localhost:3000/api/admin/export-enrichment?bucket=pusat&meta=1'
```
Expected: JSON like `{"unscreened":<N>,"batchSize":40,"batches":<M>}` with `M >= 1`.

- [ ] **Step 5: Verify a province export returns a scoped CSV**

Run (header + rows; counts the data lines for a known-populous province):
```bash
curl -s -b /tmp/pk_cookies.txt \
  'http://localhost:3000/api/admin/export-enrichment?provinsi=Jawa%20Barat' | head -3
echo "rows:"; curl -s -b /tmp/pk_cookies.txt \
  'http://localhost:3000/api/admin/export-enrichment?provinsi=Jawa%20Barat' | tail -n +2 | grep -c ','
```
Expected: first line is the 15-column header; `provinsi` column reads `Jawa Barat` on data rows; row count > 0 and far smaller than 1,061.

- [ ] **Step 6: Verify a Pusat batch returns ≤40 rows**

Run:
```bash
curl -s -b /tmp/pk_cookies.txt \
  'http://localhost:3000/api/admin/export-enrichment?bucket=pusat&batch=1' | tail -n +2 | grep -c ','
```
Expected: a number between 1 and 40.

- [ ] **Step 7: Commit**

```bash
git add web/app/api/admin/export-enrichment/route.ts
git commit -m "feat(web): scope enrichment export by province + Pusat batch"
```

---

### Task 4: Normalize + flag unknown partai at import

**Files:**
- Modify: `web/app/api/admin/import-enrichment/route.ts`

- [ ] **Step 1: Add the import for normalizePartai**

In `web/app/api/admin/import-enrichment/route.ts`, after the existing imports (top of file, after line 3 `import { isAdmin } from '@/lib/auth'`), add:

```typescript
import { normalizePartai } from '@/lib/partai'
```

- [ ] **Step 2: Add the reviewPartai accumulator**

Find this block (around line 67-70):

```typescript
  let jabatanUpdated = 0
  let pejabatUpdated = 0
  let skipped = 0
  const errors: string[] = []
```

Add one line after it:

```typescript
  const reviewPartai = new Set<string>()
```

- [ ] **Step 3: Normalize + flag at the partai write**

Replace this line (currently line 87):

```typescript
    if (partai) jabatanPatch['partai'] = partai
```

with:

```typescript
    if (partai) {
      const [normalized, known] = normalizePartai(partai)
      jabatanPatch['partai'] = normalized
      if (!known) reviewPartai.add(normalized)
    }
```

- [ ] **Step 4: Return reviewPartai in the response**

Replace the final return block (currently lines 130-136):

```typescript
  return NextResponse.json({
    jabatanUpdated,
    pejabatUpdated,
    skipped,
    errors,
    total: rows.length,
  })
```

with:

```typescript
  return NextResponse.json({
    jabatanUpdated,
    pejabatUpdated,
    skipped,
    errors,
    reviewPartai: [...reviewPartai],
    total: rows.length,
  })
```

- [ ] **Step 5: Verify it typechecks**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 6: Verify known→excluded, unknown→flagged (non-destructive)**

This uses all-zero UUIDs so the `jabatan` update matches no real row (nothing mutates). Create the test CSV:

```bash
cat > /tmp/pk_partai_test.csv <<'CSV'
pejabat_id,jabatan_id,nama_lengkap,posisi,wilayah,provinsi,mulai_jabatan,selesai_jabatan,is_placeholder,partai,mulai_jabatan_baru,selesai_jabatan_baru,nama_baru,sumber_url,catatan
00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000000,Test A,Test,Test,Test,,,,PDI-P,,,,,
00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000000,Test B,Test,Test,Test,,,,Partai Tes Zzz,,,,,
CSV
curl -s -b /tmp/pk_cookies.txt -F 'file=@/tmp/pk_partai_test.csv' \
  http://localhost:3000/api/admin/import-enrichment
```
Expected: JSON where `reviewPartai` is `["Partai Tes Zzz"]` (the known alias `PDI-P` is normalized to `PDIP` and NOT flagged; the unknown party IS flagged). `total` is `2`.

- [ ] **Step 7: Commit**

```bash
git add web/app/api/admin/import-enrichment/route.ts
git commit -m "feat(web): normalize known partai aliases + flag unknowns at import"
```

---

### Task 5: Enrichment page — dropdown, bulletproof prompt, reviewPartai UI

**Files:**
- Modify: `web/app/admin/enrichment/page.tsx`

- [ ] **Step 1: Update the ImportResult type**

Find (lines 5-11):

```typescript
type ImportResult = {
  jabatanUpdated: number
  pejabatUpdated: number
  skipped: number
  errors: string[]
  total: number
}
```

Replace with:

```typescript
type ImportResult = {
  jabatanUpdated: number
  pejabatUpdated: number
  skipped: number
  errors: string[]
  reviewPartai: string[]
  total: number
}
```

- [ ] **Step 2: Add the PROVINCES list above the component**

Immediately after the `ImportResult` type (before `function ClaudePrompt()`), add:

```typescript
const PROVINCES = [
  'Aceh', 'Bali', 'Banten', 'Bengkulu',
  'DI Yogyakarta', 'DKI Jakarta',
  'Gorontalo',
  'Jambi', 'Jawa Barat', 'Jawa Tengah', 'Jawa Timur',
  'Kalimantan Barat', 'Kalimantan Selatan', 'Kalimantan Tengah', 'Kalimantan Timur', 'Kalimantan Utara',
  'Kepulauan Bangka Belitung', 'Kepulauan Riau',
  'Lampung',
  'Maluku', 'Maluku Utara',
  'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Pegunungan', 'Papua Selatan', 'Papua Tengah',
  'Riau',
  'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tengah', 'Sulawesi Tenggara', 'Sulawesi Utara',
  'Sumatera Barat', 'Sumatera Selatan', 'Sumatera Utara',
]
```

- [ ] **Step 3: Replace the bulletproof prompt text**

Find the `PROMPT_TEXT` constant (lines 13-20) and replace it entirely with:

```typescript
const PROMPT_TEXT = `Ini daftar jabatan pejabat Indonesia yang belum ada data partai. Untuk setiap baris, cari di web partai politik pengusung pejabat tersebut saat dilantik.

Isi kolom:
- partai — gunakan SINGKATAN RESMI (PDIP, Golkar, Gerindra, PKB, NasDem, PPP, PKS, Demokrat, PAN, PSI, Perindo, Hanura, PBB, dll).
  - Jalur perseorangan/independen → tulis "Independen".
  - Partai baru yang tidak ada di contoh → tetap gunakan nama/singkatan RESMI partai itu.
  - Tidak yakin atau tanpa sumber kredibel → BIARKAN KOSONG. Jangan menebak.
- sumber_url — WAJIB diisi jika partai diisi (KPU, situs resmi pemda, atau berita kredibel).
- mulai_jabatan_baru / selesai_jabatan_baru (format YYYY-MM-DD) dan nama_baru — opsional; isi hanya jika tahu. nama_baru hanya untuk baris is_placeholder=Y.

ATURAN KETAT:
- Satu pejabat = satu partai pengusung utama saat pemilihan. Jika diusung koalisi, tulis partai asal/kader pejabat.
- JANGAN menebak dari kemiripan nama atau asumsi. Tanpa sumber = kosong.
- Gunakan singkatan resmi yang konsisten (PDIP, bukan "PDI-P" atau "PDI Perjuangan").
- Kembalikan seluruh tabel CSV dalam format yang sama persis (header + semua baris, termasuk yang tidak diubah).`
```

- [ ] **Step 4: Add dropdown state + pusat-meta fetch + scoped export handler**

Find the component's state/handlers (lines 43-53):

```typescript
export default function EnrichmentPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  function handleExport() {
    const a = document.createElement('a')
    a.href = '/api/admin/export-enrichment'
    a.download = ''
    a.click()
  }
```

Replace with:

```typescript
export default function EnrichmentPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [provinsi, setProvinsi] = useState('')
  const [pusatBatches, setPusatBatches] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  // How many batches of null-partai Pusat (kabinet) officials remain
  useEffect(() => {
    fetch('/api/admin/export-enrichment?bucket=pusat&meta=1')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setPusatBatches(d.batches) })
      .catch(() => { /* ignore — provinces still work */ })
  }, [])

  function handleExport() {
    if (!provinsi) return
    const a = document.createElement('a')
    a.href = provinsi.startsWith('pusat:')
      ? `/api/admin/export-enrichment?bucket=pusat&batch=${provinsi.slice('pusat:'.length)}`
      : `/api/admin/export-enrichment?provinsi=${encodeURIComponent(provinsi)}`
    a.download = ''
    a.click()
  }
```

- [ ] **Step 5: Update the React import to include useEffect**

Find (line 3):

```typescript
import { useRef, useState } from 'react'
```

Replace with:

```typescript
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 6: Add dropdown styles**

Find the `.enr-steps { ... }` style block (lines 109-117) and add the following two rules immediately after its closing `}`:

```css
        .province-row {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 24px;
        }
        .province-select {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 10px 14px;
          border: 1px solid #d4cfc5;
          background: #f5f1ea;
          color: #0f1117;
          flex: 1;
          max-width: 280px;
          cursor: pointer;
        }
        .province-select:focus { outline: 1px solid #8a857c; }
        .review-list {
          font-size: 10px;
          color: #f39c12;
          margin-top: 12px;
          line-height: 1.8;
        }
```

- [ ] **Step 7: Replace the export button with the dropdown**

Find the Langkah-1 export button block (lines 281-286):

```tsx
          <ClaudePrompt />
          <div style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleExport}>
              ⬇ Unduh CSV Enrichment
            </button>
          </div>
```

Replace with:

```tsx
          <ClaudePrompt />
          <div className="province-row">
            <select
              className="province-select"
              value={provinsi}
              onChange={e => setProvinsi(e.target.value)}
            >
              <option value="">Pilih provinsi...</option>
              {pusatBatches !== null && (
                pusatBatches === 0
                  ? <option key="pusat-done" value="" disabled>Pusat · Kabinet — selesai ✓</option>
                  : Array.from({ length: pusatBatches }, (_, i) => (
                    <option key={`pusat:${i + 1}`} value={`pusat:${i + 1}`}>
                      Pusat · Kabinet ({i + 1}/{pusatBatches})
                    </option>
                  ))
              )}
              {PROVINCES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!provinsi} onClick={handleExport}>
              ⬇ Unduh CSV
            </button>
          </div>
```

- [ ] **Step 8: Render reviewPartai in the result card**

Find the closing of the result errors block (lines 338-342):

```tsx
              {result.errors.length > 0 && (
                <div className="result-errors">
                  {result.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
```

Add, immediately after it (still inside the `result-card` div):

```tsx
              {result.reviewPartai.length > 0 && (
                <div className="review-list">
                  Partai perlu ditinjau (tidak dikenal): {result.reviewPartai.join(', ')}
                </div>
              )}
```

- [ ] **Step 9: Verify it typechecks**

Run: `cd web && npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 10: Browser-verify the dropdown (Playwright MCP)**

With the dev server running and logged in, navigate to `http://localhost:3000/admin/enrichment`. Verify:
- The dropdown shows "Pusat · Kabinet (n/N)" options followed by the 38 provinces.
- "⬇ Unduh CSV" is disabled until a selection is made.
- Selecting "Jawa Barat" then clicking download triggers a CSV download named `enrichment_jawa_barat.csv`.
- The prompt box shows the new bulletproof partai text.

- [ ] **Step 11: Commit**

```bash
git add web/app/admin/enrichment/page.tsx
git commit -m "feat(web): enrichment page dropdown + bulletproof partai prompt + review list"
```

---

### Task 6: `export_enrichment.py --report`

**Files:**
- Modify: `scripts/export_enrichment.py`

- [ ] **Step 1: Add the run_report function**

In `scripts/export_enrichment.py`, add this function immediately before `def main() -> None:` (currently line 86):

```python
def run_report(supabase) -> None:
    """Print partai coverage per province + Pusat, then a non-canonical review list."""
    from _partai import normalize_partai

    wilayah_rows = fetch_all(supabase, "wilayah", "id, kode_bps, nama, level, parent_id")
    pejabat_rows = fetch_all(supabase, "pejabat", "id, level")
    jabatan_rows = fetch_all(supabase, "jabatan", "id, pejabat_id, wilayah_id, partai")

    wilayah_by_id = {w["id"]: w for w in wilayah_rows}
    prov_by_kode = {w["kode_bps"]: w["nama"] for w in wilayah_rows if w["level"] == "provinsi"}
    level_by_pejabat = {p["id"]: (p.get("level") or "") for p in pejabat_rows}

    def get_provinsi(w: dict | None) -> str:
        if not w:
            return ""
        if w["level"] == "provinsi":
            return w["nama"]
        parent = wilayah_by_id.get(w.get("parent_id") or "")
        if parent:
            return parent["nama"]
        return prov_by_kode.get((w.get("kode_bps") or "")[:2], "")

    pusat_label = "Pusat · Kabinet"
    stats: dict[str, list[int]] = {}   # bucket -> [total, filled]
    review: dict[str, int] = {}        # raw value -> count

    for j in jabatan_rows:
        if level_by_pejabat.get(j["pejabat_id"]) == "pusat":
            bucket = pusat_label
        else:
            bucket = get_provinsi(wilayah_by_id.get(j["wilayah_id"])) or "(tanpa provinsi)"
        s = stats.setdefault(bucket, [0, 0])
        s[0] += 1
        raw = (j.get("partai") or "").strip()
        if raw:
            s[1] += 1
            value, known = normalize_partai(raw)
            if not known or raw != value:
                review[raw] = review.get(raw, 0) + 1

    print("\nPARTAI COVERAGE")
    print(f"  {'':<24}{'total':>7}{'filled':>8}{'remaining':>11}{'':>6}")
    grand_total = grand_filled = 0
    for bucket in sorted(stats, key=lambda n: (1 if n == pusat_label else 0, n)):
        total, filled = stats[bucket]
        remaining = total - filled
        pct = round(100 * filled / total) if total else 0
        grand_total += total
        grand_filled += filled
        print(f"  {bucket:<24}{total:>7}{filled:>8}{remaining:>11}{pct:>5}%")
    grand_remaining = grand_total - grand_filled
    grand_pct = round(100 * grand_filled / grand_total) if grand_total else 0
    print("  " + "─" * 50)
    print(f"  {'TOTAL':<24}{grand_total:>7}{grand_filled:>8}{grand_remaining:>11}{grand_pct:>5}%")

    if review:
        print("\nNON-CANONICAL PARTAI (perlu ditinjau):")
        for raw in sorted(review, key=lambda r: -review[r]):
            value, known = normalize_partai(raw)
            hint = (f"→ mungkin maksudnya {value}?" if known and raw != value
                    else "→ tidak dikenal, cek apakah partai baru")
            print(f'  "{raw}"  ({review[raw]} jabatan)  {hint}')
    else:
        print("\nSemua nilai partai sudah kanonik. ✓")
```

- [ ] **Step 2: Add the --report flag and early dispatch in main()**

Find the argparse block in `main()` (lines 87-92):

```python
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province (partial match)")
    ap.add_argument("--no-wakil", action="store_true", help="Skip wakil roles")
    ap.add_argument("--real-names-only", action="store_true",
                    help="Skip rows where nama_lengkap is still a placeholder")
    args = ap.parse_args()

    supabase = get_supabase()
    print("Fetching data from Supabase...")
```

Replace with:

```python
    ap = argparse.ArgumentParser()
    ap.add_argument("--provinsi", help="Filter to one province (partial match)")
    ap.add_argument("--no-wakil", action="store_true", help="Skip wakil roles")
    ap.add_argument("--real-names-only", action="store_true",
                    help="Skip rows where nama_lengkap is still a placeholder")
    ap.add_argument("--report", action="store_true",
                    help="Print partai coverage report and exit (writes no CSV)")
    args = ap.parse_args()

    supabase = get_supabase()

    if args.report:
        run_report(supabase)
        return

    print("Fetching data from Supabase...")
```

- [ ] **Step 3: Run the report and reconcile totals**

Run: `python scripts/export_enrichment.py --report`
Expected: a coverage table whose `TOTAL` row reads `total=1219 filled=158 remaining=1061 13%` (matching the live DB counts at plan time; small drift is fine if data changed). Per-province rows print, `Pusat · Kabinet` appears last before TOTAL, and a non-canonical list prints only if any non-canonical values exist. No CSV is written.

- [ ] **Step 4: Confirm no CSV was written by --report**

Run: `git status --porcelain scripts/enrichment_export.csv`
Expected: empty output (the report did not create/modify the export CSV).

- [ ] **Step 5: Commit**

```bash
git add scripts/export_enrichment.py
git commit -m "feat(scripts): export_enrichment.py --report for partai coverage"
```

---

### Task 7: End-to-end verification + build

**Files:** none (verification only)

- [ ] **Step 1: Full production typecheck/build**

Run: `cd web && npm run build`
Expected: build completes with no type or lint errors.

- [ ] **Step 2: End-to-end workflow smoke test (browser, Playwright MCP)**

With dev server running + logged in:
1. `/admin/enrichment` → select a small province (e.g. "Gorontalo") → download CSV → confirm it has the 15-column header and only that province's rows.
2. Hand-edit two rows of that CSV: set one `partai` to `PDI-P` and one to a real new party not in the canonical list (e.g. `Partai Buruh`). Save.
3. Upload it via Langkah 2 → confirm the result card shows updated counts and a "Partai perlu ditinjau" line listing `Partai Buruh` (but NOT `PDIP`).
4. Run `python scripts/export_enrichment.py --report` → confirm `Partai Buruh` shows in the NON-CANONICAL list, and `PDIP` does not (it was normalized + is canonical).

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: partai enrichment scoping — end-to-end verified"
```

(Skip if nothing changed.)

---

## Notes for the implementer

- **No mocking** — every verification hits the real dev server + live Supabase, per project convention. The Task-4 import test uses all-zero UUIDs specifically so the DB update matches nothing and no real row is mutated.
- **Keep the two canonical maps in sync** — adding a party is one line in BOTH `web/lib/partai.ts` and `scripts/_partai.py`.
- **Don't switch verification to jest/vitest/pytest** — this repo has no JS test runner and uses standalone `test_*.py` scripts. Match that.
- Admin routes 401 without the login cookie from Setup — re-run the Setup login if a curl returns `{"error":"Unauthorized"}`.
