'use client'

import { useEffect, useRef, useState } from 'react'

type ImportResult = {
  found: number
  bersih: number
  skipped_existing: number
  errors: string[]
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

export default function RekamBersihPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [provinsi, setProvinsi] = useState('')
  const [pusatBatches, setPusatBatches] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  // How many batches of unscreened Pusat (kabinet) officials are left to screen
  useEffect(() => {
    fetch('/api/admin/export-kasus-csv?bucket=pusat&meta=1')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setPusatBatches(d.batches) })
      .catch(() => { /* ignore — provinces still work */ })
  }, [])

  function handleExport() {
    if (!provinsi) return
    const a = document.createElement('a')
    a.href = provinsi.startsWith('pusat:')
      ? `/api/admin/export-kasus-csv?bucket=pusat&batch=${provinsi.slice('pusat:'.length)}`
      : `/api/admin/export-kasus-csv?provinsi=${encodeURIComponent(provinsi)}`
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
      const res = await fetch('/api/admin/import-kasus-csv', { method: 'POST', body: form })
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
          border-left: 2px solid #d4cfc5;
          padding-left: 16px;
        }
        .province-row {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
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
        .result-num.amber { color: #f39c12; }
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
          max-height: 120px;
          overflow-y: auto;
          line-height: 1.8;
        }
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
          white-space: pre-wrap;
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
        {/* Section 1: Export */}
        <div className="ph-section">
          <div className="ph-section-title">Langkah 1 — Unduh daftar pejabat</div>
          <div className="ph-section-sub">
            Pilih provinsi, unduh CSV, lalu buka di Gemini (gemini.google.com) atau Claude (claude.ai)
            dengan pencarian web aktif. Gunakan prompt di bawah, minta AI mengisi kolom
            <code>kasus_found</code> hingga <code>keyakinan</code>, lalu simpan hasilnya.
          </div>
          <div className="ph-steps">
            Pilih provinsi → unduh CSV → buka Gemini/Claude + aktifkan web search<br />
            Unggah atau tempel isi CSV → gunakan prompt di bawah → salin hasil CSV → lanjut ke Langkah 2
          </div>
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
            <button
              className="btn btn-primary"
              disabled={!provinsi}
              onClick={handleExport}
            >
              ⬇ Unduh CSV
            </button>
          </div>
          <AiPrompt />
        </div>

        {/* Section 2: Import */}
        <div className="ph-section">
          <div className="ph-section-title">Langkah 2 — Unggah hasil verifikasi</div>
          <div className="ph-section-sub">
            Unggah kembali CSV yang sudah diisi AI. Baris dengan <code>kasus_found=1</code> dan
            status valid akan dicatat ke tabel <code>kasus</code> (menunggu verifikasi Kimi).
            Baris <code>kasus_found=0</code> dicatat sebagai bersih.
            Pejabat yang sudah punya kasus sebelumnya dilewati otomatis.
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
              {importing ? 'Memproses...' : 'Klik atau seret file CSV yang sudah diisi'}
            </div>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {result && (
            <div className="result-card">
              <div className="result-grid">
                <div className="result-stat">
                  <div className={`result-num${result.found > 0 ? ' amber' : ''}`}>{result.found}</div>
                  <div className="result-label">Kasus Ditemukan</div>
                </div>
                <div className="result-stat">
                  <div className={`result-num${result.bersih > 0 ? ' green' : ''}`}>{result.bersih}</div>
                  <div className="result-label">Bersih</div>
                </div>
                <div className="result-stat">
                  <div className="result-num">{result.skipped_existing}</div>
                  <div className="result-label">Sudah Ada</div>
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

const PROMPT_TEXT = `Ini adalah daftar pejabat Indonesia. Untuk setiap baris, cari di web apakah pejabat tersebut pernah ditetapkan sebagai tersangka, terdakwa, atau terpidana dalam kasus korupsi/tipikor.

Isi kolom berikut:
- kasus_found: 1 jika ada kasus, 0 jika tidak
- status: tersangka / terdakwa / terpidana (kosongkan jika kasus_found=0)
- jenis: korupsi / suap / gratifikasi / pencucian_uang / lainnya
- lembaga: KPK / Kejagung / Kejati / Pengadilan Tipikor
- tahun: tahun penetapan tersangka/vonis (angka saja)
- ringkasan: 1-2 kalimat ringkasan kasus
- url_sumber: URL artikel atau sumber terpercaya
- keyakinan: tinggi / sedang / rendah

ATURAN KETAT:
- Hanya laporkan jika nama pejabat DISEBUTKAN EKSPLISIT sebagai tersangka/terdakwa/terpidana.
- Sumber valid: kpk.go.id, Kejagung, Kejati, Tempo, Kompas, Detik, CNN Indonesia.
- Jangan laporkan jika hanya saksi, terindikasi, atau kasusnya sudah SP3/bebas.
- Kalau tidak ada kasus, isi kasus_found=0 dan kosongkan kolom lainnya.
- Kembalikan seluruh tabel dalam format CSV yang sama persis (termasuk baris header dan baris yang tidak berubah).`

function AiPrompt() {
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
      <div className="gemini-prompt-label">Prompt untuk Gemini / Claude</div>
      {PROMPT_TEXT}
    </div>
  )
}
