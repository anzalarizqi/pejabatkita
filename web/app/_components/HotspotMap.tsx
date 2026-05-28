'use client'

import IndonesiaMap, { type HotspotDot } from './IndonesiaMap'
import type { ProvinceHotspotCount, ProvinceCount } from '@/lib/queries'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

interface Props {
  /** All events within current filter window (e.g., 7d) */
  provinceCounts: ProvinceHotspotCount[]
  /** 24h subset — used to decide which dots pulse */
  provinceCounts24h: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
  onProvinceClick: (provinsi: string) => void
  selected: string | null
}

export default function HotspotMap({
  provinceCounts,
  provinceCounts24h,
  allProvinces,
  onProvinceClick,
  selected,
}: Props) {
  const allCounts = provinceCounts.flatMap((p) => Object.values(p.kategori_counts))
  const max = Math.max(1, ...allCounts)
  const by24h = new Map(provinceCounts24h.map((p) => [p.provinsi_nama, p.kategori_counts]))

  const dots: HotspotDot[] = []
  for (const p of provinceCounts) {
    const kats = Object.entries(p.kategori_counts)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
    kats.forEach(([kat, count], i) => {
      const kat24h = by24h.get(p.provinsi_nama)?.[kat] ?? 0
      dots.push({
        provinceName: p.provinsi_nama,
        id: `${p.provinsi_nama}::${kat}`,
        color: KATEGORI_COLOR[kat] ?? KATEGORI_COLOR.lainnya,
        size: Math.sqrt(count / max),
        count,
        pulse: kat24h > 0,
        topKategori: kat,
        groupIndex: i,
        groupTotal: kats.length,
      })
    })
  }

  const tooltip = (name: string): string => {
    const pc = provinceCounts.find((p) => p.provinsi_nama === name)
    if (!pc) return 'Tidak ada kejadian'
    const top = Object.entries(pc.kategori_counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    return `${pc.count} kejadian${top ? ` · ${top}` : ''}`
  }

  return (
    <IndonesiaMap
      provinces={allProvinces}
      selected={selected}
      height={520}
      tooltip={tooltip}
      dots={dots}
      neutralFill
      onProvinceClick={onProvinceClick}
    />
  )
}
