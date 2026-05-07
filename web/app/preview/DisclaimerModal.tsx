'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'pejabatkita_disclaimer_v1'

export default function DisclaimerModal() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const dismissed = window.localStorage.getItem(STORAGE_KEY)
      if (!dismissed) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString())
    } catch {
      // localStorage unavailable — still close
    }
    setOpen(false)
  }

  if (!mounted || !open) return null

  return (
    <div className="dm-overlay" role="dialog" aria-modal="true" aria-labelledby="dm-title">
      <style>{styles}</style>
      <div className="dm-card">
        <div className="dm-corner dm-tl" aria-hidden />
        <div className="dm-corner dm-tr" aria-hidden />
        <div className="dm-corner dm-bl" aria-hidden />
        <div className="dm-corner dm-br" aria-hidden />

        <div className="dm-header">
          <span className="dm-doc-id">DOC—001 / DISCLAIMER</span>
          <span className="dm-doc-date">
            {new Date().toLocaleDateString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>

        <h2 className="dm-title" id="dm-title">
          Sebelum <em>melanjutkan</em>.
        </h2>

        <div className="dm-body">
          <p>
            Peta Pejabat Indonesia adalah <strong>agregator data publik</strong>{' '}
            yang mengumpulkan informasi pejabat eksekutif daerah—gubernur, bupati,
            walikota, dan wakilnya—dari sumber-sumber terbuka.
          </p>
          <p>
            Data dihimpun dari Wikipedia, situs resmi pemerintah daerah
            (<span className="dm-mono">.go.id</span>), serta hasil penelusuran
            web yang diverifikasi oleh model bahasa. Karena itu,
            <strong> data dapat tidak lengkap, tertinggal dari kondisi terbaru,
            atau memuat kekeliruan</strong>. Setiap entri menyertakan tautan
            sumber agar dapat ditelusuri ulang.
          </p>
          <p>
            Situs ini bukan editorial, opini, atau penilaian terhadap
            individu. Tujuan kami sederhana: mengumpulkan fakta-fakta publik
            di satu tempat sehingga warga lebih mudah mengakses informasi
            tentang pejabat di daerahnya.
          </p>
          <p className="dm-cta-line">
            Menemukan kesalahan? Setiap profil memiliki tombol{' '}
            <span className="dm-pill">Laporkan</span> untuk mengirim koreksi.
          </p>
        </div>

        <button type="button" className="dm-stamp" onClick={dismiss}>
          <span className="dm-stamp-inner">Saya Mengerti · TERBACA</span>
        </button>
      </div>
    </div>
  )
}

const styles = `
  .dm-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 17, 23, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    animation: dm-fade 0.4s ease-out;
  }

  @keyframes dm-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .dm-card {
    position: relative;
    background: #f5f1ea;
    color: #0f1117;
    width: 100%;
    max-width: 560px;
    padding: 56px 56px 48px;
    border: 1px solid #0f1117;
    box-shadow: 12px 12px 0 #0f1117, 0 0 0 1px #0f1117 inset;
    /* layered paper feel: faint diagonal noise */
    background-image:
      repeating-linear-gradient(
        135deg,
        transparent 0,
        transparent 3px,
        rgba(15, 17, 23, 0.012) 3px,
        rgba(15, 17, 23, 0.012) 4px
      );
    animation: dm-rise 0.5s 0.05s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes dm-rise {
    from { opacity: 0; transform: translateY(18px) rotate(-0.3deg); }
    to   { opacity: 1; transform: translateY(0) rotate(0); }
  }

  .dm-corner {
    position: absolute;
    width: 14px;
    height: 14px;
    border-color: #c0392b;
    border-style: solid;
  }
  .dm-tl { top: 10px; left: 10px; border-width: 2px 0 0 2px; }
  .dm-tr { top: 10px; right: 10px; border-width: 2px 2px 0 0; }
  .dm-bl { bottom: 10px; left: 10px; border-width: 0 0 2px 2px; }
  .dm-br { bottom: 10px; right: 10px; border-width: 0 2px 2px 0; }

  .dm-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #8a857c;
    padding-bottom: 14px;
    border-bottom: 1px solid #d4cfc5;
    margin-bottom: 28px;
  }

  .dm-doc-id { color: #c0392b; font-weight: 500; }

  .dm-title {
    font-family: 'Fraunces', serif;
    font-weight: 200;
    font-size: 44px;
    line-height: 1.05;
    letter-spacing: -0.015em;
    margin-bottom: 28px;
  }

  .dm-title em {
    font-style: italic;
    color: #c0392b;
  }

  .dm-body {
    font-family: 'Fraunces', serif;
    font-weight: 300;
    font-size: 14.5px;
    line-height: 1.65;
    color: #2a2c33;
    margin-bottom: 36px;
  }

  .dm-body p { margin-bottom: 14px; }
  .dm-body p:last-child { margin-bottom: 0; }
  .dm-body strong { font-weight: 500; color: #0f1117; }

  .dm-mono {
    font-family: 'DM Mono', monospace;
    font-size: 12.5px;
    background: rgba(192, 57, 43, 0.06);
    padding: 1px 5px;
  }

  .dm-cta-line {
    margin-top: 18px !important;
    padding-top: 14px;
    border-top: 1px dashed #d4cfc5;
    font-size: 13px !important;
    color: #5a5750 !important;
  }

  .dm-pill {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: #0f1117;
    color: #f5f1ea;
    padding: 2px 8px;
    margin: 0 2px;
  }

  .dm-stamp {
    position: relative;
    background: transparent;
    border: 2px solid #c0392b;
    color: #c0392b;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    padding: 16px 28px;
    cursor: pointer;
    width: 100%;
    transition: all 0.18s ease;
    transform: rotate(-0.5deg);
  }

  .dm-stamp::before {
    content: '';
    position: absolute;
    inset: 4px;
    border: 1px solid rgba(192, 57, 43, 0.35);
    pointer-events: none;
  }

  .dm-stamp-inner { position: relative; z-index: 2; }

  .dm-stamp:hover {
    background: #c0392b;
    color: #f5f1ea;
    transform: rotate(0deg) translateY(-1px);
    box-shadow: 0 6px 0 -2px #0f1117;
  }

  .dm-stamp:active {
    transform: rotate(0deg) translateY(1px);
  }
`
