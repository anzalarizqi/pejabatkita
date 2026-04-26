'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PejabatRow, JabatanRow, Wilayah } from '@/lib/types'
import LaporkanModal from './LaporkanModal'

interface Props {
  pejabat: PejabatRow
  jabatan: (JabatanRow & { wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'> })[]
}

export default function ProfileClient({ pejabat, jabatan }: Props) {
  const [showModal, setShowModal] = useState(false)

  const jabatanAktif = jabatan.filter((j) => j.status === 'aktif')
  const jabatanLainnya = jabatan.filter((j) => j.status !== 'aktif')
  const sources = pejabat.metadata?.sources ?? []

  const namaLengkap = [
    pejabat.gelar_depan,
    pejabat.nama_lengkap,
    pejabat.gelar_belakang,
  ].filter(Boolean).join(' ')

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
        }

        * { box-sizing: border-box; }

        body {
          background: var(--paper);
          font-family: 'DM Mono', monospace;
          color: var(--ink);
        }

        .profile-root {
          max-width: 900px;
          margin: 0 auto;
          padding: 48px 32px 80px;
        }

        .profile-nav {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 48px;
          font-size: 11px;
          color: var(--muted);
        }

        .profile-nav a {
          color: var(--muted);
          text-decoration: none;
        }

        .profile-nav a:hover {
          color: var(--ink);
        }

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
          color: var(--muted);
          line-height: 1.6;
        }

        .profile-jabatan-aktif span {
          display: block;
          font-size: 12px;
          color: var(--accent);
          font-weight: 500;
          letter-spacing: 0.04em;
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

        .laporkan-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        .section {
          margin-bottom: 36px;
        }

        .section-title {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--muted);
          border-bottom: 1px solid var(--rule);
          padding-bottom: 8px;
          margin-bottom: 16px;
        }

        .bio-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px 32px;
        }

        .bio-item {}

        .bio-label {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 4px;
        }

        .bio-value {
          font-size: 13px;
          color: var(--ink);
        }

        .jabatan-table {
          width: 100%;
          border-collapse: collapse;
        }

        .jabatan-table th {
          text-align: left;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          padding: 8px 12px 8px 0;
          border-bottom: 1px solid var(--rule);
          font-weight: 400;
        }

        .jabatan-table td {
          font-size: 12px;
          color: var(--ink);
          padding: 10px 12px 10px 0;
          border-bottom: 1px solid #ede9e1;
          vertical-align: top;
        }

        .jabatan-status {
          display: inline-block;
          padding: 2px 7px;
          font-size: 8px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .jabatan-status.aktif {
          background: #e8f5e9;
          color: #1b5e20;
        }

        .jabatan-status.penjabat {
          background: #fff8e1;
          color: #e65100;
        }

        .jabatan-status.nonaktif {
          background: #f5f5f5;
          color: #616161;
        }

        .pendidikan-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .pendidikan-item {
          display: flex;
          gap: 16px;
          align-items: baseline;
        }

        .pendidikan-jenjang {
          font-size: 10px;
          padding: 2px 8px;
          background: #0f1117;
          color: #f5f1ea;
          letter-spacing: 0.06em;
          flex-shrink: 0;
        }

        .pendidikan-detail {
          font-size: 12px;
          color: var(--ink);
          line-height: 1.5;
        }

        .pendidikan-sub {
          font-size: 10px;
          color: var(--muted);
        }

        .sources-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .source-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
        }

        .source-type {
          font-size: 8px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 2px 6px;
          border: 1px solid var(--rule);
          color: var(--muted);
          flex-shrink: 0;
        }

        .source-item a {
          color: #1565c0;
          text-decoration: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .source-item a:hover {
          text-decoration: underline;
        }

        .conf-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 8px;
          font-size: 10px;
          color: var(--muted);
        }

        .conf-track {
          width: 120px;
          height: 4px;
          background: var(--rule);
          border-radius: 2px;
          overflow: hidden;
        }

        .conf-fill {
          height: 100%;
          background: var(--accent);
          border-radius: 2px;
        }
      `}</style>

      <div className="profile-root">
        <div className="profile-nav">
          <Link href="/">Beranda</Link>
          <span>›</span>
          <span>{pejabat.nama_lengkap}</span>
        </div>

        <div className="profile-header">
          <div>
            <h1 className="profile-nama">{namaLengkap}</h1>
            <div className="profile-jabatan-aktif">
              {jabatanAktif.length > 0 ? (
                jabatanAktif.map((j) => (
                  <div key={j.id}>
                    <span>{j.posisi}</span>
                    {j.wilayah?.nama ?? ''}
                    {j.partai ? ` · ${j.partai}` : ''}
                  </div>
                ))
              ) : (
                <span style={{ color: 'var(--muted)' }}>Tidak ada jabatan aktif</span>
              )}
            </div>
          </div>
          <button className="laporkan-btn" onClick={() => setShowModal(true)}>
            ⚑ Laporkan Data
          </button>
        </div>

        {/* Biodata */}
        <div className="section">
          <div className="section-title">Biodata</div>
          <div className="bio-grid">
            <div className="bio-item">
              <div className="bio-label">Tempat Lahir</div>
              <div className="bio-value">{pejabat.biodata?.tempat_lahir ?? '—'}</div>
            </div>
            <div className="bio-item">
              <div className="bio-label">Tanggal Lahir</div>
              <div className="bio-value">{pejabat.biodata?.tanggal_lahir ?? '—'}</div>
            </div>
            <div className="bio-item">
              <div className="bio-label">Jenis Kelamin</div>
              <div className="bio-value">
                {pejabat.biodata?.jenis_kelamin === 'L' ? 'Laki-laki'
                  : pejabat.biodata?.jenis_kelamin === 'P' ? 'Perempuan'
                  : '—'}
              </div>
            </div>
            <div className="bio-item">
              <div className="bio-label">Agama</div>
              <div className="bio-value">{pejabat.biodata?.agama ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* Riwayat Jabatan */}
        <div className="section">
          <div className="section-title">Riwayat Jabatan</div>
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
                  <td>
                    <span className={`jabatan-status ${j.status}`}>{j.status}</span>
                  </td>
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

        {/* Pendidikan */}
        {pejabat.pendidikan?.length > 0 && (
          <div className="section">
            <div className="section-title">Pendidikan</div>
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

        {/* Sumber */}
        {sources.length > 0 && (
          <div className="section">
            <div className="section-title">Sumber Data</div>
            <div className="sources-list">
              {sources.map((s, i) => (
                <div key={i} className="source-item">
                  <span className="source-type">{s.type}</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.domain}
                  </a>
                  <span style={{ color: 'var(--rule)', fontSize: 10 }}>
                    {new Date(s.scraped_at).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>

            {pejabat.metadata?.confidence && (
              <div className="conf-bar">
                <span>Kepercayaan data:</span>
                <div className="conf-track">
                  <div
                    className="conf-fill"
                    style={{ width: `${(pejabat.metadata.confidence.score ?? 0) * 100}%` }}
                  />
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
