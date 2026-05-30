'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { geoIdentity, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { WilayahCount } from '@/lib/queries'
import { useMapZoom } from './useMapZoom'
import MapZoomControls from './MapZoomControls'

interface Props {
  provinsi: string
  provinsiSlug: string
  wilayahCounts: WilayahCount[]
  kasusMap?: Map<string, number>
  selected?: string | null
  height?: number
  /** When true, enables d3 zoom/pan + control overlay. Default false. */
  zoomable?: boolean
  /** When true, wheel-zoom requires Ctrl/⌘ so plain scroll passes through (scrolling pages). */
  wheelModifier?: boolean
}

interface Feature {
  type: 'Feature'
  properties: { name?: string; raw?: string }
  geometry: GeoPermissibleObjects
}

interface FC {
  type: 'FeatureCollection'
  features: Feature[]
}

export default function KabKotaMap({
  provinsi,
  provinsiSlug,
  wilayahCounts,
  kasusMap,
  selected = null,
  height = 420,
  zoomable = false,
  wheelModifier = false,
}: Props) {
  const router = useRouter()
  const [data, setData] = useState<FC | null | 'missing'>(null)
  const [size, setSize] = useState({ w: 1000, h: height })
  const [hover, setHover] = useState<{ name: string; count: number; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)

  useEffect(() => {
    setData(null)
    fetch(`/kabkota/${provinsiSlug}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((d: FC) => setData(d))
      .catch(() => setData('missing'))
  }, [provinsiSlug])

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
    for (const w of wilayahCounts) m.set(w.nama, w.count)
    return m
  }, [wilayahCounts])

  const maxCount = useMemo(
    () => Math.max(1, ...wilayahCounts.map((w) => w.count)),
    [wilayahCounts],
  )

  const { paths } = useMemo(() => {
    if (!data || data === 'missing' || size.w < 200 || size.h < 100) return { paths: [] }
    const projection = geoIdentity().reflectY(true).fitSize([size.w, size.h], data as never)
    const path = geoPath(projection)
    const out = data.features.map((f, i) => {
      const dStr = path(f as never) ?? ''
      return {
        key: (f.properties.name ?? `f${i}`) as string,
        name: f.properties.name ?? '',
        d: /NaN/.test(dStr) ? '' : dStr,
      }
    })
    return { paths: out }
  }, [data, size.w, size.h])

  const maxKasusRatio = useMemo(() => {
    if (!kasusMap || kasusMap.size === 0) return 1
    let max = 0.001
    for (const [name, kasus] of kasusMap) {
      const total = Math.max(1, countByName.get(name) ?? 1)
      max = Math.max(max, kasus / total)
    }
    return max
  }, [kasusMap, countByName])

  function colorFor(name: string): string {
    if (kasusMap) {
      const kasus = kasusMap.get(name) ?? 0
      if (kasus === 0) return '#ece7dc'
      const total = Math.max(1, countByName.get(name) ?? 1)
      const t = Math.sqrt((kasus / total) / maxKasusRatio)
      const r = lerp(245, 192, t)
      const g = lerp(241, 57, t)
      const b = lerp(234, 43, t)
      return `rgb(${r | 0}, ${g | 0}, ${b | 0})`
    }
    const c = countByName.get(name) ?? 0
    if (c === 0) return '#ece7dc'
    const t = Math.sqrt(c / maxCount)
    const r = lerp(245, 192, t)
    const g = lerp(241, 57, t)
    const b = lerp(234, 43, t)
    return `rgb(${r | 0}, ${g | 0}, ${b | 0})`
  }

  function onWilayahClick(name: string) {
    const params = new URLSearchParams()
    params.set('provinsi', provinsi)
    if (!(selected && selected === name)) {
      params.set('wilayah', name)
    }
    router.push(`/pejabat?${params.toString()}`)
  }

  function onWilayahHover(name: string, evt: React.MouseEvent<SVGPathElement>) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({
      name,
      count: countByName.get(name) ?? 0,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    })
  }

  const { zoomIn, zoomOut, recenter } = useMapZoom({
    svgRef,
    gRef,
    width: size.w,
    height: size.h,
    enabled: zoomable && data !== null && data !== 'missing',
    wheelModifier,
  })

  return (
    <div className="kk-wrap" ref={containerRef}>
      <style>{styles}</style>

      {data === null ? (
        <div className="kk-loading">Memuat peta {provinsi}…</div>
      ) : data === 'missing' ? (
        <div className="kk-loading">Peta kab/kota untuk {provinsi} belum tersedia.</div>
      ) : (
        <>
        <svg ref={svgRef} width={size.w} height={size.h} role="img" aria-label={`Peta ${provinsi}`}>
          <g ref={zoomable ? gRef : undefined}>
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
                  className={`kk ${isSelected ? 'kk-selected' : ''}`}
                  onMouseMove={(e) => onWilayahHover(p.name, e)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onWilayahClick(p.name)}
                  aria-label={`${p.name}: ${countByName.get(p.name) ?? 0} pejabat`}
                />
              )
            })}
          </g>
          </g>
        </svg>
        {zoomable && (
          <MapZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onRecenter={recenter} />
        )}
        {zoomable && wheelModifier && (
          <div className="kk-zoom-hint" aria-hidden>⌘ / Ctrl + scroll untuk zoom</div>
        )}
        </>
      )}

      {hover && (
        <div className="kk-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="tip-name">{hover.name}</div>
          {kasusMap ? (
            (() => {
              const k = kasusMap.get(hover.name) ?? 0
              const total = hover.count
              const pct = total > 0 ? Math.round((k / total) * 100) : 0
              return k > 0
                ? <div className="tip-count">{k} / {total} pejabat · {pct}% kasus</div>
                : <div className="tip-count">Tidak ada catatan korupsi</div>
            })()
          ) : (
            <div className="tip-count">{hover.count.toLocaleString('id-ID')} pejabat</div>
          )}
        </div>
      )}

      <div className="kk-legend">
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
  .kk-wrap { position: relative; width: 100%; user-select: none; }
  .kk-wrap svg { display: block; width: 100%; height: auto; }
  .kk {
    cursor: pointer;
    transition: fill 0.15s, stroke-width 0.15s;
    vector-effect: non-scaling-stroke;
  }
  .kk:hover { stroke: #0f1117; stroke-width: 1.2; }
  .kk-selected { filter: drop-shadow(0 0 6px rgba(192,57,43,0.4)); }

  .kk-zoom-hint {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 11;
    pointer-events: none;
    background: rgba(245,241,234,0.85);
    border: 1px solid #d4cfc5;
    border-left: 2px solid #c0392b;
    padding: 4px 8px;
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b6859;
  }

  .kk-loading {
    text-align: center;
    padding: 60px 0;
    color: #8a857c;
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .kk-tip {
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

  .kk-legend {
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
