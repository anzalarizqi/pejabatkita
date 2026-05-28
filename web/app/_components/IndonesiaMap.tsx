'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { geoIdentity, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { ProvinceCount } from '@/lib/queries'

export interface HotspotDot {
  provinceName: string
  color: string
  /** size factor 0..1, multiplied by base radius */
  size: number
  count: number
  pulse: boolean
  topKategori: string
}

interface Props {
  provinces: ProvinceCount[]
  selected?: string | null
  height?: number
  colorBy?: (name: string) => number | null
  tooltip?: (name: string, count: number) => string | null
  dots?: HotspotDot[]
  /** When provided, called instead of default router push */
  onProvinceClick?: (name: string) => void
  /** Override default fill behavior: when true, all paths render as neutral cream */
  neutralFill?: boolean
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

export default function IndonesiaMap({
  provinces,
  selected = null,
  height = 460,
  colorBy,
  tooltip,
  dots,
  onProvinceClick,
  neutralFill = false,
}: Props) {
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

  const { paths, centroids } = useMemo(() => {
    if (!data || size.w < 200 || size.h < 100) return { paths: [], centroids: new Map() }
    const projection = geoIdentity().reflectY(true).fitSize([size.w, size.h], data as never)
    const path = geoPath(projection)
    const paths = data.features.map((f, i) => {
      const dStr = path(f as never) ?? ''
      return {
        key: (f.properties.slug ?? `f${i}`) as string,
        name: f.properties.name ?? '',
        d: /NaN/.test(dStr) ? '' : dStr,
      }
    })
    const centroids = new Map<string, [number, number]>()
    for (const f of data.features) {
      const c = path.centroid(f as never)
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        centroids.set(f.properties.name ?? '', [c[0], c[1]])
      }
    }
    return { paths, centroids }
  }, [data, size.w, size.h])

  const dotByProvince = useMemo(() => {
    const m = new Map<string, HotspotDot>()
    for (const d of dots ?? []) m.set(d.provinceName, d)
    return m
  }, [dots])

  function colorFor(name: string): string {
    if (neutralFill) return '#ece7dc'
    if (colorBy) {
      const v = colorBy(name)
      if (v === null) return '#ece7dc'
      const t = Math.max(0, Math.min(1, v))
      const r = lerp(245, 192, t)
      const g = lerp(241, 57, t)
      const b = lerp(234, 43, t)
      return `rgb(${r|0}, ${g|0}, ${b|0})`
    }
    const c = countByName.get(name) ?? 0
    if (c === 0) return '#ece7dc'
    const t = Math.sqrt(c / maxCount)
    const r = lerp(245, 192, t)
    const g = lerp(241, 57, t)
    const b = lerp(234, 43, t)
    return `rgb(${r|0}, ${g|0}, ${b|0})`
  }

  function handleClick(name: string) {
    if (onProvinceClick) {
      onProvinceClick(name)
      return
    }
    if (selected && selected === name) {
      router.push('/pejabat')
    } else {
      router.push(`/pejabat?provinsi=${encodeURIComponent(name)}`)
    }
  }

  function onProvinceHover(name: string, evt: React.MouseEvent<SVGElement>) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({
      name,
      count: countByName.get(name) ?? 0,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    })
  }

  // Compose dot list with computed centroid
  const renderableDots = useMemo(() => {
    const out: Array<HotspotDot & { cx: number; cy: number }> = []
    for (const d of dots ?? []) {
      const c = centroids.get(d.provinceName)
      if (!c) continue
      out.push({ ...d, cx: c[0], cy: c[1] })
    }
    return out
  }, [dots, centroids])

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
                  onClick={() => handleClick(p.name)}
                  aria-label={`${p.name}: ${countByName.get(p.name) ?? 0} pejabat`}
                />
              )
            })}
          </g>

          {/* Dot overlay — drawn after paths so they sit on top */}
          {renderableDots.length > 0 && (
            <g className="dot-layer">
              {renderableDots.map((d) => {
                const baseR = 1.6
                const r = baseR + d.size * 2.0  // 1.6..3.6 (70% smaller)
                return (
                  <g
                    key={d.provinceName}
                    transform={`translate(${d.cx}, ${d.cy})`}
                    className={`hotspot-dot ${d.pulse ? 'pulsing' : 'static-dot'}`}
                    onMouseMove={(e) => onProvinceHover(d.provinceName, e)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => handleClick(d.provinceName)}
                  >
                    {d.pulse && (
                      <>
                        <circle r={r} fill={d.color} className="dot-halo dot-halo-1" opacity="0" />
                        <circle r={r} fill={d.color} className="dot-halo dot-halo-2" opacity="0" />
                      </>
                    )}
                    <circle
                      r={r}
                      fill={d.color}
                      stroke="#fbf7ee"
                      strokeWidth={0.7}
                      className="dot-core"
                    />
                  </g>
                )
              })}
            </g>
          )}
        </svg>
      )}

      {hover && (
        <div
          className="map-tip"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="tip-name">{hover.name}</div>
          <div className="tip-count">
            {tooltip ? tooltip(hover.name, hover.count) : `${hover.count.toLocaleString('id-ID')} pejabat`}
          </div>
        </div>
      )}

      {dots === undefined && (
        <div className="map-legend">
          <span className="legend-label">Jumlah pejabat</span>
          <span className="legend-tick">0</span>
          <span className="legend-bar" />
          <span className="legend-tick">{maxCount}</span>
        </div>
      )}

      {dots !== undefined && dots.length > 0 && (
        <div className="dot-legend">
          <span className="legend-label">Kategori</span>
          <span className="dot-key" style={{ background: '#c0392b' }} /> Korupsi
          <span className="dot-key" style={{ background: '#e67e22' }} /> Demonstrasi
          <span className="dot-key" style={{ background: '#f39c12' }} /> Pernyataan
          <span className="dot-key" style={{ background: '#8e44ad' }} /> Kebijakan
          <span className="dot-key" style={{ background: '#2980b9' }} /> Kritik
          <span className="dot-key dot-key-pulse" /> Pulse = 24 jam
        </div>
      )}
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
  .map-wrap svg { display: block; width: 100%; height: auto; overflow: visible; }
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

  /* ─── Hotspot dot overlay ─────────────────────────────────────────────── */
  .dot-layer { pointer-events: auto; }
  .hotspot-dot { cursor: pointer; }
  .hotspot-dot:hover .dot-core { stroke-width: 2; r: attr(r); }
  .dot-core { transition: stroke-width 0.15s; filter: drop-shadow(0 1px 1.5px rgba(15,17,23,0.35)); }

  /* Halo rings ripple outward symmetrically — animate r so origin is dot center */
  .dot-halo-1 { animation: pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  .dot-halo-2 { animation: pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite; animation-delay: 1.2s; }

  @keyframes pulse-ring {
    0%   { r: 0;   opacity: 0.85; }
    70%  { r: 14;  opacity: 0.04; }
    100% { r: 14;  opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot-halo-1, .dot-halo-2 { animation: none; opacity: 0; }
  }

  .dot-legend {
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    color: #6b6859;
    letter-spacing: 0.04em;
  }
  .dot-legend .legend-label {
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.14em;
    color: #8a857c;
    margin-right: 4px;
  }
  .dot-key {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: -1px;
  }
  .dot-key-pulse {
    background: #0f1117;
    box-shadow: 0 0 0 3px rgba(15, 17, 23, 0.15);
    animation: pulse-key 1.6s ease-out infinite;
  }
  @keyframes pulse-key {
    0% { box-shadow: 0 0 0 0 rgba(15,17,23,0.4); }
    100% { box-shadow: 0 0 0 8px rgba(15,17,23,0); }
  }
`
