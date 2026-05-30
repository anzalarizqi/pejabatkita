# Map Zoom / Pan / Recenter — Design

**Date:** 2026-05-30
**Status:** Approved (design), pending implementation plan

## Problem

The two SVG choropleth maps — `IndonesiaMap` (homepage) and `KabKotaMap`
(province drill-down on `/pejabat`) — are static, fit-to-container renders with
no zoom, pan, or recenter. Small provinces and dense kab/kota geometries are
hard to inspect. We want scroll-wheel/pinch zoom, drag-to-pan, +/− buttons, and
a recenter-to-default control on both maps.

Constraint: the homepage and `/pejabat` are in active daily use (Rekam Bersih
screening, live Pulse). The new behavior must NOT disturb those live pages while
it is being built and tested.

## Approach (chosen)

**Shared hook + flag, exercised by a gated lab page.** Build the zoom behavior
once as a reusable hook plus a presentational control overlay. Wire both real
map components behind a `zoomable` prop that **defaults to `false`**, so the live
pages render byte-for-byte as they do today until we explicitly opt in. A
throwaway gated page `/admin/map-lab` renders both maps with `zoomable={true}`
using real data. "Shipping" later = flipping the prop at two call sites.

Rejected alternatives:
- *Throwaway copies of each map* — forces re-porting the zoom logic into the
  real components later (double work, drift risk).
- *Build directly into the components, no flag* — touches the live homepage map
  immediately, which is exactly what we must avoid during screening.

## Architecture

Three new files under `web/app/_components/` (plus the lab page):

| File | Responsibility |
|---|---|
| `useMapZoom.ts` | Hook wrapping `d3-zoom`. Inputs: `svgRef`, `gRef`, current `{ w, h }`, `enabled`. Configures wheel/pinch/drag zoom, writes the transform **imperatively** onto the `<g>` via `setAttribute('transform', …)` — no React state for the transform, so the hundreds of `<path>` elements do not re-render on every wheel tick. Returns `{ zoomIn, zoomOut, recenter }`. |
| `MapZoomControls.tsx` | Presentational overlay: `+`, `−`, `⌖` buttons, absolutely positioned top-right inside `.map-wrap`. Pure props (`onZoomIn`, `onZoomOut`, `onRecenter`). |
| `app/admin/map-lab/page.tsx` | Throwaway lab. Server component pulls real data via existing queries; renders both maps with `zoomable`. Auto-gated by `proxy.ts` (admin cookie). |

Dependencies added to `web/package.json`: `d3-zoom`, `d3-selection`
(same d3 family as the existing `d3-geo`), plus `@types/d3-zoom`,
`@types/d3-selection`.

### Hook behavior (`useMapZoom`)

- Creates a `zoom()` behavior with `scaleExtent([1, 8])`. Scale `1` is the
  current fit-to-container view, so the user can never zoom out past the default
  (no empty margins).
- `translateExtent([[0, 0], [w, h]])` constrains panning to the map box so it
  cannot be dragged off-screen. The behavior is re-created when `w`/`h` change
  (it depends on size).
- `on('zoom', e => gRef.current.setAttribute('transform', e.transform))`.
- `zoomIn` / `zoomOut`: `zoom.scaleBy(selection.transition().duration(200), k)`.
- `recenter`: `zoom.transform(selection.transition().duration(200), zoomIdentity)`.
- Attaches to the `<svg>` only when `enabled` is true; full cleanup on unmount /
  when disabled.
- Respects `prefers-reduced-motion`: button transitions become instant.

### Wiring into the two maps (non-destructive)

Both `IndonesiaMap` and `KabKotaMap` gain a `zoomable?: boolean` prop
(default `false`).

- **`zoomable === false`** → render exactly as today. No transform, no controls.
- **`zoomable === true`**:
  - The wrapping `<g>` gets `ref={gRef}`. For `IndonesiaMap` this is an **outer
    `<g>` enclosing BOTH the paths group and the `dot-layer` group**, so the
    hotspot dots pan/zoom together with the provinces.
  - The hook attaches to the `<svg>`.
  - `<MapZoomControls>` renders in the corner.

**Tooltips need zero changes.** They are absolutely-positioned HTML divs placed
by screen coordinates (`evt.clientX − rect.left`), which remain correct under any
SVG transform. Mouse events still fire on whichever `<path>` is under the cursor.

## Interaction details

- Wheel / pinch zoom toward the cursor; `scaleExtent([1, 8])`.
- Drag to pan; cursor `grab` / `grabbing`; constrained by `translateExtent`.
- Buttons `+`, `−`, `⌖` animate ~200ms eased; `⌖` resets to `zoomIdentity`
  (today's view).
- Touch (pinch + drag) comes free from `d3-zoom` — helps the currently-untested
  mobile responsiveness.
- Existing `vector-effect: non-scaling-stroke` keeps borders crisp at all zoom
  levels.
- Hotspot dots scale with the map (simple v1; revisit only if they look too
  large when zoomed in).

## Control styling (editorial, matches existing system)

Must cohere with the maps' existing look — NOT a new aesthetic:

- Vertical stack of three square buttons, hairline border, top-right inside
  `.map-wrap`.
- Cream `#f5f1ea` face, ink `#0f1117` glyphs, DM Mono.
- `#c0392b` left-border accent on hover (echoes the tooltip's
  `border-left: 2px solid #c0392b`).
- Sharp corners, subtle — utilitarian, not toy-like.
- Glyphs: `+`, `−`, and a recenter mark (`⌖` or a small crosshair SVG).

## Lab page (`/admin/map-lab`)

- Server component; pulls `listProvinceCounts()` for the Indonesia map and
  wilayah counts for one default province for the kab/kota map.
- A `<select>` swaps which province's kab/kota geojson renders (test different
  geometries).
- Both maps rendered with `zoomable={true}`.
- Short on-page note listing what to test (wheel, drag, pinch, buttons,
  recenter, mobile).

## Out of scope

- Flipping `zoomable` on for the live homepage / `/pejabat` (separate follow-up
  after sign-off).
- Counter-scaling hotspot dots to keep constant pixel size.
- Mini-map / zoom-level indicator.

## Verification

- Lab page: wheel zoom, drag pan, pinch (touch/devtools), each button, and
  recenter all work on both maps; borders stay crisp; dots track the map; recenter
  returns to the exact default view.
- Homepage `/` and `/pejabat`: visually unchanged (zoomable defaults off);
  Pulse and screening flows unaffected.
- `npm run build` / typecheck clean (no `any`).
