import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { PejabatJSON, PejabatRow, JabatanRow, Wilayah, DiffEntry, ImportDiff } from '@/lib/types'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectChangedFields(
  incoming: PejabatJSON,
  existing: PejabatRow & { jabatan: JabatanRow[] }
): string[] {
  const changed: string[] = []

  if (normalize(incoming.nama_lengkap) !== normalize(existing.nama_lengkap))
    changed.push('nama_lengkap')
  if ((incoming.gelar_depan ?? '') !== (existing.gelar_depan ?? ''))
    changed.push('gelar_depan')
  if ((incoming.gelar_belakang ?? '') !== (existing.gelar_belakang ?? ''))
    changed.push('gelar_belakang')

  const ib = incoming.biodata
  const eb = existing.biodata
  if ((ib.tanggal_lahir ?? '') !== (eb.tanggal_lahir ?? '')) changed.push('biodata.tanggal_lahir')
  if ((ib.tempat_lahir ?? '') !== (eb.tempat_lahir ?? '')) changed.push('biodata.tempat_lahir')
  if ((ib.jenis_kelamin ?? '') !== (eb.jenis_kelamin ?? '')) changed.push('biodata.jenis_kelamin')
  if ((ib.agama ?? '') !== (eb.agama ?? '')) changed.push('biodata.agama')

  const ipKeys = JSON.stringify(incoming.pendidikan ?? [])
  const epKeys = JSON.stringify(existing.pendidikan ?? [])
  if (ipKeys !== epKeys) changed.push('pendidikan')

  const incomingJabatan = incoming.jabatan ?? []
  const existingJabatan = existing.jabatan ?? []
  const ijKeys = incomingJabatan.map((j) => `${j.posisi}|${j.wilayah}|${j.status}`).sort().join(',')
  const ejKeys = existingJabatan.map((j) => `${j.posisi}|${j.wilayah_id}|${j.status}`).sort().join(',')
  if (ijKeys !== ejKeys) changed.push('jabatan')

  return changed
}

export async function POST(request: NextRequest) {
  // Admin check
  const session = request.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let pejabatList: PejabatJSON[]
  try {
    const body = await request.json() as { data: PejabatJSON[] }
    pejabatList = body.data
    if (!Array.isArray(pejabatList) || pejabatList.length === 0) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format. Expected { data: PejabatJSON[] }' }, { status: 400 })
  }

  // Detect province from first entry
  const firstJabatan = pejabatList[0]?.jabatan?.[0]
  const provinsiName = firstJabatan?.wilayah ?? 'Unknown'

  const supabase = await createServerSupabase()

  // Fetch existing pejabat + jabatan for this province
  const { data: existingPejabat } = await supabase
    .from('pejabat')
    .select('*, jabatan(*)')
    .order('nama_lengkap')

  const existingMap = new Map<string, PejabatRow & { jabatan: JabatanRow[] }>()
  ;(existingPejabat ?? []).forEach((p) => {
    const key = normalize(p.nama_lengkap)
    existingMap.set(key, p as PejabatRow & { jabatan: JabatanRow[] })
  })

  // Build diff
  let newCount = 0, updatedCount = 0, unchangedCount = 0
  const entries: DiffEntry[] = pejabatList.map((incoming) => {
    const key = normalize(incoming.nama_lengkap)
    const existing = existingMap.get(key)

    if (!existing) {
      newCount++
      return { action: 'new', incoming }
    }

    const changedFields = detectChangedFields(incoming, existing)
    if (changedFields.length === 0) {
      unchangedCount++
      return { action: 'unchanged', incoming, existing }
    }

    updatedCount++
    return { action: 'updated', incoming, existing, changedFields }
  })

  const diff: ImportDiff = {
    province: provinsiName,
    newCount,
    updatedCount,
    unchangedCount,
    entries,
  }

  return NextResponse.json(diff)
}
