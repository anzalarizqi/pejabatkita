import { normalizePartai } from './partai'

export interface KasusForPartai {
  pejabat_id: string
  partai: string | null
  tanggal_kasus: string | null
}

export interface KoruptorInfo {
  pejabat_id: string
  nama: string
  posisi: string | null
  status: 'tersangka' | 'terdakwa' | 'terpidana'
}

export interface JabatanForPartai {
  pejabat_id: string
  partai: string | null
  status: string | null // 'aktif' | 'nonaktif'
}

export interface PartaiKoruptorRow {
  partai: string
  koruptorCount: number
  koruptorList: KoruptorInfo[]
  terdataCount: number
}

export interface PartaiKoruptorResult {
  rows: PartaiKoruptorRow[]
  belumDikaitkanCount: number
}

// Normalize a raw partai cell to its canonical name, or '' if empty/unparseable-as-empty.
function canon(raw: string | null): string {
  const [value] = normalizePartai(raw)
  return value // '' when raw is null/empty; otherwise canonical or trimmed original
}

/**
 * Aggregate verified corruption cases into per-party koruptor counts.
 * `jabatan` may contain all rows; only `status === 'aktif'` rows count toward
 * `terdataCount`. Cases whose pejabat_id has no entry in `koruptorInfo` are
 * dropped (kasus.pejabat_id is FK ON DELETE CASCADE, so this is defensive and
 * cannot happen with real data — mirrors listKeranjangKoruptor).
 */
export function aggregatePartaiKoruptor(
  cases: KasusForPartai[],
  koruptorInfo: KoruptorInfo[],
  jabatan: JabatanForPartai[],
): PartaiKoruptorResult {
  const infoById = new Map(koruptorInfo.map(k => [k.pejabat_id, k]))

  // 1. Group cases by pejabat, pick the attributed party = most-recent case that has a party.
  const casesByPejabat = new Map<string, KasusForPartai[]>()
  for (const c of cases) {
    const arr = casesByPejabat.get(c.pejabat_id) ?? []
    arr.push(c)
    casesByPejabat.set(c.pejabat_id, arr)
  }

  const partyToKoruptor = new Map<string, KoruptorInfo[]>()
  let belumDikaitkanCount = 0

  for (const [pejabatId, pejabatCases] of casesByPejabat) {
    const info = infoById.get(pejabatId)
    if (!info) continue // FK-guaranteed unreachable in prod; drop defensively (see listKeranjangKoruptor)

    // most recent first; null tanggal sorts last
    const sorted = [...pejabatCases].sort((a, b) =>
      (b.tanggal_kasus ?? '').localeCompare(a.tanggal_kasus ?? ''))
    const attributed = sorted.map(c => canon(c.partai)).find(v => v !== '') ?? ''

    if (!attributed) {
      belumDikaitkanCount++
      continue
    }
    const list = partyToKoruptor.get(attributed) ?? []
    list.push(info)
    partyToKoruptor.set(attributed, list)
  }

  // 2. Denominator: distinct active-jabatan pejabat per canonical party.
  const partyToTerdata = new Map<string, Set<string>>()
  for (const j of jabatan) {
    if (j.status !== 'aktif') continue
    const p = canon(j.partai)
    if (!p) continue
    const set = partyToTerdata.get(p) ?? new Set<string>()
    set.add(j.pejabat_id)
    partyToTerdata.set(p, set)
  }

  // 3. Build rows for parties that have ≥1 koruptor; sort by count desc, then name asc.
  const rows: PartaiKoruptorRow[] = [...partyToKoruptor.entries()]
    .map(([partai, koruptorList]) => ({
      partai,
      koruptorCount: koruptorList.length,
      koruptorList,
      terdataCount: partyToTerdata.get(partai)?.size ?? 0,
    }))
    .sort((a, b) => b.koruptorCount - a.koruptorCount || a.partai.localeCompare(b.partai, 'id'))

  return { rows, belumDikaitkanCount }
}
