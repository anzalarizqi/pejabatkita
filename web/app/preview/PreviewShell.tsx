'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import IndonesiaMap from '../_components/IndonesiaMap'
import DisclaimerModal from './DisclaimerModal'
import type { ProvinceCount, SiteStats } from '@/lib/queries'

interface Props {
  provinces: ProvinceCount[]
  stats: SiteStats
}

export default function PreviewShell({ provinces, stats }: Props) {
  const dateLabel = new Date().toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })

  const lastUpdatedLabel = stats.lastUpdated
    ? new Date(stats.lastUpdated).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'

  return (
    <>
      <style>{styles}</style>
      <DisclaimerModal />

      <div className="pv-root">
        {/* Crosshair registration marks at the four corners — pure decoration */}
        <RegistrationMark className="pv-mark pv-mark-tl" />
        <RegistrationMark className="pv-mark pv-mark-tr" />
        <RegistrationMark className="pv-mark pv-mark-bl" />
        <RegistrationMark className="pv-mark pv-mark-br" />

        {/* Top strip */}
        <header className="pv-topstrip">
          <div className="pv-brand">
            <span className="pv-brand-mark">◐</span>
            <span className="pv-brand-name">Peta Pejabat Indonesia</span>
          </div>
          <div className="pv-docid">
            EDISI · {String(new Date().getFullYear())} / N°{' '}
            {String(new Date().getMonth() + 1).padStart(2, '0')}
          </div>
          <div className="pv-topdate">{dateLabel}</div>
        </header>

        {/* Main: left stats rail + right map */}
        <main className="pv-main">
          <aside className="pv-rail">
            <RailContent stats={stats} lastUpdatedLabel={lastUpdatedLabel} />
          </aside>

          <section className="pv-stage">
            <div className="pv-stage-meta">
              <span className="pv-stage-eyebrow">Peta · 38 Provinsi</span>
              <span className="pv-stage-hint">
                gerakkan kursor · klik untuk membuka direktori
              </span>
            </div>
            <div className="pv-stage-map">
              <IndonesiaMap provinces={provinces} height={620} />
            </div>
          </section>
        </main>

        {/* Bottom ticker — rotating data points */}
        <footer className="pv-ticker">
          <Ticker stats={stats} provinces={provinces} />
        </footer>
      </div>
    </>
  )
}

// ─── Left rail: monumental stats ─────────────────────────────────────────────

function RailContent({
  stats,
  lastUpdatedLabel,
}: {
  stats: SiteStats
  lastUpdatedLabel: string
}) {
  const animatedReal = useCountUp(stats.realPejabat, 1400)
  const animatedPct = useCountUp(Math.round(stats.coveragePct * 10), 1600) / 10

  return (
    <div className="pv-rail-inner">
      <div className="pv-eyebrow">
        <span className="pv-eyebrow-dot" />
        Dosir Data · Berkas Terbuka
      </div>

      <h1 className="pv-headline">
        Pejabat<br />
        <em>satu peta.</em>
      </h1>

      {/* Monumental count */}
      <div className="pv-bignum-block">
        <div className="pv-bignum">
          {animatedReal.toLocaleString('id-ID')}
        </div>
        <div className="pv-bignum-caption">
          orang tercatat dari{' '}
          <span className="pv-bignum-expected">
            {stats.expectedTotal.toLocaleString('id-ID')} kursi
          </span>{' '}
          di {stats.provincesTotal} provinsi & {stats.kabKotaTotal} kab/kota.
        </div>
      </div>

      {/* Coverage bar */}
      <div className="pv-coverage">
        <div className="pv-coverage-head">
          <span className="pv-coverage-label">Cakupan</span>
          <span className="pv-coverage-pct">
            {animatedPct.toFixed(1)}<span className="pv-coverage-pct-sym">%</span>
          </span>
        </div>
        <div className="pv-coverage-track" aria-hidden>
          <div
            className="pv-coverage-fill"
            style={{ width: `${Math.min(100, stats.coveragePct)}%` }}
          />
          <div className="pv-coverage-grid" />
        </div>
        <div className="pv-coverage-foot">
          <span>{stats.provincesCovered} provinsi terisi</span>
          <span>diperbarui {lastUpdatedLabel}</span>
        </div>
      </div>

      {/* CTAs */}
      <div className="pv-actions">
        <Link href="/pejabat" className="pv-cta pv-cta-primary">
          Buka Direktori
          <span className="pv-cta-arrow">→</span>
        </Link>
        <Link href="/admin/login" className="pv-cta pv-cta-ghost">
          Panel Admin
        </Link>
      </div>

      <div className="pv-rail-foot">
        <span>
          Sumber: Wikipedia · situs <span className="pv-mono">.go.id</span> ·
          penelusuran web terverifikasi
        </span>
      </div>
    </div>
  )
}

// ─── Bottom ticker ───────────────────────────────────────────────────────────

function Ticker({
  stats,
  provinces,
}: {
  stats: SiteStats
  provinces: ProvinceCount[]
}) {
  const top = [...provinces]
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
  const items = [
    `${stats.provincesCovered}/${stats.provincesTotal} PROVINSI TERISI`,
    `${stats.realPejabat.toLocaleString('id-ID')} PEJABAT TERCATAT`,
    `${stats.coveragePct.toFixed(1)}% CAKUPAN`,
    ...top.map((p) => `${p.nama.toUpperCase()} · ${p.count}`),
    'AGGREGATOR DATA PUBLIK',
    'BUKAN OPINI · BUKAN EDITORIAL',
  ]
  // Duplicate so the marquee loops seamlessly
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
    const from = 0
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}

// ─── Registration mark (corner crosshair) ────────────────────────────────────

function RegistrationMark({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden
    >
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
    --accent: #c0392b;
    --accent-soft: rgba(192, 57, 43, 0.08);
    --rule: #d4cfc5;
    --muted: #8a857c;
    --muted-2: #5a5750;
  }

  html, body { background: var(--paper); }
  body {
    font-family: 'DM Mono', monospace;
    color: var(--ink);
  }

  .pv-root {
    position: relative;
    min-height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    background: var(--paper);
    /* Subtle paper grain via SVG-encoded noise */
    background-image:
      radial-gradient(circle at 20% 10%, rgba(192, 57, 43, 0.025), transparent 40%),
      radial-gradient(circle at 90% 80%, rgba(15, 17, 23, 0.03), transparent 50%),
      repeating-linear-gradient(
        92deg,
        transparent 0,
        transparent 2px,
        rgba(15, 17, 23, 0.012) 2px,
        rgba(15, 17, 23, 0.012) 3px
      );
  }

  /* ── Corner crosshairs ───────────────────────────────────────── */
  .pv-mark {
    position: absolute;
    color: var(--accent);
    opacity: 0.5;
    pointer-events: none;
    z-index: 5;
  }
  .pv-mark-tl { top: 14px; left: 14px; }
  .pv-mark-tr { top: 14px; right: 14px; }
  .pv-mark-bl { bottom: 14px; left: 14px; }
  .pv-mark-br { bottom: 14px; right: 14px; }

  /* ── Top strip ───────────────────────────────────────────────── */
  .pv-topstrip {
    border-bottom: 1.5px solid var(--ink);
    padding: 18px 56px 16px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
  }

  .pv-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pv-brand-mark {
    color: var(--accent);
    font-size: 18px;
    line-height: 1;
    transform: translateY(-1px);
  }
  .pv-brand-name {
    font-family: 'Fraunces', serif;
    font-size: 16px;
    font-weight: 400;
    letter-spacing: -0.005em;
  }

  .pv-docid {
    font-family: 'DM Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.22em;
    color: var(--muted);
    text-transform: uppercase;
    border: 1px solid var(--rule);
    padding: 5px 12px;
    background: var(--paper-2);
    text-align: center;
    white-space: nowrap;
  }

  .pv-topdate {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    text-align: right;
  }

  /* ── Main grid ───────────────────────────────────────────────── */
  .pv-main {
    display: grid;
    grid-template-columns: minmax(360px, 32%) 1fr;
    align-items: stretch;
    min-height: 0;
  }

  /* ── Left rail ───────────────────────────────────────────────── */
  .pv-rail {
    border-right: 1.5px solid var(--ink);
    padding: 56px 48px 56px 56px;
    display: flex;
    flex-direction: column;
    background:
      linear-gradient(180deg, transparent 0%, rgba(192, 57, 43, 0.025) 100%);
    position: relative;
  }

  /* Decorative side numerals */
  .pv-rail::before {
    content: '01 / 38';
    position: absolute;
    top: 18px;
    right: 16px;
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--muted);
    text-transform: uppercase;
  }

  .pv-rail-inner {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .pv-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
    animation: pv-fadein 0.6s 0.05s both;
  }

  .pv-eyebrow-dot {
    width: 7px;
    height: 7px;
    background: var(--accent);
    display: inline-block;
    border-radius: 50%;
    animation: pv-pulse 2.4s ease-in-out infinite;
  }

  @keyframes pv-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.4; transform: scale(0.7); }
  }

  .pv-headline {
    font-family: 'Fraunces', serif;
    font-weight: 200;
    font-size: clamp(48px, 5.4vw, 84px);
    line-height: 0.95;
    letter-spacing: -0.025em;
    color: var(--ink);
    animation: pv-rise 0.7s 0.1s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  .pv-headline em {
    font-style: italic;
    color: var(--accent);
    font-weight: 300;
  }

  /* ── The big number ──────────────────────────────────────────── */
  .pv-bignum-block {
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 24px 0 28px;
    animation: pv-rise 0.7s 0.2s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  .pv-bignum {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 200;
    font-size: clamp(72px, 9vw, 132px);
    line-height: 0.92;
    color: var(--accent);
    letter-spacing: -0.04em;
    font-variant-numeric: oldstyle-nums;
  }

  .pv-bignum-caption {
    margin-top: 14px;
    font-family: 'Fraunces', serif;
    font-weight: 300;
    font-size: 14px;
    line-height: 1.55;
    color: var(--muted-2);
    max-width: 36ch;
  }

  .pv-bignum-expected {
    color: var(--ink);
    font-weight: 400;
    border-bottom: 1px dashed var(--accent);
    padding-bottom: 1px;
  }

  /* ── Coverage bar ────────────────────────────────────────────── */
  .pv-coverage {
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: pv-rise 0.7s 0.3s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  .pv-coverage-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .pv-coverage-label {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .pv-coverage-pct {
    font-family: 'Fraunces', serif;
    font-weight: 300;
    font-size: 38px;
    line-height: 1;
    color: var(--ink);
    letter-spacing: -0.02em;
  }

  .pv-coverage-pct-sym {
    color: var(--accent);
    font-style: italic;
    font-size: 26px;
    margin-left: 2px;
  }

  .pv-coverage-track {
    position: relative;
    height: 12px;
    background: var(--paper-2);
    border: 1px solid var(--rule);
    overflow: hidden;
  }

  .pv-coverage-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    background-image:
      repeating-linear-gradient(
        45deg,
        transparent 0,
        transparent 4px,
        rgba(0,0,0,0.08) 4px,
        rgba(0,0,0,0.08) 5px
      );
    animation: pv-grow 1.6s 0.4s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    transform-origin: left center;
  }

  .pv-coverage-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--rule) 1px, transparent 1px);
    background-size: 25% 100%;
    background-repeat: repeat-x;
    pointer-events: none;
    opacity: 0.55;
  }

  @keyframes pv-grow {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }

  .pv-coverage-foot {
    display: flex;
    justify-content: space-between;
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  /* ── CTAs ────────────────────────────────────────────────────── */
  .pv-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    animation: pv-rise 0.7s 0.42s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  .pv-cta {
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-decoration: none;
    padding: 14px 20px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    transition: all 0.18s ease;
    position: relative;
  }

  .pv-cta-primary {
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
  }

  .pv-cta-primary:hover {
    background: var(--accent);
    border-color: var(--accent);
    transform: translateY(-1px);
    box-shadow: 0 4px 0 -1px var(--ink);
  }

  .pv-cta-arrow {
    transition: transform 0.18s ease;
  }
  .pv-cta-primary:hover .pv-cta-arrow {
    transform: translateX(3px);
  }

  .pv-cta-ghost {
    color: var(--muted-2);
    border: 1px solid var(--rule);
  }

  .pv-cta-ghost:hover {
    color: var(--ink);
    border-color: var(--ink);
  }

  /* ── Rail footer ─────────────────────────────────────────────── */
  .pv-rail-foot {
    margin-top: auto;
    padding-top: 28px;
    border-top: 1px dashed var(--rule);
    font-family: 'DM Mono', monospace;
    font-size: 9.5px;
    line-height: 1.7;
    letter-spacing: 0.06em;
    color: var(--muted);
    animation: pv-fadein 0.7s 0.55s both;
  }

  .pv-mono {
    font-family: 'DM Mono', monospace;
    color: var(--accent);
  }

  /* ── Stage (right side, holds the map) ───────────────────────── */
  .pv-stage {
    padding: 38px 56px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    position: relative;
    min-width: 0;
  }

  .pv-stage::before {
    content: '';
    position: absolute;
    top: 28px;
    bottom: 14px;
    left: 28px;
    right: 28px;
    border: 1px solid var(--rule);
    pointer-events: none;
  }

  .pv-stage-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0 4px;
    z-index: 2;
  }

  .pv-stage-eyebrow {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .pv-stage-hint {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 300;
    font-size: 12px;
    color: var(--muted);
  }

  .pv-stage-map {
    position: relative;
    flex: 1;
    padding: 18px 32px 32px;
    z-index: 2;
    animation: pv-fadein 1.1s 0.3s both;
  }

  /* ── Bottom ticker ───────────────────────────────────────────── */
  .pv-ticker {
    border-top: 1.5px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
    overflow: hidden;
    position: relative;
  }

  .pv-ticker::before,
  .pv-ticker::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 80px;
    z-index: 2;
    pointer-events: none;
  }
  .pv-ticker::before {
    left: 0;
    background: linear-gradient(90deg, var(--ink), transparent);
  }
  .pv-ticker::after {
    right: 0;
    background: linear-gradient(270deg, var(--ink), transparent);
  }

  .pv-ticker-track {
    padding: 14px 0;
    overflow: hidden;
  }

  .pv-ticker-inner {
    display: inline-flex;
    gap: 56px;
    white-space: nowrap;
    animation: pv-marquee 60s linear infinite;
    will-change: transform;
  }

  .pv-ticker-item {
    font-family: 'DM Mono', monospace;
    font-size: 10.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--paper);
    display: inline-flex;
    align-items: center;
    gap: 14px;
  }

  .pv-ticker-bullet {
    color: var(--accent);
    font-size: 8px;
  }

  @keyframes pv-marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }

  /* ── Animations ──────────────────────────────────────────────── */
  @keyframes pv-fadein {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes pv-rise {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`
