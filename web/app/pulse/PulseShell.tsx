'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { HotspotEventWithPejabat, ProvinceHotspotCount, HotspotTimeFilter, ProvinceCount } from '@/lib/queries'
import HotspotMap from '@/app/_components/HotspotMap'
import HotspotSidebar from '@/app/_components/HotspotSidebar'
import HotspotModal from '@/app/_components/HotspotModal'

const TIME_FILTERS: { key: HotspotTimeFilter; label: string }[] = [
  { key: '24h', label: 'Hari Ini' },
  { key: '7d', label: '7 Hari' },
  { key: '30d', label: '30 Hari' },
  { key: '90d', label: '90 Hari' },
  { key: 'all', label: 'Semua' },
]

interface Props {
  initialEvents: HotspotEventWithPejabat[]
  initialProvinceCounts: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
}

export default function PulseShell({ initialEvents, initialProvinceCounts, allProvinces }: Props) {
  const [timeFilter, setTimeFilter] = useState<HotspotTimeFilter>('24h')
  const [events, setEvents] = useState(initialEvents)
  const [provinceCounts, setProvinceCounts] = useState(initialProvinceCounts)
  const [selectedEvent, setSelectedEvent] = useState<HotspotEventWithPejabat | null>(null)
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function changeFilter(f: HotspotTimeFilter) {
    if (f === timeFilter) return
    setTimeFilter(f)
    setLoading(true)
    try {
      const resp = await fetch(`/api/hotspot?filter=${f}`)
      const data = await resp.json()
      setEvents(data.events ?? [])
      setProvinceCounts(data.provinceCounts ?? [])
    } finally {
      setLoading(false)
    }
  }

  const totalEvents = events.length

  return (
    <div className="pulse-root">
      <style>{styles}</style>

      <header className="pulse-header">
        <nav className="pulse-nav">
          <Link href="/" className="pulse-back">← Beranda</Link>
          <Link href="/pejabat" className="pulse-back">Direktori</Link>
        </nav>
        <h1 className="pulse-title">Denyut Demokrasi</h1>
        <p className="pulse-sub">
          Pulsa harian percakapan pejabat publik Indonesia — terkurasi otomatis dari berita.
        </p>
        <div className="pulse-filters" role="tablist">
          {TIME_FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={timeFilter === f.key}
              className={`pulse-filter ${timeFilter === f.key ? 'active' : ''}`}
              onClick={() => changeFilter(f.key)}
              disabled={loading}
            >
              {f.label}
            </button>
          ))}
          <span className="pulse-count">{loading ? '…' : `${totalEvents} kejadian`}</span>
        </div>
      </header>

      <div className="pulse-body">
        <main className="pulse-map">
          <HotspotMap
            events={events}
            events24h={timeFilter === '24h' ? events : initialEvents}
            provinceCounts={provinceCounts}
            allProvinces={allProvinces}
            onProvinceClick={(p) => setSelectedProvince(p === selectedProvince ? null : p)}
            selected={selectedProvince}
          />
        </main>
        <HotspotSidebar
          events={events}
          onEventClick={setSelectedEvent}
          loading={loading}
          filterProvince={selectedProvince}
          onClearProvince={() => setSelectedProvince(null)}
        />
      </div>

      <HotspotModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  )
}

const styles = `
.pulse-root { min-height: 100vh; background: #f5f1e6; color: #0f1117; display: flex; flex-direction: column; }
.pulse-header { padding: 1.25rem 1.5rem .5rem; border-bottom: 1px solid #e2dccb; background: #fbf7ee; }
.pulse-nav { display: flex; gap: 1.25rem; font-family: 'DM Mono', monospace; font-size: .75rem; margin-bottom: .5rem; }
.pulse-back { color: #6b6859; text-decoration: none; }
.pulse-back:hover { color: #0f1117; }
.pulse-title { font-family: 'Fraunces', serif; font-size: 2rem; margin: 0 0 .25rem; letter-spacing: -0.01em; }
.pulse-sub { font-size: .92rem; color: #4a4a4a; margin: 0 0 .75rem; max-width: 60ch; }
.pulse-filters { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
.pulse-filter { padding: .35rem .8rem; font-family: 'DM Mono', monospace; font-size: .75rem; background: transparent; color: #0f1117; border: 1px solid #d4cfc5; border-radius: 3px; cursor: pointer; }
.pulse-filter:hover:not(:disabled) { background: #ece7dc; }
.pulse-filter.active { background: #0f1117; color: #fbf7ee; border-color: #0f1117; }
.pulse-filter:disabled { opacity: .5; cursor: wait; }
.pulse-count { margin-left: auto; font-family: 'DM Mono', monospace; font-size: .75rem; color: #6b6859; }
.pulse-body { flex: 1; display: grid; grid-template-columns: 1fr 380px; min-height: 0; }
.pulse-map { padding: 1rem 1.5rem; overflow: visible; }
@media (max-width: 900px) {
  .pulse-body { grid-template-columns: 1fr; }
}
`
