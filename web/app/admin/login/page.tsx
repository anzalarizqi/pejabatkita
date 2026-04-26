'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        router.push('/admin/dashboard')
      } else {
        setError('Kata sandi salah.')
        setPassword('')
        inputRef.current?.focus()
      }
    } catch {
      setError('Gagal terhubung ke server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,700;1,9..144,300&family=DM+Mono:wght@400;500&display=swap');

        :root {
          --ink: #0f1117;
          --paper: #f5f1ea;
          --accent: #c0392b;
          --rule: #d4cfc5;
          --muted: #8a857c;
          --stamp: #1a3a5c;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--paper);
          font-family: 'DM Mono', monospace;
          min-height: 100vh;
          overflow: hidden;
        }

        .login-root {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 480px 1fr;
          grid-template-rows: 1fr;
          align-items: center;
          position: relative;
        }

        /* Newsprint grid lines */
        .login-root::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image:
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 27px,
              var(--rule) 27px,
              var(--rule) 28px
            );
          opacity: 0.35;
          pointer-events: none;
          z-index: 0;
        }

        .login-left {
          grid-column: 1;
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          align-self: stretch;
          position: relative;
          z-index: 1;
          opacity: 0;
          animation: fadeIn 0.8s 0.4s forwards;
        }

        .left-tagline {
          font-family: 'Fraunces', serif;
          font-size: clamp(28px, 3vw, 48px);
          font-weight: 300;
          line-height: 1.25;
          color: var(--ink);
          margin-bottom: 24px;
          max-width: 320px;
        }

        .left-tagline em {
          font-style: italic;
          color: var(--accent);
        }

        .left-meta {
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border-top: 1px solid var(--rule);
          padding-top: 16px;
          line-height: 1.8;
        }

        .login-panel {
          grid-column: 2;
          position: relative;
          z-index: 1;
          padding: 0 40px;
        }

        .panel-inner {
          background: var(--ink);
          padding: 52px 44px;
          position: relative;
          opacity: 0;
          transform: translateY(16px);
          animation: slideUp 0.6s 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        /* Corner marks */
        .panel-inner::before,
        .panel-inner::after {
          content: '';
          position: absolute;
          width: 12px;
          height: 12px;
          border-color: var(--accent);
          border-style: solid;
        }
        .panel-inner::before {
          top: -1px;
          left: -1px;
          border-width: 2px 0 0 2px;
        }
        .panel-inner::after {
          bottom: -1px;
          right: -1px;
          border-width: 0 2px 2px 0;
        }

        .panel-stamp {
          display: inline-block;
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--accent);
          border: 1px solid var(--accent);
          padding: 3px 8px;
          margin-bottom: 28px;
          opacity: 0.9;
        }

        .panel-title {
          font-family: 'Fraunces', serif;
          font-size: 26px;
          font-weight: 400;
          color: var(--paper);
          line-height: 1.3;
          margin-bottom: 8px;
        }

        .panel-subtitle {
          font-size: 11px;
          color: var(--muted);
          letter-spacing: 0.06em;
          margin-bottom: 40px;
        }

        .field-label {
          display: block;
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 10px;
        }

        .field-input {
          width: 100%;
          background: transparent;
          border: none;
          border-bottom: 1px solid #2a2e3a;
          color: var(--paper);
          font-family: 'DM Mono', monospace;
          font-size: 16px;
          padding: 8px 0 12px;
          outline: none;
          letter-spacing: 0.04em;
          transition: border-color 0.2s;
          caret-color: var(--accent);
        }

        .field-input:focus {
          border-bottom-color: var(--accent);
        }

        .field-input::placeholder {
          color: #3a3e4a;
        }

        .error-msg {
          font-size: 11px;
          color: var(--accent);
          letter-spacing: 0.04em;
          margin-top: 14px;
          height: 16px;
        }

        .submit-btn {
          width: 100%;
          margin-top: 36px;
          background: var(--accent);
          color: var(--paper);
          border: none;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 16px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: opacity 0.2s;
        }

        .submit-btn:hover:not(:disabled) {
          opacity: 0.88;
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .submit-btn .btn-text {
          position: relative;
          z-index: 1;
        }

        .loader {
          display: inline-flex;
          gap: 4px;
          align-items: center;
        }

        .loader span {
          width: 4px;
          height: 4px;
          background: var(--paper);
          display: inline-block;
          animation: blink 1s infinite;
        }
        .loader span:nth-child(2) { animation-delay: 0.2s; }
        .loader span:nth-child(3) { animation-delay: 0.4s; }

        .login-right {
          grid-column: 3;
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-self: stretch;
          position: relative;
          z-index: 1;
          opacity: 0;
          animation: fadeIn 0.8s 0.6s forwards;
        }

        .issue-number {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          writing-mode: vertical-rl;
          text-orientation: mixed;
          margin-top: 0;
        }

        .vertical-rule {
          width: 1px;
          flex: 1;
          background: var(--rule);
          margin: 12px auto;
          max-height: 120px;
        }

        @keyframes fadeIn {
          to { opacity: 1; }
        }

        @keyframes slideUp {
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes blink {
          0%, 80%, 100% { opacity: 0; }
          40% { opacity: 1; }
        }

        /* Bottom rule */
        .bottom-rule {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: var(--accent);
          z-index: 10;
        }

        .watermark {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          z-index: 5;
          opacity: 0.6;
          white-space: nowrap;
        }
      `}</style>

      <div className="login-root" style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.3s' }}>
        <div className="login-left">
          <p className="left-tagline">
            Data pejabat publik Indonesia — <em>transparan</em> dan terbuka.
          </p>
          <div className="left-meta">
            <div>Sistem Internal Admin</div>
            <div>Peta Pejabat Indonesia</div>
            <div style={{ marginTop: 4 }}>v1.0 · Phase 4</div>
          </div>
        </div>

        <div className="login-panel">
          <div className="panel-inner">
            <div className="panel-stamp">Panel Admin</div>
            <h1 className="panel-title">Masuk ke Sistem</h1>
            <p className="panel-subtitle">Akses terbatas untuk pengelola data</p>

            <form onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="password">Kata Sandi</label>
              <input
                ref={inputRef}
                id="password"
                type="password"
                className="field-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
              <div className="error-msg">{error}</div>
              <button type="submit" className="submit-btn" disabled={loading || !password}>
                <span className="btn-text">
                  {loading ? (
                    <span className="loader">
                      <span /><span /><span />
                    </span>
                  ) : 'Masuk →'}
                </span>
              </button>
            </form>
          </div>
        </div>

        <div className="login-right">
          <div className="issue-number">
            PJK·ADM·{new Date().getFullYear()}
          </div>
          <div className="vertical-rule" />
        </div>

        <div className="bottom-rule" />
        <div className="watermark">Peta Pejabat Indonesia · Admin Portal</div>
      </div>
    </>
  )
}
