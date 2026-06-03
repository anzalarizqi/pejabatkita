'use client'

import { useMemo, useState } from 'react'
import type { HotspotEventWithPejabat } from '@/lib/queries'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'baru saja'
  if (min < 60) return `${min} mnt`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} jam`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day} hari`
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

interface Props {
  events: HotspotEventWithPejabat[]
  onEventClick: (event: HotspotEventWithPejabat) => void
  loading: boolean
  filterProvince: string | null
  onClearProvince: () => void
}

export default function HotspotSidebar({ events, onEventClick, loading, filterProvince, onClearProvince }: Props) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return events.filter((e) => {
      if (filterProvince && e.provinsi_nama !== filterProvince) return false
      if (!needle) return true
      const hay = `${e.judul} ${e.ringkasan ?? ''} ${e.pejabat_nama ?? ''} ${e.provinsi_nama ?? ''}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [events, q, filterProvince])

  return (
    <aside className="pulse-side">
      <style>{styles}</style>
      <div className="pulse-side-head">
        <input
          type="search"
          placeholder="Cari berita, pejabat, daerah…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pulse-search"
        />
        {filterProvince && (
          <button className="pulse-chip" onClick={onClearProvince}>
            {filterProvince} <span aria-hidden>×</span>
          </button>
        )}
      </div>
      <div className="pulse-side-meta">
        {loading ? 'Memuat…' : `${filtered.length} kejadian`}
      </div>
      <ul className="pulse-list">
        {filtered.map((e) => (
          <li key={e.event_id}>
            <button className="pulse-card" onClick={() => onEventClick(e)}>
              <div className="pulse-card-top">
                <span
                  className="pulse-cat"
                  style={{ background: KATEGORI_COLOR[e.kategori ?? 'lainnya'] ?? KATEGORI_COLOR.lainnya }}
                >
                  {e.kategori ?? 'lainnya'}
                </span>
                <span className="pulse-time">{relativeTime(e.crawled_at)}</span>
              </div>
              <div className="pulse-judul">{e.judul}</div>
              <div className="pulse-card-meta">
                {e.pejabat_nama && <span>{e.pejabat_nama}</span>}
                {e.provinsi_nama && <span> · {e.provinsi_nama}</span>}
                {e.source_count > 1
                  ? <span> · {e.source_count} sumber</span>
                  : e.sumber_nama && <span> · {e.sumber_nama}</span>}
              </div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && !loading && (
          <li className="pulse-empty">Belum ada kejadian.</li>
        )}
      </ul>
    </aside>
  )
}

const styles = `
.pulse-side { display: flex; flex-direction: column; min-height: 0; background: #fbf7ee; border-left: 1px solid #e2dccb; }
.pulse-side-head { display: flex; gap: .5rem; align-items: center; padding: .75rem; border-bottom: 1px solid #e2dccb; }
.pulse-search { flex: 1; padding: .5rem .6rem; font: inherit; font-size: .9rem; background: #fff; border: 1px solid #d4cfc5; border-radius: 4px; }
.pulse-chip { padding: .3rem .5rem; font-size: .8rem; background: #0f1117; color: #fbf7ee; border: none; border-radius: 4px; cursor: pointer; font-family: 'DM Mono', monospace; }
.pulse-side-meta { padding: .5rem .75rem; font-family: 'DM Mono', monospace; font-size: .75rem; color: #6b6859; }
.pulse-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.pulse-card { display: block; width: 100%; text-align: left; padding: .8rem .75rem; background: transparent; border: none; border-bottom: 1px solid #e9e3d3; cursor: pointer; }
.pulse-card:hover { background: #f3eedd; }
.pulse-card-top { display: flex; justify-content: space-between; align-items: center; font-family: 'DM Mono', monospace; font-size: .7rem; margin-bottom: .35rem; }
.pulse-cat { padding: .15rem .5rem; color: #fff; border-radius: 2px; font-weight: 500; text-transform: lowercase; letter-spacing: .02em; }
.pulse-time { color: #8a8678; }
.pulse-judul { font-family: 'Fraunces', serif; font-size: 1rem; line-height: 1.3; color: #0f1117; margin-bottom: .35rem; }
.pulse-card-meta { font-family: 'DM Mono', monospace; font-size: .7rem; color: #6b6859; }
.pulse-empty { padding: 1.5rem .75rem; color: #8a8678; font-style: italic; text-align: center; }
`
