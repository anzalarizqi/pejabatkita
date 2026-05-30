# Map Zoom / Pan / Recenter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scroll/pinch zoom, drag-to-pan, +/− buttons, and recenter to both `IndonesiaMap` and `KabKotaMap`, exercised on a gated `/admin/map-lab` page, without changing the live homepage or `/pejabat`.

**Architecture:** A reusable `useMapZoom` hook wraps `d3-zoom` and writes the transform imperatively onto a `<g>` (no per-frame React re-render). A presentational `MapZoomControls` overlay provides the buttons. Both maps gain a `zoomable` prop defaulting to `false`, so live pages are unchanged until the prop is flipped. A throwaway `/admin/map-lab` page renders both maps with `zoomable` using real data.

**Tech Stack:** Next.js 16 / React 19, `d3-zoom` + `d3-selection` + `d3-transition` (added; same family as existing `d3-geo`), TypeScript (no `any`).

**Note on verification:** The web app has no unit-test framework (verified: `web/package.json` has only `dev`/`build`/`start`/`lint`). Per project convention, verification is **typecheck/build + MCP Playwright interaction testing** against the lab page — not unit tests. Adding a test runner solely for this feature would violate YAGNI and project conventions.

---

## File Structure

| File | New? | Responsibility |
|---|---|---|
| `web/package.json` | modify | Add `d3-zoom`, `d3-selection`, `d3-transition` + `@types/*`. |
| `web/app/_components/useMapZoom.ts` | create | Hook: configure `d3-zoom`, write transform to `<g>`, expose `zoomIn`/`zoomOut`/`recenter`. |
| `web/app/_components/MapZoomControls.tsx` | create | Presentational +/−/recenter overlay, editorial styling. |
| `web/app/_components/IndonesiaMap.tsx` | modify | Add `zoomable` prop, outer transform `<g>` around paths + dots, controls. |
| `web/app/_components/KabKotaMap.tsx` | modify | Add `zoomable` prop, outer transform `<g>` around paths, controls. |
| `web/app/admin/map-lab/page.tsx` | create | Server page: render both maps with `zoomable` using real data. |
| `web/app/admin/map-lab/ProvSelect.tsx` | create | Client `<select>` that navigates `?prov=` to switch the kab/kota map. |

---

## Task 1: Add d3-zoom dependencies

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: Install runtime + type deps**

Run (from `web/`):
```bash
npm install d3-zoom d3-selection d3-transition
npm install -D @types/d3-zoom @types/d3-selection @types/d3-transition
```

- [ ] **Step 2: Verify they resolve**

Run (from `web/`):
```bash
node -e "require.resolve('d3-zoom'); require.resolve('d3-selection'); require.resolve('d3-transition'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/package-lock.json
git commit -m "build: add d3-zoom/d3-selection/d3-transition for map zoom"
```

---

## Task 2: Create the `useMapZoom` hook

**Files:**
- Create: `web/app/_components/useMapZoom.ts`

- [ ] **Step 1: Write the hook**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run (from `web/`):
```bash
npx tsc --noEmit
```
Expected: no errors referencing `useMapZoom.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/app/_components/useMapZoom.ts
git commit -m "feat: useMapZoom hook (d3-zoom wrapper, imperative transform)"
```

---

## Task 3: Create the `MapZoomControls` overlay

**Files:**
- Create: `web/app/_components/MapZoomControls.tsx`

- [ ] **Step 1: Write the component**

Editorial styling: matches the maps — cream `#f5f1ea` face, ink `#0f1117` glyphs, DM Mono, hairline border, `#c0392b` left-border accent on hover (echoes the tooltip's `border-left: 2px solid #c0392b`).

```tsx
'use client'

interface Props {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
}

export default function MapZoomControls({ onZoomIn, onZoomOut, onRecenter }: Props) {
  return (
    <div className="map-zoom-controls">
      <style>{styles}</style>
      <button type="button" aria-label="Perbesar" onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Perkecil" onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Atur ulang tampilan" onClick={onRecenter}>⌖</button>
    </div>
  )
}

const styles = `
  .map-zoom-controls {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 11;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .map-zoom-controls button {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f1ea;
    color: #0f1117;
    border: 1px solid #d4cfc5;
    border-left: 2px solid transparent;
    font-family: 'DM Mono', monospace;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    transition: border-left-color 0.15s, background 0.15s;
  }
  .map-zoom-controls button:hover {
    background: #ece7dc;
    border-left-color: #c0392b;
  }
  .map-zoom-controls button:active { background: #e2dccf; }
  .map-zoom-controls button:focus-visible { outline: 2px solid #c0392b; outline-offset: 1px; }
`
```

- [ ] **Step 2: Typecheck**

Run (from `web/`):
```bash
npx tsc --noEmit
```
Expected: no errors referencing `MapZoomControls.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/app/_components/MapZoomControls.tsx
git commit -m "feat: MapZoomControls overlay (editorial +/-/recenter buttons)"
```

---

## Task 4: Wire zoom into `IndonesiaMap`

**Files:**
- Modify: `web/app/_components/IndonesiaMap.tsx`

The outer transform `<g>` must wrap BOTH the paths group and the `dot-layer` group so hotspot dots pan/zoom with the provinces.

- [ ] **Step 1: Add imports + refs**

At the top imports (after the existing `import { useEffect, useMemo, useRef, useState } from 'react'`), add:
```tsx
import { useMapZoom } from './useMapZoom'
import MapZoomControls from './MapZoomControls'
```

Add `zoomable` to the `Props` interface (after `neutralFill`):
```tsx
  /** When true, enables d3 zoom/pan + control overlay. Default false (live pages unchanged). */
  zoomable?: boolean
```

In the destructured props (after `neutralFill = false,`):
```tsx
  zoomable = false,
```

After the existing `const containerRef = useRef<HTMLDivElement | null>(null)` line, add:
```tsx
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
```

- [ ] **Step 2: Call the hook**

Immediately before the `return (` of the component, add:
```tsx
  const { zoomIn, zoomOut, recenter } = useMapZoom({
    svgRef,
    gRef,
    width: size.w,
    height: size.h,
    enabled: zoomable && data !== null,
  })
```

- [ ] **Step 3: Add the svg ref and wrap children in a transform `<g>`**

Change the opening svg tag from:
```tsx
        <svg width={size.w} height={size.h} role="img" aria-label="Peta Indonesia">
          <g>
```
to:
```tsx
        <svg ref={svgRef} width={size.w} height={size.h} role="img" aria-label="Peta Indonesia">
          <g ref={zoomable ? gRef : undefined}>
          <g>
```

Then close the new outer `<g>` after the dot-layer block. Find the end of the dots block:
```tsx
            </g>
          )}
        </svg>
```
and change it to:
```tsx
            </g>
          )}
          </g>
        </svg>
```

(The result: `<g ref=…>` → `<g>…paths…</g>` → `{dots && <g className="dot-layer">…</g>}` → `</g>`.)

- [ ] **Step 4: Render the controls**

Immediately after the closing `</svg>` (and before the `)}` that closes the `data === null ? … : (…)` ternary), add:
```tsx
        {zoomable && data && (
          <MapZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onRecenter={recenter} />
        )}
```

- [ ] **Step 5: Typecheck**

Run (from `web/`):
```bash
npx tsc --noEmit
```
Expected: no errors referencing `IndonesiaMap.tsx`.

- [ ] **Step 6: Commit**

```bash
git add web/app/_components/IndonesiaMap.tsx
git commit -m "feat: zoomable prop + transform group on IndonesiaMap (default off)"
```

---

## Task 5: Wire zoom into `KabKotaMap`

**Files:**
- Modify: `web/app/_components/KabKotaMap.tsx`

Same pattern; no dot-layer, so the outer `<g>` wraps just the paths group.

- [ ] **Step 1: Add imports + refs**

After `import { useEffect, useMemo, useRef, useState } from 'react'`, add:
```tsx
import { useMapZoom } from './useMapZoom'
import MapZoomControls from './MapZoomControls'
```

Add to `Props` (after `height?: number`):
```tsx
  /** When true, enables d3 zoom/pan + control overlay. Default false. */
  zoomable?: boolean
```

In destructured props (after `height = 420,`):
```tsx
  zoomable = false,
```

After `const containerRef = useRef<HTMLDivElement | null>(null)`, add:
```tsx
  const svgRef = useRef<SVGSVGElement | null>(null)
  const gRef = useRef<SVGGElement | null>(null)
```

- [ ] **Step 2: Call the hook**

Immediately before the `return (`, add:
```tsx
  const { zoomIn, zoomOut, recenter } = useMapZoom({
    svgRef,
    gRef,
    width: size.w,
    height: size.h,
    enabled: zoomable && data !== null && data !== 'missing',
  })
```

- [ ] **Step 3: Add svg ref and wrap paths in a transform `<g>`**

Change:
```tsx
        <svg width={size.w} height={size.h} role="img" aria-label={`Peta ${provinsi}`}>
          <g>
```
to:
```tsx
        <svg ref={svgRef} width={size.w} height={size.h} role="img" aria-label={`Peta ${provinsi}`}>
          <g ref={zoomable ? gRef : undefined}>
          <g>
```

Then change the paths-group close:
```tsx
              )
            })}
          </g>
        </svg>
```
to:
```tsx
              )
            })}
          </g>
          </g>
        </svg>
```

- [ ] **Step 4: Render the controls**

Immediately after the closing `</svg>` (before the `)}` closing the data ternary), add:
```tsx
        {zoomable && data && data !== 'missing' && (
          <MapZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onRecenter={recenter} />
        )}
```

- [ ] **Step 5: Typecheck**

Run (from `web/`):
```bash
npx tsc --noEmit
```
Expected: no errors referencing `KabKotaMap.tsx`.

- [ ] **Step 6: Commit**

```bash
git add web/app/_components/KabKotaMap.tsx
git commit -m "feat: zoomable prop + transform group on KabKotaMap (default off)"
```

---

## Task 6: Create the gated lab page

**Files:**
- Create: `web/app/admin/map-lab/ProvSelect.tsx`
- Create: `web/app/admin/map-lab/page.tsx`

The page is auto-gated by `web/proxy.ts` (admin cookie on `/admin/*`). Province switching is done by navigation (`?prov=`) so the server query `listWilayahCounts` runs server-side.

- [ ] **Step 1: Write the province selector (client)**

`web/app/admin/map-lab/ProvSelect.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'

interface Props {
  provinces: string[]
  selected: string
}

export default function ProvSelect({ provinces, selected }: Props) {
  const router = useRouter()
  return (
    <label style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#0f1117' }}>
      Provinsi (peta kab/kota):{' '}
      <select
        value={selected}
        onChange={(e) => router.push(`/admin/map-lab?prov=${encodeURIComponent(e.target.value)}`)}
        style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, padding: '4px 6px' }}
      >
        {provinces.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 2: Write the lab page (server)**

`web/app/admin/map-lab/page.tsx`:
```tsx
import IndonesiaMap from '@/app/_components/IndonesiaMap'
import KabKotaMap from '@/app/_components/KabKotaMap'
import { listProvinceCounts, listWilayahCounts } from '@/lib/queries'
import ProvSelect from './ProvSelect'

function provSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export default async function MapLabPage({
  searchParams,
}: {
  searchParams: Promise<{ prov?: string }>
}) {
  const sp = await searchParams
  const prov = sp.prov ?? 'Jawa Barat'

  const provinces = await listProvinceCounts()
  const wilayahCounts = await listWilayahCounts(prov)
  const provinceNames = provinces.map((p) => p.nama).sort((a, b) => a.localeCompare(b, 'id'))

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px', fontFamily: "'DM Mono', monospace" }}>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 24 }}>
        Map Lab — zoom / pan sandbox
      </h1>
      <p style={{ fontSize: 12, color: '#6b6859', lineHeight: 1.6 }}>
        Test: scroll-wheel zoom (toward cursor), click-drag to pan, pinch on touch,
        the +/−/⌖ buttons, and recenter (⌖) returning to the default view. Borders
        should stay crisp; dots should track the map. This page is admin-only and not linked publicly.
      </p>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c' }}>
          IndonesiaMap
        </h2>
        <IndonesiaMap provinces={provinces} height={460} zoomable />
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c' }}>
          KabKotaMap
        </h2>
        <div style={{ margin: '8px 0 12px' }}>
          <ProvSelect provinces={provinceNames} selected={prov} />
        </div>
        <KabKotaMap
          provinsi={prov}
          provinsiSlug={provSlug(prov)}
          wilayahCounts={wilayahCounts}
          height={420}
          zoomable
        />
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Typecheck**

Run (from `web/`):
```bash
npx tsc --noEmit
```
Expected: no errors referencing the lab page.

- [ ] **Step 4: Commit**

```bash
git add web/app/admin/map-lab/
git commit -m "feat: /admin/map-lab sandbox for map zoom testing"
```

---

## Task 7: Verify end-to-end + build

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run (from `web/`), in background:
```bash
npm run dev
```
Wait for "Ready". Note the port (default 3000).

- [ ] **Step 2: Log in to admin if needed**

`/admin/*` is gated by `admin_session` cookie (`web/proxy.ts`). If redirected to login, complete the existing admin login flow first.

- [ ] **Step 3: Drive the lab page with Playwright MCP**

Navigate to `http://localhost:3000/admin/map-lab`. On BOTH maps verify:
- Mouse wheel over the map zooms in/out toward the cursor.
- Click-drag pans; cursor shows grab/grabbing; map cannot be flung fully off-screen.
- `+` / `−` buttons zoom smoothly; `⌖` returns to the exact default fit view.
- Province `<select>` swaps the kab/kota geometry (try "Jawa Barat" → "Aceh").
- Hover tooltips still show the correct region while zoomed/panned.
- Take screenshots at default and zoomed-in states for both maps.

Expected: all interactions work; borders stay crisp (non-scaling-stroke); dots track the Indonesia map.

- [ ] **Step 4: Confirm live pages are unchanged**

Navigate to `/` and `/pejabat`. Confirm no zoom controls appear and the maps behave exactly as before (zoomable defaults to false).

- [ ] **Step 5: Production build**

Run (from `web/`):
```bash
npm run build
```
Expected: build succeeds, no type errors, `/admin/map-lab` listed in the route output.

- [ ] **Step 6: Commit any fixes**

If steps 3–5 required fixes, commit them:
```bash
git add -A
git commit -m "fix: map zoom lab issues found in verification"
```

---

## Shipping (separate follow-up, NOT in this plan)

After you sign off on the lab page, enabling zoom on the live pages is a one-line change at each call site:
- `web/app/_components/HomeShell.tsx` — add `zoomable` to the `<IndonesiaMap …>`.
- `web/app/pejabat/PejabatBrowse.tsx:104` and `:113` — add `zoomable` to `<KabKotaMap>` / `<IndonesiaMap>`.

---

## Self-Review Notes

- **Spec coverage:** wheel/pinch zoom (Task 2 scaleExtent + d3-zoom), drag pan (Task 2 translateExtent), +/−/recenter (Task 3 + hook handlers), touch (free via d3-zoom), editorial controls (Task 3 styles), non-destructive `zoomable` default-off (Tasks 4–5), outer `<g>` wrapping dots for IndonesiaMap (Task 4 Step 3), lab page gated under /admin (Task 6), reduced-motion (Task 2 `duration()`), tooltips unchanged (verified Task 7 Step 3). All spec sections mapped.
- **Type consistency:** hook exports `{ zoomIn, zoomOut, recenter }`; both maps and controls consume those exact names. `UseMapZoomOptions` fields (`svgRef`, `gRef`, `width`, `height`, `enabled`) match all call sites.
- **Placeholder scan:** none — every code step contains complete, correct code.
