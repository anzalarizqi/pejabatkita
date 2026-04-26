'use client'

import { useState } from 'react'
import { FlagWithPejabat } from '@/lib/types'

interface Props {
  flag: FlagWithPejabat
  onResolved: (id: string) => void
}

export default function FlagCard({ flag, onResolved }: Props) {
  const [busy, setBusy] = useState<'dismiss' | 'rescrape' | null>(null)
  const [rescrapeLog, setRescrapeLog] = useState('')

  const pejabat = flag.pejabat
  const jabatanAktif = flag.jabatan?.find((j) => j.status === 'aktif') ?? flag.jabatan?.[0]

  async function handleDismiss() {
    setBusy('dismiss')
    await fetch('/api/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: flag.id, status: 'dismissed' }),
    })
    onResolved(flag.id)
  }

  async function handleRescrape() {
    if (!pejabat?.id) return
    setBusy('rescrape')
    setRescrapeLog('Menjalankan scraper...')
    const res = await fetch('/api/rescrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pejabat_id: pejabat.id }),
    })
    const data = await res.json()
    setRescrapeLog(
      res.ok
        ? `Selesai. ${data.stdout?.slice(0, 200) ?? ''}`
        : `Gagal: ${data.error ?? data.stderr ?? ''}`
    )
    setBusy(null)
  }

  return (
    <>
      <style>{`
        .flag-card {
          background: #f5f1ea;
          border: 1px solid #d4cfc5;
          padding: 20px 24px;
          transition: border-color 0.15s;
        }

        .flag-card:hover {
          border-color: #8a857c;
        }

        .flag-top {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 14px;
        }

        .flag-type-badge {
          font-size: 8px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 3px 8px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .flag-type-system {
          background: #e3f2fd;
          color: #1565c0;
        }

        .flag-type-public {
          background: #fce4ec;
          color: #880e4f;
        }

        .flag-pejabat {
          flex: 1;
        }

        .flag-nama {
          font-size: 14px;
          color: #0f1117;
          font-weight: 500;
          margin-bottom: 3px;
        }

        .flag-jabatan {
          font-size: 11px;
          color: #8a857c;
        }

        .flag-date {
          font-size: 10px;
          color: #d4cfc5;
          flex-shrink: 0;
        }

        .flag-reason {
          font-size: 12px;
          color: #3a3e4a;
          line-height: 1.6;
          border-left: 2px solid #d4cfc5;
          padding-left: 12px;
          margin-bottom: 14px;
        }

        .flag-source {
          font-size: 10px;
          color: #8a857c;
          margin-bottom: 14px;
        }

        .flag-source a {
          color: #1565c0;
          text-decoration: none;
        }

        .flag-source a:hover {
          text-decoration: underline;
        }

        .flag-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .action-btn {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 8px 14px;
          border: 1px solid;
          cursor: pointer;
          background: none;
          transition: all 0.15s;
        }

        .action-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-dismiss {
          border-color: #d4cfc5;
          color: #8a857c;
        }

        .btn-dismiss:hover:not(:disabled) {
          border-color: #c0392b;
          color: #c0392b;
        }

        .btn-rescrape {
          border-color: #d4cfc5;
          color: #5a5e6a;
        }

        .btn-rescrape:hover:not(:disabled) {
          border-color: #1565c0;
          color: #1565c0;
        }

        .rescrape-log {
          font-size: 10px;
          color: #5a5e6a;
          margin-top: 10px;
          padding: 8px 12px;
          background: #0f1117;
          color: #5a5e6a;
          letter-spacing: 0.02em;
          max-height: 80px;
          overflow-y: auto;
          line-height: 1.6;
        }
      `}</style>

      <div className="flag-card">
        <div className="flag-top">
          <span className={`flag-type-badge flag-type-${flag.type}`}>{flag.type}</span>

          <div className="flag-pejabat">
            <div className="flag-nama">{pejabat?.nama_lengkap ?? '(pejabat tidak ditemukan)'}</div>
            <div className="flag-jabatan">
              {jabatanAktif?.posisi ?? '—'}
              {jabatanAktif?.wilayah?.nama ? ` · ${jabatanAktif.wilayah.nama}` : ''}
            </div>
          </div>

          <div className="flag-date">
            {new Date(flag.created_at).toLocaleDateString('id-ID', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </div>
        </div>

        <div className="flag-reason">{flag.reason}</div>

        {flag.source_url && (
          <div className="flag-source">
            Sumber:{' '}
            <a href={flag.source_url} target="_blank" rel="noopener noreferrer">
              {flag.source_url}
            </a>
          </div>
        )}

        <div className="flag-actions">
          <button
            className="action-btn btn-dismiss"
            onClick={handleDismiss}
            disabled={busy !== null}
          >
            {busy === 'dismiss' ? '...' : 'Abaikan'}
          </button>
          {pejabat?.id && (
            <button
              className="action-btn btn-rescrape"
              onClick={handleRescrape}
              disabled={busy !== null}
            >
              {busy === 'rescrape' ? '⟳ Berjalan...' : '⟳ Re-scrape'}
            </button>
          )}
        </div>

        {rescrapeLog && <div className="rescrape-log">{rescrapeLog}</div>}
        {process.env.NEXT_PUBLIC_IS_VERCEL === 'true' && (
          <div style={{ fontSize: 10, color: '#8a857c', marginTop: 8, letterSpacing: '0.02em' }}>
            Re-scrape hanya tersedia saat dijalankan secara lokal.
          </div>
        )}
      </div>
    </>
  )
}
