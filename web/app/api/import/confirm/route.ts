import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { DiffEntry, PejabatJSON, ImportDiff } from '@/lib/types'

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let diff: ImportDiff
  try {
    diff = await request.json() as ImportDiff
    if (!diff.entries || !Array.isArray(diff.entries)) throw new Error()
  } catch {
    return NextResponse.json({ error: 'Invalid diff payload' }, { status: 400 })
  }

  const supabase = await createServerSupabase(true) // service role — bypasses RLS

  // Fetch wilayah map (kode_bps → id)
  const { data: wilayahRows } = await supabase.from('wilayah').select('id, kode_bps, nama')
  const wilayahByKode = new Map<string, string>()
  const wilayahByName = new Map<string, string>()
  ;(wilayahRows ?? []).forEach((w) => {
    wilayahByKode.set(w.kode_bps, w.id)
    wilayahByName.set(normalize(w.nama), w.id)
  })

  let inserted = 0, updated = 0, flagged = 0, errors: string[] = []

  for (const entry of diff.entries) {
    if (entry.action === 'unchanged') continue

    const p = entry.incoming

    try {
      if (entry.action === 'new') {
        // Insert pejabat
        const { data: newPejabat, error: pe } = await supabase
          .from('pejabat')
          .insert({
            id: p.id,
            nama_lengkap: p.nama_lengkap,
            gelar_depan: p.gelar_depan,
            gelar_belakang: p.gelar_belakang,
            biodata: p.biodata,
            pendidikan: p.pendidikan,
            metadata: p.metadata,
          })
          .select('id')
          .single()

        if (pe || !newPejabat) {
          errors.push(`Insert pejabat failed: ${p.nama_lengkap} — ${pe?.message}`)
          continue
        }

        // Insert jabatan rows
        for (const j of p.jabatan ?? []) {
          const wilayahId =
            wilayahByKode.get(j.kode_wilayah) ?? wilayahByName.get(normalize(j.wilayah))
          if (!wilayahId) {
            errors.push(`Wilayah not found for ${j.wilayah} (${j.kode_wilayah})`)
            continue
          }
          await supabase.from('jabatan').insert({
            pejabat_id: newPejabat.id,
            wilayah_id: wilayahId,
            posisi: j.posisi,
            partai: j.partai,
            mulai_jabatan: j.mulai_jabatan,
            selesai_jabatan: j.selesai_jabatan,
            status: j.status,
          })
        }

        // Auto-flag if needs_review
        if (p.metadata?.needs_review) {
          await supabase.from('flags').insert({
            pejabat_id: newPejabat.id,
            type: 'system',
            reason: 'Perlu tinjauan manual — skor kepercayaan rendah atau data tidak lengkap.',
            status: 'pending',
          })
          flagged++
        }

        inserted++
      } else if (entry.action === 'updated' && entry.existing) {
        // Update pejabat fields
        await supabase
          .from('pejabat')
          .update({
            nama_lengkap: p.nama_lengkap,
            gelar_depan: p.gelar_depan,
            gelar_belakang: p.gelar_belakang,
            biodata: p.biodata,
            pendidikan: p.pendidikan,
            metadata: p.metadata,
          })
          .eq('id', entry.existing.id)

        // Upsert jabatan rows
        for (const j of p.jabatan ?? []) {
          const wilayahId =
            wilayahByKode.get(j.kode_wilayah) ?? wilayahByName.get(normalize(j.wilayah))
          if (!wilayahId) continue

          await supabase.from('jabatan').upsert(
            {
              pejabat_id: entry.existing.id,
              wilayah_id: wilayahId,
              posisi: j.posisi,
              partai: j.partai,
              mulai_jabatan: j.mulai_jabatan,
              selesai_jabatan: j.selesai_jabatan,
              status: j.status,
            },
            { onConflict: 'pejabat_id, wilayah_id, posisi' }
          )
        }

        updated++
      }
    } catch (err) {
      errors.push(`Unexpected error for ${p.nama_lengkap}: ${String(err)}`)
    }
  }

  // Record scrape_run if metadata provided
  if (diff.province) {
    const { data: provWilayah } = await supabase
      .from('wilayah')
      .select('id, kode_bps')
      .ilike('nama', `%${diff.province}%`)
      .eq('level', 'provinsi')
      .limit(1)
      .single()

    if (provWilayah) {
      await supabase.from('scrape_runs').insert({
        provinsi: diff.province,
        kode_provinsi: provWilayah.kode_bps,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: 'done',
        total_pejabat: inserted + updated,
        needs_review_count: flagged,
      })
    }
  }

  return NextResponse.json({ inserted, updated, flagged, errors })
}
