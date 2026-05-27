'use client'

import Link from 'next/link'
import type { PejabatPusatCard } from '@/lib/queries'

interface Props {
  officials: PejabatPusatCard[]
}

const FEATURED_POSISI = ['Presiden', 'Wakil Presiden']

function isFeatured(posisi: string | null): boolean {
  return FEATURED_POSISI.includes(posisi ?? '')
}

function formatName(o: PejabatPusatCard): string {
  const parts: string[] = []
  if (o.gelar_depan) parts.push(o.gelar_depan)
  parts.push(o.nama_lengkap)
  if (o.gelar_belakang) parts.push(o.gelar_belakang)
  return parts.join(' ')
}

export default function KabinetGrid({ officials }: Props) {
  const featured = officials.filter((o) => isFeatured(o.posisi))
  const menteri = [...officials.filter((o) => !isFeatured(o.posisi))].sort((a, b) =>
    (a.posisi ?? '').localeCompare(b.posisi ?? '', 'id'),
  )

  if (officials.length === 0) {
    return (
      <>
        <style>{styles}</style>
        <div className="kg-empty">
          <span className="kg-empty-mark" aria-hidden>◐</span>
          <p className="kg-empty-text">Data kabinet belum tersedia.</p>
          <p className="kg-empty-sub">Informasi pejabat pusat sedang dihimpun.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{styles}</style>

      <div className="kg-root">
        {/* ── Section header ───────────────────────────────────────── */}
        <div className="kg-section-head">
          <div className="kg-eyebrow">
            <span className="kg-eyebrow-dot" aria-hidden />
            Kabinet · Pejabat Pusat
          </div>
          <div className="kg-section-rule" aria-hidden />
        </div>

        {/* ── Featured: Presiden + Wapres ──────────────────────────── */}
        {featured.length > 0 && (
          <div className="kg-featured-row">
            {featured.map((o) => (
              <Link key={o.id} href={`/${o.id}`} className="kg-featured-card">
                <div className="kg-featured-posisi">{o.posisi}</div>
                {o.foto_url ? (
                  <div className="kg-featured-photo-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.foto_url}
                      alt={o.nama_lengkap}
                      className="kg-featured-photo"
                    />
                  </div>
                ) : (
                  <div className="kg-featured-avatar" aria-hidden>
                    {o.nama_lengkap.charAt(0)}
                  </div>
                )}
                <div className="kg-featured-body">
                  <div className="kg-featured-name">{formatName(o)}</div>
                  {o.partai && (
                    <span className="kg-badge kg-badge-partai">{o.partai}</span>
                  )}
                  {o.has_kasus && (
                    <span className="kg-badge kg-badge-kasus">ADA CATATAN</span>
                  )}
                </div>
                <div className="kg-featured-arrow" aria-hidden>→</div>
              </Link>
            ))}
          </div>
        )}

        {/* ── Divider ──────────────────────────────────────────────── */}
        {featured.length > 0 && menteri.length > 0 && (
          <div className="kg-divider">
            <div className="kg-divider-rule" aria-hidden />
            <span className="kg-divider-label">
              {menteri.length} Pejabat
            </span>
            <div className="kg-divider-rule" aria-hidden />
          </div>
        )}

        {/* ── Menteri grid ──────────────────────────────────────────── */}
        {menteri.length > 0 && (
          <div className="kg-grid">
            {menteri.map((o, i) => (
              <Link
                key={o.id}
                href={`/${o.id}`}
                className="kg-card"
                style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
              >
                {o.foto_url ? (
                  <div className="kg-photo-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.foto_url}
                      alt={o.nama_lengkap}
                      className="kg-photo"
                    />
                  </div>
                ) : (
                  <div className="kg-avatar" aria-hidden>
                    {o.nama_lengkap.charAt(0)}
                  </div>
                )}

                <div className="kg-card-body">
                  <div className="kg-card-posisi">
                    {o.posisi ?? 'Pejabat Pusat'}
                  </div>
                  <div className="kg-card-name">{formatName(o)}</div>
                  <div className="kg-card-badges">
                    {o.partai && (
                      <span className="kg-badge kg-badge-partai">{o.partai}</span>
                    )}
                    {o.has_kasus && (
                      <span className="kg-badge kg-badge-kasus">ADA CATATAN</span>
                    )}
                  </div>
                </div>

                <div className="kg-card-arrow" aria-hidden>→</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = `
  .kg-root {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Section header ─────────────────────────────────────────────── */
  .kg-section-head {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 28px;
  }

  .kg-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .kg-eyebrow-dot {
    width: 7px;
    height: 7px;
    background: var(--accent);
    display: inline-block;
    border-radius: 50%;
    animation: kg-pulse 2.4s ease-in-out infinite;
  }

  @keyframes kg-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.7); }
  }

  .kg-section-rule {
    flex: 1;
    height: 1px;
    background: var(--rule);
  }

  /* ── Featured row (Presiden + Wapres) ──────────────────────────── */
  .kg-featured-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 2px;
    margin-bottom: 2px;
  }

  .kg-featured-card {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto auto;
    gap: 0 18px;
    align-items: center;
    padding: 28px 32px;
    background: var(--paper-2);
    border: 1.5px solid var(--ink);
    text-decoration: none;
    color: inherit;
    transition: all 0.18s ease;
    overflow: hidden;
  }

  .kg-featured-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--accent);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform 0.18s ease;
  }

  .kg-featured-card:hover {
    background: var(--paper-3, #ddd6c3);
  }

  .kg-featured-card:hover::before {
    transform: scaleY(1);
  }

  .kg-featured-card:hover .kg-featured-arrow {
    color: var(--accent);
    transform: translateX(4px);
  }

  .kg-featured-posisi {
    grid-column: 1 / -1;
    grid-row: 1;
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 16px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 10px;
  }

  .kg-featured-photo-wrap {
    grid-row: 2;
    width: 72px;
    height: 72px;
    border: 1.5px solid var(--ink);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--paper-2);
  }

  .kg-featured-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
    display: block;
    filter: grayscale(20%);
    transition: filter 0.2s ease;
  }

  .kg-featured-card:hover .kg-featured-photo {
    filter: grayscale(0%);
  }

  .kg-featured-avatar {
    grid-row: 2;
    width: 72px;
    height: 72px;
    border: 1.5px solid var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Fraunces', serif;
    font-size: 28px;
    font-weight: 200;
    font-style: italic;
    color: var(--muted);
    background: var(--paper);
    flex-shrink: 0;
  }

  .kg-featured-body {
    grid-row: 2;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .kg-featured-name {
    font-family: 'Fraunces', serif;
    font-size: 22px;
    font-weight: 400;
    line-height: 1.15;
    letter-spacing: -0.015em;
    color: var(--ink);
  }

  .kg-featured-arrow {
    grid-row: 2;
    font-family: 'DM Mono', monospace;
    font-size: 16px;
    color: var(--rule);
    transition: all 0.18s ease;
    align-self: center;
  }

  /* ── Divider ────────────────────────────────────────────────────── */
  .kg-divider {
    display: flex;
    align-items: center;
    gap: 20px;
    margin: 32px 0 28px;
  }

  .kg-divider-rule {
    flex: 1;
    height: 1px;
    background: var(--rule);
  }

  .kg-divider-label {
    font-family: 'DM Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
    padding: 0 4px;
  }

  /* ── Menteri grid ───────────────────────────────────────────────── */
  .kg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1px;
    background: var(--rule);
    border: 1px solid var(--rule);
  }

  .kg-card {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 16px 18px;
    background: var(--paper);
    text-decoration: none;
    color: inherit;
    transition: background 0.15s ease;
    animation: kg-rise 0.45s both;
    overflow: hidden;
  }

  .kg-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform 0.18s ease;
  }

  .kg-card:hover {
    background: var(--paper-2);
  }

  .kg-card:hover::before {
    transform: scaleY(1);
  }

  .kg-card:hover .kg-card-arrow {
    color: var(--accent);
    transform: translateX(3px);
  }

  @keyframes kg-rise {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Photo / avatar */
  .kg-photo-wrap {
    width: 44px;
    height: 44px;
    border: 1px solid var(--rule);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--paper-2);
  }

  .kg-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
    display: block;
    filter: grayscale(30%);
    transition: filter 0.2s ease;
  }

  .kg-card:hover .kg-photo {
    filter: grayscale(0%);
  }

  .kg-avatar {
    width: 44px;
    height: 44px;
    border: 1px solid var(--rule);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Fraunces', serif;
    font-size: 18px;
    font-weight: 200;
    font-style: italic;
    color: var(--muted);
    background: var(--paper);
    flex-shrink: 0;
  }

  /* Card body */
  .kg-card-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .kg-card-posisi {
    font-family: 'DM Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kg-card-name {
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    font-weight: 400;
    line-height: 1.2;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kg-card-badges {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .kg-card-arrow {
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    color: var(--rule);
    transition: all 0.18s ease;
    flex-shrink: 0;
  }

  /* ── Badges ─────────────────────────────────────────────────────── */
  .kg-badge {
    display: inline-block;
    font-family: 'DM Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 2px 6px;
    border: 1px solid;
    line-height: 1.5;
    white-space: nowrap;
  }

  .kg-badge-partai {
    color: var(--muted-2);
    border-color: var(--rule);
    background: var(--paper);
  }

  .kg-badge-kasus {
    color: var(--paper);
    border-color: var(--accent);
    background: var(--accent);
    font-weight: 500;
  }

  /* ── Empty state ────────────────────────────────────────────────── */
  .kg-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 40px;
    gap: 12px;
    border: 1px dashed var(--rule);
    background: var(--paper-2);
  }

  .kg-empty-mark {
    font-size: 32px;
    color: var(--muted);
    opacity: 0.5;
    line-height: 1;
    display: block;
  }

  .kg-empty-text {
    font-family: 'Fraunces', serif;
    font-size: 16px;
    font-weight: 300;
    color: var(--muted-2);
    margin: 0;
  }

  .kg-empty-sub {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    color: var(--muted);
    text-transform: uppercase;
    margin: 0;
  }
`
