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

export async function GET() {
  const cookieStore = await cookies()
  const session = cookieStore.get('admin_session')
  if (!session?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServerSupabase(true)

  const [pejabatRes, provRes] = await Promise.all([
    supabase
      .from('pejabat')
      .select('id, nama_lengkap, jabatan(id, posisi, wilayah:wilayah_id(id, nama, kode_bps, level))')
      .limit(5000),
    supabase.from('wilayah').select('kode_bps, nama').eq('level', 'provinsi'),
  ])

  const provMap: Record<string, string> = {}
  for (const w of provRes.data ?? []) {
    provMap[w.kode_bps] = w.nama
  }

  const rows: string[] = []
  rows.push(csvRow(['pejabat_id', 'jabatan_id', 'posisi', 'wilayah', 'provinsi', 'placeholder_saat_ini', 'nama_baru', 'sumber_url', 'catatan']))

  const pejabatList = pejabatRes.data ?? []
  type WilayahRaw = { id: string; nama: string; kode_bps: string; level: string }
  type JabatanRaw = { id: string; posisi: string; wilayah: WilayahRaw | WilayahRaw[] | null }
  type PejabatRaw = { id: string; nama_lengkap: string; jabatan: JabatanRaw[] }

  const entries: Array<{ pejabatId: string; jabatanId: string; posisi: string; wilayah: string; provinsi: string; placeholder: string; isWakil: boolean }> = []

  for (const p of pejabatList as unknown as PejabatRaw[]) {
    if (!isPlaceholder(p.nama_lengkap)) continue
    for (const j of (p.jabatan ?? [])) {
      const w = Array.isArray(j.wilayah) ? j.wilayah[0] ?? null : j.wilayah
      const kode = w?.kode_bps ?? ''
      const provinsi = provMap[kode.slice(0, 2)] ?? ''
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

  for (const e of entries) {
    rows.push(csvRow([e.pejabatId, e.jabatanId, e.posisi, e.wilayah, e.provinsi, e.placeholder, '', '', '']))
  }

  const csv = rows.join('\n')
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="placeholders_${date}.csv"`,
    },
  })
}
