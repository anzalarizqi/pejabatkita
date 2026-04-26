'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

const NAV = [
  { href: '/admin/dashboard', label: 'Pantauan', icon: '◉' },
  { href: '/admin/import', label: 'Impor Data', icon: '⊕' },
  { href: '/admin/review', label: 'Ulasan Bendera', icon: '⚑' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/admin/login')
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300&family=DM+Mono:wght@400;500&display=swap');

        :root {
          --ink: #0f1117;
          --paper: #f5f1ea;
          --accent: #c0392b;
          --rule: #d4cfc5;
          --muted: #8a857c;
          --sidebar-w: 220px;
          --sidebar-bg: #0f1117;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'DM Mono', monospace;
          background: var(--paper);
          min-height: 100vh;
        }

        .admin-shell {
          display: grid;
          grid-template-columns: var(--sidebar-w) 1fr;
          min-height: 100vh;
        }

        .sidebar {
          background: var(--sidebar-bg);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow: hidden;
          border-right: 1px solid #1e2230;
        }

        .sidebar-brand {
          padding: 28px 24px 20px;
          border-bottom: 1px solid #1e2230;
        }

        .brand-label {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 6px;
        }

        .brand-name {
          font-family: 'Fraunces', serif;
          font-size: 16px;
          font-weight: 400;
          color: #f5f1ea;
          line-height: 1.3;
        }

        .sidebar-nav {
          flex: 1;
          padding: 24px 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .nav-section-label {
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #3a3e4a;
          padding: 0 24px 10px;
          margin-top: 8px;
        }

        .nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 24px;
          font-size: 12px;
          letter-spacing: 0.04em;
          color: #5a5e6a;
          text-decoration: none;
          transition: color 0.15s, background 0.15s;
          position: relative;
        }

        .nav-link:hover {
          color: #f5f1ea;
          background: rgba(255,255,255,0.04);
        }

        .nav-link.active {
          color: #f5f1ea;
          background: rgba(255,255,255,0.06);
        }

        .nav-link.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 2px;
          background: var(--accent);
        }

        .nav-icon {
          font-size: 14px;
          width: 16px;
          text-align: center;
          flex-shrink: 0;
        }

        .sidebar-footer {
          padding: 20px 24px;
          border-top: 1px solid #1e2230;
        }

        .logout-btn {
          background: none;
          border: 1px solid #2a2e3a;
          color: #5a5e6a;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 8px 14px;
          cursor: pointer;
          width: 100%;
          transition: color 0.15s, border-color 0.15s;
        }

        .logout-btn:hover:not(:disabled) {
          color: var(--accent);
          border-color: var(--accent);
        }

        .logout-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .admin-main {
          min-height: 100vh;
          overflow: auto;
        }

        .admin-topbar {
          background: var(--paper);
          border-bottom: 1px solid var(--rule);
          padding: 16px 36px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .topbar-title {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .topbar-date {
          font-size: 10px;
          color: var(--rule);
          letter-spacing: 0.06em;
        }

        .admin-content {
          padding: 36px;
        }
      `}</style>

      <div className="admin-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="brand-label">Admin Panel</div>
            <div className="brand-name">Peta Pejabat<br />Indonesia</div>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-section-label">Navigasi</div>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${pathname.startsWith(item.href) ? ' active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button
              className="logout-btn"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? '...' : '← Keluar'}
            </button>
          </div>
        </aside>

        <div className="admin-main">
          <div className="admin-topbar">
            <span className="topbar-title">
              {NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Admin'}
            </span>
            <span className="topbar-date">
              {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
          <div className="admin-content">{children}</div>
        </div>
      </div>
    </>
  )
}
