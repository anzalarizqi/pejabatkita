'use client'

import { useState, useRef } from 'react'
import { PejabatJSON, ImportDiff, DiffEntry } from '@/lib/types'
import DiffPreview from './DiffPreview'

type Step = 'upload' | 'preview' | 'done'

interface ConfirmResult {
  inserted: number
  updated: number
  flagged: number
  errors: string[]
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [loading, setLoading] = useState(false)
  const [diff, setDiff] = useState<ImportDiff | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      // Accept both array and { data: [] } formats
      const data: PejabatJSON[] = Array.isArray(raw) ? raw : raw.data ?? raw.pejabat ?? []
      if (!data.length) throw new Error('File kosong atau format tidak dikenali.')

      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
      if (!res.ok) throw new Error(await res.text())
      const diffData: ImportDiff = await res.json()
      setDiff(diffData)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membaca file.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!diff) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      })
      if (!res.ok) throw new Error(await res.text())
      const data: ConfirmResult = await res.json()
      setResult(data)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengimpor data.')
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setStep('upload')
    setDiff(null)
    setResult(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <style>{`
        .import-wrap {
          max-width: 900px;
        }

        .import-steps {
          display: flex;
          align-items: center;
          gap: 0;
          margin-bottom: 36px;
        }

        .step-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #8a857c;
        }

        .step-num {
          width: 24px;
          height: 24px;
          border: 1px solid currentColor;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          flex-shrink: 0;
        }

        .step-item.active {
          color: #0f1117;
        }

        .step-item.done {
          color: #27ae60;
        }

        .step-sep {
          flex: 1;
          height: 1px;
          background: #d4cfc5;
          margin: 0 16px;
          max-width: 60px;
        }

        .upload-zone {
          border: 1px dashed #d4cfc5;
          padding: 60px 40px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          position: relative;
        }

        .upload-zone:hover {
          border-color: #8a857c;
          background: #f0ece4;
        }

        .upload-zone input[type="file"] {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
        }

        .upload-icon {
          font-size: 32px;
          color: #d4cfc5;
          margin-bottom: 16px;
        }

        .upload-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 8px;
        }

        .upload-sub {
          font-size: 11px;
          color: #8a857c;
          letter-spacing: 0.04em;
        }

        .error-banner {
          background: #fff0ef;
          border: 1px solid #c0392b;
          padding: 12px 16px;
          font-size: 12px;
          color: #c0392b;
          margin-top: 16px;
          letter-spacing: 0.02em;
        }

        .result-card {
          background: #0f1117;
          padding: 40px;
          max-width: 480px;
        }

        .result-title {
          font-family: 'Fraunces', serif;
          font-size: 24px;
          font-weight: 300;
          color: #f5f1ea;
          margin-bottom: 24px;
        }

        .result-stats {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px;
          margin-bottom: 24px;
        }

        .result-stat {
          text-align: center;
        }

        .result-num {
          font-size: 32px;
          font-weight: 300;
          color: #f5f1ea;
          font-family: 'Fraunces', serif;
          line-height: 1;
          margin-bottom: 4px;
        }

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

        .btn {
          display: inline-block;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 12px 24px;
          cursor: pointer;
          border: none;
          transition: opacity 0.2s;
        }

        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .btn-primary {
          background: #c0392b;
          color: #f5f1ea;
        }

        .btn-primary:hover:not(:disabled) {
          opacity: 0.85;
        }

        .btn-ghost {
          background: transparent;
          color: #8a857c;
          border: 1px solid #d4cfc5;
        }

        .btn-ghost:hover:not(:disabled) {
          color: #0f1117;
          border-color: #8a857c;
        }

        .confirm-row {
          display: flex;
          gap: 12px;
          margin-top: 24px;
        }

        .loading-msg {
          font-size: 11px;
          color: #8a857c;
          letter-spacing: 0.08em;
          padding: 12px 0;
        }
      `}</style>

      <div className="import-wrap">
        {/* Steps indicator */}
        <div className="import-steps">
          <div className={`step-item${step === 'upload' ? ' active' : ' done'}`}>
            <span className="step-num">{step !== 'upload' ? '✓' : '1'}</span>
            Unggah File
          </div>
          <div className="step-sep" />
          <div className={`step-item${step === 'preview' ? ' active' : step === 'done' ? ' done' : ''}`}>
            <span className="step-num">{step === 'done' ? '✓' : '2'}</span>
            Pratinjau Diff
          </div>
          <div className="step-sep" />
          <div className={`step-item${step === 'done' ? ' active done' : ''}`}>
            <span className="step-num">{step === 'done' ? '✓' : '3'}</span>
            Konfirmasi
          </div>
        </div>

        {step === 'upload' && (
          <>
            <div className="upload-zone">
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                onChange={handleFile}
                disabled={loading}
              />
              <div className="upload-icon">⊕</div>
              <div className="upload-title">Unggah File JSON</div>
              <div className="upload-sub">
                {loading
                  ? 'Memproses file...'
                  : 'Klik atau seret file pejabat.json hasil scraper / verifier'}
              </div>
            </div>
            {error && <div className="error-banner">{error}</div>}
          </>
        )}

        {step === 'preview' && diff && (
          <>
            <DiffPreview diff={diff} />
            {error && <div className="error-banner">{error}</div>}
            <div className="confirm-row">
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={loading || (diff.newCount + diff.updatedCount === 0)}
              >
                {loading ? 'Mengimpor...' : `Konfirmasi Impor (${diff.newCount + diff.updatedCount} perubahan)`}
              </button>
              <button className="btn btn-ghost" onClick={handleReset} disabled={loading}>
                ← Batal
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <div className="result-card">
            <div className="result-title">Impor Selesai</div>
            <div className="result-stats">
              <div className="result-stat">
                <div className="result-num">{result.inserted}</div>
                <div className="result-label">Ditambahkan</div>
              </div>
              <div className="result-stat">
                <div className="result-num">{result.updated}</div>
                <div className="result-label">Diperbarui</div>
              </div>
              <div className="result-stat">
                <div className="result-num">{result.flagged}</div>
                <div className="result-label">Perlu Tinjauan</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="result-errors">
                {result.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}
            <button className="btn btn-ghost" onClick={handleReset} style={{ marginTop: 24 }}>
              Impor File Lain
            </button>
          </div>
        )}
      </div>
    </>
  )
}
