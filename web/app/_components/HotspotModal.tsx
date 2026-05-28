'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import type { HotspotEventWithPejabat } from '@/lib/queries'

const KATEGORI_COLOR: Record<string, string> = {
  korupsi: '#c0392b',
  demonstrasi: '#e67e22',
  pernyataan: '#f39c12',
  kebijakan: '#8e44ad',
  kritik: '#2980b9',
  lainnya: '#7f8c8d',
}

interface Props {
  event: HotspotEventWithPejabat | null
  onClose: () => void
}

export default function HotspotModal({ event, onClose }: Props) {
  useEffect(() => {
    if (!event) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, onClose])

  if (!event) return null

  const ts = new Date(event.crawled_at).toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="pulse-overlay" onClick={onClose}>
      <style>{styles}</style>
      <div className="pulse-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pulse-close" onClick={onClose} aria-label="Tutup">×</button>
        <div className="pulse-modal-top">
          <span
            className="pulse-modal-cat"
            style={{ background: KATEGORI_COLOR[event.kategori ?? 'lainnya'] ?? KATEGORI_COLOR.lainnya }}
          >
            {event.kategori ?? 'lainnya'}
          </span>
          <span className="pulse-modal-time">{ts}</span>
        </div>
        <h2 className="pulse-modal-judul">{event.judul}</h2>
        {event.ringkasan && <p className="pulse-modal-ring">{event.ringkasan}</p>}
        <dl className="pulse-modal-meta">
          {event.pejabat_nama && (
            <>
              <dt>Pejabat</dt>
              <dd>
                {event.pejabat_id
                  ? <Link href={`/${event.pejabat_id}`}>{event.pejabat_nama}</Link>
                  : event.pejabat_nama}
              </dd>
            </>
          )}
          {event.provinsi_nama && (<><dt>Daerah</dt><dd>{event.provinsi_nama}</dd></>)}
          {event.sumber_nama && (<><dt>Sumber</dt><dd>{event.sumber_nama}</dd></>)}
        </dl>
        {event.url_sumber && (
          <a href={event.url_sumber} target="_blank" rel="noopener noreferrer" className="pulse-modal-link">
            Baca selengkapnya →
          </a>
        )}
      </div>
    </div>
  )
}

const styles = `
.pulse-overlay { position: fixed; inset: 0; background: rgba(15,17,23,.5); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
.pulse-modal { position: relative; max-width: 640px; width: 100%; max-height: 90vh; overflow-y: auto; background: #fbf7ee; border: 1px solid #d4cfc5; border-radius: 6px; padding: 1.75rem 1.5rem; box-shadow: 0 12px 48px rgba(0,0,0,.3); }
.pulse-close { position: absolute; top: .5rem; right: .75rem; background: none; border: none; font-size: 1.6rem; line-height: 1; cursor: pointer; color: #6b6859; }
.pulse-close:hover { color: #0f1117; }
.pulse-modal-top { display: flex; justify-content: space-between; align-items: center; font-family: 'DM Mono', monospace; font-size: .75rem; margin-bottom: .75rem; }
.pulse-modal-cat { padding: .2rem .55rem; color: #fff; border-radius: 2px; }
.pulse-modal-time { color: #6b6859; }
.pulse-modal-judul { font-family: 'Fraunces', serif; font-size: 1.6rem; line-height: 1.25; margin: 0 0 .75rem; color: #0f1117; }
.pulse-modal-ring { font-size: .98rem; line-height: 1.55; color: #2d2d2d; margin: 0 0 1rem; }
.pulse-modal-meta { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .8rem; font-family: 'DM Mono', monospace; font-size: .8rem; margin: 0 0 1.25rem; padding-top: .75rem; border-top: 1px solid #e2dccb; }
.pulse-modal-meta dt { color: #6b6859; }
.pulse-modal-meta dd { margin: 0; color: #0f1117; }
.pulse-modal-meta a { color: #0f1117; text-decoration: underline; }
.pulse-modal-link { display: inline-block; padding: .55rem 1rem; background: #0f1117; color: #fbf7ee; text-decoration: none; border-radius: 3px; font-family: 'DM Mono', monospace; font-size: .85rem; }
.pulse-modal-link:hover { background: #c0392b; }
`
