'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PejabatRow, JabatanRow, Wilayah, KasusRow } from '@/lib/types'
import LaporkanModal from './LaporkanModal'
import KasusSection from '@/app/_components/KasusSection'

interface Props {
  pejabat: PejabatRow
  jabatan: (JabatanRow & { wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'> })[]
  provinsiNama: string | null
  kasus: KasusRow[]
}

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function formatTanggal(raw: string | null | undefined): string {
  if (!raw) return '—'
  const s = raw.trim()
  if (!s) return '—'
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const [, y, m, d] = iso
    const monthIdx = parseInt(m, 10) - 1
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${parseInt(d, 10)} ${BULAN_ID[monthIdx]} ${y}`
    }
  }
  if (/^\d{4}$/.test(s)) return s
  return s
}

// Deterministic 0–1 hash so PRATINJAU sections look stable per pejabat
function hash01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export default function ProfileClient({ pejabat, jabatan, provinsiNama, kasus }: Props) {
  const [showModal, setShowModal] = useState(false)

  const jabatanAktif = jabatan.filter((j) => j.status === 'aktif')
  const sources = pejabat.metadata?.sources ?? []

  const namaLengkap = [
    pejabat.gelar_depan,
    pejabat.nama_lengkap,
    pejabat.gelar_belakang,
  ].filter(Boolean).join(' ')

  const tanggalLahir = formatTanggal(pejabat.biodata?.tanggal_lahir)
  const bio = pejabat.biodata
  const hasAnyBio = !!(bio?.tempat_lahir || bio?.tanggal_lahir || bio?.jenis_kelamin || bio?.agama)

  // Mock LHKPN/integrity values, deterministic per pejabat. Until 9B/9C ship,
  // these never claim to be real — every appearance is paired with a PRATINJAU stamp.
  const mockLhkpnPct = Math.floor(hash01(pejabat.id + ':lhkpn') * 100)
  const mockBersih = hash01(pejabat.id + ':bersih')
  const mockBersihLabel = mockBersih > 0.85 ? 'Tercatat' : 'Belum tercatat'

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,700;1,9..144,300&family=DM+Mono:wght@400;500&display=swap');

        :root {
          --ink: #0f1117;
          --paper: #f5f1ea;
          --accent: #c0392b;
          --rule: #d4cfc5;
          --muted: #8a857c;
          --muted-2: #6b665e;
        }

        * { box-sizing: border-box; }

        body {
          background: var(--paper);
          font-family: 'DM Mono', monospace;
          color: var(--ink);
        }

        /* ── Editorial header (mirrors homepage) ─────────────────────── */
        .pp-header {
          border-bottom: 1.5px solid var(--ink);
          padding: 16px 32px 14px;
          display: grid;
          grid-template-columns: minmax(240px, 1fr) auto minmax(240px, 1fr);
          align-items: center;
          gap: 24px;
          background: var(--paper);
        }
        .pp-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--ink); }
        .pp-brand-mark { color: var(--accent); font-size: 22px; line-height: 1; transform: translateY(-1px); }
        .pp-brand-text { display: flex; flex-direction: column; line-height: 1.1; }
        .pp-brand-name { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 400; letter-spacing: -0.01em; }
        .pp-brand-sub { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-top: 3px; }
        .pp-nav { display: flex; gap: 4px; align-items: center; justify-self: center; }
        .pp-nav-link {
          font-size: 10.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted-2);
          text-decoration: none;
          padding: 8px 16px;
          transition: color 0.15s ease;
        }
        .pp-nav-link:hover { color: var(--ink); }
        .pp-edisi {
          justify-self: end;
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .profile-root {
          max-width: 900px;
          margin: 0 auto;
          padding: 32px 32px 80px;
        }

        .pp-crumb {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 28px;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .pp-crumb a { color: var(--muted); text-decoration: none; }
        .pp-crumb a:hover { color: var(--ink); }
        .pp-crumb .sep { opacity: 0.5; }

        .profile-header {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 24px;
          align-items: start;
          border-bottom: 2px solid var(--ink);
          padding-bottom: 28px;
          margin-bottom: 36px;
        }

        .profile-nama {
          font-family: 'Fraunces', serif;
          font-size: clamp(28px, 4vw, 44px);
          font-weight: 300;
          line-height: 1.2;
          color: var(--ink);
          margin-bottom: 12px;
        }

        .profile-jabatan-aktif {
          font-size: 14px;
          color: var(--ink);
          line-height: 1.6;
        }

        .pp-aktif-row { margin-bottom: 4px; }
        .pp-aktif-posisi {
          display: inline-block;
          font-size: 11px;
          color: var(--accent);
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-right: 8px;
        }
        .pp-aktif-wilayah { color: var(--ink); font-size: 13px; }
        .pp-partai-chip {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          font-size: 10px;
          letter-spacing: 0.06em;
          background: var(--ink);
          color: var(--paper);
        }

        .laporkan-btn {
          white-space: nowrap;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 10px 18px;
          background: none;
          border: 1px solid var(--rule);
          color: var(--muted);
          cursor: pointer;
          transition: all 0.15s;
          margin-top: 4px;
        }
        .laporkan-btn:hover { border-color: var(--accent); color: var(--accent); }

        .section { margin-bottom: 36px; }
        .section-title {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted);
          border-bottom: 1px solid var(--rule);
          padding-bottom: 8px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .section-tag {
          font-size: 8px;
          letter-spacing: 0.14em;
          background: var(--accent);
          color: var(--paper);
          padding: 2px 7px;
        }

        .bio-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 32px; }
        .bio-label { font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
        .bio-value { font-size: 13px; color: var(--ink); }

        .jabatan-table { width: 100%; border-collapse: collapse; }
        .jabatan-table th {
          text-align: left; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--muted); padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); font-weight: 400;
        }
        .jabatan-table td {
          font-size: 12px; color: var(--ink);
          padding: 10px 12px 10px 0; border-bottom: 1px solid #ede9e1; vertical-align: top;
        }
        .jabatan-status {
          display: inline-block; padding: 2px 7px; font-size: 8px;
          letter-spacing: 0.1em; text-transform: uppercase;
        }
        .jabatan-status.aktif { background: #e8f5e9; color: #1b5e20; }
        .jabatan-status.penjabat { background: #fff8e1; color: #e65100; }
        .jabatan-status.nonaktif { background: #f5f5f5; color: #616161; }

        .pendidikan-list { display: flex; flex-direction: column; gap: 12px; }
        .pendidikan-item { display: flex; gap: 16px; align-items: baseline; }
        .pendidikan-jenjang {
          font-size: 10px; padding: 2px 8px; background: #0f1117; color: #f5f1ea;
          letter-spacing: 0.06em; flex-shrink: 0;
        }
        .pendidikan-detail { font-size: 12px; color: var(--ink); line-height: 1.5; }
        .pendidikan-sub { font-size: 10px; color: var(--muted); }

        /* ── PRATINJAU sections ──────────────────────────────────────── */
        .pratinjau {
          position: relative;
          border: 1px dashed var(--rule);
          padding: 24px;
          background: rgba(255,255,255,0.35);
        }
        .pratinjau-stamp {
          position: absolute;
          top: 8px;
          right: 12px;
          font-size: 8px;
          letter-spacing: 0.18em;
          color: var(--accent);
          background: var(--paper);
          padding: 2px 6px;
          border: 1px solid var(--accent);
        }
        .pratinjau-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 24px; align-items: center; }
        .pratinjau-stat {
          font-family: 'Fraunces', serif;
          font-size: 38px;
          font-weight: 300;
          color: var(--muted);
          font-style: italic;
        }
        .pratinjau-caption { font-size: 11px; color: var(--muted); line-height: 1.6; font-style: italic; }
        .pratinjau-bar { height: 6px; background: var(--rule); margin-top: 10px; position: relative; }
        .pratinjau-fill { height: 100%; background: var(--muted); }

        .sources-list { display: flex; flex-direction: column; gap: 8px; }
        .source-item { display: flex; align-items: center; gap: 10px; font-size: 11px; }
        .source-type {
          font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
          padding: 2px 6px; border: 1px solid var(--rule); color: var(--muted); flex-shrink: 0;
        }
        .source-item a {
          color: #1565c0; text-decoration: none;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .source-item a:hover { text-decoration: underline; }

        .conf-bar { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 10px; color: var(--muted); }
        .conf-track { width: 120px; height: 4px; background: var(--rule); border-radius: 2px; overflow: hidden; }
        .conf-fill { height: 100%; background: var(--accent); border-radius: 2px; }

        @media (max-width: 720px) {
          .pp-header {
            grid-template-columns: 1fr auto;
            padding: 12px 20px 10px;
          }
          .pp-edisi { display: none; }
          .pp-nav { justify-self: end; gap: 0; }
          .pp-nav-link { padding: 6px 8px; font-size: 9.5px; letter-spacing: 0.14em; }
          .profile-root { padding: 20px 20px 60px; }
          .profile-header { grid-template-columns: 1fr; }
          .laporkan-btn { justify-self: start; }
          .bio-grid { grid-template-columns: 1fr; }
          .pratinjau-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <header className="pp-header">
        <Link href="/" className="pp-brand">
          <span className="pp-brand-mark" aria-hidden>◐</span>
          <div className="pp-brand-text">
            <span className="pp-brand-name">Peta Pejabat Indonesia</span>
            <span className="pp-brand-sub">Dosir publik</span>
          </div>
        </Link>
        <nav className="pp-nav" aria-label="Navigasi utama">
          <Link href="/" className="pp-nav-link">Beranda</Link>
          <Link href="/pejabat" className="pp-nav-link">Direktori</Link>
          <Link href="/admin/login" className="pp-nav-link">Lapor</Link>
        </nav>
        <span className="pp-edisi">Profil</span>
      </header>

      <div className="profile-root">
        <div className="pp-crumb">
          <Link href="/">Beranda</Link>
          <span className="sep">›</span>
          <Link href="/pejabat">Direktori</Link>
          {provinsiNama && (
            <>
              <span className="sep">›</span>
              <Link href={`/pejabat?provinsi=${encodeURIComponent(provinsiNama)}`}>{provinsiNama}</Link>
            </>
          )}
        </div>

        <div className="profile-header">
          <div>
            <h1 className="profile-nama">{namaLengkap}</h1>
            <div className="profile-jabatan-aktif">
              {jabatanAktif.length > 0 ? (
                jabatanAktif.map((j) => (
                  <div key={j.id} className="pp-aktif-row">
                    <span className="pp-aktif-posisi">{j.posisi}</span>
                    <span className="pp-aktif-wilayah">{j.wilayah?.nama ?? ''}</span>
                    {j.partai && <span className="pp-partai-chip">{j.partai}</span>}
                  </div>
                ))
              ) : (
                <span style={{ color: 'var(--muted)' }}>Tidak ada jabatan aktif tercatat</span>
              )}
            </div>
          </div>
          <button className="laporkan-btn" onClick={() => setShowModal(true)}>
            ⚑ Laporkan Data
          </button>
        </div>

        {/* Biodata — collapsed if empty */}
        {hasAnyBio && (
          <div className="section">
            <div className="section-title"><span>Biodata</span></div>
            <div className="bio-grid">
              <div className="bio-item">
                <div className="bio-label">Tempat Lahir</div>
                <div className="bio-value">{bio?.tempat_lahir ?? '—'}</div>
              </div>
              <div className="bio-item">
                <div className="bio-label">Tanggal Lahir</div>
                <div className="bio-value">{tanggalLahir}</div>
              </div>
              <div className="bio-item">
                <div className="bio-label">Jenis Kelamin</div>
                <div className="bio-value">
                  {bio?.jenis_kelamin === 'L' ? 'Laki-laki'
                    : bio?.jenis_kelamin === 'P' ? 'Perempuan'
                    : '—'}
                </div>
              </div>
              <div className="bio-item">
                <div className="bio-label">Agama</div>
                <div className="bio-value">{bio?.agama ?? '—'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Riwayat Jabatan */}
        <div className="section">
          <div className="section-title"><span>Riwayat Jabatan</span></div>
          <table className="jabatan-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Jabatan</th>
                <th>Wilayah</th>
                <th>Partai</th>
                <th>Masa Jabatan</th>
              </tr>
            </thead>
            <tbody>
              {jabatan.map((j) => (
                <tr key={j.id}>
                  <td><span className={`jabatan-status ${j.status}`}>{j.status}</span></td>
                  <td>{j.posisi}</td>
                  <td>{j.wilayah?.nama ?? '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{j.partai ?? '—'}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {j.mulai_jabatan ?? '?'}
                    {j.selesai_jabatan ? ` — ${j.selesai_jabatan}` : j.status === 'aktif' ? ' — sekarang' : ''}
                  </td>
                </tr>
              ))}
              {jabatan.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--muted)', padding: '20px 0' }}>
                    Tidak ada data jabatan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pendidikan — only if real data exists */}
        {pejabat.pendidikan?.length > 0 && (
          <div className="section">
            <div className="section-title"><span>Pendidikan</span></div>
            <div className="pendidikan-list">
              {pejabat.pendidikan.map((p, i) => (
                <div key={i} className="pendidikan-item">
                  <span className="pendidikan-jenjang">{p.jenjang}</span>
                  <div className="pendidikan-detail">
                    {p.institusi}
                    <div className="pendidikan-sub">
                      {p.jurusan ?? ''}
                      {p.tahun_lulus ? ` · ${p.tahun_lulus}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LHKPN — PRATINJAU until Phase 9B */}
        <div className="section">
          <div className="section-title">
            <span>LHKPN — Laporan Harta Kekayaan</span>
            <span className="section-tag">Pratinjau</span>
          </div>
          <div className="pratinjau">
            <div className="pratinjau-stamp">DATA ILUSTRASI · Q2 2026</div>
            <div className="pratinjau-grid">
              <div>
                <div className="pratinjau-stat">{mockLhkpnPct}<span style={{ fontSize: 18 }}>%</span></div>
                <div style={{ fontSize: 10, letterSpacing: 0.1, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 4 }}>
                  Kelengkapan ilustrasi
                </div>
                <div className="pratinjau-bar"><div className="pratinjau-fill" style={{ width: `${mockLhkpnPct}%` }} /></div>
              </div>
              <div className="pratinjau-caption">
                Bagian ini akan menampilkan ringkasan harta kekayaan dari elhkpn.kpk.go.id —
                aset, utang, perubahan dari periode sebelumnya, dan tautan ke laporan resmi.
                Sedang disiapkan; angka di atas hanya tata letak.
              </div>
            </div>
          </div>
        </div>

        {/* Rekam Bersih — real data from kasus table */}
        <KasusSection kasus={kasus} />

        {/* Sumber Data */}
        {sources.length > 0 && (
          <div className="section">
            <div className="section-title"><span>Sumber Data</span></div>
            <div className="sources-list">
              {sources.map((s, i) => (
                <div key={i} className="source-item">
                  <span className="source-type">{s.type}</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">{s.domain}</a>
                  <span style={{ color: 'var(--rule)', fontSize: 10 }}>
                    {s.scraped_at && !isNaN(new Date(s.scraped_at).getTime())
                      ? new Date(s.scraped_at).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
                      : '—'}
                  </span>
                </div>
              ))}
            </div>

            {(pejabat.metadata?.confidence?.score ?? 0) > 0 && (
              <div className="conf-bar">
                <span>Kepercayaan data:</span>
                <div className="conf-track">
                  <div className="conf-fill" style={{ width: `${(pejabat.metadata.confidence.score ?? 0) * 100}%` }} />
                </div>
                <span>{((pejabat.metadata.confidence.score ?? 0) * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <LaporkanModal
          pejabatId={pejabat.id}
          namaPejabat={namaLengkap}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
