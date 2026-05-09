import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i
const URLS_TRIED_RE = /URLs tried:\n((?:  - .+\n?)+)/m

function isPlaceholder(name: string | null): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function extractUrls(reason: string | null): string {
  if (!reason) return ''
  const m = URLS_TRIED_RE.exec(reason)
  if (!m) return ''
  return m[1].split('\n')
    .map(l => l.trim().replace(/^- /, ''))
    .filter(Boolean)
    .join(' | ')
}

function csvRow(fields: (string | null | undefined)[]): string {
  return fields.map(f => {
    const s = (f ?? '').toString()
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }).join(',')
}

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  table: string,
  columns: string,
  extra?: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    let q = supabase.from(table).select(columns)
    if (extra) q = extra(q) as typeof q
    const { data } = await (q as ReturnType<typeof supabase.from>).range(offset, offset + 999)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < 1000) break
    offset += 1000
  }
  return rows
}

export async function GET() {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_session')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)

  const [wilayahRows, pejabatRows, jabatanRows, flagRows] = await Promise.all([
    fetchAll<{ id: string; kode_bps: string; nama: string; level: string; parent_id: string | null }>(
      supabase, 'wilayah', 'id, kode_bps, nama, level, parent_id',
    ),
    fetchAll<{ id: string; nama_lengkap: string; gelar_depan: string | null; gelar_belakang: string | null }>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang',
    ),
    fetchAll<{ id: string; pejabat_id: string; wilayah_id: string; posisi: string; mulai_jabatan: string | null; selesai_jabatan: string | null }>(
      supabase, 'jabatan', 'id, pejabat_id, wilayah_id, posisi, mulai_jabatan, selesai_jabatan',
      q => q.is('partai', null),
    ),
    fetchAll<{ pejabat_id: string; reason: string | null }>(
      supabase, 'flags', 'pejabat_id, reason',
      q => q.eq('type', 'agent_unresolved').eq('status', 'pending'),
    ),
  ])

  const wilayahById = new Map(wilayahRows.map(w => [w.id, w]))
  const provById = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.id, w.nama]))
  const provByKode = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.kode_bps, w.nama]))
  const pejabatById = new Map(pejabatRows.map(p => [p.id, p]))
  const flagByPejabat = new Map(flagRows.map(f => [f.pejabat_id, f]))

  function getProvinsi(w: { level: string; parent_id: string | null; kode_bps: string }): string {
    if (w.level === 'provinsi') return provById.get(w.kode_bps) ?? ''
    if (w.parent_id) return provById.get(w.parent_id) ?? ''
    return provByKode.get(w.kode_bps.slice(0, 2)) ?? ''
  }

  type Entry = {
    pejabat_id: string; jabatan_id: string; nama_lengkap: string
    posisi: string; wilayah: string; provinsi: string
    mulai_jabatan: string; selesai_jabatan: string
    is_placeholder: string; has_unresolved_flag: string; urls_tried: string
    isWakil: boolean
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
    const flag = flagByPejabat.get(p.id)

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
      has_unresolved_flag: flag ? 'Y' : '',
      urls_tried: extractUrls(flag?.reason ?? null),
      isWakil: /wakil/i.test(j.posisi ?? ''),
    })
  }

  // Real names first, then placeholders; within each: provinsi → wilayah → posisi
  entries.sort((a, b) => {
    const ph = (a.is_placeholder ? 1 : 0) - (b.is_placeholder ? 1 : 0)
    if (ph !== 0) return ph
    if (a.provinsi !== b.provinsi) return a.provinsi.localeCompare(b.provinsi)
    if (a.wilayah !== b.wilayah) return a.wilayah.localeCompare(b.wilayah)
    return a.posisi.localeCompare(b.posisi)
  })

  const header = csvRow([
    'pejabat_id', 'jabatan_id', 'nama_lengkap', 'posisi', 'wilayah', 'provinsi',
    'mulai_jabatan', 'selesai_jabatan',
    'is_placeholder', 'has_unresolved_flag', 'urls_tried',
    'partai', 'mulai_jabatan_baru', 'selesai_jabatan_baru', 'nama_baru', 'sumber_url', 'catatan',
  ])
  const rows = [
    header,
    ...entries.map(e => csvRow([
      e.pejabat_id, e.jabatan_id, e.nama_lengkap, e.posisi, e.wilayah, e.provinsi,
      e.mulai_jabatan, e.selesai_jabatan,
      e.is_placeholder, e.has_unresolved_flag, e.urls_tried,
      '', '', '', '', '', '',
    ])),
  ]

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="enrichment_${date}.csv"`,
    },
  })
}
