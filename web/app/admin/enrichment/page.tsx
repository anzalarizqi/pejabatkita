'use client'

import { useRef, useState } from 'react'

type ImportResult = {
  jabatanUpdated: number
  pejabatUpdated: number
  skipped: number
  errors: string[]
  total: number
}

const PROMPT_TEXT = `Ini adalah daftar jabatan pejabat Indonesia yang belum ada data partai dan masa jabatan.
Untuk setiap baris, cari di web:
1. partai — partai politik pengusung saat dilantik (singkatan resmi: PDIP, Golkar, Gerindra, PKB, NasDem, PPP, PKS, Demokrat, PAN, dll). Jika jalur perseorangan, isi "Independen". Jika tidak tahu, biarkan kosong.
2. mulai_jabatan_baru — tanggal mulai jabatan format YYYY-MM-DD. Isi hanya jika berbeda dari kolom mulai_jabatan atau jika mulai_jabatan kosong.
3. selesai_jabatan_baru — tanggal selesai jabatan format YYYY-MM-DD, jika sudah selesai menjabat.
4. nama_baru — isi HANYA untuk baris is_placeholder=Y, dengan nama lengkap orang yang menjabat.
5. sumber_url — URL sumber.
Kolom urls_tried berisi URL yang sudah terbukti tidak bisa diakses — jangan gunakan URL tersebut, cari sumber lain.
Kembalikan seluruh tabel CSV dengan format yang sama persis (termasuk header dan baris yang tidak berubah).`

function ClaudePrompt() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT_TEXT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="claude-prompt">
      <button className="copy-btn" onClick={copy}>{copied ? 'Tersalin ✓' : 'Salin'}</button>
      <div className="claude-prompt-label">Prompt untuk Claude</div>
      {PROMPT_TEXT}
    </div>
  )
}

export default function EnrichmentPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  function handleExport() {
    const a = document.createElement('a')
    a.href = '/api/admin/export-enrichment'
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
      const res = await fetch('/api/admin/import-enrichment', { method: 'POST', body: form })
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
        .enr-wrap { max-width: 720px; }

        .enr-section {
          border: 1px solid #d4cfc5;
          padding: 32px;
          margin-bottom: 24px;
        }

        .enr-section-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 8px;
        }

        .enr-section-sub {
          font-size: 11px;
          color: #8a857c;
          letter-spacing: 0.04em;
          line-height: 1.7;
          margin-bottom: 24px;
        }

        .enr-section-sub code {
          font-family: 'DM Mono', monospace;
          background: rgba(0,0,0,0.05);
          padding: 1px 5px;
          font-size: 10px;
        }

        .enr-steps {
          font-size: 11px;
          color: #5a5750;
          letter-spacing: 0.03em;
          line-height: 2;
          margin-bottom: 24px;
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

        .claude-prompt {
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
          white-space: pre-wrap;
        }

        .claude-prompt-label {
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

        .field-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 12px;
        }

        .field-pill {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          padding: 3px 8px;
          border: 1px solid #d4cfc5;
          color: #5a5750;
        }
      `}</style>

      <div className="enr-wrap">
        <div className="enr-section">
          <div className="enr-section-title">Langkah 1 — Unduh daftar untuk diisi</div>
          <div className="enr-section-sub">
            Unduh CSV berisi semua jabatan yang belum ada data partai.
            Kolom <code>is_placeholder=Y</code> berarti nama pejabat juga masih kosong.
            Kolom <code>urls_tried</code> berisi URL yang sudah dicoba agent sebelumnya —
            sertakan dalam prompt agar Claude tidak mencari ke tempat yang sama.
          </div>
          <div className="enr-steps">
            Unduh CSV → buka di spreadsheet → bagi per provinsi jika perlu<br />
            → kirim ke Claude dengan prompt di bawah → salin hasil → lanjut ke Langkah 2
          </div>
          <ClaudePrompt />
          <div style={{ marginTop: 24 }}>
            <button className="btn btn-primary" onClick={handleExport}>
              ⬇ Unduh CSV Enrichment
            </button>
          </div>
        </div>

        <div className="enr-section">
          <div className="enr-section-title">Langkah 2 — Unggah hasil dari Claude</div>
          <div className="enr-section-sub">
            Unggah kembali CSV yang sudah diisi Claude. Baris kosong di semua kolom berikut akan dilewati.
          </div>
          <div className="field-pills">
            {['partai', 'mulai_jabatan_baru', 'selesai_jabatan_baru', 'nama_baru'].map(f => (
              <span key={f} className="field-pill">{f}</span>
            ))}
          </div>
          <div className="upload-zone" style={{ marginTop: 20 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleImport}
              disabled={importing}
            />
            <div className="upload-label">
              {importing ? 'Memproses...' : 'Klik atau seret file CSV yang sudah diisi'}
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {result && (
            <div className="result-card">
              <div className="result-grid">
                <div className="result-stat">
                  <div className={`result-num${result.jabatanUpdated > 0 ? ' green' : ''}`}>
                    {result.jabatanUpdated}
                  </div>
                  <div className="result-label">Jabatan Diperbarui</div>
                </div>
                <div className="result-stat">
                  <div className={`result-num${result.pejabatUpdated > 0 ? ' green' : ''}`}>
                    {result.pejabatUpdated}
                  </div>
                  <div className="result-label">Nama Diperbarui</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.skipped}</div>
                  <div className="result-label">Dilewati</div>
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
