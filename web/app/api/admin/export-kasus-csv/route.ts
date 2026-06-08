import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAdmin } from '@/lib/auth'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i

const CSV_HEADER = 'pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,tanggal_kasus,ringkasan,url_sumber,keyakinan,partai'
const PUSAT_BATCH_SIZE = 40

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

async function fetchScreenedExclusions(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>
): Promise<Array<{ pejabat_id: string }>> {
  const pageSize = 1000
  const rows: Array<{ pejabat_id: string }> = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('kasus_screened')
      .select('pejabat_id')
      .in('last_result', ['found', 'bersih'])
      .range(offset, offset + pageSize - 1)
    const chunk = (data ?? []) as Array<{ pejabat_id: string }>
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return rows
}

// Pejabat already screened (in `kasus` or `kasus_screened`) — excluded from export.
async function buildExcludeSet(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>
): Promise<Set<string>> {
  const [kasusRows, screenedRows] = await Promise.all([
    fetchAll<{ pejabat_id: string }>(supabase, 'kasus', 'pejabat_id'),
    fetchScreenedExclusions(supabase),
  ])
  return new Set<string>([
    ...kasusRows.map(k => k.pejabat_id),
    ...screenedRows.map(s => s.pejabat_id),
  ])
}

// Pusat (level='pusat') officials: ?bucket=pusat&meta=1 → batch counts; &batch=N → CSV slice.
async function handlePusatExport(
  req: NextRequest,
  supabase: Awaited<ReturnType<typeof createServerSupabase>>
): Promise<NextResponse> {
  const pejabatRows = await fetchAll<{
    id: string
    nama_lengkap: string
    gelar_depan: string | null
    gelar_belakang: string | null
    level: string | null
  }>(supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, level')
  const pusat = pejabatRows.filter(p => p.level === 'pusat')

  const [excludeSet, jabatanRows] = await Promise.all([
    buildExcludeSet(supabase),
    fetchAll<{ pejabat_id: string; posisi: string | null }>(supabase, 'jabatan', 'pejabat_id, posisi'),
  ])

  // First jabatan per pejabat (matches screen_kasus_llm.py / province path behaviour)
  const firstPosisi = new Map<string, string>()
  for (const j of jabatanRows) {
    if (!firstPosisi.has(j.pejabat_id)) firstPosisi.set(j.pejabat_id, j.posisi ?? '')
  }

  // Unscreened, non-placeholder candidates — deterministically sorted so batch boundaries are stable
  const candidates = pusat
    .filter(p => !excludeSet.has(p.id))
    .filter(p => !isPlaceholder(p.nama_lengkap))
    .map(p => {
      const nama = [(p.gelar_depan ?? '').trim(), p.nama_lengkap.trim(), (p.gelar_belakang ?? '').trim()]
        .filter(Boolean).join(' ')
      return { id: p.id, nama, posisi: firstPosisi.get(p.id) ?? '' }
    })
    .sort((a, b) =>
      (a.posisi || '').localeCompare(b.posisi || '', 'id') || a.nama.localeCompare(b.nama, 'id'),
    )

  const batches = Math.ceil(candidates.length / PUSAT_BATCH_SIZE)

  if (req.nextUrl.searchParams.get('meta')) {
    return NextResponse.json({ unscreened: candidates.length, batchSize: PUSAT_BATCH_SIZE, batches })
  }

  const batchN = parseInt(req.nextUrl.searchParams.get('batch') ?? '1', 10)
  if (isNaN(batchN) || batchN < 1 || (batches > 0 && batchN > batches)) {
    return NextResponse.json({ error: `batch ${batchN} di luar jangkauan (1..${batches})` }, { status: 400 })
  }

  const slice = candidates.slice((batchN - 1) * PUSAT_BATCH_SIZE, batchN * PUSAT_BATCH_SIZE)
  const lines = [CSV_HEADER]
  for (const c of slice) {
    lines.push(csvRow([c.id, c.nama, c.posisi, 'Pusat', '', '', '', '', '', '', '', '', '', '']))
  }
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kasus_export_pusat_batch${batchN}.csv"`,
    },
  })
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)

  if (req.nextUrl.searchParams.get('bucket') === 'pusat') {
    return handlePusatExport(req, supabase)
  }

  const provinsi = req.nextUrl.searchParams.get('provinsi')?.trim()
  if (!provinsi) {
    return NextResponse.json({ error: 'provinsi parameter required' }, { status: 400 })
  }

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
  const provId = (provRow as { id: string }).id
  const kabkotaRows = await fetchAll<{ id: string }>(
    supabase, 'wilayah', 'id', { parent_id: provId }
  )

  const wilayahIds = [
    provId,
    ...kabkotaRows.map(w => w.id),
  ]

  // 3. Fetch pejabat_ids to exclude
  const excludeSet = await buildExcludeSet(supabase)

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
    const slug = provinsi.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    return new NextResponse(CSV_HEADER + '\n', {
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
  const lines: string[] = [CSV_HEADER]

  for (const id of pejabatIds) {
    const p = pejabatMap.get(id)
    if (!p) continue
    if (isPlaceholder(p.nama_lengkap)) continue

    const gelarDepan = (p.gelar_depan ?? '').trim()
    const gelarBelakang = (p.gelar_belakang ?? '').trim()
    const nama = [gelarDepan, p.nama_lengkap.trim(), gelarBelakang].filter(Boolean).join(' ')
    const jabatan = firstJabatan.get(id)?.posisi ?? ''

    lines.push(csvRow([id, nama, jabatan, provinsi, '', '', '', '', '', '', '', '', '', '']))
  }

  const slug = provinsi.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kasus_export_${slug}.csv"`,
    },
  })
}
