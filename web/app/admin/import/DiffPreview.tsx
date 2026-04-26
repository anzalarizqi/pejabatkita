'use client'

import { useState } from 'react'
import { ImportDiff, DiffEntry } from '@/lib/types'

function DiffEntryRow({ entry, index }: { entry: DiffEntry; index: number }) {
  const [open, setOpen] = useState(entry.action === 'updated')
  const p = entry.incoming
  const jabatanAktif = p.jabatan?.find((j) => j.status === 'aktif') ?? p.jabatan?.[0]

  const badgeColor = entry.action === 'new'
    ? { bg: '#e8f5e9', color: '#1b5e20', text: 'Baru' }
    : entry.action === 'updated'
    ? { bg: '#fff8e1', color: '#e65100', text: 'Diperbarui' }
    : { bg: '#f5f5f5', color: '#616161', text: 'Tidak Berubah' }

  return (
    <div style={{ borderBottom: '1px solid #ede9e1' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '70px 1fr 200px 20px',
          gap: 16,
          padding: '12px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          alignItems: 'center',
          fontFamily: "'DM Mono', monospace",
        }}
      >
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          background: badgeColor.bg,
          color: badgeColor.color,
          fontWeight: 500,
        }}>
          {badgeColor.text}
        </span>

        <div>
          <div style={{ fontSize: 13, color: '#0f1117', fontWeight: 500 }}>
            {p.gelar_depan ? `${p.gelar_depan} ` : ''}{p.nama_lengkap}
            {p.gelar_belakang ? `, ${p.gelar_belakang}` : ''}
          </div>
          <div style={{ fontSize: 10, color: '#8a857c', marginTop: 2 }}>
            {jabatanAktif?.posisi ?? '—'} · {jabatanAktif?.wilayah ?? '—'}
          </div>
        </div>

        <div style={{ fontSize: 10, color: '#8a857c' }}>
          {entry.changedFields?.length
            ? entry.changedFields.slice(0, 3).join(', ') + (entry.changedFields.length > 3 ? '…' : '')
            : entry.action === 'new'
            ? `${p.jabatan?.length ?? 0} jabatan`
            : ''}
        </div>

        <span style={{ color: '#8a857c', fontSize: 14, transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
      </button>

      {open && (
        <div style={{ padding: '12px 0 20px 86px', background: '#faf9f6' }}>
          {/* Biodata */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              ['Tempat Lahir', p.biodata?.tempat_lahir],
              ['Tgl. Lahir', p.biodata?.tanggal_lahir],
              ['Jenis Kelamin', p.biodata?.jenis_kelamin],
              ['Agama', p.biodata?.agama],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c', marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: val ? '#0f1117' : '#d4cfc5' }}>
                  {val ?? '—'}
                </div>
              </div>
            ))}
          </div>

          {/* Jabatan list */}
          {p.jabatan?.length > 0 && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c', marginBottom: 6 }}>
                Jabatan
              </div>
              {p.jabatan.map((j, i) => (
                <div key={i} style={{
                  display: 'flex',
                  gap: 10,
                  fontSize: 11,
                  color: '#0f1117',
                  marginBottom: 4,
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: 8,
                    padding: '1px 5px',
                    background: j.status === 'aktif' ? '#e8f5e9' : '#f5f5f5',
                    color: j.status === 'aktif' ? '#1b5e20' : '#616161',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}>
                    {j.status}
                  </span>
                  <span>{j.posisi}</span>
                  <span style={{ color: '#8a857c' }}>·</span>
                  <span style={{ color: '#8a857c' }}>{j.wilayah}</span>
                  {j.partai && <span style={{ color: '#8a857c' }}>({j.partai})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Changed fields highlight */}
          {entry.action === 'updated' && entry.changedFields && entry.changedFields.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e65100', marginBottom: 6 }}>
                Field yang berubah
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {entry.changedFields.map((f) => (
                  <span key={f} style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    background: '#fff8e1',
                    color: '#e65100',
                    border: '1px solid #ffe0b2',
                  }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c', marginBottom: 3 }}>
                Kepercayaan
              </div>
              <div style={{
                fontSize: 12,
                color: (p.metadata?.confidence?.score ?? 0) >= 0.8 ? '#27ae60'
                  : (p.metadata?.confidence?.score ?? 0) >= 0.5 ? '#f39c12' : '#c0392b',
                fontWeight: 500,
              }}>
                {((p.metadata?.confidence?.score ?? 0) * 100).toFixed(0)}%
              </div>
            </div>
            {p.metadata?.needs_review && (
              <div style={{ fontSize: 10, color: '#c0392b', alignSelf: 'flex-end', paddingBottom: 2 }}>
                ⚑ Perlu tinjauan
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DiffPreview({ diff }: { diff: ImportDiff }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const newEntries = diff.entries.filter((e) => e.action === 'new')
  const updatedEntries = diff.entries.filter((e) => e.action === 'updated')
  const unchangedEntries = diff.entries.filter((e) => e.action === 'unchanged')

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: 'flex',
        gap: 24,
        padding: '16px 20px',
        background: '#0f1117',
        marginBottom: 24,
        alignItems: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#5a5e6a', letterSpacing: '0.06em' }}>
          Provinsi: <span style={{ color: '#f5f1ea' }}>{diff.province}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 20 }}>
          {[
            { count: diff.newCount, label: 'Baru', color: '#27ae60' },
            { count: diff.updatedCount, label: 'Diperbarui', color: '#f39c12' },
            { count: diff.unchangedCount, label: 'Tidak Berubah', color: '#3a3e4a' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, color: s.color, fontFamily: "'Fraunces', serif", fontWeight: 300, lineHeight: 1 }}>
                {s.count}
              </div>
              <div style={{ fontSize: 9, color: '#5a5e6a', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* New entries */}
      {newEntries.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#27ae60', marginBottom: 12 }}>
            ● Pejabat Baru ({newEntries.length})
          </div>
          {newEntries.map((e, i) => <DiffEntryRow key={e.incoming.id} entry={e} index={i} />)}
        </div>
      )}

      {/* Updated entries */}
      {updatedEntries.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#f39c12', marginBottom: 12 }}>
            ● Diperbarui ({updatedEntries.length})
          </div>
          {updatedEntries.map((e, i) => <DiffEntryRow key={e.incoming.id} entry={e} index={i} />)}
        </div>
      )}

      {/* Unchanged entries — collapsed */}
      {unchangedEntries.length > 0 && (
        <div>
          <button
            onClick={() => setShowUnchanged((o) => !o)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#8a857c',
              marginBottom: 8,
              fontFamily: "'DM Mono', monospace",
              padding: 0,
            }}
          >
            {showUnchanged ? '▾' : '▸'} Tidak Berubah ({unchangedEntries.length})
          </button>
          {showUnchanged && unchangedEntries.map((e, i) => <DiffEntryRow key={e.incoming.id} entry={e} index={i} />)}
        </div>
      )}
    </div>
  )
}
