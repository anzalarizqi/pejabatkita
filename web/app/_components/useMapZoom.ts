import { useCallback, useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import 'd3-transition' // side-effect: adds .transition() to selections

interface UseMapZoomOptions {
  svgRef: React.RefObject<SVGSVGElement | null>
  gRef: React.RefObject<SVGGElement | null>
  width: number
  height: number
  enabled: boolean
}

/**
 * Attaches a d3-zoom behavior to `svgRef` and writes the transform imperatively
 * onto `gRef` (no React state -> no per-frame re-render of map paths).
 * Returns button handlers. When `enabled` is false it does nothing and clears
 * any transform, so the host renders identically to its non-zoom state.
 */
export function useMapZoom({ svgRef, gRef, width, height, enabled }: UseMapZoomOptions) {
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const reduceMotion = useRef(false)

  useEffect(() => {
    reduceMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    if (!enabled || !svgRef.current || width < 200 || height < 100) return
    const svgEl = svgRef.current
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .translateExtent([[0, 0], [width, height]])
      .on('zoom', (e) => {
        gRef.current?.setAttribute('transform', e.transform.toString())
      })
    zoomRef.current = behavior

    const sel = select(svgEl)
    sel.call(behavior)
    sel.style('cursor', 'grab')
    sel.on('mousedown.cursor', () => sel.style('cursor', 'grabbing'))
    sel.on('mouseup.cursor', () => sel.style('cursor', 'grab'))

    return () => {
      sel.on('.zoom', null)
      sel.on('mousedown.cursor', null)
      sel.on('mouseup.cursor', null)
      sel.style('cursor', null)
      gRef.current?.removeAttribute('transform')
      zoomRef.current = null
    }
  }, [enabled, svgRef, gRef, width, height])

  const duration = () => (reduceMotion.current ? 0 : 200)

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(duration()).call(zoomRef.current.scaleBy, 1.5)
  }, [svgRef])

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(duration()).call(zoomRef.current.scaleBy, 1 / 1.5)
  }, [svgRef])

  const recenter = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(duration()).call(zoomRef.current.transform, zoomIdentity)
  }, [svgRef])

  return { zoomIn, zoomOut, recenter }
}
