'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import IndonesiaMap, { type HotspotDot } from './IndonesiaMap'
import DisclaimerModal from './DisclaimerModal'
import MisiKamiModal from './MisiKamiModal'
import KabinetGrid from './KabinetGrid'
import HotspotRail from './HotspotRail'
import type {
  HotspotEventWithPejabat,
  LeaderRow,
  PejabatPusatCard,
  ProvinceCount,
  ProvinceHotspotCount,
  ProvinceKasusCount,
  SiteStats,
} from '@/lib/queries'

interface Props {
  provinces: ProvinceCount[]
  stats: SiteStats
  leaders: LeaderRow[]
  pusatOfficials: PejabatPusatCard[]
  kasusCounts: ProvinceKasusCount[]
  hotspotEvents24h: HotspotEventWithPejabat[]
  hotspotEvents7d: HotspotEventWithPejabat[]
  provinceHotspot24h: ProvinceHotspotCount[]
  provinceHotspot7d: ProvinceHotspotCount[]
}

type SortKey = 'posisi' | 'nama' | 'provinsi'
type ColorMode = 'tercatat' | 'pendidikan' | 'lhkpn' | 'bersih' | 'denyut'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

const COLOR_MODES: { key: ColorMode; label: string; live: boolean; hint: string }[] = [
  { key: 'bersih',     label: 'Rekam Bersih', live: true,  hint: '% pejabat dengan catatan korupsi' },
  { key: 'denyut',     label: 'Denyut',     live: true,  hint: 'kejadian publik 7 hari terakhir' },
  { key: 'tercatat',   label: 'Tercatat',   live: true,  hint: 'pejabat tercatat' },
  { key: 'pendidikan', label: 'Pendidikan', live: false, hint: '% S2/S3 · ilustrasi' },
  { key: 'lhkpn',      label: 'LHKPN',      live: false, hint: '% LHKPN lengkap · ilustrasi' },
]

function hash01(s: string, salt: number): number {
  let h = salt | 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return ((h >>> 0) % 10000) / 10000
}

// Smooth a uniform 0..1 toward a centre, so mock distributions look plausible
function biased(u: number, centre: number, spread: number): number {
  return Math.max(0, Math.min(1, centre + (u - 0.5) * spread))
}

type ViewMode = 'daerah' | 'pusat'

export default function PreviewShell({
  provinces, stats, leaders, pusatOfficials, kasusCounts,
  hotspotEvents24h, hotspotEvents7d, provinceHotspot24h, provinceHotspot7d,
}: Props) {
  const [mode, setMode] = useState<ColorMode>('bersih')
  const [viewMode, setViewMode] = useState<ViewMode>('daerah')
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null)

  const kasusMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of kasusCounts) m.set(k.provinsi_nama, k.kasus_count)
    return m
  }, [kasusCounts])

  const screenedMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of kasusCounts) m.set(k.provinsi_nama, k.screened_count)
    return m
  }, [kasusCounts])

  const dateLabel = new Date().toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const lastUpdatedLabel = stats.lastUpdated
    ? new Date(stats.lastUpdated).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : '—'

  function reopenDisclaimer() {
    try { window.localStorage.removeItem('pejabatkita_disclaimer_v1') } catch {}
    window.dispatchEvent(new Event('pv:open-disclaimer'))
  }

  function openMisi() {
    window.dispatchEvent(new Event('pv:open-misi'))
  }

  const provinceMaps = useMemo(() => {
    const expected = new Map<string, number>()
    const count = new Map<string, number>()
    for (const p of provinces) {
      expected.set(p.nama, p.expected)
      count.set(p.nama, p.count)
    }
    return { expected, count }
  }, [provinces])

  // Hotspot dots — one per event. Events in same province are fanned in
  // a phyllotaxis spiral around the centroid. Pulse if event is in 24h list.
  const hotspotDots: HotspotDot[] = useMemo(() => {
    if (mode !== 'denyut') return []
    const events24hIds = new Set(hotspotEvents24h.map((e) => e.event_id))

    const byProvince = new Map<string, HotspotEventWithPejabat[]>()
    for (const e of hotspotEvents7d) {
      if (!e.provinsi_nama) continue
      const list = byProvince.get(e.provinsi_nama) ?? []
      list.push(e)
      byProvince.set(e.provinsi_nama, list)
    }

    const MAX_DOTS = 10
    const out: HotspotDot[] = []
    for (const [province, events] of byProvince) {
      // When a province has more than MAX_DOTS events, keep the most relevant:
      // 24h events (the pulsing ones) always win, then most-recently-crawled.
      // events arrive crawled_at-desc and Array.sort is stable, so returning 0
      // for same-bucket pairs preserves that recency order — the dropped dots
      // are therefore always the oldest non-24h events.
      const capped = [...events]
        .sort((a, b) => {
          const a24 = events24hIds.has(a.event_id) ? 1 : 0
          const b24 = events24hIds.has(b.event_id) ? 1 : 0
          return b24 - a24
        })
        .slice(0, MAX_DOTS)
      capped.forEach((e, i) => {
        out.push({
          provinceName: province,
          id: e.event_id,
          color: KATEGORI_COLOR[e.kategori ?? 'lainnya'] ?? KATEGORI_COLOR.lainnya,
          size: 0.4,
          count: 1,
          pulse: events24hIds.has(e.event_id),
          topKategori: e.kategori ?? 'lainnya',
          groupIndex: i,
          groupTotal: capped.length,
        })
      })
    }
    return out
  }, [mode, hotspotEvents7d, hotspotEvents24h])

  // Each mock mode computes a "safety %" (high = good). Colour intensity is
  // INVERTED so that red = danger / low % across all preview modes, matching
  // the editorial convention (red = alarm). Tercatat shows completion %
  // (count / expected) so the gradient lands on a meaningful 0–100 scale.
  const mapColorBy = useMemo(() => {
    if (mode === 'denyut') {
      // Neutral fill — dots carry all the signal
      return () => null
    }
    if (mode === 'tercatat') {
      return (name: string) => {
        const e = provinceMaps.expected.get(name)
        const c = provinceMaps.count.get(name)
        if (!e || c === undefined) return null
        return Math.min(1, c / e)
      }
    }
    if (mode === 'bersih') {
      const ratios = [...kasusMap.entries()].map(([name, count]) => {
        const total = Math.max(1, provinceMaps.count.get(name) ?? 1)
        return count / total
      })
      const maxRatio = Math.max(...ratios, 0.001)
      return (name: string) => {
        const count    = kasusMap.get(name) ?? 0
        const screened = screenedMap.get(name) ?? 0
        const total    = provinceMaps.count.get(name) ?? 0
        if (count === 0 && screened >= total && total > 0) return 'bersih'
        return (count / Math.max(1, total)) / maxRatio
      }
    }
    return (name: string) => {
      const u = hash01(name, mode === 'pendidikan' ? 17 : mode === 'lhkpn' ? 31 : 53)
      const centre = mode === 'pendidikan' ? 0.62 : mode === 'lhkpn' ? 0.48 : 0.74
      const safety = biased(u, centre, 0.7)
      return 1 - safety // redder = lower safety
    }
  }, [mode, provinceMaps, kasusMap])

  const mapTooltip = useMemo(() => {
    if (mode === 'denyut') {
      const by7d = new Map(provinceHotspot7d.map((p) => [p.provinsi_nama, p]))
      const by24h = new Map(provinceHotspot24h.map((p) => [p.provinsi_nama, p]))
      return (name: string) => {
        const p7 = by7d.get(name)
        const p24 = by24h.get(name)
        if (!p7 && !p24) return 'Tidak ada kejadian 7 hari terakhir'
        const c24 = p24?.count ?? 0
        const c7 = p7?.count ?? 0
        const top = p7 ? Object.entries(p7.kategori_counts).sort((a, b) => b[1] - a[1])[0]?.[0] : null
        const parts = []
        if (c24 > 0) parts.push(`${c24} kejadian 24 jam`)
        else parts.push(`${c7} kejadian 7 hari`)
        if (top) parts.push(top)
        return parts.join(' · ')
      }
    }
    if (mode === 'tercatat') {
      return (name: string) => {
        const e = provinceMaps.expected.get(name) ?? 0
        const c = provinceMaps.count.get(name) ?? 0
        const pct = e > 0 ? Math.round((c / e) * 100) : 0
        return `${c} / ${e} kursi · ${pct}% terisi`
      }
    }
    if (mode === 'bersih') {
      return (name: string) => {
        const count    = kasusMap.get(name) ?? 0
        const screened = screenedMap.get(name) ?? 0
        const total    = provinceMaps.count.get(name) ?? 0
        if (count > 0) {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return `${count} / ${total} pejabat memiliki catatan korupsi (${pct}%)`
        }
        if (screened >= total && total > 0) {
          return `${total} pejabat · bersih ✓`
        }
        return `${screened} / ${total} pejabat terskrining`
      }
    }
    return (name: string) => {
      const u = hash01(name, mode === 'pendidikan' ? 17 : mode === 'lhkpn' ? 31 : 53)
      const centre = mode === 'pendidikan' ? 0.62 : mode === 'lhkpn' ? 0.48 : 0.74
      const safety = biased(u, centre, 0.7)
      const pct = Math.round(safety * 100)
      const labels = {
        pendidikan: `${pct}% pendidikan ≥ S2 (ilustrasi)`,
        lhkpn:      `${pct}% LHKPN lengkap (ilustrasi)`,
      } as Record<Exclude<ColorMode, 'tercatat' | 'bersih'>, string>
      return labels[mode as Exclude<ColorMode, 'tercatat' | 'bersih'>]
    }
  }, [mode, provinceMaps, kasusMap])

  return (
    <>
      <style>{styles}</style>
      <DisclaimerModal />
      <MisiKamiModal />

      <div className="pv-root">
        <RegistrationMark className="pv-mark pv-mark-tl" />
        <RegistrationMark className="pv-mark pv-mark-tr" />
        <RegistrationMark className="pv-mark pv-mark-bl" />
        <RegistrationMark className="pv-mark pv-mark-br" />

        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="pv-header">
          <div className="pv-brand">
            <span className="pv-brand-mark" aria-hidden>◐</span>
            <div className="pv-brand-text">
              <span className="pv-brand-name">Peta Pejabat Indonesia</span>
              <span className="pv-brand-sub">Dosir publik · {dateLabel}</span>
            </div>
          </div>

          <nav className="pv-nav" aria-label="Navigasi utama">
            <Link href="/" className="pv-nav-link pv-nav-active">Beranda</Link>
            <Link href="/pejabat" className="pv-nav-link">Direktori</Link>
            <Link href="/pulse" className="pv-nav-link">Denyut</Link>
            <button
              type="button"
              className="pv-nav-link pv-nav-btn"
              onClick={openMisi}
              suppressHydrationWarning
            >
              Misi Kami
            </button>
          </nav>

          <div className="pv-header-meta">
            <span className="pv-edisi">EDISI · {String(new Date().getFullYear())} / N° {String(new Date().getMonth() + 1).padStart(2, '0')}</span>
          </div>
        </header>

        {/* ── Main: map stage | hotspot rail ──────────────────────── */}
        <main className="pv-main">
          <section className="pv-stage">
            <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
            {viewMode === 'daerah' ? (
              <>
                <StatStrip stats={stats} lastUpdatedLabel={lastUpdatedLabel} />
                <ModeToggle mode={mode} setMode={setMode} />
                <div className="pv-stage-map" style={{ overflow: 'visible' }}>
                  {mode !== 'tercatat' && mode !== 'bersih' && mode !== 'denyut' && (
                    <div className="pv-mock-stamp">DATA ILUSTRASI · Q2 2026</div>
                  )}
                  <IndonesiaMap
                    provinces={provinces}
                    height={460}
                    zoomable
                    colorBy={mapColorBy}
                    tooltip={mapTooltip}
                    dots={mode === 'denyut' ? hotspotDots : undefined}
                    neutralFill={mode === 'denyut'}
                    selected={mode === 'denyut' ? selectedProvince : null}
                    onProvinceClick={
                      mode === 'denyut'
                        ? (name) => setSelectedProvince((cur) => cur === name ? null : name)
                        : undefined
                    }
                  />
                </div>
                {mode === 'denyut'
                  ? <DenyutLegend />
                  : <MapLegend mode={mode} provinces={provinces} />}
              </>
            ) : (
              <div className="pv-pusat-scroll">
                <KabinetGrid officials={pusatOfficials} />
              </div>
            )}
          </section>

          {viewMode === 'daerah' && (
            <aside className="pv-hotspot-rail">
              <HotspotRail
                events24h={hotspotEvents24h}
                events7d={hotspotEvents7d}
                selectedProvince={mode === 'denyut' ? selectedProvince : null}
                onProvinceClear={() => setSelectedProvince(null)}
                onActivate={() => setMode('denyut')}
              />
            </aside>
          )}
        </main>

        {/* ── Bottom ticker ───────────────────────────────────────── */}
        <footer className="pv-ticker">
          <Ticker stats={stats} provinces={provinces} />
        </footer>
      </div>
    </>
  )
}

// ─── View toggle (Daerah / Pusat) ────────────────────────────────────────────

function ViewToggle({ viewMode, setViewMode }: { viewMode: ViewMode; setViewMode: (v: ViewMode) => void }) {
  return (
    <div className="pv-view-row">
      <div className="pv-mode-tabs" role="tablist">
        {(['daerah', 'pusat'] as ViewMode[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={viewMode === v}
            className={`pv-mode-tab ${viewMode === v ? 'pv-mode-tab-active' : ''}`}
            onClick={() => setViewMode(v)}
            suppressHydrationWarning
          >
            {v === 'daerah' ? 'Daerah' : 'Pusat · Kabinet'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Leaders rail ────────────────────────────────────────────────────────────

const PAGE_SIZE = 30

function LeadersRail({ leaders }: { leaders: LeaderRow[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('posisi')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = leaders
    if (q) {
      rows = rows.filter(
        (l) =>
          l.nama.toLowerCase().includes(q) ||
          l.wilayah.toLowerCase().includes(q) ||
          l.provinsi.toLowerCase().includes(q),
      )
    }
    const sorted = [...rows]
    if (sort === 'nama') sorted.sort((a, b) => a.nama.localeCompare(b.nama))
    else if (sort === 'provinsi')
      sorted.sort((a, b) =>
        a.provinsi === b.provinsi ? a.wilayah.localeCompare(b.wilayah) : a.provinsi.localeCompare(b.provinsi),
      )
    // 'posisi' is the default order from the server
    return sorted
  }, [leaders, query, sort])

  // Reset pagination when filters change so users don't scroll through stale results
  useEffect(() => { setVisible(PAGE_SIZE) }, [query, sort])

  const shown = filtered.slice(0, visible)
  const hasMore = visible < filtered.length

  return (
    <div className="pv-rail-inner">
      <div className="pv-rail-head">
        <div className="pv-eyebrow">
          <span className="pv-eyebrow-dot" />
          Direktori · Kepala Daerah
        </div>
        <h2 className="pv-rail-title">
          {leaders.length}<span className="pv-rail-title-sym"> nama</span>
        </h2>
        <p className="pv-rail-subtitle">
          gubernur, bupati, walikota — terverifikasi dari sumber publik.
        </p>
      </div>

      <div className="pv-rail-controls">
        <label className="pv-search">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <input
            type="text"
            placeholder="Cari nama atau wilayah…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            suppressHydrationWarning
          />
          {query && (
            <button
              type="button"
              className="pv-search-clear"
              onClick={() => setQuery('')}
              aria-label="Hapus"
              suppressHydrationWarning
            >×</button>
          )}
        </label>
        <div className="pv-sort">
          <span className="pv-sort-label">Urut</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} suppressHydrationWarning>
            <option value="posisi">Jenjang</option>
            <option value="nama">A — Z</option>
            <option value="provinsi">Provinsi</option>
          </select>
        </div>
      </div>

      <div className="pv-rail-count">
        <span>{shown.length} dari {filtered.length}</span>
        <span className="pv-rail-legend">
          <span className="pv-dot pv-dot-empty" /> belum ada · <span className="pv-dot pv-dot-ok" /> tersedia
        </span>
      </div>

      <div className="pv-leader-list" role="list">
        {shown.map((l, i) => (
          <Link
            href={`/${l.id}`}
            className="pv-leader"
            role="listitem"
            key={l.id}
            style={{ animationDelay: `${Math.min(i, 18) * 22}ms` }}
          >
            <div className="pv-leader-rank">
              {LEADER_RANK_LABEL[l.posisi] ?? l.posisi.slice(0, 3).toUpperCase()}
            </div>
            <div className="pv-leader-body">
              <div className="pv-leader-name">{l.nama}</div>
              <div className="pv-leader-meta">
                <span>{l.posisi}</span>
                {l.wilayah_level !== 'provinsi' && <span> · {l.wilayah}</span>}
                <span className="pv-leader-prov"> · {l.provinsi}</span>
              </div>
              <div className="pv-leader-tags">
                <span className="pv-tag"><span className="pv-dot pv-dot-empty" /> LHKPN</span>
                <span className="pv-tag"><span className="pv-dot pv-dot-empty" /> Rekam jejak</span>
              </div>
            </div>
            <div className="pv-leader-arrow">→</div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="pv-empty">Tidak ada hasil untuk «{query}».</div>
        )}
        {hasMore && (
          <button
            type="button"
            className="pv-loadmore"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            suppressHydrationWarning
          >
            Tampilkan {Math.min(PAGE_SIZE, filtered.length - visible)} lagi
            <span className="pv-loadmore-rest">
              · sisa {filtered.length - visible}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

const LEADER_RANK_LABEL: Record<string, string> = {
  Gubernur: 'GUB',
  Bupati: 'BUP',
  Walikota: 'WAL',
  'Wali Kota': 'WAL',
}

// ─── Stat strip (above the map) ──────────────────────────────────────────────

function StatStrip({
  stats,
  lastUpdatedLabel,
}: {
  stats: SiteStats
  lastUpdatedLabel: string
}) {
  const animatedReal = useCountUp(stats.realPejabat, 1400)
  const animatedPct = useCountUp(Math.round(stats.coveragePct * 10), 1600) / 10
  return (
    <div className="pv-strip">
      <div className="pv-strip-cell">
        <div className="pv-strip-label">
          <span className="pv-eyebrow-dot" /> Database
        </div>
        <div className="pv-strip-value">
          <span className="pv-strip-num">{animatedReal.toLocaleString('id-ID')}</span>
          <span className="pv-strip-sub">
            / {stats.expectedTotal.toLocaleString('id-ID')} kursi
          </span>
        </div>
        <div className="pv-strip-foot">
          {stats.provincesTotal} provinsi · {stats.kabKotaTotal} kab/kota
        </div>
      </div>

      <div className="pv-strip-cell">
        <div className="pv-strip-label">Cakupan · {stats.provincesCovered} provinsi</div>
        <div className="pv-strip-value">
          <span className="pv-strip-num">{animatedPct.toFixed(1)}</span>
          <span className="pv-strip-pct">%</span>
        </div>
        <div className="pv-strip-bar" aria-hidden>
          <div className="pv-strip-bar-fill" style={{ width: `${Math.min(100, stats.coveragePct)}%` }} />
        </div>
        <div className="pv-strip-foot">diperbarui {lastUpdatedLabel}</div>
      </div>
    </div>
  )
}

// ─── Map legend (per-mode gradient meaning) ─────────────────────────────────

function MapLegend({ mode }: { mode: ColorMode; provinces?: ProvinceCount[] }) {
  if (mode === 'tercatat') {
    return (
      <div className="pv-legend">
        <span className="pv-legend-label">% Kursi terisi · per provinsi</span>
        <div className="pv-legend-scale" aria-hidden>
          <span className="pv-legend-end">0%</span>
          <span className="pv-legend-bar pv-legend-bar-neutral" />
          <span className="pv-legend-end">100%</span>
        </div>
      </div>
    )
  }

  const configMap: Record<Exclude<ColorMode, 'tercatat' | 'denyut'>, { label: string; danger: string; safe: string }> = {
    pendidikan: { label: '% pendidikan ≥ S2 · ilustrasi', danger: 'rendah', safe: 'tinggi' },
    lhkpn:      { label: '% LHKPN lengkap · ilustrasi',   danger: 'belum lengkap', safe: 'lengkap' },
    bersih:     { label: 'pejabat dengan catatan korupsi', danger: 'banyak catatan', safe: 'bersih' },
  }
  if (mode === 'denyut') return null
  const config = configMap[mode]

  return (
    <div className="pv-legend">
      <span className="pv-legend-label">{config.label}</span>
      <div className="pv-legend-scale" aria-hidden>
        <span className="pv-legend-end pv-legend-end-danger">▲ {config.danger}</span>
        <span className="pv-legend-bar pv-legend-bar-danger" />
        <span className="pv-legend-end pv-legend-end-safe">{config.safe} ◯</span>
      </div>
    </div>
  )
}

// ─── Denyut legend (pulse = 24h vs static = ≤7d) ─────────────────────────────

function DenyutLegend() {
  return (
    <div className="pv-legend pv-legend-denyut">
      <span className="pv-legend-label">Denyut publik</span>
      <span className="pv-denyut-key">
        <span className="pv-denyut-dot pv-denyut-dot-pulse" />
        24 jam · berdenyut
      </span>
      <span className="pv-denyut-key">
        <span className="pv-denyut-dot" />
        ≤ 7 hari · statis
      </span>
      <span className="pv-denyut-note">titik diwarnai per kategori</span>
    </div>
  )
}

// ─── Map colour-mode toggle ──────────────────────────────────────────────────

function ModeToggle({
  mode,
  setMode,
}: {
  mode: ColorMode
  setMode: (m: ColorMode) => void
}) {
  return (
    <div className="pv-mode-row">
      <span className="pv-mode-prefix">Warnai peta:</span>
      <div className="pv-mode-tabs" role="tablist">
        {COLOR_MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            className={`pv-mode-tab ${mode === m.key ? 'pv-mode-tab-active' : ''} ${m.live ? 'pv-mode-tab-live' : 'pv-mode-tab-mock'}`}
            onClick={() => setMode(m.key)}
            title={m.hint}
            suppressHydrationWarning
          >
            {m.label}
            {!m.live && <span className="pv-mode-flag">PRATINJAU</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Feature preview strip (compact horizontal banner) ──────────────────────

function FeatureStrip() {
  return (
    <div className="pv-fstrip">
      <div className="pv-fstrip-stamp">PRATINJAU · Q2 2026</div>
      <div className="pv-fstrip-cell">
        <span className="pv-fstrip-label">LHKPN</span>
        <span className="pv-fstrip-val">Rp <em>12,4</em> M</span>
      </div>
      <div className="pv-fstrip-divider" />
      <div className="pv-fstrip-cell">
        <span className="pv-fstrip-label">Pendidikan</span>
        <span className="pv-fstrip-val pv-fstrip-val-text">S2 Magister Hukum</span>
      </div>
      <div className="pv-fstrip-divider" />
      <div className="pv-fstrip-cell">
        <span className="pv-fstrip-label">Rekam Jejak</span>
        <span className="pv-fstrip-track">
          <span className="pv-track-dot pv-dot-ok" />
          <span className="pv-track-dot pv-dot-ok" />
          <span className="pv-track-dot pv-dot-ok" />
          <em>tidak ada catatan</em>
        </span>
      </div>
      <div className="pv-fstrip-note">fase 9B & 9C sedang dikerjakan</div>
    </div>
  )
}

// ─── Bottom ticker ───────────────────────────────────────────────────────────

function Ticker({ stats, provinces }: { stats: SiteStats; provinces: ProvinceCount[] }) {
  const top = [...provinces].filter((p) => p.count > 0).sort((a, b) => b.count - a.count).slice(0, 8)
  const items = [
    `${stats.provincesCovered}/${stats.provincesTotal} PROVINSI TERISI`,
    `${stats.realPejabat.toLocaleString('id-ID')} PEJABAT TERCATAT`,
    `${stats.coveragePct.toFixed(1)}% CAKUPAN`,
    ...top.map((p) => `${p.nama.toUpperCase()} · ${p.count}`),
    'AGGREGATOR DATA PUBLIK',
    'BUKAN OPINI · BUKAN EDITORIAL',
  ]
  const loop = [...items, ...items]
  return (
    <div className="pv-ticker-track">
      <div className="pv-ticker-inner">
        {loop.map((t, i) => (
          <span className="pv-ticker-item" key={i}>
            <span className="pv-ticker-bullet">●</span> {t}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Animated count-up hook ──────────────────────────────────────────────────

function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return value
}

// ─── Registration mark ───────────────────────────────────────────────────────

function RegistrationMark({ className }: { className: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="0.6" />
      <line x1="11" y1="0" x2="11" y2="22" stroke="currentColor" strokeWidth="0.6" />
      <line x1="0" y1="11" x2="22" y2="11" stroke="currentColor" strokeWidth="0.6" />
    </svg>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,200;0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,200;1,9..144,300;1,9..144,400&family=DM+Mono:wght@300;400;500&display=swap');

  :root {
    --ink: #0f1117;
    --paper: #f5f1ea;
    --paper-2: #ede7da;
    --paper-3: #e4dccb;
    --accent: #c0392b;
    --accent-soft: rgba(192, 57, 43, 0.08);
    --rule: #d4cfc5;
    --muted: #8a857c;
    --muted-2: #5a5750;
  }

  html, body { background: var(--paper); }
  body { font-family: 'DM Mono', monospace; color: var(--ink); }

  .pv-root {
    position: relative;
    height: 100vh;
    min-height: 760px;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--paper);
    overflow: hidden;
    background-image:
      radial-gradient(circle at 20% 10%, rgba(192,57,43,0.025), transparent 40%),
      radial-gradient(circle at 90% 80%, rgba(15,17,23,0.03), transparent 50%),
      repeating-linear-gradient(92deg, transparent 0, transparent 2px, rgba(15,17,23,0.012) 2px, rgba(15,17,23,0.012) 3px);
  }

  .pv-mark { position: absolute; color: var(--accent); opacity: 0.45; pointer-events: none; z-index: 50; }
  .pv-mark-tl { top: 12px; left: 12px; }
  .pv-mark-tr { top: 12px; right: 12px; }
  .pv-mark-bl { bottom: 12px; left: 12px; }
  .pv-mark-br { bottom: 12px; right: 12px; }

  /* ── Header ───────────────────────────────────────────────────── */
  .pv-header {
    border-bottom: 1.5px solid var(--ink);
    padding: 16px 56px 14px;
    display: grid;
    grid-template-columns: minmax(280px, 1fr) auto minmax(280px, 1fr);
    align-items: center;
    gap: 32px;
    background: var(--paper);
    position: relative;
    z-index: 10;
  }

  .pv-brand { display: flex; align-items: center; gap: 12px; }
  .pv-brand-mark { color: var(--accent); font-size: 22px; line-height: 1; transform: translateY(-1px); }
  .pv-brand-text { display: flex; flex-direction: column; line-height: 1.1; }
  .pv-brand-name { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 400; letter-spacing: -0.01em; }
  .pv-brand-sub { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }

  .pv-nav { display: flex; gap: 4px; align-items: center; justify-self: center; }
  .pv-nav-link {
    font-family: 'DM Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted-2);
    text-decoration: none;
    padding: 8px 16px;
    transition: all 0.15s ease;
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
  }
  .pv-nav-link:hover { color: var(--ink); }
  .pv-nav-link::after {
    content: ''; position: absolute; left: 16px; right: 16px; bottom: 4px;
    height: 1px; background: var(--accent); transform: scaleX(0); transform-origin: left center;
    transition: transform 0.22s ease;
  }
  .pv-nav-link:hover::after { transform: scaleX(1); }
  .pv-nav-active { color: var(--ink); }
  .pv-nav-active::after { transform: scaleX(1); background: var(--ink); }
  .pv-nav-btn { font-family: inherit; }

  .pv-header-meta { justify-self: end; }
  .pv-edisi {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.22em;
    color: var(--muted);
    text-transform: uppercase;
    border: 1px solid var(--rule);
    padding: 5px 12px;
    background: var(--paper-2);
    white-space: nowrap;
  }

  /* ── Main grid ───────────────────────────────────────────────── */
  .pv-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
    align-items: stretch;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  /* Hotspot rail (right) */
  .pv-hotspot-rail {
    border-left: 1.5px solid var(--ink);
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .pv-hotspot-rail > aside { height: 100%; }

  @media (max-width: 920px) {
    .pv-main { grid-template-columns: 1fr; }
    .pv-hotspot-rail { border-left: none; border-top: 1.5px solid var(--ink); max-height: 60vh; }
  }

  /* ── Rail ────────────────────────────────────────────────────── */
  .pv-rail {
    border-right: 1.5px solid var(--ink);
    padding: 32px 0 0;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, transparent, rgba(192,57,43,0.018));
    position: relative;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .pv-rail-inner {
    display: flex; flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .pv-rail-head { padding: 0 32px 20px; border-bottom: 1px solid var(--rule); }

  .pv-eyebrow {
    display: inline-flex; align-items: center; gap: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--accent);
    animation: pv-fadein 0.6s 0.05s both;
  }
  .pv-eyebrow-dot {
    width: 7px; height: 7px; background: var(--accent);
    display: inline-block; border-radius: 50%;
    animation: pv-pulse 2.4s ease-in-out infinite;
  }
  @keyframes pv-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.4; transform: scale(0.7); }
  }

  .pv-rail-title {
    font-family: 'Fraunces', serif;
    font-weight: 200;
    font-size: 64px;
    line-height: 0.95;
    letter-spacing: -0.025em;
    color: var(--ink);
    margin-top: 14px;
    animation: pv-rise 0.7s 0.1s cubic-bezier(0.2,0.7,0.3,1) both;
  }
  .pv-rail-title-sym {
    font-style: italic; font-size: 24px; color: var(--muted); font-weight: 300;
    letter-spacing: 0; margin-left: 4px;
  }

  .pv-rail-subtitle {
    font-family: 'Fraunces', serif; font-weight: 300;
    font-size: 13.5px; line-height: 1.5; color: var(--muted-2);
    max-width: 30ch; margin-top: 10px;
    animation: pv-fadein 0.7s 0.18s both;
  }

  /* Controls */
  .pv-rail-controls { padding: 18px 32px 12px; display: flex; gap: 10px; align-items: stretch; }

  .pv-search {
    flex: 1; display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--rule); padding: 9px 12px;
    background: var(--paper); transition: border-color 0.15s;
    color: var(--muted);
  }
  .pv-search:focus-within { border-color: var(--ink); color: var(--ink); }
  .pv-search input {
    flex: 1; border: none; outline: none; background: transparent;
    font-family: 'DM Mono', monospace; font-size: 11.5px;
    color: var(--ink); letter-spacing: 0.02em;
    min-width: 0;
  }
  .pv-search input::placeholder { color: var(--muted); letter-spacing: 0.04em; }
  .pv-search-clear {
    border: none; background: none; cursor: pointer;
    color: var(--muted); font-size: 16px; line-height: 1; padding: 0 2px;
  }
  .pv-search-clear:hover { color: var(--accent); }

  .pv-sort {
    display: flex; align-items: center; gap: 8px;
    border: 1px solid var(--rule); padding: 0 10px 0 12px; background: var(--paper);
  }
  .pv-sort-label {
    font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted);
  }
  .pv-sort select {
    border: none; outline: none; background: transparent;
    font-family: 'DM Mono', monospace; font-size: 11px;
    color: var(--ink); padding: 9px 4px 9px 0; cursor: pointer;
    letter-spacing: 0.05em;
  }

  .pv-rail-count {
    padding: 6px 32px 12px;
    display: flex; justify-content: space-between; align-items: center;
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase;
  }
  .pv-rail-legend { display: inline-flex; gap: 4px; align-items: center; }

  .pv-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    border: 1px solid var(--rule); background: transparent;
  }
  .pv-dot-ok { background: var(--accent); border-color: var(--accent); }
  .pv-dot-empty { background: transparent; }

  /* Leader list */
  .pv-leader-list {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 0 32px 32px;
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
  }
  .pv-leader-list::-webkit-scrollbar { width: 6px; }
  .pv-leader-list::-webkit-scrollbar-thumb { background: var(--rule); }

  .pv-leader {
    display: grid;
    grid-template-columns: 44px 1fr 18px;
    gap: 14px; align-items: center;
    padding: 12px 4px;
    border-bottom: 1px solid var(--rule);
    text-decoration: none; color: inherit;
    transition: all 0.15s ease;
    animation: pv-rise 0.5s both;
    position: relative;
  }
  .pv-leader::before {
    content: ''; position: absolute; left: -32px; top: 0; bottom: 0; width: 3px;
    background: var(--accent); transform: scaleY(0); transform-origin: top center;
    transition: transform 0.18s ease;
  }
  .pv-leader:hover { background: var(--paper-2); }
  .pv-leader:hover::before { transform: scaleY(1); }
  .pv-leader:hover .pv-leader-arrow { color: var(--accent); transform: translateX(3px); }

  .pv-leader-rank {
    font-family: 'DM Mono', monospace;
    font-size: 9.5px; letter-spacing: 0.14em;
    color: var(--accent); text-align: center;
    border: 1px solid var(--accent); padding: 6px 0;
    background: var(--paper);
  }

  .pv-leader-body { min-width: 0; }
  .pv-leader-name {
    font-family: 'Fraunces', serif; font-weight: 400;
    font-size: 14.5px; line-height: 1.2;
    color: var(--ink);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pv-leader-meta {
    font-family: 'DM Mono', monospace;
    font-size: 9.5px; letter-spacing: 0.04em;
    color: var(--muted); margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pv-leader-prov { color: var(--muted-2); }

  .pv-leader-tags {
    display: flex; gap: 8px; margin-top: 6px;
  }
  .pv-tag {
    font-family: 'DM Mono', monospace;
    font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--muted);
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 6px; border: 1px solid var(--rule);
    background: var(--paper);
  }

  .pv-leader-arrow {
    font-family: 'DM Mono', monospace; font-size: 13px;
    color: var(--rule); transition: all 0.18s ease;
  }

  .pv-empty {
    padding: 40px 0; text-align: center;
    font-family: 'Fraunces', serif; font-style: italic; font-size: 13px;
    color: var(--muted);
  }

  .pv-loadmore {
    width: 100%;
    margin-top: 12px;
    background: var(--paper-2);
    border: 1px dashed var(--rule);
    padding: 12px 14px;
    cursor: pointer;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted-2);
    transition: all 0.15s ease;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .pv-loadmore:hover {
    background: var(--paper);
    border-color: var(--ink);
    border-style: solid;
    color: var(--ink);
  }
  .pv-loadmore-rest {
    font-size: 9px;
    color: var(--muted);
    letter-spacing: 0.1em;
  }

  /* ── Stage ───────────────────────────────────────────────────── */
  .pv-stage {
    position: relative;
    padding: 24px 40px 18px;
    display: flex; flex-direction: column;
    gap: 8px;
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .pv-stage::before {
    content: ''; position: absolute;
    top: 22px; left: 22px; right: 22px; bottom: 12px;
    border: 1px solid var(--rule); pointer-events: none;
  }

  .pv-stage-meta {
    display: flex; justify-content: space-between; align-items: baseline;
    z-index: 3; padding: 0 8px;
    flex-shrink: 0;
  }
  .pv-stage-eyebrow {
    font-family: 'DM Mono', monospace;
    font-size: 10px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--accent);
  }
  .pv-stage-hint {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 12px; color: var(--muted);
  }

  .pv-stage-map {
    position: relative; flex: 1;
    min-height: 0;
    padding: 0 24px;
    z-index: 1;
    animation: pv-fadein 1.1s 0.3s both;
    overflow: hidden;
  }
  .pv-stage-map .map-legend { display: none; }

  /* Pusat (Kabinet) view: scroll the official grid inside the fixed-height stage */
  .pv-pusat-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    z-index: 1;
    padding: 4px 24px 12px;
    animation: pv-fadein 1.1s 0.3s both;
  }

  /* ── Stat strip (above the map) ──────────────────────────────── */
  .pv-strip {
    display: grid; grid-template-columns: 1.4fr 1fr;
    gap: 0;
    border: 1px solid var(--ink);
    background: var(--paper);
    margin: 0 8px;
    flex-shrink: 0;
    animation: pv-rise 0.7s 0.2s cubic-bezier(0.2,0.7,0.3,1) both;
  }
  .pv-strip-cell {
    padding: 10px 22px;
    display: flex; flex-direction: column; gap: 2px;
    border-right: 1px dashed var(--rule);
    min-width: 0;
  }
  .pv-strip-cell:last-child { border-right: none; }

  .pv-strip-label {
    font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--accent);
    display: inline-flex; align-items: center; gap: 8px;
  }

  .pv-strip-value {
    display: flex; align-items: baseline; gap: 8px;
    margin-top: 0;
  }
  .pv-strip-num {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 200;
    font-size: 28px; line-height: 1.05; color: var(--accent);
    letter-spacing: -0.025em;
    font-variant-numeric: oldstyle-nums;
  }
  .pv-strip-pct {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 18px; color: var(--accent); margin-left: -2px;
  }
  .pv-strip-sub {
    font-family: 'Fraunces', serif; font-weight: 300;
    font-size: 12px; color: var(--muted-2);
    border-bottom: 1px dashed var(--accent); padding-bottom: 1px;
  }

  .pv-strip-foot {
    font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.1em; color: var(--muted);
  }

  .pv-strip-bar {
    position: relative; height: 3px;
    background: var(--paper-2); border: 1px solid var(--rule);
    overflow: hidden; margin-top: 3px;
  }
  .pv-strip-bar-fill {
    position: absolute; inset: 0 auto 0 0; background: var(--accent);
    background-image: repeating-linear-gradient(45deg, transparent 0, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px);
    animation: pv-grow 1.6s 0.4s cubic-bezier(0.2,0.7,0.3,1) both;
    transform-origin: left center;
  }
  @keyframes pv-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  /* ── Mode toggle row ─────────────────────────────────────────── */
  .pv-mode-row {
    display: flex; align-items: center; gap: 14px;
    padding: 6px 12px 0;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .pv-mode-prefix {
    font-family: 'DM Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--muted);
  }
  .pv-mode-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .pv-mode-tab {
    font-family: 'DM Mono', monospace; font-size: 10px;
    letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--muted-2);
    background: transparent;
    border: 1px solid var(--rule);
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex; align-items: center; gap: 8px;
    position: relative;
  }
  .pv-mode-tab:hover { color: var(--ink); border-color: var(--ink); }
  .pv-mode-tab-active {
    background: var(--ink); color: var(--paper); border-color: var(--ink);
  }
  .pv-mode-tab-active.pv-mode-tab-mock {
    background: var(--accent); border-color: var(--accent);
  }
  .pv-mode-flag {
    font-size: 7.5px; letter-spacing: 0.18em;
    padding: 1px 4px; border: 1px solid currentColor;
    opacity: 0.7;
  }
  .pv-mode-tab-active .pv-mode-flag { opacity: 0.85; }

  .pv-mode-hint {
    margin-left: auto;
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 12px; color: var(--muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ── Map legend ──────────────────────────────────────────────── */
  .pv-legend {
    display: flex; align-items: center; gap: 16px;
    padding: 0 12px;
    flex-shrink: 0;
    animation: pv-fadein 0.4s both;
  }
  .pv-legend-label {
    font-family: 'DM Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--muted);
    flex-shrink: 0;
  }
  .pv-legend-scale {
    display: flex; align-items: center; gap: 8px;
    flex: 1;
  }
  .pv-legend-end {
    font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .pv-legend-end-danger { color: var(--accent); font-weight: 500; }
  .pv-legend-end-safe { color: var(--muted-2); }

  /* Denyut time legend (pulse = 24h vs static = ≤7d) */
  .pv-legend-denyut { gap: 18px; flex-wrap: wrap; }
  .pv-denyut-key {
    display: inline-flex; align-items: center; gap: 8px;
    font-family: 'DM Mono', monospace; font-size: 9.5px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted-2);
  }
  .pv-denyut-dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--ink); border: 1px solid var(--paper);
    display: inline-block; flex-shrink: 0;
  }
  .pv-denyut-dot-pulse {
    box-shadow: 0 0 0 0 rgba(15,17,23,0.4);
    animation: pv-denyut-pulse 1.6s ease-out infinite;
  }
  @keyframes pv-denyut-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(15,17,23,0.4); }
    100% { box-shadow: 0 0 0 7px rgba(15,17,23,0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pv-denyut-dot-pulse { animation: none; }
  }
  .pv-denyut-note {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 11px; color: var(--muted); margin-left: auto;
  }

  .pv-legend-bar {
    flex: 1; height: 6px;
    border: 1px solid var(--rule);
  }
  .pv-legend-bar-neutral {
    background: linear-gradient(to right, #ece7dc, var(--accent));
  }
  /* Danger gradient: red on the LEFT (low % = bad), paper on the RIGHT */
  .pv-legend-bar-danger {
    background: linear-gradient(to right, var(--accent), #ece7dc);
    background-image:
      linear-gradient(to right, var(--accent), #ece7dc),
      repeating-linear-gradient(45deg, transparent 0, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px);
    background-blend-mode: multiply;
  }

  /* ── Mock stamp on map ───────────────────────────────────────── */
  .pv-mock-stamp {
    position: absolute; top: 8px; left: 32px;
    font-family: 'DM Mono', monospace;
    font-size: 9px; letter-spacing: 0.22em;
    background: var(--accent); color: var(--paper);
    padding: 4px 10px;
    transform: rotate(-1deg);
    z-index: 5;
    animation: pv-rise 0.5s both;
    box-shadow: 2px 2px 0 var(--ink);
  }

  /* ── Feature strip (compact, below map) ──────────────────────── */
  .pv-fstrip {
    position: relative;
    display: flex; align-items: center; gap: 18px;
    padding: 10px 18px;
    margin: 0 8px;
    border: 1px solid var(--ink);
    background: var(--paper-2);
    flex-shrink: 0;
    animation: pv-rise 0.8s 0.6s cubic-bezier(0.2,0.7,0.3,1) both;
  }

  .pv-fstrip-stamp {
    background: var(--accent); color: var(--paper);
    font-family: 'DM Mono', monospace;
    font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
    padding: 4px 10px;
    transform: rotate(-1deg);
    flex-shrink: 0;
  }

  .pv-fstrip-cell {
    display: flex; flex-direction: column; gap: 2px;
    min-width: 0;
  }
  .pv-fstrip-label {
    font-family: 'DM Mono', monospace; font-size: 9px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--muted);
  }
  .pv-fstrip-val {
    font-family: 'Fraunces', serif; font-weight: 300;
    font-size: 16px; color: var(--ink); line-height: 1.1;
    white-space: nowrap;
  }
  .pv-fstrip-val em {
    font-style: italic; color: var(--accent); font-weight: 400; font-size: 22px;
  }
  .pv-fstrip-val-text { font-size: 14px; }

  .pv-fstrip-track {
    display: flex; align-items: center; gap: 5px;
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 13px; color: var(--muted-2);
    white-space: nowrap;
  }
  .pv-fstrip-track em { margin-left: 6px; font-size: 12px; }

  .pv-fstrip-divider {
    width: 1px; align-self: stretch; background: var(--rule);
    margin: 4px 0;
  }

  .pv-fstrip-note {
    margin-left: auto;
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 300;
    font-size: 11px; color: var(--muted);
    white-space: nowrap;
  }

  .pv-track-dot {
    display: inline-block;
    width: 9px; height: 9px; border-radius: 50%;
    border: 1px solid var(--rule); background: transparent;
  }
  .pv-track-dot.pv-dot-ok { background: var(--accent); border-color: var(--accent); }

  /* ── Bottom ticker ───────────────────────────────────────────── */
  .pv-ticker {
    border-top: 1.5px solid var(--ink); background: var(--ink);
    color: var(--paper); overflow: hidden; position: relative;
  }
  .pv-ticker::before, .pv-ticker::after {
    content: ''; position: absolute; top: 0; bottom: 0; width: 80px; z-index: 2; pointer-events: none;
  }
  .pv-ticker::before { left: 0; background: linear-gradient(90deg, var(--ink), transparent); }
  .pv-ticker::after { right: 0; background: linear-gradient(270deg, var(--ink), transparent); }
  .pv-ticker-track { padding: 12px 0; overflow: hidden; }
  .pv-ticker-inner {
    display: inline-flex; gap: 56px; white-space: nowrap;
    animation: pv-marquee 60s linear infinite; will-change: transform;
  }
  .pv-ticker-item {
    font-family: 'DM Mono', monospace; font-size: 10.5px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--paper); display: inline-flex; align-items: center; gap: 14px;
  }
  .pv-ticker-bullet { color: var(--accent); font-size: 8px; }
  @keyframes pv-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

  @keyframes pv-fadein { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pv-rise   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

  /* ── View toggle row (Daerah / Pusat) ───────────────────────── */
  .pv-view-row {
    display: flex; align-items: center; gap: 14px;
    padding: 0 12px 4px;
    flex-shrink: 0;
    border-bottom: 1px dashed var(--rule);
    margin-bottom: 4px;
  }
`
