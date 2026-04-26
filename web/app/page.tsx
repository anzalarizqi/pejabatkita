import Link from 'next/link'

export default function HomePage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,200;0,9..144,300;0,9..144,400;1,9..144,200;1,9..144,300&family=DM+Mono:wght@400;500&display=swap');

        :root {
          --ink: #0f1117;
          --paper: #f5f1ea;
          --accent: #c0392b;
          --rule: #d4cfc5;
          --muted: #8a857c;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--paper);
          font-family: 'DM Mono', monospace;
          color: var(--ink);
          min-height: 100vh;
        }

        .home-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .home-topbar {
          border-bottom: 2px solid var(--ink);
          padding: 16px 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .topbar-brand {
          font-family: 'Fraunces', serif;
          font-size: 15px;
          font-weight: 400;
          color: var(--ink);
          letter-spacing: -0.01em;
        }

        .topbar-date {
          font-size: 10px;
          letter-spacing: 0.1em;
          color: var(--muted);
          text-transform: uppercase;
        }

        .home-hero {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 48px;
          text-align: center;
          position: relative;
        }

        /* Horizontal rules for newsprint feel */
        .home-hero::before,
        .home-hero::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: var(--rule);
        }
        .home-hero::before { top: 0; }
        .home-hero::after { bottom: 0; }

        .hero-label {
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--accent);
          margin-bottom: 20px;
        }

        .hero-title {
          font-family: 'Fraunces', serif;
          font-size: clamp(40px, 7vw, 88px);
          font-weight: 200;
          line-height: 1.1;
          color: var(--ink);
          margin-bottom: 24px;
          max-width: 800px;
        }

        .hero-title em {
          font-style: italic;
          color: var(--accent);
        }

        .hero-desc {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.8;
          max-width: 480px;
          margin-bottom: 48px;
          letter-spacing: 0.02em;
        }

        .hero-actions {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
        }

        .btn-primary {
          background: var(--ink);
          color: var(--paper);
          padding: 14px 28px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-decoration: none;
          display: inline-block;
          transition: opacity 0.15s;
        }

        .btn-primary:hover {
          opacity: 0.8;
        }

        .btn-ghost {
          color: var(--muted);
          padding: 14px 28px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          text-decoration: none;
          border: 1px solid var(--rule);
          display: inline-block;
          transition: all 0.15s;
        }

        .btn-ghost:hover {
          color: var(--ink);
          border-color: var(--ink);
        }

        .home-footer {
          border-top: 1px solid var(--rule);
          padding: 20px 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10px;
          color: var(--muted);
          letter-spacing: 0.06em;
        }

        .footer-links {
          display: flex;
          gap: 24px;
        }

        .footer-links a {
          color: var(--muted);
          text-decoration: none;
        }

        .footer-links a:hover {
          color: var(--ink);
        }

        .rule-strip {
          width: 100%;
          height: 3px;
          background: var(--accent);
        }
      `}</style>

      <div className="home-root">
        <div className="rule-strip" />

        <header className="home-topbar">
          <div className="topbar-brand">Peta Pejabat Indonesia</div>
          <div className="topbar-date">
            {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </header>

        <main className="home-hero">
          <p className="hero-label">Civic Tech · Data Terbuka</p>
          <h1 className="hero-title">
            Data pejabat publik<br />
            Indonesia <em>satu tempat</em>
          </h1>
          <p className="hero-desc">
            Cari profil gubernur, bupati, dan walikota di seluruh Indonesia.
            Data dikumpulkan dari sumber resmi, diverifikasi, dan diperbarui secara berkala.
          </p>
          <div className="hero-actions">
            <Link href="/admin/dashboard" className="btn-primary">
              Panel Admin →
            </Link>
            <Link href="/admin/login" className="btn-ghost">
              Masuk
            </Link>
          </div>
        </main>

        <footer className="home-footer">
          <span>© {new Date().getFullYear()} Peta Pejabat Indonesia</span>
          <div className="footer-links">
            <a href="https://github.com/anzalarizqi/pejabatkita" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <Link href="/admin/login">Admin</Link>
          </div>
        </footer>
      </div>
    </>
  )
}
