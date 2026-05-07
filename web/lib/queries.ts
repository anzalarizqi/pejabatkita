import { createServerSupabase } from './supabase'
import type { Wilayah, JabatanRow, PejabatRow } from './types'

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

  return provinces
    .map((p) => ({ nama: p.nama, kode_bps: p.kode_bps, count: counts.get(p.nama) ?? 0 }))
    .sort((a, b) => a.nama.localeCompare(b.nama))
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
}

export interface ListPejabatOptions {
  provinsi?: string
  search?: string
  page?: number
  pageSize?: number
  includePlaceholders?: boolean
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
      .select('id')
      .eq('parent_id', prov.id)
    wilayahFilterIds = [prov.id, ...((kids ?? []).map((k) => k.id))]

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
