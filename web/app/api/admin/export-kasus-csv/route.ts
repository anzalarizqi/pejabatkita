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
  const provId = (provRow as { id: string }).id
  const kabkotaRows = await fetchAll<{ id: string }>(
    supabase, 'wilayah', 'id', { parent_id: provId }
  )

  const wilayahIds = [
    provId,
    ...kabkotaRows.map(w => w.id),
  ]

  // 3. Fetch pejabat_ids to exclude
  const [kasusRows, screenedRows] = await Promise.all([
    fetchAll<{ pejabat_id: string }>(supabase, 'kasus', 'pejabat_id'),
    fetchScreenedExclusions(supabase),
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
