'use client'

import { useEffect, useState } from 'react'

export default function MisiKamiModal() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    function reopen() { setOpen(true) }
    window.addEventListener('pv:open-misi', reopen)
    return () => window.removeEventListener('pv:open-misi', reopen)
  }, [])

  if (!mounted || !open) return null

  return (
    <div className="mk-overlay" role="dialog" aria-modal="true" aria-labelledby="mk-title" onClick={() => setOpen(false)}>
      <style>{styles}</style>
      <div className="mk-card" onClick={e => e.stopPropagation()}>
        <div className="mk-corner mk-tl" aria-hidden />
        <div className="mk-corner mk-tr" aria-hidden />
        <div className="mk-corner mk-bl" aria-hidden />
        <div className="mk-corner mk-br" aria-hidden />

        <div className="mk-header">
          <span className="mk-doc-id">DOC—002 / MISI KAMI</span>
          <button className="mk-close" onClick={() => setOpen(false)} aria-label="Tutup">✕</button>
        </div>

        <h2 className="mk-title" id="mk-title">
          Kenapa situs <em>ini</em> ada?
        </h2>

        <div className="mk-body">
          <p>
            Indonesia punya <strong>514 kabupaten dan kota</strong>, masing-masing
            dipimpin kepala daerah yang dipilih langsung oleh rakyat. Tapi informasi
            tentang siapa mereka—nama, latar belakang, rekam jejak—tersebar di ratusan
            situs yang sulit ditelusuri.
          </p>
          <p>
            <strong>Peta Pejabat Indonesia</strong> hadir untuk menjawab satu
            pertanyaan sederhana: <em>siapa yang memimpin daerahku?</em>
          </p>
          <div className="mk-divider" />
          <div className="mk-pillars">
            <div className="mk-pillar">
              <div className="mk-pillar-icon">◎</div>
              <div className="mk-pillar-label">Transparansi</div>
              <div className="mk-pillar-text">
                Data pejabat publik adalah hak warga. Kami mengumpulkan informasi
                dari sumber terbuka—Wikipedia, situs resmi pemerintah, KPU—dan
                menyajikannya dalam satu tempat.
              </div>
            </div>
            <div className="mk-pillar">
              <div className="mk-pillar-icon">◈</div>
              <div className="mk-pillar-label">Akuntabilitas</div>
              <div className="mk-pillar-text">
                Setiap entri menyertakan sumber yang dapat ditelusuri. Setiap warga
                dapat melaporkan kesalahan. Tidak ada data tanpa bukti.
              </div>
            </div>
            <div className="mk-pillar">
              <div className="mk-pillar-icon">◐</div>
              <div className="mk-pillar-label">Keterbukaan</div>
              <div className="mk-pillar-text">
                Proyek ini terbuka untuk kontribusi. Temukan kesalahan? Tombol
                Laporkan ada di setiap profil.
              </div>
            </div>
          </div>
          <div className="mk-divider" />
          <p className="mk-note">
            Data dihimpun secara otomatis dan diverifikasi oleh model bahasa.
            Kami tidak berafiliasi dengan pemerintah maupun partai politik mana pun.
          </p>
        </div>

        <button type="button" className="mk-close-btn" onClick={() => setOpen(false)}>
          Tutup
        </button>
      </div>
    </div>
  )
}

const styles = `
  .mk-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(15, 17, 23, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    animation: mk-fade 0.3s ease-out;
  }

  @keyframes mk-fade { from { opacity: 0; } to { opacity: 1; } }

  .mk-card {
    position: relative;
    background: #f5f1ea;
    color: #0f1117;
    width: 100%;
    max-width: 580px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 48px 52px 44px;
    border: 1px solid #0f1117;
    box-shadow: 12px 12px 0 #0f1117;
    animation: mk-rise 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }

  @keyframes mk-rise {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .mk-corner {
    position: absolute;
    width: 14px; height: 14px;
    border-color: #c0392b;
    border-style: solid;
  }
  .mk-tl { top: 10px; left: 10px; border-width: 2px 0 0 2px; }
  .mk-tr { top: 10px; right: 10px; border-width: 2px 2px 0 0; }
  .mk-bl { bottom: 10px; left: 10px; border-width: 0 0 2px 2px; }
  .mk-br { bottom: 10px; right: 10px; border-width: 0 2px 2px 0; }

  .mk-header {
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

  .mk-doc-id { color: #c0392b; font-weight: 500; }

  .mk-close {
    background: none;
    border: none;
    color: #8a857c;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    transition: color 0.15s;
  }
  .mk-close:hover { color: #0f1117; }

  .mk-title {
    font-family: 'Fraunces', serif;
    font-weight: 200;
    font-size: 40px;
    line-height: 1.05;
    letter-spacing: -0.015em;
    margin-bottom: 24px;
  }
  .mk-title em { font-style: italic; color: #c0392b; }

  .mk-body {
    font-family: 'Fraunces', serif;
    font-weight: 300;
    font-size: 14px;
    line-height: 1.65;
    color: #2a2c33;
  }
  .mk-body p { margin-bottom: 14px; }
  .mk-body strong { font-weight: 500; color: #0f1117; }

  .mk-divider { height: 1px; background: #d4cfc5; margin: 20px 0; }

  .mk-pillars {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin: 20px 0;
  }

  .mk-pillar { }

  .mk-pillar-icon {
    font-size: 18px;
    color: #c0392b;
    margin-bottom: 8px;
  }

  .mk-pillar-label {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #0f1117;
    margin-bottom: 6px;
  }

  .mk-pillar-text {
    font-size: 12px;
    line-height: 1.6;
    color: #5a5750;
  }

  .mk-note {
    font-size: 12px !important;
    color: #8a857c !important;
    font-style: italic;
  }

  .mk-close-btn {
    margin-top: 28px;
    background: #0f1117;
    color: #f5f1ea;
    border: none;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 14px 32px;
    cursor: pointer;
    width: 100%;
    transition: opacity 0.2s;
  }
  .mk-close-btn:hover { opacity: 0.8; }
`
