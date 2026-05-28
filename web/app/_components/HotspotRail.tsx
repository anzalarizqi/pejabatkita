'use client'

import { useMemo, useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import type { HotspotEventWithPejabat } from '@/lib/queries'
import HotspotModal from './HotspotModal'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'baru saja'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}j`
  const d = Math.round(hr / 24)
  if (d < 7) return `${d}h`
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
}

interface Props {
  events24h: HotspotEventWithPejabat[]
  events7d: HotspotEventWithPejabat[]
  selectedProvince: string | null
  onProvinceClear: () => void
}

export default function HotspotRail({ events24h, events7d, selectedProvince, onProvinceClear }: Props) {
  // Fallback ladder: 24h → 7d → empty
  const usingFallback = events24h.length === 0 && events7d.length > 0
  const baseEvents = events24h.length > 0 ? events24h : events7d

  const filtered = useMemo(() => {
    if (!selectedProvince) return baseEvents
    return baseEvents.filter((e) => e.provinsi_nama === selectedProvince)
  }, [baseEvents, selectedProvince])

  const visible = filtered // render all; .hsr-list scrolls
  const [openEvent, setOpenEvent] = useState<HotspotEventWithPejabat | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // When user picks a province on the map, scroll rail to top
  useEffect(() => {
    if (selectedProvince && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [selectedProvince])

  return (
    <>
      <style>{styles}</style>
      <aside className="hsr">
        <header className="hsr-head">
          <div className="hsr-title-row">
            <h2 className="hsr-title">Denyut</h2>
            <span className="hsr-pulse-icon" aria-hidden />
          </div>
          <p className="hsr-sub">
            {selectedProvince
              ? <>Filter: <strong>{selectedProvince}</strong> · <button className="hsr-clear" onClick={onProvinceClear}>×</button></>
              : usingFallback
              ? '7 hari terakhir'
              : '24 jam terakhir'}
          </p>
        </header>

        <div className="hsr-list" ref={listRef}>
          {visible.length === 0 ? (
            <div className="hsr-empty">
              {selectedProvince
                ? `Tidak ada kejadian di ${selectedProvince}.`
                : 'Belum ada kejadian.'}
              <Link href="/pulse" className="hsr-empty-link">Lihat arsip →</Link>
            </div>
          ) : (
            <ol className="hsr-cards">
              {visible.map((e, idx) => (
                <li key={e.event_id}>
                  <button
                    className="hsr-card"
                    onClick={() => setOpenEvent(e)}
                  >
                    <span className="hsr-index">{String(idx + 1).padStart(2, '0')}</span>
                    <span
                      className="hsr-dot"
                      style={{ background: KATEGORI_COLOR[e.kategori ?? 'lainnya'] ?? KATEGORI_COLOR.lainnya }}
                      aria-hidden
                    />
                    <div className="hsr-body">
                      <div className="hsr-judul">{e.judul}</div>
                      <div className="hsr-meta">
                        <span className="hsr-kat">{e.kategori ?? 'lainnya'}</span>
                        {e.provinsi_nama && <span>{e.provinsi_nama}</span>}
                        <span className="hsr-time">{relativeTime(e.crawled_at)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="hsr-footer">
          <Link href="/pulse" className="hsr-cta">
            <span>Lihat semua kejadian</span>
            <span aria-hidden className="hsr-cta-arrow">→</span>
          </Link>
        </footer>
      </aside>

      <HotspotModal event={openEvent} onClose={() => setOpenEvent(null)} />
    </>
  )
}

const styles = `
  .hsr {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #fbf7ee;
    border-left: 1px solid #d4cfc5;
    font-family: 'DM Mono', monospace;
  }
  .hsr-head {
    padding: 18px 20px 14px;
    border-bottom: 1px solid #e2dccb;
    background:
      linear-gradient(135deg, transparent 0%, transparent 49.5%, #e2dccb 49.5%, #e2dccb 50.5%, transparent 50.5%) 0 0/4px 4px,
      #fbf7ee;
  }
  .hsr-title-row { display: flex; align-items: center; gap: 10px; }
  .hsr-title {
    font-family: 'Fraunces', serif;
    font-weight: 400;
    font-size: 22px;
    letter-spacing: -0.01em;
    color: #0f1117;
    margin: 0;
  }
  .hsr-pulse-icon {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #c0392b;
    box-shadow: 0 0 0 0 rgba(192,57,43,0.5);
    animation: hsr-beat 1.6s ease-out infinite;
  }
  @keyframes hsr-beat {
    0%   { box-shadow: 0 0 0 0 rgba(192,57,43,0.45); }
    70%  { box-shadow: 0 0 0 10px rgba(192,57,43,0); }
    100% { box-shadow: 0 0 0 0 rgba(192,57,43,0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .hsr-pulse-icon { animation: none; }
  }
  .hsr-sub {
    font-size: 10px;
    color: #6b6859;
    margin-top: 6px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .hsr-sub strong { color: #0f1117; font-weight: 500; text-transform: none; }
  .hsr-clear {
    background: none;
    border: none;
    color: #c0392b;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    margin-left: 2px;
    padding: 0 4px;
  }
  .hsr-clear:hover { color: #0f1117; }

  .hsr-list {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .hsr-cards {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    counter-reset: hsr;
  }
  .hsr-cards li { display: block; }
  .hsr-card {
    display: grid;
    grid-template-columns: 24px 8px 1fr;
    gap: 10px;
    align-items: start;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-bottom: 1px dashed #e2dccb;
    padding: 14px 18px;
    cursor: pointer;
    transition: background 0.15s;
    font-family: inherit;
    color: #0f1117;
  }
  .hsr-card:hover { background: #f3eedd; }
  .hsr-card:hover .hsr-judul { color: #c0392b; }

  .hsr-index {
    font-size: 10px;
    color: #b0a99a;
    padding-top: 2px;
    letter-spacing: 0.06em;
  }
  .hsr-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-top: 6px;
    box-shadow: 0 0 0 2px #fbf7ee, 0 0 0 3px currentColor;
  }
  .hsr-body { min-width: 0; }
  .hsr-judul {
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    line-height: 1.3;
    color: #0f1117;
    transition: color 0.15s;
    /* clamp to 3 lines */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .hsr-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 6px;
    font-size: 9.5px;
    color: #8a857c;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hsr-meta > span:not(:last-child)::after {
    content: '·';
    margin-left: 6px;
    color: #c5bfb0;
  }
  .hsr-kat { color: #6b6859; font-weight: 500; }
  .hsr-time { color: #b0a99a; }

  .hsr-empty {
    padding: 36px 20px;
    text-align: center;
    font-size: 12px;
    color: #8a857c;
    font-style: italic;
    line-height: 1.6;
  }
  .hsr-empty-link {
    display: inline-block;
    margin-top: 12px;
    font-style: normal;
    color: #0f1117;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-decoration: none;
    border-bottom: 1px solid #c0392b;
    padding-bottom: 2px;
  }
  .hsr-empty-link:hover { color: #c0392b; }

  .hsr-more-note {
    text-align: center;
    padding: 8px;
    font-size: 9.5px;
    color: #b0a99a;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-top: 1px dashed #e2dccb;
  }

  .hsr-footer {
    border-top: 1px solid #d4cfc5;
    background: #0f1117;
  }
  .hsr-cta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    color: #f5f1ea;
    text-decoration: none;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition: background 0.15s;
  }
  .hsr-cta:hover { background: #1a1d2a; color: #c0392b; }
  .hsr-cta-arrow {
    font-size: 14px;
    transition: transform 0.2s;
  }
  .hsr-cta:hover .hsr-cta-arrow { transform: translateX(4px); }
`
