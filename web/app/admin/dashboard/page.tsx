import { createServerSupabase } from '@/lib/supabase'
import { Wilayah, JabatanRow, ScrapeRun, Flag } from '@/lib/types'
import DashboardClient from './DashboardClient'

interface WilayahWithChildren extends Wilayah {
  children: Wilayah[]
}

interface RowStats {
  wilayah_id: string
  count: number
}

async function getCoverageData() {
  const supabase = await createServerSupabase(true)

  const [wilayahRes, jabatanRes, scrapeRes, flagRes] = await Promise.all([
    supabase.from('wilayah').select('*').order('nama'),
    supabase.from('jabatan').select('wilayah_id, pejabat_id').eq('status', 'aktif'),
    supabase
      .from('scrape_runs')
      .select('*')
      .eq('status', 'done')
      .order('finished_at', { ascending: false }),
    supabase.from('flags').select('pejabat_id, status').eq('status', 'pending'),
  ])

  const allWilayah: Wilayah[] = wilayahRes.data ?? []
  const jabatan: Pick<JabatanRow, 'wilayah_id' | 'pejabat_id'>[] = jabatanRes.data ?? []
  const scrapeRuns: ScrapeRun[] = scrapeRes.data ?? []
  const pendingFlags: Pick<Flag, 'pejabat_id' | 'status'>[] = flagRes.data ?? []

  // Build province → children map
  const provinces = allWilayah.filter((w) => w.level === 'provinsi')
  const childMap = new Map<string, Wilayah[]>()
  allWilayah
    .filter((w) => w.level === 'kabupaten' || w.level === 'kota')
    .forEach((w) => {
      if (!w.parent_id) return
      if (!childMap.has(w.parent_id)) childMap.set(w.parent_id, [])
      childMap.get(w.parent_id)!.push(w)
    })

  // Count active jabatan per wilayah_id
  const jabatanByWilayah = new Map<string, number>()
  jabatan.forEach((j) => {
    jabatanByWilayah.set(j.wilayah_id, (jabatanByWilayah.get(j.wilayah_id) ?? 0) + 1)
  })

  // Latest scrape run per kode_provinsi (first after ordering desc)
  const latestScrape = new Map<string, ScrapeRun>()
  scrapeRuns.forEach((r) => {
    if (!latestScrape.has(r.kode_provinsi)) latestScrape.set(r.kode_provinsi, r)
  })

  // Count pending flags per wilayah_id (simplified: use jabatan's wilayah_id)
  const jabatanPejabatIds = new Set(jabatan.map((j) => j.pejabat_id))
  const pendingFlagCount = pendingFlags.length

  const rows = provinces.map((prov) => {
    const children = childMap.get(prov.id) ?? []
    const expected = 2 + children.length * 2
    const actual = (jabatanByWilayah.get(prov.id) ?? 0) +
      children.reduce((sum, c) => sum + (jabatanByWilayah.get(c.id) ?? 0), 0)
    const pct = expected > 0 ? Math.round((actual / expected) * 100) : 0
    const scrape = latestScrape.get(prov.kode_bps)
    const avgConf = scrape?.avg_confidence ?? null
    const needsReview = scrape?.needs_review_count ?? 0
    const status: 'green' | 'yellow' | 'gray' =
      actual === 0 ? 'gray' :
      needsReview > 0 || pendingFlagCount > 0 ? 'yellow' :
      (avgConf !== null && avgConf >= 0.8) ? 'green' : 'yellow'

    return {
      wilayah: prov,
      children,
      actual,
      expected,
      pct,
      avgConf,
      needsReview,
      lastScrapedAt: scrape?.finished_at ?? null,
      status,
      pendingFlags: 0, // simplified — per-province flag count needs join
    }
  })

  return rows
}

export default async function DashboardPage() {
  const rows = await getCoverageData()
  return <DashboardClient rows={rows} />
}
