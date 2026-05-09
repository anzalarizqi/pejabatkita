'use client'

import { useRef, useState } from 'react'

type ImportResult = {
  updated: number
  skippedEmpty: number
  skippedBadName: number
  errors: string[]
  total: number
}

export default function PlaceholdersPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function handleExport() {
    const a = document.createElement('a')
    a.href = '/api/admin/export-csv'
    a.download = ''
    a.click()
  }

  async function handleExportAll() {
    const a = document.createElement('a')
    a.href = '/api/admin/export-all-csv'
    a.download = ''
    a.click()
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setResult(null)
    setImporting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/import-csv', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      setResult(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengimpor.')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <style>{`
        .ph-wrap { max-width: 720px; }
        .ph-section {
          border: 1px solid #d4cfc5;
          padding: 32px;
          margin-bottom: 24px;
        }
        .ph-section-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 8px;
        }
        .ph-section-sub {
          font-size: 11px;
          color: #8a857c;
          letter-spacing: 0.04em;
          line-height: 1.7;
          margin-bottom: 24px;
        }
        .ph-section-sub code {
          font-family: 'DM Mono', monospace;
          background: rgba(0,0,0,0.05);
          padding: 1px 5px;
          font-size: 10px;
        }
        .ph-steps {
          font-size: 11px;
          color: #5a5750;
          letter-spacing: 0.03em;
          line-height: 2;
          margin-bottom: 24px;
          padding-left: 4px;
          border-left: 2px solid #d4cfc5;
          padding-left: 16px;
        }
        .btn {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 12px 24px;
          cursor: pointer;
          border: none;
          transition: opacity 0.2s;
          display: inline-block;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: #c0392b; color: #f5f1ea; }
        .btn-primary:hover:not(:disabled) { opacity: 0.85; }
        .btn-ghost { background: transparent; color: #0f1117; border: 1px solid #d4cfc5; }
        .btn-ghost:hover:not(:disabled) { border-color: #8a857c; }
        .upload-zone {
          border: 1px dashed #d4cfc5;
          padding: 40px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          position: relative;
        }
        .upload-zone:hover { border-color: #8a857c; background: #f0ece4; }
        .upload-zone input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
        }
        .upload-label { font-size: 12px; color: #5a5750; letter-spacing: 0.04em; }
        .error-banner {
          background: #fff0ef;
          border: 1px solid #c0392b;
          padding: 12px 16px;
          font-size: 12px;
          color: #c0392b;
          margin-top: 16px;
        }
        .result-card {
          background: #0f1117;
          padding: 32px;
          margin-top: 16px;
        }
        .result-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 16px;
        }
        .result-stat { text-align: center; }
        .result-num {
          font-family: 'Fraunces', serif;
          font-size: 28px;
          font-weight: 300;
          color: #f5f1ea;
          line-height: 1;
          margin-bottom: 4px;
        }
        .result-num.green { color: #27ae60; }
        .result-label {
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #5a5e6a;
        }
        .result-errors {
          font-size: 10px;
          color: #c0392b;
          margin-top: 12px;
          max-height: 100px;
          overflow-y: auto;
          line-height: 1.8;
        }
        .divider { height: 1px; background: #d4cfc5; margin: 0 0 24px; }
        .gemini-prompt {
          background: #f0ece4;
          border: 1px solid #d4cfc5;
          padding: 20px 24px;
          font-size: 12px;
          color: #2a2c33;
          line-height: 1.7;
          font-family: 'Fraunces', serif;
          font-weight: 300;
          margin-top: 16px;
          position: relative;
        }
        .gemini-prompt-label {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #8a857c;
          margin-bottom: 10px;
        }
        .copy-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          background: none;
          border: 1px solid #d4cfc5;
          color: #8a857c;
          padding: 4px 10px;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        }
        .copy-btn:hover { color: #0f1117; border-color: #8a857c; }
      `}</style>

      <div className="ph-wrap">
        {/* Export section */}
        <div className="ph-section">
          <div className="ph-section-title">1 — Ekspor daftar placeholder</div>
          <div className="ph-section-sub">
            Unduh CSV berisi semua pejabat yang namanya belum terisi.
            Buka di Gemini (gemini.google.com) dengan web search aktif,
            minta Gemini mengisi kolom <code>nama_baru</code> dan <code>sumber_url</code>.
          </div>
          <div className="ph-steps">
            Buka gemini.google.com → aktifkan pencarian web → unggah/tempel isi CSV<br />
            Gunakan prompt di bawah → copy hasil CSV → lanjut ke langkah 2
          </div>
          <GeminiPrompt />
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleExport}>
              ⬇ Unduh CSV Placeholder
            </button>
            <button className="btn btn-ghost" onClick={handleExportAll}>
              ⬇ Unduh Semua Pejabat (Audit)
            </button>
          </div>
        </div>

        {/* Import section */}
        <div className="ph-section">
          <div className="ph-section-title">2 — Impor hasil Gemini</div>
          <div className="ph-section-sub">
            Unggah kembali CSV yang sudah diisi Gemini. Hanya baris dengan
            <code>nama_baru</code> tidak kosong yang akan diproses.
            Nama yang terlihat seperti placeholder tetap diabaikan.
          </div>

          <div className="upload-zone">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleImport}
              disabled={importing}
            />
            <div className="upload-label">
              {importing ? 'Memproses...' : 'Klik atau seret file CSV hasil Gemini'}
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {result && (
            <div className="result-card">
              <div className="result-grid">
                <div className="result-stat">
                  <div className={`result-num${result.updated > 0 ? ' green' : ''}`}>{result.updated}</div>
                  <div className="result-label">Diperbarui</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.skippedEmpty}</div>
                  <div className="result-label">Kosong</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.skippedBadName}</div>
                  <div className="result-label">Nama Buruk</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.total}</div>
                  <div className="result-label">Total Baris</div>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="result-errors">
                  {result.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const PROMPT_TEXT = `Ini adalah daftar jabatan pejabat Indonesia yang namanya belum diketahui (kolom nama_baru kosong).
Untuk setiap baris, cari di web siapa nama pejabat yang SAAT INI menjabat (pasca Pilkada 2024).
Isi kolom nama_baru dengan nama lengkap orang tersebut, dan sumber_url dengan URL sumber.
Kalau tidak ketemu, biarkan nama_baru tetap kosong.
Kembalikan seluruh tabel dalam format CSV yang sama persis (termasuk baris header dan baris yang tidak berubah).`

function GeminiPrompt() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT_TEXT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="gemini-prompt">
      <button className="copy-btn" onClick={copy}>{copied ? 'Tersalin ✓' : 'Salin'}</button>
      <div className="gemini-prompt-label">Prompt untuk Gemini</div>
      {PROMPT_TEXT}
    </div>
  )
}
