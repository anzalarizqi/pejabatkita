'use client'

import { useState } from 'react'

interface CrawlResult {
  mode: 'rss' | 'keyword'
  keyword?: string | null
  feeds_ok?: number
  feeds_failed?: { feed: string; error: string }[]
  total_rss_items?: number
  within_24h?: number
  search_returned?: number
  after_dedup?: number
  rejected_by_llm?: number
  parse_failed?: number
  inserted: number
  db_errors?: number
  errors: string[]
  elapsed_ms?: number
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
        <label className="hot-label" htmlFor="kw">Kata kunci (opsional)</label>
        <input
          id="kw"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="mis. demo BBM Jakarta — kosongkan untuk crawl RSS default"
          className="hot-input"
          disabled={loading}
        />
        <div className="hot-hint">
          Kosong = pull RSS Detik/CNN/Antara (24 jam terakhir). Isi = Kimi $web_search untuk kata kunci ini saja.
        </div>
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
          <div className="hot-mode">
            mode: <strong>{result.mode}</strong>
            {result.keyword && <> · keyword: <em>{result.keyword}</em></>}
            {result.elapsed_ms !== undefined && <> · {(result.elapsed_ms / 1000).toFixed(1)}s</>}
          </div>
          <div className="hot-stats">
            {result.mode === 'rss' ? (
              <>
                <div><span className="hot-num">{result.feeds_ok ?? 0}</span><span className="hot-lbl">feeds ok</span></div>
                <div><span className="hot-num">{result.within_24h ?? 0}</span><span className="hot-lbl">within 24h</span></div>
              </>
            ) : (
              <div><span className="hot-num">{result.search_returned ?? 0}</span><span className="hot-lbl">search returned</span></div>
            )}
            <div><span className="hot-num">{result.after_dedup ?? 0}</span><span className="hot-lbl">after dedup</span></div>
            <div><span className="hot-num">{result.rejected_by_llm ?? 0}</span><span className="hot-lbl">rejected by LLM</span></div>
            <div><span className="hot-num">{result.inserted}</span><span className="hot-lbl">inserted</span></div>
            <div><span className="hot-num">{(result.parse_failed ?? 0) + (result.db_errors ?? 0) + (result.errors?.length ?? 0)}</span><span className="hot-lbl">errors</span></div>
          </div>
          {result.feeds_failed && result.feeds_failed.length > 0 && (
            <details className="hot-errs">
              <summary>Feed failures ({result.feeds_failed.length})</summary>
              <ul>{result.feeds_failed.map((f, i) => <li key={i}>{f.feed}: {f.error}</li>)}</ul>
            </details>
          )}
          {result.errors && result.errors.length > 0 && (
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
.hot-input { width: 100%; padding: 8px 10px; font-family: 'DM Mono', monospace; font-size: 13px; border: 1px solid var(--rule); background: #fff; color: var(--ink); margin-bottom: 4px; }
.hot-hint { font-size: 11px; color: var(--muted); margin-bottom: 12px; line-height: 1.5; }
.hot-mode { font-size: 11px; color: var(--muted); margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
.hot-mode strong { color: var(--ink); }
.hot-mode em { color: var(--accent); font-style: normal; }
.hot-btn { padding: 10px 20px; background: var(--ink); color: var(--paper); border: none; font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.hot-btn:hover:not(:disabled) { background: var(--accent); }
.hot-btn:disabled { opacity: 0.5; cursor: wait; }
.hot-error { border-color: var(--accent); color: var(--accent); }
.hot-error pre { font-size: 11px; white-space: pre-wrap; margin-top: 6px; }
.hot-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 16px; }
.hot-stats > div { display: flex; flex-direction: column; }
.hot-num { font-family: 'Fraunces', serif; font-size: 28px; color: var(--ink); }
.hot-lbl { font-size: 10px; letter-spacing: 0.06em; color: var(--muted); text-transform: uppercase; }
.hot-errs { margin-top: 16px; font-size: 11px; }
.hot-errs summary { cursor: pointer; color: var(--muted); }
.hot-errs ul { margin-top: 8px; padding-left: 20px; }
.hot-errs li { margin-bottom: 4px; color: var(--accent); }
`
