import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i

function isPlaceholder(name: string | null): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function csvRow(fields: string[]): string {
  return fields.map(f => {
    const s = (f ?? '').toString()
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }).join(',')
}

async function fetchAll<T>(supabase: Awaited<ReturnType<typeof createServerSupabase>>, table: string, columns: string): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1)
    const chunk = (data ?? []) as T[]
    rows.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return rows
}

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)

  const [wilayahRows, pejabatRows, jabatanRows] = await Promise.all([
    fetchAll<{ id: string; kode_bps: string; nama: string; level: string }>(supabase, 'wilayah', 'id, kode_bps, nama, level'),
    fetchAll<{ id: string; nama_lengkap: string; metadata: Record<string, unknown> | null }>(supabase, 'pejabat', 'id, nama_lengkap, metadata'),
    fetchAll<{ pejabat_id: string; wilayah_id: string; posisi: string; partai: string | null; mulai_jabatan: string | null; selesai_jabatan: string | null; status: string }>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id, posisi, partai, mulai_jabatan, selesai_jabatan, status'
    ),
  ])

  const wilayahById = new Map(wilayahRows.map(w => [w.id, w]))
  const provMap = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.kode_bps, w.nama]))
  const pejabatById = new Map(pejabatRows.map(p => [p.id, p]))

  const jabatanByPejabat = new Map<string, typeof jabatanRows>()
  for (const j of jabatanRows) {
    const list = jabatanByPejabat.get(j.pejabat_id) ?? []
    list.push(j)
    jabatanByPejabat.set(j.pejabat_id, list)
  }

  const entries: Array<Record<string, string>> = []

  for (const p of pejabatRows) {
    for (const j of jabatanByPejabat.get(p.id) ?? []) {
      const w = wilayahById.get(j.wilayah_id)
      const kode = w?.kode_bps ?? ''
      const provinsi = provMap.get(kode.slice(0, 2)) ?? ''
      const meta = p.metadata ?? {}
      const sources = (meta.sources as Array<{ url?: string }> | undefined) ?? []
      const sumber = sources[0]?.url ?? ''
      const confidence = String(meta.confidence ?? '')
      const status = isPlaceholder(p.nama_lengkap) ? 'placeholder' : 'terisi'

      entries.push({
        pejabat_id: p.id,
        nama_lengkap: p.nama_lengkap ?? '',
        posisi: j.posisi ?? '',
        wilayah: w?.nama ?? '',
        provinsi,
        partai: j.partai ?? '',
        mulai_jabatan: j.mulai_jabatan ?? '',
        selesai_jabatan: j.selesai_jabatan ?? '',
        jabatan_status: j.status ?? '',
        status,
        confidence,
        sumber_url: sumber,
        _isWakil: /wakil/i.test(j.posisi ?? '') ? '1' : '0',
      })
    }
  }

  entries.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'placeholder' ? -1 : 1
    if (a._isWakil !== b._isWakil) return a._isWakil === '0' ? -1 : 1
    if (a.provinsi !== b.provinsi) return a.provinsi.localeCompare(b.provinsi)
    return a.wilayah.localeCompare(b.wilayah)
  })

  const rows: string[] = [
    csvRow(['pejabat_id', 'nama_lengkap', 'posisi', 'wilayah', 'provinsi', 'partai', 'mulai_jabatan', 'selesai_jabatan', 'jabatan_status', 'status', 'confidence', 'sumber_url']),
    ...entries.map(e => csvRow([e.pejabat_id, e.nama_lengkap, e.posisi, e.wilayah, e.provinsi, e.partai, e.mulai_jabatan, e.selesai_jabatan, e.jabatan_status, e.status, e.confidence, e.sumber_url])),
  ]

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="semua_pejabat_${date}.csv"`,
    },
  })
}
