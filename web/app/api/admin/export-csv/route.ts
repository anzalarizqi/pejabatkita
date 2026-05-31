import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAdmin } from '@/lib/auth'

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
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)

  // Separate queries — avoids PostgREST nested-join silently dropping rows
  const [wilayahRows, pejabatRows, jabatanRows] = await Promise.all([
    fetchAll<{ id: string; kode_bps: string; nama: string; level: string }>(supabase, 'wilayah', 'id, kode_bps, nama, level'),
    fetchAll<{ id: string; nama_lengkap: string }>(supabase, 'pejabat', 'id, nama_lengkap'),
    fetchAll<{ id: string; pejabat_id: string; wilayah_id: string; posisi: string }>(supabase, 'jabatan', 'id, pejabat_id, wilayah_id, posisi'),
  ])

  const wilayahById = new Map(wilayahRows.map(w => [w.id, w]))
  const provMap = new Map(wilayahRows.filter(w => w.level === 'provinsi').map(w => [w.kode_bps, w.nama]))

  // Index jabatan by pejabat_id
  const jabatanByPejabat = new Map<string, typeof jabatanRows>()
  for (const j of jabatanRows) {
    const list = jabatanByPejabat.get(j.pejabat_id) ?? []
    list.push(j)
    jabatanByPejabat.set(j.pejabat_id, list)
  }

  const entries: Array<{
    pejabatId: string; jabatanId: string; posisi: string
    wilayah: string; provinsi: string; placeholder: string; isWakil: boolean
  }> = []

  for (const p of pejabatRows) {
    if (!isPlaceholder(p.nama_lengkap)) continue
    for (const j of jabatanByPejabat.get(p.id) ?? []) {
      const w = wilayahById.get(j.wilayah_id)
      const kode = w?.kode_bps ?? ''
      const provinsi = provMap.get(kode.slice(0, 2)) ?? ''
      entries.push({
        pejabatId: p.id,
        jabatanId: j.id,
        posisi: j.posisi ?? '',
        wilayah: w?.nama ?? '',
        provinsi,
        placeholder: p.nama_lengkap,
        isWakil: /wakil/i.test(j.posisi ?? ''),
      })
    }
  }

  // Kepala daerah first, then wakil; within each group sort by province + wilayah
  entries.sort((a, b) => {
    if (a.isWakil !== b.isWakil) return a.isWakil ? 1 : -1
    if (a.provinsi !== b.provinsi) return a.provinsi.localeCompare(b.provinsi)
    return a.wilayah.localeCompare(b.wilayah)
  })

  const rows: string[] = [
    csvRow(['pejabat_id', 'jabatan_id', 'posisi', 'wilayah', 'provinsi', 'placeholder_saat_ini', 'nama_baru', 'sumber_url', 'catatan']),
    ...entries.map(e => csvRow([e.pejabatId, e.jabatanId, e.posisi, e.wilayah, e.provinsi, e.placeholder, '', '', ''])),
  ]

  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="placeholders_${date}.csv"`,
    },
  })
}
