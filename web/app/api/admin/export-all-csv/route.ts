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
      .select('id, nama_lengkap, metadata, jabatan(id, posisi, wilayah:wilayah_id(nama, kode_bps))')
      .limit(5000),
    supabase.from('wilayah').select('kode_bps, nama').eq('level', 'provinsi'),
  ])

  const provMap: Record<string, string> = {}
  for (const w of provRes.data ?? []) provMap[w.kode_bps] = w.nama

  type WilayahRaw = { nama: string; kode_bps: string }
  type JabatanRaw = { id: string; posisi: string; wilayah: WilayahRaw | WilayahRaw[] | null }
  type PejabatRaw = { id: string; nama_lengkap: string; metadata: Record<string, unknown> | null; jabatan: JabatanRaw[] }

  const rows: string[] = []
  rows.push(csvRow(['pejabat_id', 'nama_lengkap', 'posisi', 'wilayah', 'provinsi', 'status', 'confidence', 'sumber_url', 'nama_koreksi', 'catatan']))

  const entries: Array<Record<string, string>> = []

  for (const p of (pejabatRes.data ?? []) as unknown as PejabatRaw[]) {
    for (const j of (p.jabatan ?? [])) {
      const w = Array.isArray(j.wilayah) ? j.wilayah[0] ?? null : j.wilayah
      const kode = w?.kode_bps ?? ''
      const provinsi = provMap[kode.slice(0, 2)] ?? ''
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
        status,
        confidence,
        sumber_url: sumber,
        nama_koreksi: '',
        catatan: '',
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

  for (const e of entries) {
    rows.push(csvRow([e.pejabat_id, e.nama_lengkap, e.posisi, e.wilayah, e.provinsi, e.status, e.confidence, e.sumber_url, e.nama_koreksi, e.catatan]))
  }

  const csv = rows.join('\n')
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit_pejabat_${date}.csv"`,
    },
  })
}
