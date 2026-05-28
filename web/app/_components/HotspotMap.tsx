'use client'

import IndonesiaMap, { type HotspotDot } from './IndonesiaMap'
import type { HotspotEventWithPejabat, ProvinceHotspotCount, ProvinceCount } from '@/lib/queries'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

interface Props {
  /** All events within current filter window — one dot per event */
  events: HotspotEventWithPejabat[]
  /** 24h subset — used to decide which dots pulse */
  events24h: HotspotEventWithPejabat[]
  /** Aggregated counts for tooltip hover */
  provinceCounts: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
  onProvinceClick: (provinsi: string) => void
  selected: string | null
}

export default function HotspotMap({
  events,
  events24h,
  provinceCounts,
  allProvinces,
  onProvinceClick,
  selected,
}: Props) {
  const ids24h = new Set(events24h.map((e) => e.event_id))

  const byProvince = new Map<string, HotspotEventWithPejabat[]>()
  for (const e of events) {
    if (!e.provinsi_nama) continue
    const list = byProvince.get(e.provinsi_nama) ?? []
    list.push(e)
    byProvince.set(e.provinsi_nama, list)
  }

  const dots: HotspotDot[] = []
  for (const [province, evs] of byProvince) {
    evs.forEach((e, i) => {
      dots.push({
        provinceName: province,
        id: e.event_id,
        color: KATEGORI_COLOR[e.kategori ?? 'lainnya'] ?? KATEGORI_COLOR.lainnya,
        size: 0.4,
        count: 1,
        pulse: ids24h.has(e.event_id),
        topKategori: e.kategori ?? 'lainnya',
        groupIndex: i,
        groupTotal: evs.length,
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
