import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { cookies } from 'next/headers'
import * as XLSX from 'xlsx'

const PLACEHOLDER_RE = /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i
const LLM_ERR_RE = /^\[LLM Error\]/i

function isPlaceholder(name: string | null): boolean {
  if (!name?.trim()) return true
  return LLM_ERR_RE.test(name) || PLACEHOLDER_RE.test(name)
}

function parseCsv(text: string): Record<string, string>[] {
  const delimiter = text.slice(0, 2048).split(';').length > text.slice(0, 2048).split(',').length ? ';' : ','
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
  const session = cookieStore.get('admin_session')
  if (!session?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const isExcel = /\.(xlsx|xls)$/i.test(file.name)
  let rows: Record<string, string>[]

  if (isExcel) {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
  } else {
    const text = await file.text()
    rows = parseCsv(text)
  }

  if (!rows.length) return NextResponse.json({ error: 'File kosong atau format tidak dikenali' }, { status: 400 })

  const supabase = await createServerSupabase(true)

  let updated = 0
  let skippedEmpty = 0
  let skippedBadName = 0
  const errors: string[] = []

  for (const row of rows) {
    const nama = (row['nama_baru'] ?? row['nama_koreksi'] ?? '').trim()
    const pid = (row['pejabat_id'] ?? '').trim()
    const sumber = (row['sumber_url'] ?? '').trim()

    if (!nama) { skippedEmpty++; continue }
    if (!pid) { errors.push(`Row missing pejabat_id`); continue }
    if (isPlaceholder(nama)) { skippedBadName++; continue }

    try {
      await supabase.from('pejabat').update({
        nama_lengkap: nama,
        last_updated: new Date().toISOString(),
        metadata: {
          verified_by: 'gemini_manual',
          sources: sumber ? [{ url: sumber, method: 'gemini_web' }] : [],
          confidence: sumber ? 0.9 : 0.7,
        },
      }).eq('id', pid)
      updated++
    } catch (e) {
      errors.push(`${pid.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({ updated, skippedEmpty, skippedBadName, errors, total: rows.length })
}
