# Rekam Bersih CSV Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/admin/rekam-bersih` — a CSV export/import page that lets an admin screen pejabat for corruption records via Gemini/Claude web instead of burning Kimi API credits, producing identical DB state to `screen_kasus_llm.py`.

**Architecture:** Three new files (export route, import route, page) plus one nav edit. Export queries pejabat not yet screened for a chosen province; import writes to `kasus` (verified=NULL) and `kasus_screened` exactly as the Kimi screener does, so `verify_kasus.py` and `--report` work unchanged.

**Tech Stack:** Next.js 16 App Router, Supabase JS v2 (`@supabase/ssr`), TypeScript, MCP Playwright for final test.

**Spec:** `docs/superpowers/specs/2026-05-30-rekam-bersih-csv-workflow-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `web/app/api/admin/export-kasus-csv/route.ts` | GET → CSV of unscreened pejabat for a province |
| Create | `web/app/api/admin/import-kasus-csv/route.ts` | POST → parse CSV, write kasus + kasus_screened |
| Create | `web/app/admin/rekam-bersih/page.tsx` | Client component — province select, export, prompt, upload, result card |
| Modify | `web/app/admin/layout.tsx` | Add nav entry for Rekam Bersih |

---

## Task 1: Export API Route

**Files:**
- Create: `web/app/api/admin/export-kasus-csv/route.ts`

### Background

The export follows the same pattern as `web/app/api/admin/export-csv/route.ts`:
- Auth: check `admin_session` cookie
- Use `createServerSupabase(true)` (service role, bypasses RLS)
- Use separate queries (not nested joins — PostgREST nested joins silently drop rows)
- Use a `fetchAll` helper for pagination (1000-row pages)
- Use a `csvRow` helper for proper CSV escaping
- Return `NextResponse` with `Content-Type: text/csv`

Excluded from export:
- pejabat already in `kasus` table (any row)
- pejabat in `kasus_screened` with `last_result IN ('found', 'bersih')` — error rows are re-exported so they can be retried
- pejabat with placeholder names (jabatan title used as name, or `[LLM Error]` prefix)

Province → pejabat join chain: `wilayah(provinsi)` → `wilayah(kabkota, parent_id=provinsi.id)` → `jabatan.wilayah_id` → `pejabat`.

- [ ] **Step 1: Create the export route**

Create `web/app/api/admin/export-kasus-csv/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i

function isPlaceholder(name: string | null | undefined): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(f => {
    const s = (f ?? '').toString()
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  table: string,
  columns: string,
  filters?: Record<string, string>
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  let offset = 0
  while (true) {
    let q = supabase.from(table).select(columns).range(offset, offset + pageSize - 1)
    if (filters) {
      for (const [col, val] of Object.entries(filters)) {
        q = q.eq(col, val)
      }
    }
    const { data } = await q
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return rows
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provinsi = req.nextUrl.searchParams.get('provinsi')?.trim()
  if (!provinsi) {
    return NextResponse.json({ error: 'provinsi parameter required' }, { status: 400 })
  }

  const supabase = await createServerSupabase(true)

  // 1. Find province wilayah id
  const { data: provRow } = await supabase
    .from('wilayah')
    .select('id')
    .eq('level', 'provinsi')
    .eq('nama', provinsi)
    .maybeSingle()

  if (!provRow) {
    return NextResponse.json({ error: `Provinsi "${provinsi}" tidak ditemukan` }, { status: 404 })
  }

  // 2. Collect all wilayah ids for this province (province itself + all kabkota)
  const { data: kabkotaRows } = await supabase
    .from('wilayah')
    .select('id')
    .eq('parent_id', (provRow as { id: string }).id)

  const wilayahIds = [
    (provRow as { id: string }).id,
    ...((kabkotaRows ?? []) as Array<{ id: string }>).map(w => w.id),
  ]

  // 3. Fetch pejabat_ids to exclude
  const [kasusRows, screenedRows] = await Promise.all([
    fetchAll<{ pejabat_id: string }>(supabase, 'kasus', 'pejabat_id'),
    supabase
      .from('kasus_screened')
      .select('pejabat_id')
      .in('last_result', ['found', 'bersih'])
      .then(r => (r.data ?? []) as Array<{ pejabat_id: string }>),
  ])

  const excludeSet = new Set<string>([
    ...kasusRows.map(k => k.pejabat_id),
    ...screenedRows.map(s => s.pejabat_id),
  ])

  // 4. Fetch jabatan for this province (separate queries — no nested joins)
  const jabatanRows = await fetchAll<{ pejabat_id: string; posisi: string; wilayah_id: string }>(
    supabase, 'jabatan', 'pejabat_id, posisi, wilayah_id'
  )

  // Filter to this province's wilayah_ids
  const wilayahSet = new Set(wilayahIds)
  const jabatanInProv = jabatanRows.filter(j => wilayahSet.has(j.wilayah_id))

  // Deduplicate: first jabatan per pejabat (matches screen_kasus_llm.py behaviour)
  const firstJabatan = new Map<string, { posisi: string }>()
  for (const j of jabatanInProv) {
    if (!firstJabatan.has(j.pejabat_id)) {
      firstJabatan.set(j.pejabat_id, { posisi: j.posisi })
    }
  }

  // 5. Fetch pejabat details for those not excluded
  const pejabatIds = [...firstJabatan.keys()].filter(id => !excludeSet.has(id))

  if (!pejabatIds.length) {
    // Return header-only CSV (nothing to screen)
    const header = 'pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan'
    const slug = provinsi.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    return new NextResponse(header + '\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="kasus_export_${slug}.csv"`,
      },
    })
  }

  const pejabatRows = await fetchAll<{
    id: string
    nama_lengkap: string
    gelar_depan: string | null
    gelar_belakang: string | null
  }>(supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang')

  const pejabatMap = new Map(pejabatRows.map(p => [p.id, p]))

  // 6. Build CSV rows
  const header = 'pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan'
  const lines: string[] = [header]

  for (const id of pejabatIds) {
    const p = pejabatMap.get(id)
    if (!p) continue
    if (isPlaceholder(p.nama_lengkap)) continue

    const gelarDepan = (p.gelar_depan ?? '').trim()
    const gelarBelakang = (p.gelar_belakang ?? '').trim()
    const nama = [gelarDepan, p.nama_lengkap.trim(), gelarBelakang].filter(Boolean).join(' ')
    const jabatan = firstJabatan.get(id)?.posisi ?? ''

    lines.push(csvRow([id, nama, jabatan, provinsi, '', '', '', '', '', '', '', '']))
  }

  const slug = provinsi.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kasus_export_${slug}.csv"`,
    },
  })
}
```

- [ ] **Step 2: Smoke-test the export endpoint**

With dev server running (`cd web && npm run dev`), open a browser, log in to `/admin`, then visit:

```
http://localhost:3000/api/admin/export-kasus-csv?provinsi=Aceh
```

Expected: browser downloads `kasus_export_aceh.csv`. Open it — should have header row + rows for unscreened Aceh pejabat with columns 5–12 blank. If Aceh is fully screened, try another province.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/admin/export-kasus-csv/route.ts
git commit -m "feat: export-kasus-csv API route — province-filtered unscreened pejabat CSV"
```

---

## Task 2: Import API Route

**Files:**
- Create: `web/app/api/admin/import-kasus-csv/route.ts`

### Background

Mirrors `screen_kasus_llm.py` exactly:

| CSV row | DB writes |
|---------|-----------|
| `kasus_found=0` | `upsert kasus_screened(last_result='bersih')` |
| `kasus_found=1`, status blank | `upsert kasus_screened(last_result='bersih')` + warning (mirrors "tidak terbukti" branch) |
| `kasus_found=1`, status set | `INSERT kasus(verified=NULL)` + `upsert kasus_screened(last_result='found')` |
| pejabat already in `kasus` table | skip, increment `skipped_existing` |

`verified` is intentionally not set on kasus insert → stays NULL → `verify_kasus.py` (`WHERE verified IS NULL`) picks it up identically to Kimi output.

Valid values enforced:
- `status`: `tersangka`, `terdakwa`, `terpidana`
- `jenis`: `korupsi`, `suap`, `gratifikasi`, `pencucian_uang`, `lainnya`
- `kasus_found`: `1`/`ya`/`true` = found; `0`/`tidak`/`false` = bersih

- [ ] **Step 4: Create the import route**

Create `web/app/api/admin/import-kasus-csv/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

const VALID_STATUS = new Set(['tersangka', 'terdakwa', 'terpidana'])
const VALID_JENIS = new Set(['korupsi', 'suap', 'gratifikasi', 'pencucian_uang', 'lainnya'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const rows: Record<string, string>[] = []

  for (const line of lines.slice(1)) {
    const vals: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        vals.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    vals.push(cur.trim())

    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    rows.push(row)
  }
  return rows
}

function isTruthy(val: string): boolean {
  return val === '1' || val.toLowerCase() === 'ya' || val.toLowerCase() === 'true'
}

function isFalsy(val: string): boolean {
  return val === '0' || val.toLowerCase() === 'tidak' || val.toLowerCase() === 'false'
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const text = await file.text()
  const rows = parseCsv(text)
  if (!rows.length) {
    return NextResponse.json({ error: 'File kosong atau format tidak dikenali' }, { status: 400 })
  }

  const supabase = await createServerSupabase(true)

  // Fetch pejabat_ids already in kasus table (mutable — updated as we insert)
  const { data: existingKasusData } = await supabase.from('kasus').select('pejabat_id')
  const existingKasusSet = new Set<string>(
    (existingKasusData ?? []).map((k: { pejabat_id: string }) => k.pejabat_id)
  )

  let found = 0
  let bersih = 0
  let skipped_existing = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const row of rows) {
    const pejabat_id = (row['pejabat_id'] ?? '').trim()
    const displayName = (row['nama'] ?? pejabat_id.slice(0, 8)).trim()

    if (!pejabat_id || !UUID_RE.test(pejabat_id)) {
      errors.push(`"${displayName}" — pejabat_id kosong atau tidak valid, dilewati`)
      continue
    }

    // Skip if already has a kasus row
    if (existingKasusSet.has(pejabat_id)) {
      skipped_existing++
      continue
    }

    const kasus_found = (row['kasus_found'] ?? '').trim()
    const keyakinan = (row['keyakinan'] ?? '').trim() || null

    // kasus_found = 0 → bersih
    if (isFalsy(kasus_found)) {
      const { error } = await supabase.from('kasus_screened').upsert(
        { pejabat_id, last_screened_at: now, last_result: 'bersih', last_keyakinan: keyakinan },
        { onConflict: 'pejabat_id' }
      )
      if (error) errors.push(`${displayName}: ${error.message}`)
      else bersih++
      continue
    }

    // kasus_found = 1 → check status
    if (isTruthy(kasus_found)) {
      const status = (row['status'] ?? '').trim().toLowerCase()

      if (!status || !VALID_STATUS.has(status)) {
        // mirrors "tidak terbukti (no status)" branch in screen_kasus_llm.py
        errors.push(`${displayName}: kasus_found=1 tapi status kosong/tidak valid ("${status}") — dicatat sebagai bersih`)
        await supabase.from('kasus_screened').upsert(
          { pejabat_id, last_screened_at: now, last_result: 'bersih', last_keyakinan: keyakinan },
          { onConflict: 'pejabat_id' }
        )
        bersih++
        continue
      }

      const jenis = (row['jenis'] ?? '').trim().toLowerCase()
      const lembaga = (row['lembaga'] ?? '').trim() || null
      const tahunStr = (row['tahun'] ?? '').trim()
      const tahun = tahunStr ? parseInt(tahunStr, 10) : null
      const ringkasan = (row['ringkasan'] ?? '').trim() || null
      const url_sumber = (row['url_sumber'] ?? '').trim() || null

      const kasusRow: Record<string, unknown> = { pejabat_id, status }
      if (jenis && VALID_JENIS.has(jenis)) kasusRow.jenis = jenis
      if (lembaga) kasusRow.lembaga = lembaga
      if (tahun && !isNaN(tahun)) kasusRow.tahun = tahun
      if (ringkasan) kasusRow.ringkasan = ringkasan
      if (url_sumber) kasusRow.url_sumber = url_sumber
      // verified intentionally omitted → NULL → verify_kasus.py picks it up

      const { error: kasusError } = await supabase.from('kasus').insert(kasusRow)
      if (kasusError) {
        errors.push(`${displayName}: ${kasusError.message}`)
        continue
      }

      // Mark as found in screened log
      const { error: screenedError } = await supabase.from('kasus_screened').upsert(
        { pejabat_id, last_screened_at: now, last_result: 'found', last_keyakinan: keyakinan },
        { onConflict: 'pejabat_id' }
      )
      if (screenedError) errors.push(`screened log ${displayName}: ${screenedError.message}`)

      // Prevent duplicate insert if same pejabat_id appears twice in CSV
      existingKasusSet.add(pejabat_id)
      found++
      continue
    }

    // kasus_found blank or unrecognised
    errors.push(`${displayName}: kasus_found tidak diisi ("${kasus_found}") — baris dilewati`)
  }

  return NextResponse.json({ found, bersih, skipped_existing, errors, total: rows.length })
}
```

- [ ] **Step 5: Smoke-test the import endpoint**

With dev server running, use `curl` to POST a minimal fixture. In PowerShell:

```powershell
$csvContent = "pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan`nbad-uuid,Test,Bupati,Aceh,0,,,,,,,"

$boundary = "----boundary123"
$body = "--$boundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"test.csv`"`r`nContent-Type: text/csv`r`n`r`n$csvContent`r`n--$boundary--"

# Get admin session cookie first from browser devtools, then:
Invoke-WebRequest -Uri "http://localhost:3000/api/admin/import-kasus-csv" `
  -Method POST `
  -ContentType "multipart/form-data; boundary=$boundary" `
  -Body $body `
  -Headers @{ Cookie = "admin_session=YOUR_SESSION_VALUE" }
```

Expected JSON response:
```json
{"found":0,"bersih":0,"skipped_existing":0,"errors":["\"Test\" — pejabat_id kosong atau tidak valid, dilewati"],"total":1}
```

The bad UUID triggers the validation error as expected.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/admin/import-kasus-csv/route.ts
git commit -m "feat: import-kasus-csv API route — mirrors screen_kasus_llm.py DB writes exactly"
```

---

## Task 3: Admin Page

**Files:**
- Create: `web/app/admin/rekam-bersih/page.tsx`

### Background

Mirrors `/admin/placeholders` layout exactly — same CSS classes, same two-section structure (Langkah 1 export, Langkah 2 import), same dark result card. Province list is hardcoded (BPS 2024, 38 provinces, alphabetical — they don't change).

Result card has 4 stats: Found / Bersih / Skipped / Total, plus scrollable error list.

- [ ] **Step 7: Create the admin page**

Create `web/app/admin/rekam-bersih/page.tsx`:

```typescript
'use client'

import { useRef, useState } from 'react'

type ImportResult = {
  found: number
  bersih: number
  skipped_existing: number
  errors: string[]
  total: number
}

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

export default function RekamBersihPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [provinsi, setProvinsi] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  function handleExport() {
    if (!provinsi) return
    const a = document.createElement('a')
    a.href = `/api/admin/export-kasus-csv?provinsi=${encodeURIComponent(provinsi)}`
    a.download = ''
    a.click()
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setResult(null)
    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/import-kasus-csv', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      setResult(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengimpor.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <style>{`
        .ph-wrap { max-width: 720px; }
        .ph-section {
          border: 1px solid #d4cfc5;
          padding: 32px;
          margin-bottom: 24px;
        }
        .ph-section-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 8px;
        }
        .ph-section-sub {
          font-size: 11px;
          color: #8a857c;
          letter-spacing: 0.04em;
          line-height: 1.7;
          margin-bottom: 24px;
        }
        .ph-section-sub code {
          font-family: 'DM Mono', monospace;
          background: rgba(0,0,0,0.05);
          padding: 1px 5px;
          font-size: 10px;
        }
        .ph-steps {
          font-size: 11px;
          color: #5a5750;
          letter-spacing: 0.03em;
          line-height: 2;
          margin-bottom: 24px;
          border-left: 2px solid #d4cfc5;
          padding-left: 16px;
        }
        .province-row {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
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
        .btn {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 12px 24px;
          cursor: pointer;
          border: none;
          transition: opacity 0.2s;
          display: inline-block;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: #c0392b; color: #f5f1ea; }
        .btn-primary:hover:not(:disabled) { opacity: 0.85; }
        .upload-zone {
          border: 1px dashed #d4cfc5;
          padding: 40px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          position: relative;
        }
        .upload-zone:hover { border-color: #8a857c; background: #f0ece4; }
        .upload-zone input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
        }
        .upload-label { font-size: 12px; color: #5a5750; letter-spacing: 0.04em; }
        .error-banner {
          background: #fff0ef;
          border: 1px solid #c0392b;
          padding: 12px 16px;
          font-size: 12px;
          color: #c0392b;
          margin-top: 16px;
        }
        .result-card {
          background: #0f1117;
          padding: 32px;
          margin-top: 16px;
        }
        .result-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 16px;
        }
        .result-stat { text-align: center; }
        .result-num {
          font-family: 'Fraunces', serif;
          font-size: 28px;
          font-weight: 300;
          color: #f5f1ea;
          line-height: 1;
          margin-bottom: 4px;
        }
        .result-num.green { color: #27ae60; }
        .result-num.amber { color: #f39c12; }
        .result-label {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #5a5e6a;
        }
        .result-errors {
          font-size: 10px;
          color: #c0392b;
          margin-top: 12px;
          max-height: 120px;
          overflow-y: auto;
          line-height: 1.8;
        }
        .gemini-prompt {
          background: #f0ece4;
          border: 1px solid #d4cfc5;
          padding: 20px 24px;
          font-size: 12px;
          color: #2a2c33;
          line-height: 1.7;
          font-family: 'Fraunces', serif;
          font-weight: 300;
          margin-top: 16px;
          position: relative;
          white-space: pre-wrap;
        }
        .gemini-prompt-label {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #8a857c;
          margin-bottom: 10px;
        }
        .copy-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          background: none;
          border: 1px solid #d4cfc5;
          color: #8a857c;
          padding: 4px 10px;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        }
        .copy-btn:hover { color: #0f1117; border-color: #8a857c; }
      `}</style>

      <div className="ph-wrap">
        {/* Section 1: Export */}
        <div className="ph-section">
          <div className="ph-section-title">Langkah 1 — Unduh daftar pejabat</div>
          <div className="ph-section-sub">
            Pilih provinsi, unduh CSV, lalu buka di Gemini (gemini.google.com) atau Claude (claude.ai)
            dengan pencarian web aktif. Gunakan prompt di bawah, minta AI mengisi kolom
            <code>kasus_found</code> hingga <code>keyakinan</code>, lalu simpan hasilnya.
          </div>
          <div className="ph-steps">
            Pilih provinsi → unduh CSV → buka Gemini/Claude + aktifkan web search<br />
            Unggah atau tempel isi CSV → gunakan prompt di bawah → salin hasil CSV → lanjut ke Langkah 2
          </div>
          <div className="province-row">
            <select
              className="province-select"
              value={provinsi}
              onChange={e => setProvinsi(e.target.value)}
            >
              <option value="">Pilih provinsi...</option>
              {PROVINCES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              disabled={!provinsi}
              onClick={handleExport}
            >
              ⬇ Unduh CSV
            </button>
          </div>
          <AiPrompt />
        </div>

        {/* Section 2: Import */}
        <div className="ph-section">
          <div className="ph-section-title">Langkah 2 — Unggah hasil verifikasi</div>
          <div className="ph-section-sub">
            Unggah kembali CSV yang sudah diisi AI. Baris dengan <code>kasus_found=1</code> dan
            status valid akan dicatat ke tabel <code>kasus</code> (menunggu verifikasi Kimi).
            Baris <code>kasus_found=0</code> dicatat sebagai bersih.
            Pejabat yang sudah punya kasus sebelumnya dilewati otomatis.
          </div>
          <div className="upload-zone">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleImport}
              disabled={importing}
            />
            <div className="upload-label">
              {importing ? 'Memproses...' : 'Klik atau seret file CSV yang sudah diisi'}
            </div>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {result && (
            <div className="result-card">
              <div className="result-grid">
                <div className="result-stat">
                  <div className={`result-num${result.found > 0 ? ' amber' : ''}`}>{result.found}</div>
                  <div className="result-label">Kasus Ditemukan</div>
                </div>
                <div className="result-stat">
                  <div className={`result-num${result.bersih > 0 ? ' green' : ''}`}>{result.bersih}</div>
                  <div className="result-label">Bersih</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.skipped_existing}</div>
                  <div className="result-label">Sudah Ada</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.total}</div>
                  <div className="result-label">Total Baris</div>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="result-errors">
                  {result.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const PROMPT_TEXT = `Ini adalah daftar pejabat Indonesia. Untuk setiap baris, cari di web apakah pejabat tersebut pernah ditetapkan sebagai tersangka, terdakwa, atau terpidana dalam kasus korupsi/tipikor.

Isi kolom berikut:
- kasus_found: 1 jika ada kasus, 0 jika tidak
- status: tersangka / terdakwa / terpidana (kosongkan jika kasus_found=0)
- jenis: korupsi / suap / gratifikasi / pencucian_uang / lainnya
- lembaga: KPK / Kejagung / Kejati / Pengadilan Tipikor
- tahun: tahun penetapan tersangka/vonis (angka saja)
- ringkasan: 1-2 kalimat ringkasan kasus
- url_sumber: URL artikel atau sumber terpercaya
- keyakinan: tinggi / sedang / rendah

ATURAN KETAT:
- Hanya laporkan jika nama pejabat DISEBUTKAN EKSPLISIT sebagai tersangka/terdakwa/terpidana.
- Sumber valid: kpk.go.id, Kejagung, Kejati, Tempo, Kompas, Detik, CNN Indonesia.
- Jangan laporkan jika hanya saksi, terindikasi, atau kasusnya sudah SP3/bebas.
- Kalau tidak ada kasus, isi kasus_found=0 dan kosongkan kolom lainnya.
- Kembalikan seluruh tabel dalam format CSV yang sama persis (termasuk baris header dan baris yang tidak berubah).`

function AiPrompt() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT_TEXT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="gemini-prompt">
      <button className="copy-btn" onClick={copy}>{copied ? 'Tersalin ✓' : 'Salin'}</button>
      <div className="gemini-prompt-label">Prompt untuk Gemini / Claude</div>
      {PROMPT_TEXT}
    </div>
  )
}
```

- [ ] **Step 8: Verify the page renders**

Navigate to `http://localhost:3000/admin/rekam-bersih` (while logged in). Expected:
- Two bordered sections visible
- Province `<select>` shows placeholder "Pilih provinsi..."
- Download button is disabled until a province is selected
- Prompt block renders with "Salin" button
- Upload zone renders in section 2

- [ ] **Step 9: Commit**

```bash
git add web/app/admin/rekam-bersih/page.tsx
git commit -m "feat: /admin/rekam-bersih page — province export + CSV import UI"
```

---

## Task 4: Nav Entry

**Files:**
- Modify: `web/app/admin/layout.tsx`

- [ ] **Step 10: Add nav entry**

In `web/app/admin/layout.tsx`, find the `NAV` array and insert the new entry between `Partai & Masa Jabatan` and `Impor Scraper`:

```typescript
// BEFORE (lines 7–14):
const NAV = [
  { href: '/admin/dashboard', label: 'Cakupan Data', icon: '◉' },
  { href: '/admin/placeholders', label: 'Isi Nama Kosong', icon: '✎' },
  { href: '/admin/enrichment', label: 'Partai & Masa Jabatan', icon: '⊞' },
  { href: '/admin/import', label: 'Impor Scraper', icon: '⊕' },
  { href: '/admin/review', label: 'Koreksi Warga', icon: '⚑' },
  { href: '/admin/runbook', label: 'Runbook (CLI)', icon: '◈' },
  { href: '/admin/settings', label: 'Pengaturan LLM', icon: '⚙' },
]

// AFTER:
const NAV = [
  { href: '/admin/dashboard', label: 'Cakupan Data', icon: '◉' },
  { href: '/admin/placeholders', label: 'Isi Nama Kosong', icon: '✎' },
  { href: '/admin/enrichment', label: 'Partai & Masa Jabatan', icon: '⊞' },
  { href: '/admin/rekam-bersih', label: 'Rekam Bersih', icon: '⦿' },
  { href: '/admin/import', label: 'Impor Scraper', icon: '⊕' },
  { href: '/admin/review', label: 'Koreksi Warga', icon: '⚑' },
  { href: '/admin/runbook', label: 'Runbook (CLI)', icon: '◈' },
  { href: '/admin/settings', label: 'Pengaturan LLM', icon: '⚙' },
]
```

- [ ] **Step 11: Verify nav entry**

Navigate to any admin page. Expected: sidebar shows "⦿ Rekam Bersih" between "Partai & Masa Jabatan" and "Impor Scraper". Clicking it navigates to `/admin/rekam-bersih` and the link is highlighted active.

- [ ] **Step 12: Commit**

```bash
git add web/app/admin/layout.tsx
git commit -m "feat: add Rekam Bersih to admin sidebar nav"
```

---

## Task 5: Playwright Test via MCP

**Goal:** End-to-end verification — export CSV, upload fixture, verify DB writes reflect in UI.

**Prerequisites:** Dev server running at `http://localhost:3000`. Admin credentials available.

### What to test

1. Page structure
2. Export → valid CSV with correct columns
3. Import → result card shows correct counts
4. Pejabat profile → `● KASUS` badge appears after import

### Steps

- [ ] **Step 13: Start dev server**

```bash
cd web && npm run dev
```

Wait for "Ready" message.

- [ ] **Step 14: Get a valid pejabat_id for fixture**

Before uploading, you need a real pejabat_id that is NOT already in `kasus` or `kasus_screened`. Use the export API to get one.

Use MCP Playwright `browser_navigate` to:
```
http://localhost:3000/api/admin/export-kasus-csv?provinsi=Aceh
```
(Set the `admin_session` cookie first via login, see step 15.)

The response CSV will contain real pejabat_ids in column 1. Pick the first non-header row's `pejabat_id` value — call it `TEST_PID`.

- [ ] **Step 15: Log in as admin via Playwright**

```
Navigate to: http://localhost:3000/admin/login
Fill the password field with the ADMIN_PASSWORD from .env
Click the login button
Assert: redirected to /admin/dashboard (or /admin/rekam-bersih)
```

The `admin_session` cookie is now set in the Playwright browser context.

- [ ] **Step 16: Navigate to page and assert structure**

```
Navigate to: http://localhost:3000/admin/rekam-bersih
Assert: page contains two elements with class "ph-section"
Assert: page contains a <select> element (province dropdown)
Assert: page contains upload zone text "Klik atau seret file CSV"
Assert: download button is disabled (no province selected)
```

- [ ] **Step 17: Test export**

```
Select "Aceh" from the province dropdown
Assert: download button becomes enabled
Click the download button
Capture network requests — assert one request to /api/admin/export-kasus-csv?provinsi=Aceh
Assert: response Content-Type is "text/csv"
Assert: response body first line is exactly:
  pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan
```

Record the first pejabat_id from the response body as `TEST_PID`.

- [ ] **Step 18: Write fixture CSV file to disk**

Write a temp CSV file at `scripts/test_kasus_fixture.csv` using the `TEST_PID` obtained in step 17. The file must contain exactly these two data rows (replace `<TEST_PID>` with the real UUID):

```
pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan
<TEST_PID>,Test Bersih,Bupati Test,Aceh,0,,,,,,, 
```

For the second row, you need a second unscreened pejabat_id (take the second row from the export response). If only one row was exported, use one row with `kasus_found=0` only and verify `bersih=1`.

For a two-row test (bersih + found), the file looks like:

```
pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,ringkasan,url_sumber,keyakinan
<TEST_PID_1>,Test Bersih,Bupati Test,Aceh,0,,,,,,,
<TEST_PID_2>,Test Kasus,Walikota Test,Aceh,1,tersangka,korupsi,KPK,2023,Tersangka korupsi pengadaan barang,https://kpk.go.id/test,tinggi
```

- [ ] **Step 19: Upload fixture CSV and verify result card**

```
On /admin/rekam-bersih, use browser_file_upload to upload scripts/test_kasus_fixture.csv
  to the upload input element
Assert: result card appears (element with class "result-card" is visible)
Assert: result card shows:
  - "Kasus Ditemukan" stat = 1
  - "Bersih" stat = 1
  - "Sudah Ada" stat = 0
  - "Total Baris" stat = 2
Assert: no error banners visible (or only the expected warning about TEST_PID_2 status)
```

- [ ] **Step 20: Verify pejabat profile badge**

```
Navigate to: http://localhost:3000/<TEST_PID_2>
  (the pejabat_id you used for the kasus_found=1 row)
Assert: page contains "● KASUS" text (the badge shown on profiles with confirmed kasus)
Take screenshot for visual confirmation
```

- [ ] **Step 21: Verify --report sees the imported data**

Run in terminal (separate from dev server):

```bash
python scripts/screen_kasus_llm.py --report
```

Expected: the province you imported (Aceh) shows at least 2 screened rows, with 1 in the Found column.

- [ ] **Step 22: Clean up fixture data and commit**

Delete the fixture rows from the DB (so test data doesn't pollute production):

```bash
# In psql or Supabase SQL editor:
DELETE FROM kasus WHERE ringkasan = 'Tersangka korupsi pengadaan barang' AND url_sumber = 'https://kpk.go.id/test';
DELETE FROM kasus_screened WHERE pejabat_id IN ('<TEST_PID_1>', '<TEST_PID_2>');
```

Then:

```bash
git add web/app/admin/rekam-bersih/page.tsx web/app/api/admin/export-kasus-csv/route.ts web/app/api/admin/import-kasus-csv/route.ts web/app/admin/layout.tsx
git status  # confirm all files already committed individually
git log --oneline -5  # confirm 4 commits from tasks 1–4
```

Delete the fixture file:

```bash
rm scripts/test_kasus_fixture.csv
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Export: unscreened pejabat for province | Task 1 export route, step 1 |
| Export: exclude kasus + screened(found/bersih), re-export errors | Task 1, `excludeSet` logic |
| Export: skip placeholder names | Task 1, `isPlaceholder` check |
| Export: CSV columns pejabat_id…keyakinan | Task 1, `csvRow` lines |
| Export: filename `kasus_export_<slug>.csv` | Task 1, `Content-Disposition` header |
| Import: kasus_found=0 → upsert kasus_screened bersih | Task 2, `isFalsy` branch |
| Import: kasus_found=1, no status → bersih + warn | Task 2, status validation branch |
| Import: kasus_found=1, status set → insert kasus (verified=NULL) + upsert screened found | Task 2, insert branch |
| Import: skip pejabat already in kasus | Task 2, `existingKasusSet` check |
| Import: result `{ found, bersih, skipped_existing, errors, total }` | Task 2, return statement |
| verified=NULL on kasus insert → verify_kasus.py picks up | Task 2, comment in insert block |
| duplicate pejabat_id in CSV → second row skipped | Task 2, `existingKasusSet.add` after insert |
| Auth: admin_session cookie | Both routes, cookie check |
| Nav: Rekam Bersih between Partai and Impor Scraper | Task 4 |
| UI: two sections, province select, prompt block, upload zone, result card | Task 3 |
| UI: mirrors placeholders visual style | Task 3, shared CSS classes |
| 38 provinces hardcoded | Task 3, PROVINCES array |
| Playwright: page structure, export, upload, result card, badge | Task 5 steps 16–20 |
| --report reflects import | Task 5 step 21 |

**Placeholder scan:** No TBDs, all code blocks complete, all commands shown with expected output.

**Type consistency:** `ImportResult` type defined in page and matches route return shape. `fetchAll<T>` generic used consistently in export route. `supabase.from().upsert({}, { onConflict: 'pejabat_id' })` matches kasus_screened PK.
