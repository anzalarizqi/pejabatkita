'use client'

import { useState } from 'react'

interface CrawlResult {
  inserted: number
  skipped: number
  errors: string[]
  queries_run: number
}

export default function AdminHotspotPage() {
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<CrawlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runCrawl() {
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const body: Record<string, unknown> = { is_manual: true }
      if (keyword.trim()) body.keyword = keyword.trim()
      const resp = await fetch('/api/admin/hotspot/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`)
      }
      setResult(await resp.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="hot-wrap">
      <style>{styles}</style>
      <h1 className="hot-h1">Denyut Crawler</h1>
      <p className="hot-lede">
        Jalankan crawl berita secara manual. Crawl harian otomatis dijadwalkan via pg_cron pukul 09:00 WIB.
      </p>

      <section className="hot-card">
        <label className="hot-label" htmlFor="kw">Kata kunci tambahan (opsional)</label>
        <input
          id="kw"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="mis. demo BBM Jakarta"
          className="hot-input"
          disabled={loading}
        />
        <button onClick={runCrawl} disabled={loading} className="hot-btn">
          {loading ? 'Menjalankan… (1-3 menit)' : 'Jalankan Crawl'}
        </button>
      </section>

      {error && (
        <section className="hot-card hot-error">
          <strong>Gagal:</strong>
          <pre>{error}</pre>
        </section>
      )}

      {result && (
        <section className="hot-card">
          <div className="hot-stats">
            <div><span className="hot-num">{result.inserted}</span><span className="hot-lbl">inserted</span></div>
            <div><span className="hot-num">{result.skipped}</span><span className="hot-lbl">skipped (duplicate/parse)</span></div>
            <div><span className="hot-num">{result.queries_run}</span><span className="hot-lbl">queries run</span></div>
            <div><span className="hot-num">{result.errors.length}</span><span className="hot-lbl">errors</span></div>
          </div>
          {result.errors.length > 0 && (
            <details className="hot-errs">
              <summary>Lihat error ({result.errors.length})</summary>
              <ul>{result.errors.map((er, i) => <li key={i}>{er}</li>)}</ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}

const styles = `
.hot-wrap { max-width: 720px; }
.hot-h1 { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 400; margin-bottom: 8px; color: var(--ink); }
.hot-lede { font-size: 12px; color: var(--muted); margin-bottom: 24px; max-width: 60ch; line-height: 1.6; }
.hot-card { background: #fbf7ee; border: 1px solid var(--rule); padding: 20px; margin-bottom: 16px; border-radius: 4px; }
.hot-label { display: block; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.hot-input { width: 100%; padding: 8px 10px; font-family: 'DM Mono', monospace; font-size: 13px; border: 1px solid var(--rule); background: #fff; color: var(--ink); margin-bottom: 12px; }
.hot-btn { padding: 10px 20px; background: var(--ink); color: var(--paper); border: none; font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.hot-btn:hover:not(:disabled) { background: var(--accent); }
.hot-btn:disabled { opacity: 0.5; cursor: wait; }
.hot-error { border-color: var(--accent); color: var(--accent); }
.hot-error pre { font-size: 11px; white-space: pre-wrap; margin-top: 6px; }
.hot-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.hot-stats > div { display: flex; flex-direction: column; }
.hot-num { font-family: 'Fraunces', serif; font-size: 28px; color: var(--ink); }
.hot-lbl { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); text-transform: uppercase; }
.hot-errs { margin-top: 16px; font-size: 11px; }
.hot-errs summary { cursor: pointer; color: var(--muted); }
.hot-errs ul { margin-top: 8px; padding-left: 20px; }
.hot-errs li { margin-bottom: 4px; color: var(--accent); }
`
