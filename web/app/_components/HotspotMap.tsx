'use client'

import IndonesiaMap from './IndonesiaMap'
import type { ProvinceHotspotCount, ProvinceCount } from '@/lib/queries'

interface Props {
  provinceCounts: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
  onProvinceClick: (provinsi: string) => void
  selected: string | null
}

export default function HotspotMap({ provinceCounts, allProvinces, onProvinceClick, selected }: Props) {
  const countMap = new Map(provinceCounts.map((p) => [p.provinsi_nama, p]))
  const maxCount = Math.max(1, ...provinceCounts.map((p) => p.count))

  const colorBy = (name: string): number | null => {
    const c = countMap.get(name)?.count ?? 0
    if (c === 0) return null
    return Math.sqrt(c / maxCount)
  }

  const tooltip = (name: string): string => {
    const pc = countMap.get(name)
    if (!pc) return '0 kejadian'
    const topKat = Object.entries(pc.kategori_counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    return `${pc.count} kejadian${topKat ? ` · ${topKat}` : ''} · klik untuk filter`
  }

  return (
    <div
      onClickCapture={(e) => {
        const target = e.target as Element
        const ariaLabel = target.getAttribute('aria-label')
        if (ariaLabel) {
          const match = /^(.+?):\s/.exec(ariaLabel)
          if (match) {
            e.preventDefault()
            e.stopPropagation()
            onProvinceClick(match[1])
          }
        }
      }}
    >
      <IndonesiaMap
        provinces={allProvinces}
        selected={selected}
        height={520}
        colorBy={colorBy}
        tooltip={tooltip}
      />
    </div>
  )
}
