'use client'

import { useEffect, useRef, useState } from 'react'

type ImportResult = {
  jabatanUpdated: number
  pejabatUpdated: number
  skipped: number
  errors: string[]
  reviewPartai: string[]
  total: number
}

const PROVINCES = [
  'Aceh', 'Bali', 'Banten', 'Bengkulu',
  'DI Yogyakarta', 'DKI Jakarta',
  'Gorontalo',
  'Jambi', 'Jawa Barat', 'Jawa Tengah', 'Jawa Timur',
  'Kalimantan Barat', 'Kalimantan Selatan', 'Kalimantan Tengah', 'Kalimantan Timur', 'Kalimantan Utara',
  'Kepulauan Bangka Belitung', 'Kepulauan Riau',
  'Lampung',
  'Maluku', 'Maluku Utara',
  'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Pegunungan', 'Papua Selatan', 'Papua Tengah',
  'Riau',
  'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tengah', 'Sulawesi Tenggara', 'Sulawesi Utara',
  'Sumatera Barat', 'Sumatera Selatan', 'Sumatera Utara',
]

const PROMPT_TEXT = `Ini daftar jabatan pejabat Indonesia yang belum ada data partai. Untuk setiap baris, cari di web partai politik pengusung pejabat tersebut saat dilantik.

Isi kolom:
- partai — gunakan SINGKATAN RESMI (PDIP, Golkar, Gerindra, PKB, NasDem, PPP, PKS, Demokrat, PAN, PSI, Perindo, Hanura, PBB, dll).
  - Jalur perseorangan/independen → tulis "Independen".
  - Partai baru yang tidak ada di contoh → tetap gunakan nama/singkatan RESMI partai itu.
  - Tidak yakin atau tanpa sumber kredibel → BIARKAN KOSONG. Jangan menebak.
- sumber_url — WAJIB diisi jika partai diisi (KPU, situs resmi pemda, atau berita kredibel).
- mulai_jabatan_baru / selesai_jabatan_baru (format YYYY-MM-DD) dan nama_baru — opsional; isi hanya jika tahu. nama_baru hanya untuk baris is_placeholder=Y.

ATURAN KETAT:
- Satu pejabat = satu partai pengusung utama saat pemilihan. Jika diusung koalisi, tulis partai asal/kader pejabat.
- JANGAN menebak dari kemiripan nama atau asumsi. Tanpa sumber = kosong.
- Gunakan singkatan resmi yang konsisten (PDIP, bukan "PDI-P" atau "PDI Perjuangan").
- Kembalikan seluruh tabel CSV dalam format yang sama persis (header + semua baris, termasuk yang tidak diubah).`

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
  const [provinsi, setProvinsi] = useState('')
  const [pusatBatches, setPusatBatches] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  // How many batches of null-partai Pusat (kabinet) officials remain
  useEffect(() => {
    fetch('/api/admin/export-enrichment?bucket=pusat&meta=1')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setPusatBatches(d.batches) })
      .catch(() => { /* ignore — provinces still work */ })
  }, [])

  function handleExport() {
    if (!provinsi) return
    const a = document.createElement('a')
    a.href = provinsi.startsWith('pusat:')
      ? `/api/admin/export-enrichment?bucket=pusat&batch=${provinsi.slice('pusat:'.length)}`
      : `/api/admin/export-enrichment?provinsi=${encodeURIComponent(provinsi)}`
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

        .province-row {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 24px;
        }
        .province-select {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.04em;
          padding: 10px 14px;
          border: 1px solid #d4cfc5;
          background: #f5f1ea;
          color: #0f1117;
          flex: 1;
          max-width: 280px;
          cursor: pointer;
        }
        .province-select:focus { outline: 1px solid #8a857c; }
        .review-list {
          font-size: 10px;
          color: #f39c12;
          margin-top: 12px;
          line-height: 1.8;
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
          <div className="province-row">
            <select
              className="province-select"
              value={provinsi}
              onChange={e => setProvinsi(e.target.value)}
            >
              <option value="">Pilih provinsi...</option>
              {pusatBatches !== null && (
                pusatBatches === 0
                  ? <option key="pusat-done" value="" disabled>Pusat · Kabinet — selesai ✓</option>
                  : Array.from({ length: pusatBatches }, (_, i) => (
                    <option key={`pusat:${i + 1}`} value={`pusat:${i + 1}`}>
                      Pusat · Kabinet ({i + 1}/{pusatBatches})
                    </option>
                  ))
              )}
              {PROVINCES.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={!provinsi} onClick={handleExport}>
              ⬇ Unduh CSV
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
              {result.reviewPartai.length > 0 && (
                <div className="review-list">
                  Partai perlu ditinjau (tidak dikenal): {result.reviewPartai.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
