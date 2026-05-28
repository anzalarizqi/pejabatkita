'use client'

import { useState, useEffect } from 'react'

const LLM_PROVIDERS = ['zhipu', 'openai', 'anthropic', 'moonshot'] as const

export default function AdminSettingsPage() {
  const [provider, setProvider] = useState<string>('zhipu')
  const [model, setModel] = useState('glm-4.5-air')
  const [keywords, setKeywords] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data) => {
        setProvider(data.llm_provider ?? 'zhipu')
        setModel(data.llm_model ?? 'glm-4.5-air')
        try {
          const arr = JSON.parse(data.hotspot_keywords ?? '[]')
          setKeywords(Array.isArray(arr) ? arr.join('\n') : '')
        } catch { setKeywords('') }
      })
      .finally(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    const kwArr = keywords.split('\n').map((s) => s.trim()).filter(Boolean)
    await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm_provider: provider,
        llm_model: model,
        hotspot_keywords: JSON.stringify(kwArr),
      }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="set-wrap">
      <style>{styles}</style>
      <h1 className="set-h1">Pengaturan LLM</h1>
      <p className="set-lede">
        Provider &amp; model yang dipakai Edge Function untuk mengekstrak event dari berita.
        API key dikelola via Supabase Secrets — bukan di sini.
      </p>

      {!loaded ? <div className="set-loading">Memuat…</div> : (
        <section className="set-card">
          <div className="set-field">
            <label htmlFor="provider">Provider</label>
            <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {LLM_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div className="set-field">
            <label htmlFor="model">Model</label>
            <input id="model" type="text" value={model} onChange={(e) => setModel(e.target.value)} />
            <div className="set-hint">e.g. glm-4.5-air, gpt-4o-mini, claude-haiku-4-5</div>
          </div>

          <div className="set-field">
            <label htmlFor="kw">Kata kunci tetap (satu per baris)</label>
            <textarea
              id="kw"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={6}
              placeholder="kebijakan pendidikan&#10;reshuffle kabinet"
            />
            <div className="set-hint">Ditambahkan ke daftar query default setiap crawl.</div>
          </div>

          <button onClick={save} disabled={saving} className="set-btn">
            {saving ? 'Menyimpan…' : saved ? 'Tersimpan ✓' : 'Simpan'}
          </button>
        </section>
      )}
    </div>
  )
}

const styles = `
.set-wrap { max-width: 640px; }
.set-h1 { font-family: 'Fraunces', serif; font-size: 28px; font-weight: 400; margin-bottom: 8px; color: var(--ink); }
.set-lede { font-size: 12px; color: var(--muted); margin-bottom: 24px; max-width: 60ch; line-height: 1.6; }
.set-loading { color: var(--muted); font-size: 12px; }
.set-card { background: #fbf7ee; border: 1px solid var(--rule); padding: 24px; border-radius: 4px; }
.set-field { margin-bottom: 20px; }
.set-field label { display: block; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.set-field input, .set-field select, .set-field textarea { width: 100%; padding: 8px 10px; font-family: 'DM Mono', monospace; font-size: 13px; border: 1px solid var(--rule); background: #fff; }
.set-field textarea { resize: vertical; min-height: 80px; }
.set-hint { font-size: 11px; color: var(--muted); margin-top: 4px; }
.set-btn { padding: 10px 20px; background: var(--ink); color: var(--paper); border: none; font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
.set-btn:hover:not(:disabled) { background: var(--accent); }
.set-btn:disabled { opacity: 0.5; }
`
