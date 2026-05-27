'use client'

import { useState } from 'react'
import type { KasusRow } from '@/lib/types'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  tersangka: { label: 'TERSANGKA', color: '#fff', bg: '#dc2626' },
  terdakwa:  { label: 'TERDAKWA',  color: '#fff', bg: '#ea580c' },
  terpidana: { label: 'TERPIDANA', color: '#fff', bg: '#1c1917' },
}

const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, "DM Mono", monospace)',
}

interface Props {
  kasus: KasusRow[]
}

export default function KasusSection({ kasus }: Props) {
  const [expanded, setExpanded] = useState(false)

  const confirmed = kasus.filter((k) => k.verified !== false)
  const mentioned = kasus.filter((k) => k.verified === false)

  const heading = (
    <h2 style={{
      fontFamily: 'Fraunces, Georgia, serif',
      fontSize: '1rem',
      fontWeight: 600,
      letterSpacing: '0.02em',
      color: confirmed.length > 0 ? '#dc2626' : 'var(--ink)',
      marginBottom: '0.875rem',
      textTransform: 'uppercase',
    }}>
      Rekam Jejak Korupsi
      {confirmed.length > 0 && (
        <span style={{ ...monoStyle, marginLeft: '0.5em', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 400, verticalAlign: 'middle' }}>
          {confirmed.length} kasus
        </span>
      )}
    </h2>
  )

  // ── Green badge (shared) ──────────────────────────────────────────────────
  const greenBadge = (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.4em',
      padding: '0.35em 0.75em',
      background: '#f0fdf4',
      border: '1px solid #bbf7d0',
      borderRadius: '4px',
      ...monoStyle,
      fontSize: '0.78rem',
      color: '#15803d',
      fontWeight: 500,
    }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="5.5" stroke="#15803d"/>
        <path d="M3.5 6l2 2 3-3" stroke="#15803d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Tidak ditemukan rekam jejak korupsi
    </span>
  )

  // ── Mention note (verified=false) ─────────────────────────────────────────
  function MentionNote({ k }: { k: KasusRow }) {
    const parts = [k.ringkasan, k.verified_note].filter(Boolean)
    const combined = parts.join(' ')
    return (
      <div style={{
        marginTop: '0.875rem',
        padding: '0.65rem 0.875rem',
        background: '#fafaf9',
        border: '1px solid var(--rule)',
        borderRadius: '4px',
      }}>
        <div style={{ ...monoStyle, fontSize: '0.68rem', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
          Pernah disebut dalam kasus korupsi
        </div>
        {combined && (
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--ink)', opacity: 0.8 }}>
            {combined}
          </p>
        )}
        {k.url_sumber && (
          <a href={k.url_sumber} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25em', marginTop: '0.4rem',
            ...monoStyle, fontSize: '0.7rem', color: 'var(--accent, #2563eb)', textDecoration: 'none',
          }}>
            ↗ Sumber
          </a>
        )}
      </div>
    )
  }

  // ── No kasus at all ───────────────────────────────────────────────────────
  if (kasus.length === 0) {
    return (
      <section style={{ margin: '2rem 0' }}>
        {heading}
        {greenBadge}
      </section>
    )
  }

  // ── Only mentions (all verified=false) ────────────────────────────────────
  if (confirmed.length === 0) {
    return (
      <section style={{ margin: '2rem 0' }}>
        {heading}
        {greenBadge}
        {mentioned.map((k) => <MentionNote key={k.kasus_id} k={k} />)}
      </section>
    )
  }

  // ── Has confirmed kasus ───────────────────────────────────────────────────
  const visible = expanded ? confirmed : confirmed.slice(0, 1)

  return (
    <section style={{ margin: '2rem 0', paddingLeft: '0.875rem', borderLeft: '3px solid #dc2626' }}>
      {heading}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visible.map((k, i) => {
          const cfg = STATUS_CONFIG[k.status] ?? { label: k.status.toUpperCase(), color: '#fff', bg: '#6b7280' }
          return (
            <div key={k.kasus_id} style={{ padding: '0.75rem 0', borderTop: i > 0 ? '1px solid var(--rule)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <span style={{
                  display: 'inline-block', padding: '0.2em 0.55em',
                  background: cfg.bg, color: cfg.color,
                  ...monoStyle, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', borderRadius: '2px',
                }}>
                  {cfg.label}
                </span>
                {k.lembaga && (
                  <span style={{ ...monoStyle, fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.04em' }}>
                    {k.lembaga}
                  </span>
                )}
                {k.tahun && (
                  <span style={{ ...monoStyle, fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {k.tahun}
                  </span>
                )}
                {k.jenis && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--ink)', opacity: 0.7, textTransform: 'capitalize' }}>
                    · {k.jenis}
                  </span>
                )}
              </div>

              {k.ringkasan && (
                <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--ink)', opacity: 0.85 }}>
                  {k.ringkasan}
                </p>
              )}

              {k.url_sumber && (
                <a href={k.url_sumber} target="_blank" rel="noopener noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25em',
                  ...monoStyle, fontSize: '0.7rem', color: 'var(--accent, #2563eb)', textDecoration: 'none',
                }}>
                  ↗ Sumber
                </a>
              )}
            </div>
          )
        })}
      </div>

      {confirmed.length > 1 && (
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Sembunyikan semua kasus' : `Lihat semua ${confirmed.length} kasus`}
          style={{
            marginTop: '0.25rem', padding: 0, background: 'none', border: 'none', cursor: 'pointer',
            ...monoStyle, fontSize: '0.72rem', color: 'var(--muted)', textDecoration: 'underline', textUnderlineOffset: '3px',
          }}
        >
          {expanded ? '↑ Sembunyikan' : `↓ Lihat semua ${confirmed.length} kasus`}
        </button>
      )}

      {mentioned.map((k) => <MentionNote key={k.kasus_id} k={k} />)}
    </section>
  )
}
