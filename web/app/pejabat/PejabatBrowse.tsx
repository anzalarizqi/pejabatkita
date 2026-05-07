'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import IndonesiaMap from '../_components/IndonesiaMap'
import type { PejabatCard, ProvinceCount, ListPejabatResult } from '@/lib/queries'

interface Props {
  provinsi: string | null
  search: string
  page: number
  list: ListPejabatResult
  provinces: ProvinceCount[]
}

export default function PejabatBrowse({ provinsi, search, page, list, provinces }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(search)
  const [, startTransition] = useTransition()

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null || value === '') params.delete(key)
    else params.set(key, value)
    if (key !== 'page') params.delete('page')
    startTransition(() => router.push(`/pejabat?${params.toString()}`))
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateParam('q', searchInput)
  }

  const totalReal = provinces.reduce((acc, p) => acc + p.count, 0)

  return (
    <>
      <style>{tokens}</style>
      <style>{styles}</style>

      <div className="pj-root">
        <div className="rule-strip" />

        <header className="pj-topbar">
          <Link href="/" className="topbar-brand">Peta Pejabat Indonesia</Link>
          <div className="topbar-meta">
            <span>{totalReal.toLocaleString('id-ID')} pejabat terdaftar</span>
          </div>
        </header>

        <section className="pj-hero">
          <p className="hero-label">Direktori Publik</p>
          <h1 className="hero-title">
            Telusuri pejabat<br />
            dari <em>seluruh nusantara</em>
          </h1>
        </section>

        <section className="pj-map">
          <IndonesiaMap provinces={provinces} selected={provinsi} height={420} />
        </section>

        <section className="pj-filters">
          <div className="filters-inner">
            <form className="search-form" onSubmit={onSearchSubmit}>
              <label className="filter-label" htmlFor="q">Cari nama</label>
              <div className="search-row">
                <input
                  id="q"
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="cth. Anies, Ridwan…"
                  className="search-input"
                />
                <button type="submit" className="btn-primary">Cari</button>
              </div>
            </form>

            <div className="province-filter">
              <label className="filter-label" htmlFor="prov">Provinsi</label>
              <select
                id="prov"
                className="province-select"
                value={provinsi ?? ''}
                onChange={(e) => updateParam('provinsi', e.target.value || null)}
              >
                <option value="">Semua provinsi ({totalReal})</option>
                {provinces.map((p) => (
                  <option key={p.kode_bps} value={p.nama}>
                    {p.nama} ({p.count})
                  </option>
                ))}
              </select>
            </div>

            {(provinsi || search) && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => router.push('/pejabat')}
              >
                Reset filter
              </button>
            )}
          </div>

          <div className="filter-summary">
            {list.total === 0 ? (
              <span>Tidak ada hasil.</span>
            ) : (
              <span>
                Menampilkan <strong>{(list.page - 1) * list.pageSize + 1}</strong>–
                <strong>{Math.min(list.page * list.pageSize, list.total)}</strong> dari{' '}
                <strong>{list.total.toLocaleString('id-ID')}</strong>
                {provinsi ? ` di ${provinsi}` : ''}
                {search ? ` cocok "${search}"` : ''}
              </span>
            )}
          </div>
        </section>

        <main className="pj-grid">
          {list.rows.length === 0 ? (
            <div className="empty-state">
              <p>Belum ada data yang cocok dengan filter ini.</p>
              <Link href="/pejabat" className="btn-ghost">Lihat semua</Link>
            </div>
          ) : (
            <div className="cards">
              {list.rows.map((p) => (
                <Card key={p.id} pejabat={p} />
              ))}
            </div>
          )}
        </main>

        {list.totalPages > 1 && (
          <nav className="pj-pagination">
            <button
              className="page-btn"
              disabled={page <= 1}
              onClick={() => updateParam('page', String(page - 1))}
            >
              ← Sebelumnya
            </button>
            <span className="page-info">
              {list.page} / {list.totalPages}
            </span>
            <button
              className="page-btn"
              disabled={page >= list.totalPages}
              onClick={() => updateParam('page', String(page + 1))}
            >
              Berikutnya →
            </button>
          </nav>
        )}

        <footer className="pj-footer">
          <span>© {new Date().getFullYear()} Peta Pejabat Indonesia</span>
          <div className="footer-links">
            <Link href="/">Beranda</Link>
            <a
              href="https://github.com/anzalarizqi/pejabatkita"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  )
}

function Card({ pejabat: p }: { pejabat: PejabatCard }) {
  const fullName = [p.gelar_depan, p.nama_lengkap, p.gelar_belakang]
    .filter(Boolean)
    .join(' ')

  return (
    <Link href={`/${p.id}`} className="card">
      <div className="card-eyebrow">
        {p.posisi ?? '—'}
        {p.status && p.status !== 'aktif' ? (
          <span className="card-status">· {p.status}</span>
        ) : null}
      </div>
      <h3 className="card-name">{fullName}</h3>
      <div className="card-meta">
        <span>{p.wilayah_nama ?? 'Wilayah tidak diketahui'}</span>
        {p.provinsi_nama && p.provinsi_nama !== p.wilayah_nama ? (
          <span className="card-prov">{p.provinsi_nama}</span>
        ) : null}
      </div>
      {p.confidence !== null && p.confidence !== undefined && (
        <div className="card-confidence" title={`Skor kepercayaan: ${(p.confidence * 100).toFixed(0)}%`}>
          <ConfidenceBar value={p.confidence} />
          <span>{(p.confidence * 100).toFixed(0)}%</span>
        </div>
      )}
    </Link>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const color =
    value >= 0.8 ? 'var(--accent)' : value >= 0.5 ? '#caa54e' : 'var(--muted)'
  return (
    <div className="conf-bar">
      <div className="conf-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

const tokens = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,200;0,9..144,300;0,9..144,400;1,9..144,200;1,9..144,300&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --ink: #0f1117;
    --paper: #f5f1ea;
    --accent: #c0392b;
    --rule: #d4cfc5;
    --muted: #8a857c;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--paper);
    font-family: 'DM Mono', monospace;
    color: var(--ink);
    min-height: 100vh;
  }
`

const styles = `
  .pj-root {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .rule-strip { width: 100%; height: 3px; background: var(--accent); }

  .pj-topbar {
    border-bottom: 2px solid var(--ink);
    padding: 16px 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .topbar-brand {
    font-family: 'Fraunces', serif;
    font-size: 15px;
    color: var(--ink);
    text-decoration: none;
    letter-spacing: -0.01em;
  }
  .topbar-meta {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .pj-hero {
    padding: 64px 48px 40px;
    border-bottom: 1px solid var(--rule);
  }
  .hero-label {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 16px;
  }
  .hero-title {
    font-family: 'Fraunces', serif;
    font-size: clamp(32px, 5vw, 60px);
    font-weight: 200;
    line-height: 1.1;
    color: var(--ink);
    max-width: 900px;
  }
  .hero-title em {
    font-style: italic;
    color: var(--accent);
  }

  .pj-map {
    padding: 28px 48px 12px;
    border-bottom: 1px solid var(--rule);
  }

  .pj-filters {
    padding: 28px 48px;
    border-bottom: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .filters-inner {
    display: flex;
    gap: 24px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .filter-label {
    display: block;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .search-form { flex: 1 1 320px; }
  .search-row { display: flex; gap: 8px; }
  .search-input {
    flex: 1;
    background: transparent;
    border: 1px solid var(--rule);
    padding: 12px 14px;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    color: var(--ink);
    outline: none;
    transition: border-color 0.15s;
  }
  .search-input:focus { border-color: var(--ink); }

  .province-filter { flex: 1 1 240px; }
  .province-select {
    width: 100%;
    background: transparent;
    border: 1px solid var(--rule);
    padding: 12px 14px;
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    color: var(--ink);
    outline: none;
    cursor: pointer;
  }
  .province-select:focus { border-color: var(--ink); }

  .btn-primary, .btn-ghost, .page-btn {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 12px 20px;
    cursor: pointer;
    border: 1px solid transparent;
    text-decoration: none;
    display: inline-block;
    transition: all 0.15s;
  }
  .btn-primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .btn-primary:hover { opacity: 0.85; }
  .btn-ghost { background: transparent; color: var(--muted); border-color: var(--rule); }
  .btn-ghost:hover { color: var(--ink); border-color: var(--ink); }

  .filter-summary {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .filter-summary strong { color: var(--ink); font-weight: 500; }

  .pj-grid { flex: 1; padding: 36px 48px 48px; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .card {
    display: block;
    padding: 22px 22px 20px;
    border: 1px solid var(--rule);
    background: rgba(255,255,255,0.35);
    text-decoration: none;
    color: var(--ink);
    transition: border-color 0.15s, background 0.15s, transform 0.15s;
    position: relative;
  }
  .card:hover {
    border-color: var(--ink);
    background: rgba(255,255,255,0.6);
    transform: translateY(-1px);
  }
  .card::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.2s;
  }
  .card:hover::before { transform: scaleX(1); }

  .card-eyebrow {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 12px;
  }
  .card-status { color: var(--muted); margin-left: 6px; }
  .card-name {
    font-family: 'Fraunces', serif;
    font-weight: 300;
    font-size: 22px;
    line-height: 1.2;
    margin-bottom: 12px;
    color: var(--ink);
  }
  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }
  .card-prov { font-size: 10px; opacity: 0.8; }

  .card-confidence {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    color: var(--muted);
  }
  .conf-bar {
    flex: 1;
    height: 3px;
    background: var(--rule);
    overflow: hidden;
  }
  .conf-fill { height: 100%; transition: width 0.3s; }

  .empty-state {
    text-align: center;
    padding: 64px 24px;
    color: var(--muted);
    font-size: 13px;
  }
  .empty-state p { margin-bottom: 18px; }

  .pj-pagination {
    border-top: 1px solid var(--rule);
    padding: 24px 48px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 24px;
  }
  .page-btn {
    background: transparent;
    color: var(--ink);
    border-color: var(--rule);
  }
  .page-btn:hover:not(:disabled) { border-color: var(--ink); }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.06em;
  }

  .pj-footer {
    border-top: 1px solid var(--rule);
    padding: 20px 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    color: var(--muted);
    letter-spacing: 0.06em;
  }
  .footer-links { display: flex; gap: 24px; }
  .footer-links a {
    color: var(--muted);
    text-decoration: none;
  }
  .footer-links a:hover { color: var(--ink); }

  @media (max-width: 720px) {
    .pj-topbar, .pj-hero, .pj-filters, .pj-grid, .pj-pagination, .pj-footer {
      padding-left: 24px;
      padding-right: 24px;
    }
  }
`
