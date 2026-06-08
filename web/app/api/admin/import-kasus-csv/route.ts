import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { isAdmin } from '@/lib/auth'
import { normalizePartai } from '@/lib/partai'

const VALID_STATUS = new Set(['tersangka', 'terdakwa', 'terpidana'])
const VALID_JENIS = new Set(['korupsi', 'suap', 'gratifikasi', 'pencucian_uang', 'lainnya'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const sample = text.slice(0, 2048)
  const delimiter = sample.split(';').length > sample.split(',').length ? ';' : ','
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

function isTruthy(val: string): boolean {
  return val === '1' || val.toLowerCase() === 'ya' || val.toLowerCase() === 'true'
}

function isFalsy(val: string): boolean {
  return val === '0' || val.toLowerCase() === 'tidak' || val.toLowerCase() === 'false'
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  const text = await file.text()
  const rows = parseCsv(text)
  if (!rows.length) {
    return NextResponse.json({ error: 'File kosong atau format tidak dikenali' }, { status: 400 })
  }

  const supabase = await createServerSupabase(true)

  // Fetch pejabat_ids already in kasus table (mutable — updated as we insert)
  const { data: existingKasusData } = await supabase.from('kasus').select('pejabat_id')
  const existingKasusSet = new Set<string>(
    (existingKasusData ?? []).map((k: { pejabat_id: string }) => k.pejabat_id)
  )

  let found = 0
  let bersih = 0
  let skipped_existing = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const row of rows) {
    const pejabat_id = (row['pejabat_id'] ?? '').trim()
    const displayName = (row['nama'] ?? pejabat_id.slice(0, 8)).trim()

    if (!pejabat_id || !UUID_RE.test(pejabat_id)) {
      errors.push(`"${displayName}" — pejabat_id kosong atau tidak valid, dilewati`)
      continue
    }

    // Skip if already has a kasus row
    if (existingKasusSet.has(pejabat_id)) {
      skipped_existing++
      continue
    }

    const kasus_found = (row['kasus_found'] ?? '').trim()
    const keyakinan = (row['keyakinan'] ?? '').trim() || null

    // kasus_found = 0 → bersih
    if (isFalsy(kasus_found)) {
      const { error } = await supabase.from('kasus_screened').upsert(
        { pejabat_id, last_screened_at: now, last_result: 'bersih', last_keyakinan: keyakinan },
        { onConflict: 'pejabat_id' }
      )
      if (error) errors.push(`${displayName}: ${error.message}`)
      else bersih++
      continue
    }

    // kasus_found = 1 → check status
    if (isTruthy(kasus_found)) {
      const status = (row['status'] ?? '').trim().toLowerCase()

      if (!status || !VALID_STATUS.has(status)) {
        // mirrors "tidak terbukti (no status)" branch in screen_kasus_llm.py
        errors.push(`${displayName}: kasus_found=1 tapi status kosong/tidak valid ("${status}") — dicatat sebagai bersih`)
        const { error: screenedBersihError } = await supabase.from('kasus_screened').upsert(
          { pejabat_id, last_screened_at: now, last_result: 'bersih', last_keyakinan: keyakinan },
          { onConflict: 'pejabat_id' }
        )
        if (screenedBersihError) errors.push(`${displayName}: ${screenedBersihError.message}`)
        else bersih++
        continue
      }

      const jenis = (row['jenis'] ?? '').trim().toLowerCase()
      const lembaga = (row['lembaga'] ?? '').trim() || null
      const tahunStr = (row['tahun'] ?? '').trim()
      const tahun = tahunStr ? parseInt(tahunStr, 10) : null
      const ringkasan = (row['ringkasan'] ?? '').trim() || null
      const url_sumber = (row['url_sumber'] ?? '').trim() || null
      const tanggalRaw = (row['tanggal_kasus'] ?? '').trim()
      const tanggal_kasus = ISO_DATE_RE.test(tanggalRaw) ? tanggalRaw : null

      const partaiRaw = (row['partai'] ?? '').trim()
      const partai = partaiRaw ? normalizePartai(partaiRaw)[0] : null

      const kasusRow: Record<string, unknown> = { pejabat_id, status }
      if (jenis && VALID_JENIS.has(jenis)) kasusRow.jenis = jenis
      if (lembaga) kasusRow.lembaga = lembaga
      if (tahun !== null && !isNaN(tahun)) kasusRow.tahun = tahun
      if (tanggal_kasus) kasusRow.tanggal_kasus = tanggal_kasus
      if (partai) kasusRow.partai = partai
      if (ringkasan) kasusRow.ringkasan = ringkasan
      if (url_sumber) kasusRow.url_sumber = url_sumber
      // verified intentionally omitted → NULL → verify_kasus.py picks it up

      const { error: kasusError } = await supabase.from('kasus').insert(kasusRow)
      if (kasusError) {
        errors.push(`${displayName}: ${kasusError.message}`)
        continue
      }

      // Mark as found in screened log
      const { error: screenedError } = await supabase.from('kasus_screened').upsert(
        { pejabat_id, last_screened_at: now, last_result: 'found', last_keyakinan: keyakinan },
        { onConflict: 'pejabat_id' }
      )
      if (screenedError) errors.push(`screened log ${displayName}: ${screenedError.message}`)

      // Prevent duplicate insert if same pejabat_id appears twice in CSV
      existingKasusSet.add(pejabat_id)
      found++
      continue
    }

    // kasus_found blank or unrecognised
    errors.push(`${displayName}: kasus_found tidak diisi ("${kasus_found}") — baris dilewati`)
  }

  return NextResponse.json({ found, bersih, skipped_existing, errors, total: rows.length })
}
