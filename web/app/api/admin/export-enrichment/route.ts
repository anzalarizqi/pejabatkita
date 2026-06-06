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
    // Placeholders are intentionally kept (unlike export-kasus-csv): enrichment
    // also fills missing names via the nama_baru column.
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
