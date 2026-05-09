import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isPlaceholder(name: string | null): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

function parseCsv(text: string): Record<string, string>[] {
  const sample = text.slice(0, 2048)
  const delimiter = sample.split(';').length > sample.split(',').length ? ';' : ','
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''))
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
      } else if (ch === delimiter && !inQuote) {
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

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_session')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const text = await file.text()
  const rows = parseCsv(text)
  if (!rows.length) return NextResponse.json({ error: 'File kosong atau format tidak dikenali' }, { status: 400 })

  const supabase = await createServerSupabase(true)

  let jabatanUpdated = 0
  let pejabatUpdated = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    const jabatanId = (row['jabatan_id'] ?? '').trim()
    const pejabatId = (row['pejabat_id'] ?? '').trim()
    const posisi = row['posisi'] ?? ''
    const wilayah = row['wilayah'] ?? ''
    const label = `${posisi} @ ${wilayah}`

    const partai = (row['partai'] ?? '').trim()
    const mulai = (row['mulai_jabatan_baru'] ?? '').trim()
    const selesai = (row['selesai_jabatan_baru'] ?? '').trim()
    const namaBaru = (row['nama_baru'] ?? '').trim()

    const jabatanPatch: Record<string, string> = {}
    const dateWarnings: string[] = []

    if (partai) jabatanPatch['partai'] = partai

    if (mulai) {
      if (isValidDate(mulai)) jabatanPatch['mulai_jabatan'] = mulai
      else dateWarnings.push(`mulai_jabatan_baru="${mulai}" bukan tanggal valid`)
    }
    if (selesai) {
      if (isValidDate(selesai)) jabatanPatch['selesai_jabatan'] = selesai
      else dateWarnings.push(`selesai_jabatan_baru="${selesai}" bukan tanggal valid`)
    }

    for (const w of dateWarnings) errors.push(`${label}: ${w}`)

    const hasJabatanUpdate = Object.keys(jabatanPatch).length > 0
    const hasPejabatUpdate = namaBaru.length > 0 && !isPlaceholder(namaBaru)

    if (!hasJabatanUpdate && !hasPejabatUpdate) { skipped++; continue }

    if (!jabatanId) { errors.push(`${label}: missing jabatan_id`); continue }
    if (!pejabatId) { errors.push(`${label}: missing pejabat_id`); continue }

    if (hasJabatanUpdate) {
      try {
        await supabase.from('jabatan').update(jabatanPatch).eq('id', jabatanId)
        jabatanUpdated++
      } catch (e) {
        errors.push(`${label}: jabatan update failed — ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (hasPejabatUpdate) {
      try {
        await supabase.from('pejabat').update({
          nama_lengkap: namaBaru,
          last_updated: new Date().toISOString(),
        }).eq('id', pejabatId)
        pejabatUpdated++
      } catch (e) {
        errors.push(`${label}: pejabat update failed — ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return NextResponse.json({
    jabatanUpdated,
    pejabatUpdated,
    skipped,
    errors,
    total: rows.length,
  })
}
