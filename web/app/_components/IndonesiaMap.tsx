'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { geoIdentity, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { ProvinceCount } from '@/lib/queries'

interface Props {
  provinces: ProvinceCount[]
  selected?: string | null
  height?: number
}

interface FeatureProps {
  name?: string
  slug?: string
}

interface Feature {
  type: 'Feature'
  properties: FeatureProps
  geometry: GeoPermissibleObjects
}

interface FC {
  type: 'FeatureCollection'
  features: Feature[]
}

export default function IndonesiaMap({ provinces, selected = null, height = 460 }: Props) {
  const router = useRouter()
  const [data, setData] = useState<FC | null>(null)
  const [size, setSize] = useState({ w: 1000, h: height })
  const [hover, setHover] = useState<{ name: string; count: number; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fetch('/indonesia-provinces.json')
      .then((r) => r.json())
      .then((d: FC) => setData(d))
      .catch(() => setData(null))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        if (w >= 200) setSize({ w, h: height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  const countByName = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of provinces) m.set(p.nama, p.count)
    return m
  }, [provinces])

  const maxCount = useMemo(
    () => Math.max(1, ...provinces.map((p) => p.count)),
    [provinces],
  )

  const { paths } = useMemo(() => {
    if (!data || size.w < 200 || size.h < 100) return { paths: [] }
    const projection = geoIdentity().reflectY(true).fitSize([size.w, size.h], data as never)
    const path = geoPath(projection)
    const paths = data.features.map((f, i) => {
      const dStr = path(f as never) ?? ''
      // Defensive: drop any feature whose path string contains NaN
      return {
        key: (f.properties.slug ?? `f${i}`) as string,
        name: f.properties.name ?? '',
        d: /NaN/.test(dStr) ? '' : dStr,
      }
    })
    return { paths }
  }, [data, size.w, size.h])

  function colorFor(name: string): string {
    const c = countByName.get(name) ?? 0
    if (c === 0) return '#ece7dc'
    const t = Math.sqrt(c / maxCount)
    // Interpolate from paper to accent
    const r = lerp(245, 192, t)
    const g = lerp(241, 57, t)
    const b = lerp(234, 43, t)
    return `rgb(${r|0}, ${g|0}, ${b|0})`
  }

  function onProvinceClick(name: string) {
    if (selected && selected === name) {
      router.push('/pejabat')
    } else {
      router.push(`/pejabat?provinsi=${encodeURIComponent(name)}`)
    }
  }

  function onProvinceHover(name: string, evt: React.MouseEvent<SVGPathElement>) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({
      name,
      count: countByName.get(name) ?? 0,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    })
  }

  return (
    <div className="map-wrap" ref={containerRef}>
      <style>{styles}</style>

      {data === null ? (
        <div className="map-loading">Memuat peta…</div>
      ) : (
        <svg width={size.w} height={size.h} role="img" aria-label="Peta Indonesia">
          <g>
            {paths.map((p) => {
              const isSelected = selected === p.name
              return (
                <path
                  key={p.key}
                  d={p.d}
                  fill={colorFor(p.name)}
                  stroke={isSelected ? '#0f1117' : '#d4cfc5'}
                  strokeWidth={isSelected ? 1.6 : 0.5}
                  className={`prov ${isSelected ? 'prov-selected' : ''}`}
                  onMouseMove={(e) => onProvinceHover(p.name, e)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onProvinceClick(p.name)}
                  aria-label={`${p.name}: ${countByName.get(p.name) ?? 0} pejabat`}
                />
              )
            })}
          </g>
        </svg>
      )}

      {hover && (
        <div
          className="map-tip"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="tip-name">{hover.name}</div>
          <div className="tip-count">
            {hover.count.toLocaleString('id-ID')} pejabat
          </div>
        </div>
      )}

      <div className="map-legend">
        <span className="legend-label">Jumlah pejabat</span>
        <span className="legend-tick">0</span>
        <span className="legend-bar" />
        <span className="legend-tick">{maxCount}</span>
      </div>
    </div>
  )
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

const styles = `
  .map-wrap {
    position: relative;
    width: 100%;
    user-select: none;
  }
  .map-wrap svg { display: block; width: 100%; height: auto; }
  .prov {
    cursor: pointer;
    transition: fill 0.15s, stroke-width 0.15s;
    vector-effect: non-scaling-stroke;
  }
  .prov:hover {
    stroke: #0f1117;
    stroke-width: 1.2;
  }
  .prov-selected { filter: drop-shadow(0 0 6px rgba(192,57,43,0.4)); }

  .map-loading {
    text-align: center;
    padding: 80px 0;
    color: #8a857c;
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .map-tip {
    position: absolute;
    pointer-events: none;
    background: #0f1117;
    color: #f5f1ea;
    padding: 8px 12px;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    z-index: 10;
    border-left: 2px solid #c0392b;
    white-space: nowrap;
  }
  .tip-name {
    font-family: 'Fraunces', serif;
    font-size: 13px;
    margin-bottom: 2px;
    font-weight: 300;
  }
  .tip-count { opacity: 0.8; letter-spacing: 0.04em; }

  .map-legend {
    margin-top: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: flex-end;
    font-size: 9px;
    color: #8a857c;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .legend-bar {
    display: inline-block;
    width: 140px;
    height: 6px;
    background: linear-gradient(to right, #ece7dc, #c0392b);
  }
  .legend-tick {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    color: #0f1117;
  }
`
