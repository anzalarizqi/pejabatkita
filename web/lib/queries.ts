import { createServerSupabase } from './supabase'
import type { Wilayah, JabatanRow, PejabatRow, KasusRow, HotspotEvent } from './types'

// ─── Placeholder filtering ────────────────────────────────────────────────────
// Pejabat with these name patterns are scraper artifacts, not real people.
// Hidden from public views by default; available via includePlaceholders=true.

// Patterns are broad on purpose: no real Indonesian official has a name
// starting with "Bupati"/"Gubernur"/etc. — these are always scraper artifacts
// where the LLM emitted the title as the name (e.g. "Gubernur Jawa Tengah").
const PLACEHOLDER_PATTERNS = [
  '[LLM Error]%',
  'Bupati %',
  'Wakil Bupati %',
  'Walikota %',
  'Wali Kota %',
  'Wakil Walikota %',
  'Wakil Wali Kota %',
  'Gubernur %',
  'Wakil Gubernur %',
  'Penjabat %',
  'Pj %',
  'Pj. %',
]

export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true
  const trimmed = name.trim()
  if (!trimmed) return true
  if (/^\[LLM Error\]/i.test(trimmed)) return true
  return /^(Bupati|Walikota|Wali Kota|Wakil Bupati|Wakil Walikota|Wakil Wali Kota|Gubernur|Wakil Gubernur|Penjabat|Pj\.?)\s+\S/i.test(
    trimmed,
  )
}

// ─── Province counts (for choropleth) ─────────────────────────────────────────

export interface ProvinceCount {
  nama: string
  kode_bps: string
  count: number
  expected: number
}

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  table: string,
  columns: string,
): Promise<T[]> {
  const pageSize = 1000
  const out: T[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + pageSize - 1)
    const chunk = (data ?? []) as T[]
    out.push(...chunk)
    if (chunk.length < pageSize) break
    offset += pageSize
  }
  return out
}

export async function listProvinceCounts(): Promise<ProvinceCount[]> {
  const supabase = await createServerSupabase()

  const [wilayah, jabatan, pejabat] = await Promise.all([
    fetchAll<Wilayah>(supabase, 'wilayah', 'id, kode_bps, nama, level, parent_id'),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id'>>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id',
    ),
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap'>>(
      supabase, 'pejabat', 'id, nama_lengkap',
    ),
  ])

  const wilayahById = new Map<string, Wilayah>()
  const provinces: Wilayah[] = []
  for (const w of wilayah) {
    wilayahById.set(w.id, w)
    if (w.level === 'provinsi') provinces.push(w)
  }

  const realPejabatIds = new Set<string>()
  for (const p of pejabat) {
    if (!isPlaceholderName(p.nama_lengkap)) realPejabatIds.add(p.id)
  }

  // Map wilayah_id → province name
  function provinceOf(wilayahId: string): string | null {
    const w = wilayahById.get(wilayahId)
    if (!w) return null
    if (w.level === 'provinsi') return w.nama
    if (w.parent_id) {
      const parent = wilayahById.get(w.parent_id)
      if (parent && parent.level === 'provinsi') return parent.nama
    }
    return null
  }

  // Count distinct (pejabat, province) pairs — a pejabat can hold jabatan in
  // multiple wilayah within the same province, but should only count once there.
  const counted = new Set<string>()
  const counts = new Map<string, number>()
  for (const j of jabatan) {
    if (!realPejabatIds.has(j.pejabat_id)) continue
    const provName = provinceOf(j.wilayah_id)
    if (!provName) continue
    const key = `${j.pejabat_id}::${provName}`
    if (counted.has(key)) continue
    counted.add(key)
    counts.set(provName, (counts.get(provName) ?? 0) + 1)
  }

  const kabKotaByProvId = new Map<string, number>()
  for (const w of wilayah) {
    if (w.level !== 'provinsi' && w.parent_id) {
      kabKotaByProvId.set(w.parent_id, (kabKotaByProvId.get(w.parent_id) ?? 0) + 1)
    }
  }

  return provinces
    .map((p) => ({
      nama: p.nama,
      kode_bps: p.kode_bps,
      count: counts.get(p.nama) ?? 0,
      expected: 2 + 2 * (kabKotaByProvId.get(p.id) ?? 0),
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama))
}

// ─── Site-wide stats (for the homepage) ──────────────────────────────────────

export interface SiteStats {
  realPejabat: number
  expectedTotal: number
  coveragePct: number
  provincesCovered: number
  provincesTotal: number
  lastUpdated: string | null
  kabKotaTotal: number
}

export async function getSiteStats(): Promise<SiteStats> {
  const supabase = await createServerSupabase()

  const [wilayah, pejabat, jabatan] = await Promise.all([
    fetchAll<Pick<Wilayah, 'id' | 'level' | 'parent_id' | 'nama'>>(
      supabase,
      'wilayah',
      'id, level, parent_id, nama',
    ),
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap' | 'metadata' | 'last_updated'>>(
      supabase,
      'pejabat',
      'id, nama_lengkap, metadata, last_updated',
    ),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id'>>(
      supabase,
      'jabatan',
      'pejabat_id, wilayah_id',
    ),
  ])

  const provinces = wilayah.filter((w) => w.level === 'provinsi')
  const kabkota = wilayah.filter((w) => w.level === 'kabupaten' || w.level === 'kota')
  const provincesTotal = provinces.length
  const kabKotaTotal = kabkota.length
  // Each province seat = 2 (gubernur + wakil), each kab/kota = 2 (bupati/walikota + wakil)
  const expectedTotal = provincesTotal * 2 + kabKotaTotal * 2

  const realPejabatIds = new Set<string>()
  for (const p of pejabat) {
    if (!isPlaceholderName(p.nama_lengkap)) realPejabatIds.add(p.id)
  }

  const wilayahById = new Map<string, Pick<Wilayah, 'id' | 'level' | 'parent_id' | 'nama'>>()
  for (const w of wilayah) wilayahById.set(w.id, w)

  const filledPejabatIds = new Set<string>()
  const coveredProvNames = new Set<string>()
  for (const j of jabatan) {
    if (!realPejabatIds.has(j.pejabat_id)) continue
    const w = wilayahById.get(j.wilayah_id)
    if (!w || w.level === 'nasional') continue  // exclude central/kabinet positions
    filledPejabatIds.add(j.pejabat_id)
    if (w.level === 'provinsi') coveredProvNames.add(w.nama)
    else if (w.parent_id) {
      const parent = wilayahById.get(w.parent_id)
      if (parent && parent.level === 'provinsi') coveredProvNames.add(parent.nama)
    }
  }
  const realPejabat = filledPejabatIds.size
  const provincesCovered = coveredProvNames.size

  // Last updated: max last_updated across pejabat
  let lastUpdated: string | null = null
  for (const p of pejabat) {
    const u = p.last_updated ?? null
    if (u && (!lastUpdated || u > lastUpdated)) lastUpdated = u
  }

  return {
    realPejabat,
    expectedTotal,
    coveragePct: expectedTotal > 0 ? (realPejabat / expectedTotal) * 100 : 0,
    provincesCovered,
    provincesTotal,
    lastUpdated,
    kabKotaTotal,
  }
}

// ─── Leader roster (kepala daerah only — for homepage rail) ──────────────────

export interface LeaderRow {
  id: string
  nama: string
  posisi: string
  wilayah: string
  wilayah_level: 'provinsi' | 'kabupaten' | 'kota'
  provinsi: string
}

const LEADER_RANK: Record<string, number> = {
  Gubernur: 0,
  Bupati: 1,
  Walikota: 1,
  'Wali Kota': 1,
}

export async function listLeaderRoster(): Promise<LeaderRow[]> {
  const supabase = await createServerSupabase()

  const [wilayah, jabatan, pejabat] = await Promise.all([
    fetchAll<Wilayah>(supabase, 'wilayah', 'id, kode_bps, nama, level, parent_id'),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id' | 'posisi' | 'status' | 'mulai_jabatan'>>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id, posisi, status, mulai_jabatan',
    ),
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap' | 'gelar_depan' | 'gelar_belakang'>>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang',
    ),
  ])

  const wilayahById = new Map<string, Wilayah>()
  for (const w of wilayah) wilayahById.set(w.id, w)

  const pejabatById = new Map<string, Pick<PejabatRow, 'id' | 'nama_lengkap' | 'gelar_depan' | 'gelar_belakang'>>()
  for (const p of pejabat) {
    if (!isPlaceholderName(p.nama_lengkap)) pejabatById.set(p.id, p)
  }

  // Best (top-rank) jabatan per pejabat among kepala-daerah-tier titles
  const best = new Map<string, typeof jabatan[number]>()
  for (const j of jabatan) {
    const rank = LEADER_RANK[j.posisi ?? '']
    if (rank === undefined) continue
    if (!pejabatById.has(j.pejabat_id)) continue
    const cur = best.get(j.pejabat_id)
    if (!cur) { best.set(j.pejabat_id, j); continue }
    const curRank = LEADER_RANK[cur.posisi ?? ''] ?? 99
    if (rank < curRank) best.set(j.pejabat_id, j)
    else if (rank === curRank && (j.mulai_jabatan ?? '') > (cur.mulai_jabatan ?? '')) {
      best.set(j.pejabat_id, j)
    }
  }

  const rows: LeaderRow[] = []
  for (const [pid, j] of best) {
    const w = wilayahById.get(j.wilayah_id)
    if (!w) continue
    const p = pejabatById.get(pid)!
    const provNama =
      w.level === 'provinsi'
        ? w.nama
        : w.parent_id
          ? wilayahById.get(w.parent_id)?.nama ?? ''
          : ''
    rows.push({
      id: p.id,
      nama: p.nama_lengkap,
      posisi: j.posisi ?? '',
      wilayah: w.nama,
      wilayah_level: w.level as LeaderRow['wilayah_level'],
      provinsi: provNama,
    })
  }

  rows.sort((a, b) => {
    const ra = LEADER_RANK[a.posisi] ?? 99
    const rb = LEADER_RANK[b.posisi] ?? 99
    if (ra !== rb) return ra - rb
    if (a.provinsi !== b.provinsi) return a.provinsi.localeCompare(b.provinsi)
    return a.wilayah.localeCompare(b.wilayah)
  })

  return rows
}

// ─── Pejabat listing (for /pejabat page) ──────────────────────────────────────

export interface PejabatCard {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  posisi: string | null
  wilayah_nama: string | null
  wilayah_level: string | null
  provinsi_nama: string | null
  status: string | null
  confidence: number | null
  has_kasus: boolean
}

export interface ListPejabatOptions {
  provinsi?: string
  wilayah?: string
  search?: string
  page?: number
  pageSize?: number
  includePlaceholders?: boolean
}

// ─── Wilayah (kab/kota) counts within a province ──────────────────────────────

export interface WilayahCount {
  nama: string
  level: 'kabupaten' | 'kota'
  count: number
}

export async function listWilayahCounts(provinsi: string): Promise<WilayahCount[]> {
  const supabase = await createServerSupabase()

  const { data: prov } = await supabase
    .from('wilayah')
    .select('id')
    .eq('level', 'provinsi')
    .eq('nama', provinsi)
    .maybeSingle()
  if (!prov) return []

  const { data: kids } = await supabase
    .from('wilayah')
    .select('id, nama, level')
    .eq('parent_id', prov.id)
  const wilayahList = (kids ?? []) as Array<{ id: string; nama: string; level: 'kabupaten' | 'kota' }>
  if (wilayahList.length === 0) return []

  const wilayahIds = wilayahList.map((w) => w.id)

  const [jabatan, pejabat] = await Promise.all([
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id'>>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id',
    ).then((rows) => rows.filter((r) => wilayahIds.includes(r.wilayah_id))),
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap'>>(
      supabase, 'pejabat', 'id, nama_lengkap',
    ),
  ])

  const realPejabatIds = new Set<string>()
  for (const p of pejabat) {
    if (!isPlaceholderName(p.nama_lengkap)) realPejabatIds.add(p.id)
  }

  // Count distinct (pejabat, wilayah) pairs
  const counted = new Set<string>()
  const counts = new Map<string, number>()
  for (const j of jabatan) {
    if (!realPejabatIds.has(j.pejabat_id)) continue
    const key = `${j.pejabat_id}::${j.wilayah_id}`
    if (counted.has(key)) continue
    counted.add(key)
    counts.set(j.wilayah_id, (counts.get(j.wilayah_id) ?? 0) + 1)
  }

  return wilayahList
    .map((w) => ({ nama: w.nama, level: w.level, count: counts.get(w.id) ?? 0 }))
    .sort((a, b) => a.nama.localeCompare(b.nama))
}

export interface ListPejabatResult {
  rows: PejabatCard[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const POSISI_RANK: Record<string, number> = {
  Gubernur: 0,
  'Wakil Gubernur': 1,
  Bupati: 2,
  Walikota: 2,
  'Wali Kota': 2,
  'Wakil Bupati': 3,
  'Wakil Walikota': 3,
  'Wakil Wali Kota': 3,
}

function rankPosisi(posisi: string | null | undefined): number {
  if (!posisi) return 99
  return POSISI_RANK[posisi] ?? 50
}

export async function listPejabat(opts: ListPejabatOptions = {}): Promise<ListPejabatResult> {
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(60, Math.max(6, opts.pageSize ?? 24))
  const supabase = await createServerSupabase()

  // Strategy: when provinsi filter is active, narrow pejabat IDs via jabatan
  // first (small wilayah list), then load pejabat by those IDs. Otherwise
  // paginate pejabat directly via postgrest .range().

  let restrictedPejabatIds: string[] | null = null
  let wilayahFilterIds: string[] | null = null

  if (opts.provinsi) {
    const { data: prov } = await supabase
      .from('wilayah')
      .select('id')
      .eq('level', 'provinsi')
      .eq('nama', opts.provinsi)
      .limit(1)
      .maybeSingle()
    if (!prov) {
      return { rows: [], total: 0, page, pageSize, totalPages: 0 }
    }
    const { data: kids } = await supabase
      .from('wilayah')
      .select('id, nama')
      .eq('parent_id', prov.id)
    const allKids = (kids ?? []) as Array<{ id: string; nama: string }>
    if (opts.wilayah) {
      const match = allKids.find((k) => k.nama === opts.wilayah)
      if (!match) {
        return { rows: [], total: 0, page, pageSize, totalPages: 0 }
      }
      wilayahFilterIds = [match.id]
    } else {
      wilayahFilterIds = [prov.id, ...allKids.map((k) => k.id)]
    }

    const { data: jabPids } = await supabase
      .from('jabatan')
      .select('pejabat_id')
      .in('wilayah_id', wilayahFilterIds)
    restrictedPejabatIds = Array.from(new Set((jabPids ?? []).map((j) => j.pejabat_id)))
    if (restrictedPejabatIds.length === 0) {
      return { rows: [], total: 0, page, pageSize, totalPages: 0 }
    }
  }

  // Pejabat query (filtered by name + placeholder patterns + optional id list).
  let pejabatQuery = supabase
    .from('pejabat')
    .select('id, nama_lengkap, gelar_depan, gelar_belakang, metadata', { count: 'exact' })

  if (restrictedPejabatIds) {
    pejabatQuery = pejabatQuery.in('id', restrictedPejabatIds)
  }
  if (opts.search && opts.search.trim()) {
    pejabatQuery = pejabatQuery.ilike('nama_lengkap', `%${opts.search.trim()}%`)
  }
  if (!opts.includePlaceholders) {
    for (const pat of PLACEHOLDER_PATTERNS) {
      pejabatQuery = pejabatQuery.not('nama_lengkap', 'ilike', pat)
    }
  }
  pejabatQuery = pejabatQuery
    .order('nama_lengkap', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)

  const { data: pageRows, count } = await pejabatQuery
  const visiblePejabat = (pageRows ?? []) as Array<
    Pick<PejabatRow, 'id' | 'nama_lengkap' | 'gelar_depan' | 'gelar_belakang' | 'metadata'>
  >
  const total = count ?? visiblePejabat.length

  if (visiblePejabat.length === 0) {
    return { rows: [], total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  }

  // Pull jabatan for ONLY this page's pejabat ids
  const pageIds = visiblePejabat.map((p) => p.id)

  const { data: kasusForPage } = await supabase
    .from('kasus')
    .select('pejabat_id')
    .in('pejabat_id', pageIds)
    .neq('verified', false)
  const kasusSet = new Set((kasusForPage ?? []).map((k) => k.pejabat_id as string))

  let jabQuery = supabase
    .from('jabatan')
    .select('pejabat_id, wilayah_id, posisi, status, mulai_jabatan')
    .in('pejabat_id', pageIds)
  if (wilayahFilterIds) jabQuery = jabQuery.in('wilayah_id', wilayahFilterIds)

  const { data: jabatanRows } = await jabQuery
  const jabList = (jabatanRows ?? []) as Array<
    Pick<JabatanRow, 'pejabat_id' | 'wilayah_id' | 'posisi' | 'status' | 'mulai_jabatan'>
  >

  // 5) Wilayah lookup for jabatan (for display)
  const allWilayahIds = Array.from(new Set(jabList.map((j) => j.wilayah_id)))
  const { data: wilayahRows } = allWilayahIds.length
    ? await supabase
        .from('wilayah')
        .select('id, nama, level, parent_id')
        .in('id', allWilayahIds)
    : { data: [] as Pick<Wilayah, 'id' | 'nama' | 'level' | 'parent_id'>[] }

  const wilayahById = new Map<string, Pick<Wilayah, 'id' | 'nama' | 'level' | 'parent_id'>>()
  for (const w of wilayahRows ?? []) wilayahById.set(w.id, w as never)

  // Need parent province names → fetch any missing parents
  const parentIds = Array.from(
    new Set(
      Array.from(wilayahById.values())
        .map((w) => w.parent_id)
        .filter((x): x is string => !!x && !wilayahById.has(x)),
    ),
  )
  if (parentIds.length) {
    const { data: parents } = await supabase
      .from('wilayah')
      .select('id, nama, level, parent_id')
      .in('id', parentIds)
    for (const w of parents ?? []) wilayahById.set(w.id, w as never)
  }

  function provNameOf(wilayahId: string): string | null {
    const w = wilayahById.get(wilayahId)
    if (!w) return null
    if (w.level === 'provinsi') return w.nama
    if (w.parent_id) return wilayahById.get(w.parent_id)?.nama ?? null
    return null
  }

  // 6) Pick primary jabatan per pejabat (rank by posisi, then most recent)
  const primaryByPejabat = new Map<string, typeof jabList[number]>()
  for (const j of jabList) {
    const cur = primaryByPejabat.get(j.pejabat_id)
    if (!cur) {
      primaryByPejabat.set(j.pejabat_id, j)
      continue
    }
    const a = rankPosisi(j.posisi)
    const b = rankPosisi(cur.posisi)
    if (a < b) primaryByPejabat.set(j.pejabat_id, j)
    else if (a === b) {
      const da = j.mulai_jabatan ?? ''
      const db = cur.mulai_jabatan ?? ''
      if (da > db) primaryByPejabat.set(j.pejabat_id, j)
    }
  }

  const rows: PejabatCard[] = visiblePejabat.map((p) => {
    const j = primaryByPejabat.get(p.id)
    const w = j ? wilayahById.get(j.wilayah_id) : undefined
    const meta = (p.metadata ?? {}) as { confidence?: { score?: number } }
    return {
      id: p.id,
      nama_lengkap: p.nama_lengkap,
      gelar_depan: p.gelar_depan,
      gelar_belakang: p.gelar_belakang,
      posisi: j?.posisi ?? null,
      wilayah_nama: w?.nama ?? null,
      wilayah_level: w?.level ?? null,
      provinsi_nama: j ? provNameOf(j.wilayah_id) : null,
      status: j?.status ?? null,
      confidence: meta.confidence?.score ?? null,
      has_kasus: kasusSet.has(p.id),
    }
  })

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

// ─── Pejabat Pusat (kabinet) ──────────────────────────────────────────────────

export interface PejabatPusatCard {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  posisi: string | null
  partai: string | null
  foto_url: string | null
  has_kasus: boolean
}

export async function listPejabatPusat(): Promise<PejabatPusatCard[]> {
  const supabase = await createServerSupabase()

  const [pejabatRows, jabatanRows, kasusRows] = await Promise.all([
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap' | 'gelar_depan' | 'gelar_belakang' | 'metadata' | 'level'>>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, metadata, level',
    ).then((rows) => rows.filter((p) => p.level === 'pusat')),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'posisi' | 'partai'>>(
      supabase, 'jabatan', 'pejabat_id, posisi, partai',
    ),
    supabase.from('kasus').select('pejabat_id').then(({ data }) => data ?? []),
  ])

  const kasusSet = new Set((kasusRows as Array<{ pejabat_id: string }>).map((k) => k.pejabat_id))
  const jabByPejabat = new Map<string, Pick<JabatanRow, 'pejabat_id' | 'posisi' | 'partai'>>()
  for (const j of jabatanRows) {
    if (!jabByPejabat.has(j.pejabat_id)) jabByPejabat.set(j.pejabat_id, j)
  }

  return pejabatRows.map((p) => {
    const j = jabByPejabat.get(p.id)
    const meta = (p.metadata ?? {}) as { foto_url?: string }
    return {
      id: p.id,
      nama_lengkap: p.nama_lengkap,
      gelar_depan: p.gelar_depan,
      gelar_belakang: p.gelar_belakang,
      posisi: j?.posisi ?? null,
      partai: j?.partai ?? null,
      foto_url: meta.foto_url ?? null,
      has_kasus: kasusSet.has(p.id),
    }
  })
}

// ─── Kasus (corruption records) ──────────────────────────────────────────────

export async function getKasusByPejabat(pejabatId: string): Promise<KasusRow[]> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('kasus')
    .select('*')
    .eq('pejabat_id', pejabatId)
    .eq('verified', true)
    .order('tahun', { ascending: false })
  return (data ?? []) as KasusRow[]
}

export interface ProvinceKasusCount {
  provinsi_nama: string
  kasus_count: number
  screened_count: number  // union of pejabat in kasus table + kasus_screened table
}

export async function listProvinceKasusCounts(): Promise<ProvinceKasusCount[]> {
  const supabase = await createServerSupabase(true)  // service role — kasus_screened has no public RLS policy

  const [kasusAllRows, screenedRows, jabatanRows, wilayahRows] = await Promise.all([
    // fetchAll (not a plain .select) — both tables can exceed PostgREST's 1000-row
    // cap, which would silently drop the most-recently-screened pejabat.
    fetchAll<{ pejabat_id: string; verified: boolean | null }>(
      supabase, 'kasus', 'pejabat_id, verified',
    ),
    fetchAll<{ pejabat_id: string }>(
      supabase, 'kasus_screened', 'pejabat_id',
    ),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id'>>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id',
    ),
    fetchAll<Pick<Wilayah, 'id' | 'nama' | 'level' | 'parent_id'>>(
      supabase, 'wilayah', 'id, nama, level, parent_id',
    ),
  ])
  // Mirror the old `.neq('verified', false)` filter: PostgREST `verified <> false`
  // returns only verified=true (NULL/pending excluded), matching the public
  // verified-only policy.
  const kasusRows = kasusAllRows.filter((k) => k.verified === true)

  const wilayahById = new Map<string, Pick<Wilayah, 'id' | 'nama' | 'level' | 'parent_id'>>()
  for (const w of wilayahRows) wilayahById.set(w.id, w)

  const pejabatWithKasus = new Set(kasusRows.map((k) => k.pejabat_id))
  // Union: anyone in kasus table OR kasus_screened counts as screened
  const pejabatScreened = new Set<string>([
    ...kasusRows.map((k) => k.pejabat_id),
    ...screenedRows.map((s) => s.pejabat_id),
  ])

  function provinceNamaOf(wilayahId: string): string | null {
    const w = wilayahById.get(wilayahId)
    if (!w) return null
    if (w.level === 'provinsi') return w.nama
    if (w.parent_id) return wilayahById.get(w.parent_id)?.nama ?? null
    return null
  }

  const counted = new Set<string>()
  const countedScreened = new Set<string>()
  const counts = new Map<string, number>()
  const screenedCounts = new Map<string, number>()

  for (const j of jabatanRows) {
    const prov = provinceNamaOf(j.wilayah_id)
    if (!prov) continue

    if (pejabatWithKasus.has(j.pejabat_id)) {
      const key = `${j.pejabat_id}::${prov}`
      if (!counted.has(key)) {
        counted.add(key)
        counts.set(prov, (counts.get(prov) ?? 0) + 1)
      }
    }

    if (pejabatScreened.has(j.pejabat_id)) {
      const key = `${j.pejabat_id}::${prov}`
      if (!countedScreened.has(key)) {
        countedScreened.add(key)
        screenedCounts.set(prov, (screenedCounts.get(prov) ?? 0) + 1)
      }
    }
  }

  // Return all provinces that have any screened pejabat, plus any with kasus
  const allProvs = new Set([...counts.keys(), ...screenedCounts.keys()])
  return Array.from(allProvs).map((provinsi_nama) => ({
    provinsi_nama,
    kasus_count: counts.get(provinsi_nama) ?? 0,
    screened_count: screenedCounts.get(provinsi_nama) ?? 0,
  }))
}

export interface WilayahKasusCount {
  wilayah_nama: string
  kasus_count: number
}

export async function listWilayahKasusCounts(provinsi: string): Promise<WilayahKasusCount[]> {
  const supabase = await createServerSupabase()

  const { data: prov } = await supabase
    .from('wilayah').select('id').eq('level', 'provinsi').eq('nama', provinsi).limit(1).maybeSingle()
  if (!prov) return []

  const { data: kids } = await supabase.from('wilayah').select('id, nama').eq('parent_id', prov.id)
  const kabkotaById = new Map((kids ?? []).map((k) => [k.id as string, k.nama as string]))
  if (kabkotaById.size === 0) return []

  const { data: kasusRows } = await supabase.from('kasus').select('pejabat_id').neq('verified', false)
  const kasusSet = new Set((kasusRows ?? []).map((k) => k.pejabat_id as string))
  if (kasusSet.size === 0) return []

  const { data: jabRows } = await supabase
    .from('jabatan').select('pejabat_id, wilayah_id').in('wilayah_id', Array.from(kabkotaById.keys()))

  const counted = new Set<string>()
  const counts = new Map<string, number>()
  for (const j of jabRows ?? []) {
    if (!kasusSet.has(j.pejabat_id as string)) continue
    const nama = kabkotaById.get(j.wilayah_id as string)
    if (!nama) continue
    const key = `${j.pejabat_id}::${nama}`
    if (counted.has(key)) continue
    counted.add(key)
    counts.set(nama, (counts.get(nama) ?? 0) + 1)
  }

  return Array.from(counts.entries()).map(([wilayah_nama, kasus_count]) => ({ wilayah_nama, kasus_count }))
}

// ─── Hotspot events ──────────────────────────────────────────────────────────

export type HotspotTimeFilter = '24h' | '7d' | '30d' | '90d' | 'all'

function hotspotSince(filter: HotspotTimeFilter): string | null {
  if (filter === 'all') return null
  const ms = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 }[filter]
  return new Date(Date.now() - ms).toISOString()
}

export interface HotspotSource {
  sumber_nama: string | null
  url_sumber: string | null
  crawled_at: string
}

export interface HotspotEventWithPejabat extends HotspotEvent {
  pejabat_nama: string | null
  provinsi_nama: string | null
  sources: HotspotSource[]
  source_count: number
}

export async function listHotspotEvents(
  filter: HotspotTimeFilter = '24h',
): Promise<HotspotEventWithPejabat[]> {
  const supabase = await createServerSupabase()
  const since = hotspotSince(filter)

  let q = supabase
    .from('hotspot_events')
    .select('*')
    .order('crawled_at', { ascending: false })
    .limit(500)

  if (since) q = q.gte('crawled_at', since)

  const { data: events } = await q
  const rows = (events ?? []) as HotspotEvent[]

  if (rows.length === 0) return []

  const pejabatIds = [...new Set(rows.map((r) => r.pejabat_id).filter(Boolean))] as string[]
  const wilayahIds = [...new Set(rows.map((r) => r.wilayah_id).filter(Boolean))] as string[]

  const [pejabatRows, wilayahRows] = await Promise.all([
    pejabatIds.length
      ? supabase.from('pejabat').select('id, nama_lengkap').in('id', pejabatIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    wilayahIds.length
      ? supabase.from('wilayah').select('id, nama').in('id', wilayahIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ])

  const pejabatMap = new Map((pejabatRows as Array<{ id: string; nama_lengkap: string }>).map((p) => [p.id, p.nama_lengkap]))
  const wilayahMap = new Map((wilayahRows as Array<{ id: string; nama: string }>).map((w) => [w.id, w.nama]))

  // Group rows by story (story_id falls back to event_id for safety).
  const storyMap = new Map<string, HotspotEvent[]>()
  for (const r of rows) {
    const key = r.story_id ?? r.event_id
    const arr = storyMap.get(key) ?? []
    arr.push(r)
    storyMap.set(key, arr)
  }

  const stories = Array.from(storyMap.values()).map((group) => {
    const rep = group.find((g) => g.story_id === g.event_id) ?? group[0]
    const sources: HotspotSource[] = group
      .map((g) => ({ sumber_nama: g.sumber_nama, url_sumber: g.url_sumber, crawled_at: g.crawled_at }))
      .sort((a, b) => b.crawled_at.localeCompare(a.crawled_at))
    return {
      ...rep,
      pejabat_nama: rep.pejabat_id ? (pejabatMap.get(rep.pejabat_id) ?? null) : null,
      provinsi_nama: rep.wilayah_id ? (wilayahMap.get(rep.wilayah_id) ?? null) : null,
      sources,
      source_count: sources.length,
    }
  })

  // Newest story first, by its most-recent source.
  stories.sort((a, b) => (b.sources[0]?.crawled_at ?? '').localeCompare(a.sources[0]?.crawled_at ?? ''))
  return stories
}

export interface ProvinceHotspotCount {
  wilayah_id: string
  provinsi_nama: string
  count: number
  kategori_counts: Record<string, number>
}

export async function listProvinceHotspotCounts(
  filter: HotspotTimeFilter = '24h',
): Promise<ProvinceHotspotCount[]> {
  const events = await listHotspotEvents(filter)
  const byWilayah = new Map<string, { nama: string; count: number; kategori: Record<string, number> }>()

  // events are already collapsed to one-per-story by listHotspotEvents,
  // so counting them here counts distinct events (not source articles).
  for (const e of events) {
    if (!e.wilayah_id || !e.provinsi_nama) continue
    const cur = byWilayah.get(e.wilayah_id) ?? { nama: e.provinsi_nama, count: 0, kategori: {} }
    cur.count++
    cur.kategori[e.kategori ?? 'lainnya'] = (cur.kategori[e.kategori ?? 'lainnya'] ?? 0) + 1
    byWilayah.set(e.wilayah_id, cur)
  }

  return Array.from(byWilayah.entries()).map(([wilayah_id, v]) => ({
    wilayah_id,
    provinsi_nama: v.nama,
    count: v.count,
    kategori_counts: v.kategori,
  }))
}
