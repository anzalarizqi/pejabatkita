'use client'

import { useState } from 'react'
import { Wilayah } from '@/lib/types'

interface ProvinceRow {
  wilayah: Wilayah
  children: Wilayah[]
  actual: number
  expected: number
  pct: number
  avgConf: number | null
  needsReview: number
  lastScrapedAt: string | null
  status: 'green' | 'yellow' | 'gray'
  pendingFlags: number
}

function ProgressBar({ pct, status }: { pct: number; status: 'green' | 'yellow' | 'gray' }) {
  const color = status === 'green' ? '#27ae60' : status === 'yellow' ? '#f39c12' : '#3a3e4a'
  return (
    <div style={{
      height: 6,
      background: '#2a2e3a',
      borderRadius: 3,
      overflow: 'hidden',
      width: '100%',
      minWidth: 80,
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: color,
        borderRadius: 3,
        transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
      }} />
    </div>
  )
}

function StatusDot({ status }: { status: 'green' | 'yellow' | 'gray' }) {
  const color = status === 'green' ? '#27ae60' : status === 'yellow' ? '#f39c12' : '#3a3e4a'
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }} />
  )
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ProvinceRow({ row }: { row: ProvinceRow }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="prov-block">
      <button
        className="prov-row"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <StatusDot status={row.status} />
        <span className="prov-name">{row.wilayah.nama}</span>
        <div className="prov-bar">
          <ProgressBar pct={row.pct} status={row.status} />
        </div>
        <span className="prov-pct">{row.pct}%</span>
        <span className="prov-meta">{formatDate(row.lastScrapedAt)}</span>
        <span className="prov-meta">{row.avgConf !== null ? row.avgConf.toFixed(2) : '—'}</span>
        <span className="prov-flags">
          {row.needsReview > 0 ? <span className="flag-badge">⚑ {row.needsReview}</span> : null}
        </span>
        <span className="prov-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
      </button>

      {open && row.children.length > 0 && (
        <div className="child-list">
          {row.children.map((c) => (
            <div key={c.id} className="child-row">
              <span className="child-tree">└</span>
              <span className="child-name">{c.nama}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardClient({ rows }: { rows: ProvinceRow[] }) {
  const total = rows.length
  const scraped = rows.filter((r) => r.actual > 0).length
  const avgPct = total > 0 ? Math.round(rows.reduce((s, r) => s + r.pct, 0) / total) : 0
  const pendingTotal = rows.reduce((s, r) => s + r.needsReview, 0)

  return (
    <>
      <style>{`
        .dash-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 36px;
        }

        .stat-card {
          background: #0f1117;
          padding: 20px 24px;
          position: relative;
        }

        .stat-card::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent, #c0392b);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.4s ease;
        }

        .stat-card:hover::after { transform: scaleX(1); }

        .stat-num {
          font-family: 'Fraunces', serif;
          font-size: 36px;
          font-weight: 300;
          color: #f5f1ea;
          line-height: 1;
          margin-bottom: 6px;
        }

        .stat-label {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #5a5e6a;
        }

        .table-header {
          display: grid;
          grid-template-columns: 8px 200px 1fr 50px 120px 60px 80px 20px;
          gap: 12px;
          padding: 10px 16px;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #3a3e4a;
          border-bottom: 1px solid #d4cfc5;
          margin-bottom: 4px;
          align-items: center;
        }

        .prov-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .prov-block {
          border: 1px solid transparent;
          transition: border-color 0.15s;
        }

        .prov-block:hover {
          border-color: #d4cfc5;
        }

        .prov-row {
          width: 100%;
          display: grid;
          grid-template-columns: 8px 200px 1fr 50px 120px 60px 80px 20px;
          gap: 12px;
          padding: 12px 16px;
          background: #f5f1ea;
          border: none;
          cursor: pointer;
          text-align: left;
          align-items: center;
          transition: background 0.15s;
          font-family: 'DM Mono', monospace;
        }

        .prov-row:hover {
          background: #ede9e1;
        }

        .prov-name {
          font-size: 12px;
          color: #0f1117;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .prov-pct {
          font-size: 12px;
          font-weight: 500;
          color: #0f1117;
          text-align: right;
        }

        .prov-meta {
          font-size: 10px;
          color: #8a857c;
          white-space: nowrap;
        }

        .prov-flags {
          font-size: 10px;
        }

        .flag-badge {
          background: #fff3cd;
          color: #856404;
          padding: 2px 6px;
          font-size: 9px;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .prov-chevron {
          font-size: 16px;
          color: #8a857c;
          transition: transform 0.2s;
          display: inline-block;
          text-align: center;
        }

        .prov-bar {
          display: flex;
          align-items: center;
        }

        .child-list {
          background: #f0ece4;
          border-top: 1px solid #d4cfc5;
          padding: 8px 0;
        }

        .child-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 16px 5px 32px;
          font-size: 11px;
          color: #5a5e6a;
        }

        .child-tree {
          color: #d4cfc5;
          flex-shrink: 0;
        }

        .child-name {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .section-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 20px;
        }
      `}</style>

      {/* Summary stats */}
      <div className="dash-stats">
        <div className="stat-card">
          <div className="stat-num">{total}</div>
          <div className="stat-label">Provinsi Total</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{scraped}</div>
          <div className="stat-label">Sudah Di-scrape</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{avgPct}%</div>
          <div className="stat-label">Rata-rata Kelengkapan</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{pendingTotal}</div>
          <div className="stat-label">Perlu Ditinjau</div>
        </div>
      </div>

      <h2 className="section-title">Cakupan per Provinsi</h2>

      <div className="table-header">
        <span />
        <span>Provinsi</span>
        <span>Progress</span>
        <span>%</span>
        <span>Terakhir Scrape</span>
        <span>Conf.</span>
        <span>Review</span>
        <span />
      </div>

      <div className="prov-list">
        {rows.map((row) => (
          <ProvinceRow key={row.wilayah.id} row={row} />
        ))}
        {rows.length === 0 && (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#8a857c', fontSize: 12 }}>
            Belum ada data wilayah. Tambahkan seed data wilayah ke Supabase terlebih dahulu.
          </div>
        )}
      </div>
    </>
  )
}
