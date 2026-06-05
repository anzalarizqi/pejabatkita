'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { KeranjangKoruptorRow } from '@/lib/types'

// Indonesian short-month formatter — no heavy date lib needed
const ID_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function formatTanggal(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${ID_MONTHS[m - 1] ?? '?'} ${y}`
}

type StatusFilter = 'semua' | 'tersangka' | 'terdakwa' | 'terpidana'
type LevelFilter  = 'semua' | 'pusat' | 'daerah'

const STATUS_LABELS: Record<'tersangka' | 'terdakwa' | 'terpidana', string> = {
  tersangka:  'Tersangka',
  terdakwa:   'Terdakwa',
  terpidana:  'Terpidana',
}

const STATUS_CHIP_CLASS: Record<'tersangka' | 'terdakwa' | 'terpidana', string> = {
  tersangka:  'kk-chip kk-chip-tersangka',
  terdakwa:   'kk-chip kk-chip-terdakwa',
  terpidana:  'kk-chip kk-chip-terpidana',
}

interface Props {
  rows: KeranjangKoruptorRow[]
}

export default function KeranjangShell({ rows }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('semua')
  const [levelFilter,  setLevelFilter]  = useState<LevelFilter>('semua')
  const [nameQuery,    setNameQuery]    = useState('')

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== 'semua' && r.status !== statusFilter) return false
      if (levelFilter  !== 'semua' && r.level  !== levelFilter)  return false
      if (q && !r.nama.toLowerCase().includes(q))                 return false
      return true
    })
    // preserve server-supplied tanggal_kasus desc order — do NOT re-sort
  }, [rows, statusFilter, levelFilter, nameQuery])

  return (
    <div className="kk-root">
      <style>{styles}</style>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="kk-header">
        <nav className="kk-nav">
          <Link href="/"        className="kk-back">← Beranda</Link>
          <Link href="/pejabat" className="kk-back">Direktori</Link>
        </nav>

        <div className="kk-title-row">
          <div>
            <h1 className="kk-title">Keranjang Koruptor</h1>
            <p className="kk-sub">
              Pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024
            </p>
          </div>
          <span className="kk-counter">{filtered.length} pejabat</span>
        </div>

        {/* ── Filters ─────────────────────────────────────────────── */}
        <div className="kk-filters" role="group" aria-label="Filter">
          {/* Status filter */}
          <div className="kk-filter-group">
            <span className="kk-filter-label">Status</span>
            {(['semua', 'tersangka', 'terdakwa', 'terpidana'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={`kk-filter-btn ${statusFilter === s ? 'active' : ''}`}
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
              >
                {s === 'semua' ? 'Semua' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Level filter */}
          <div className="kk-filter-group">
            <span className="kk-filter-label">Level</span>
            {(['semua', 'pusat', 'daerah'] as LevelFilter[]).map((l) => (
              <button
                key={l}
                className={`kk-filter-btn ${levelFilter === l ? 'active' : ''}`}
                onClick={() => setLevelFilter(l)}
                aria-pressed={levelFilter === l}
              >
                {l === 'semua' ? 'Semua' : l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            ))}
          </div>

          {/* Name search */}
          <label className="kk-search">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <input
              type="text"
              placeholder="Cari nama…"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              suppressHydrationWarning
            />
            {nameQuery && (
              <button
                type="button"
                className="kk-search-clear"
                onClick={() => setNameQuery('')}
                aria-label="Hapus pencarian"
                suppressHydrationWarning
              >×</button>
            )}
          </label>
        </div>
      </header>

      {/* ── Card list ──────────────────────────────────────────────── */}
      <main className="kk-main">
        {rows.length === 0 ? (
          <div className="kk-empty">
            <span className="kk-empty-icon">◯</span>
            <p>Belum ada data.</p>
            <p className="kk-empty-sub">Data akan muncul setelah kasus diverifikasi.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="kk-empty">
            <span className="kk-empty-icon">◯</span>
            <p>Tidak ada hasil untuk filter ini.</p>
          </div>
        ) : (
          <ul className="kk-list" role="list">
            {filtered.map((row) => {
              const meta = [row.posisi, row.wilayah_nama].filter(Boolean).join(' · ')
              return (
                <li key={`${row.pejabat_id}-${row.tanggal_kasus}`} className="kk-card">
                  {/* Left: date + status */}
                  <div className="kk-card-aside">
                    <time className="kk-date" dateTime={row.tanggal_kasus}>
                      {formatTanggal(row.tanggal_kasus)}
                    </time>
                    <span className={STATUS_CHIP_CLASS[row.status]}>
                      {STATUS_LABELS[row.status]}
                    </span>
                  </div>

                  {/* Right: main content */}
                  <div className="kk-card-body">
                    <Link href={`/${row.pejabat_id}`} className="kk-nama">
                      {row.nama}
                    </Link>
                    {meta && <div className="kk-meta">{meta}</div>}
                    {row.lembaga && (
                      <div className="kk-lembaga">{row.lembaga}</div>
                    )}
                    {row.ringkasan && (
                      <p className="kk-ringkasan">{row.ringkasan}</p>
                    )}
                    {row.url_sumber && (
                      <a
                        href={row.url_sumber}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="kk-sumber"
                      >
                        sumber ↗
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {/* ── Disclaimer footer (REQUIRED) ───────────────────────────── */}
      <footer className="kk-disclaimer">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="kk-disclaimer-icon">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <line x1="8" y1="7" x2="8" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="4.5" r="0.8" fill="currentColor" />
        </svg>
        <p>
          Status hukum mencerminkan tahap yang dilaporkan saat data dikumpulkan.{' '}
          <strong>Tersangka dan terdakwa belum tentu bersalah — asas praduga tak bersalah berlaku.</strong>{' '}
          Data bersumber dari pemberitaan publik terverifikasi (KPK, ICW, media nasional).
        </p>
      </footer>
    </div>
  )
}

const styles = `
.kk-root {
  min-height: 100vh;
  background: #f5f1e6;
  color: #0f1117;
  display: flex;
  flex-direction: column;
  font-family: 'DM Mono', monospace;
}

/* ── Header ─────────────────────────────────────────────── */
.kk-header {
  padding: 1.25rem 1.5rem .75rem;
  border-bottom: 1px solid #e2dccb;
  background: #fbf7ee;
}

.kk-nav {
  display: flex;
  gap: 1.25rem;
  font-family: 'DM Mono', monospace;
  font-size: .75rem;
  margin-bottom: .75rem;
}

.kk-back {
  color: #6b6859;
  text-decoration: none;
}
.kk-back:hover { color: #0f1117; }

.kk-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: .75rem;
}

.kk-title {
  font-family: 'Fraunces', serif;
  font-size: 2rem;
  font-weight: 400;
  margin: 0 0 .2rem;
  letter-spacing: -0.01em;
  color: #0f1117;
}

.kk-sub {
  font-size: .85rem;
  color: #4a4a4a;
  margin: 0;
  max-width: 60ch;
}

.kk-counter {
  font-family: 'DM Mono', monospace;
  font-size: .7rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: #c0392b;
  border: 1px solid #c0392b;
  padding: .3rem .7rem;
  white-space: nowrap;
  align-self: flex-start;
  margin-top: .25rem;
}

/* ── Filters ──────────────────────────────────────────────── */
.kk-filters {
  display: flex;
  gap: .75rem;
  flex-wrap: wrap;
  align-items: center;
  padding-top: .5rem;
  border-top: 1px dashed #d4cfc5;
}

.kk-filter-group {
  display: flex;
  align-items: center;
  gap: .3rem;
}

.kk-filter-label {
  font-family: 'DM Mono', monospace;
  font-size: .7rem;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: #8a857c;
  margin-right: .2rem;
}

.kk-filter-btn {
  padding: .28rem .65rem;
  font-family: 'DM Mono', monospace;
  font-size: .7rem;
  letter-spacing: .08em;
  background: transparent;
  color: #0f1117;
  border: 1px solid #d4cfc5;
  border-radius: 3px;
  cursor: pointer;
  transition: background .12s, border-color .12s;
}
.kk-filter-btn:hover { background: #ece7dc; }
.kk-filter-btn.active {
  background: #0f1117;
  color: #fbf7ee;
  border-color: #0f1117;
}

.kk-search {
  display: flex;
  align-items: center;
  gap: .5rem;
  border: 1px solid #d4cfc5;
  padding: .3rem .65rem;
  background: #f5f1e6;
  color: #6b6859;
  margin-left: auto;
  transition: border-color .14s;
}
.kk-search:focus-within {
  border-color: #0f1117;
  color: #0f1117;
}
.kk-search input {
  border: none;
  outline: none;
  background: transparent;
  font-family: 'DM Mono', monospace;
  font-size: .72rem;
  letter-spacing: .04em;
  color: #0f1117;
  width: 140px;
}
.kk-search input::placeholder { color: #8a857c; }
.kk-search-clear {
  border: none;
  background: none;
  cursor: pointer;
  color: #8a857c;
  font-size: 15px;
  line-height: 1;
  padding: 0 1px;
}
.kk-search-clear:hover { color: #c0392b; }

/* ── Main / card list ─────────────────────────────────────── */
.kk-main {
  flex: 1;
  padding: 1.25rem 1.5rem;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
}

.kk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.kk-card {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 1.25rem;
  padding: 1rem 0;
  border-bottom: 1px solid #e2dccb;
  transition: background .12s;
}
.kk-card:first-child { border-top: 1px solid #e2dccb; }
.kk-card:hover { background: #f0ece0; }

.kk-card-aside {
  display: flex;
  flex-direction: column;
  gap: .45rem;
  padding-top: .1rem;
}

.kk-date {
  font-family: 'DM Mono', monospace;
  font-size: .7rem;
  letter-spacing: .08em;
  color: #6b6859;
}

/* Status chips */
.kk-chip {
  display: inline-block;
  font-family: 'DM Mono', monospace;
  font-size: .65rem;
  letter-spacing: .12em;
  text-transform: uppercase;
  padding: .2rem .5rem;
  border-radius: 2px;
  width: fit-content;
}
.kk-chip-tersangka {
  background: rgba(192, 57, 43, .1);
  color: #c0392b;
  border: 1px solid rgba(192, 57, 43, .25);
}
.kk-chip-terdakwa {
  background: rgba(192, 57, 43, .18);
  color: #a93226;
  border: 1px solid rgba(192, 57, 43, .4);
}
.kk-chip-terpidana {
  background: #c0392b;
  color: #fbf7ee;
  border: 1px solid #c0392b;
}

.kk-card-body {
  min-width: 0;
}

.kk-nama {
  font-family: 'Fraunces', serif;
  font-size: 1.05rem;
  font-weight: 400;
  letter-spacing: -0.005em;
  color: #0f1117;
  text-decoration: none;
  display: inline-block;
  border-bottom: 1px solid transparent;
  transition: border-color .14s, color .14s;
}
.kk-nama:hover {
  color: #c0392b;
  border-bottom-color: #c0392b;
}

.kk-meta {
  font-family: 'DM Mono', monospace;
  font-size: .72rem;
  color: #6b6859;
  letter-spacing: .03em;
  margin-top: .25rem;
}

.kk-lembaga {
  font-family: 'DM Mono', monospace;
  font-size: .7rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #8a857c;
  margin-top: .25rem;
}

.kk-ringkasan {
  font-size: .85rem;
  line-height: 1.55;
  color: #3a3a3a;
  margin: .5rem 0 0;
  max-width: 72ch;
}

.kk-sumber {
  display: inline-block;
  margin-top: .4rem;
  font-family: 'DM Mono', monospace;
  font-size: .68rem;
  letter-spacing: .1em;
  color: #c0392b;
  text-decoration: none;
}
.kk-sumber:hover { text-decoration: underline; }

/* ── Empty state ──────────────────────────────────────────── */
.kk-empty {
  padding: 3rem 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
}
.kk-empty-icon {
  font-size: 2.5rem;
  color: #d4cfc5;
  line-height: 1;
}
.kk-empty p {
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-size: 1rem;
  color: #6b6859;
  margin: 0;
}
.kk-empty-sub {
  font-family: 'DM Mono', monospace;
  font-size: .72rem !important;
  font-style: normal !important;
  color: #8a857c !important;
}

/* ── Disclaimer footer ────────────────────────────────────── */
.kk-disclaimer {
  display: flex;
  align-items: flex-start;
  gap: .65rem;
  padding: .9rem 1.5rem;
  border-top: 1px solid #e2dccb;
  background: #fbf7ee;
  font-size: .78rem;
  line-height: 1.5;
  color: #6b6859;
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}
.kk-disclaimer-icon {
  flex-shrink: 0;
  margin-top: .15rem;
  color: #8a857c;
}
.kk-disclaimer p {
  margin: 0;
}
.kk-disclaimer strong {
  font-weight: 500;
  color: #3a3a3a;
}

/* ── Responsive ───────────────────────────────────────────── */
@media (max-width: 640px) {
  .kk-card {
    grid-template-columns: 1fr;
    gap: .5rem;
  }
  .kk-card-aside {
    flex-direction: row;
    align-items: center;
    gap: .6rem;
  }
  .kk-search {
    margin-left: 0;
    width: 100%;
  }
  .kk-search input {
    width: 100%;
  }
}
`
