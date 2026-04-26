'use client'

import { useState } from 'react'

interface Props {
  pejabatId: string
  namaPejabat: string
  onClose: () => void
}

export default function LaporkanModal({ pejabatId, namaPejabat, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pejabat_id: pejabatId,
          reason: reason.trim(),
          source_url: sourceUrl.trim() || undefined,
        }),
      })
      if (res.status === 429) {
        setError('Anda sudah melaporkan pejabat ini dalam 24 jam terakhir.')
        return
      }
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Gagal mengirim laporan.')
        return
      }
      setDone(true)
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 17, 23, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
        }

        .modal-box {
          background: #f5f1ea;
          padding: 40px;
          width: 100%;
          max-width: 480px;
          position: relative;
        }

        .modal-close {
          position: absolute;
          top: 16px;
          right: 20px;
          background: none;
          border: none;
          font-size: 20px;
          color: #8a857c;
          cursor: pointer;
          line-height: 1;
          font-family: 'DM Mono', monospace;
        }

        .modal-close:hover {
          color: #0f1117;
        }

        .modal-title {
          font-family: 'Fraunces', serif;
          font-size: 20px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 6px;
        }

        .modal-sub {
          font-size: 11px;
          color: #8a857c;
          margin-bottom: 28px;
          letter-spacing: 0.04em;
        }

        .field-label {
          display: block;
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #8a857c;
          margin-bottom: 8px;
        }

        .field-textarea {
          width: 100%;
          background: #fff;
          border: 1px solid #d4cfc5;
          color: #0f1117;
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          padding: 12px;
          resize: vertical;
          min-height: 100px;
          outline: none;
          transition: border-color 0.2s;
          margin-bottom: 6px;
        }

        .field-textarea:focus {
          border-color: #8a857c;
        }

        .char-count {
          font-size: 10px;
          color: #d4cfc5;
          text-align: right;
          margin-bottom: 20px;
        }

        .char-count.warn {
          color: #c0392b;
        }

        .field-input {
          width: 100%;
          background: #fff;
          border: 1px solid #d4cfc5;
          color: #0f1117;
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          padding: 10px 12px;
          outline: none;
          transition: border-color 0.2s;
          margin-bottom: 24px;
        }

        .field-input:focus {
          border-color: #8a857c;
        }

        .modal-error {
          font-size: 11px;
          color: #c0392b;
          margin-bottom: 16px;
          letter-spacing: 0.02em;
        }

        .submit-btn {
          width: 100%;
          background: #c0392b;
          color: #f5f1ea;
          border: none;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 14px;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .submit-btn:hover:not(:disabled) {
          opacity: 0.85;
        }

        .submit-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .done-state {
          text-align: center;
          padding: 20px 0;
        }

        .done-icon {
          font-size: 28px;
          color: #27ae60;
          margin-bottom: 12px;
        }

        .done-title {
          font-family: 'Fraunces', serif;
          font-size: 18px;
          font-weight: 300;
          color: #0f1117;
          margin-bottom: 8px;
        }

        .done-sub {
          font-size: 11px;
          color: #8a857c;
          margin-bottom: 24px;
        }
      `}</style>

      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-box">
          <button className="modal-close" onClick={onClose}>×</button>

          {done ? (
            <div className="done-state">
              <div className="done-icon">✓</div>
              <div className="done-title">Laporan Terkirim</div>
              <div className="done-sub">
                Terima kasih. Tim kami akan meninjau laporan Anda segera.
              </div>
              <button className="submit-btn" onClick={onClose}>
                Tutup
              </button>
            </div>
          ) : (
            <>
              <h2 className="modal-title">Laporkan Data</h2>
              <p className="modal-sub">
                Melaporkan: <strong>{namaPejabat}</strong>
              </p>

              <form onSubmit={handleSubmit}>
                <label className="field-label" htmlFor="reason">
                  Keterangan <span style={{ color: '#c0392b' }}>*</span>
                </label>
                <textarea
                  id="reason"
                  className="field-textarea"
                  placeholder="Jelaskan data yang tidak akurat atau perlu diperbarui..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  disabled={loading}
                  required
                />
                <div className={`char-count${reason.length > 450 ? ' warn' : ''}`}>
                  {reason.length}/500
                </div>

                <label className="field-label" htmlFor="source">
                  URL Sumber (opsional)
                </label>
                <input
                  id="source"
                  type="url"
                  className="field-input"
                  placeholder="https://..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  disabled={loading}
                />

                {error && <div className="modal-error">{error}</div>}

                <button
                  type="submit"
                  className="submit-btn"
                  disabled={loading || !reason.trim()}
                >
                  {loading ? 'Mengirim...' : 'Kirim Laporan'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  )
}
