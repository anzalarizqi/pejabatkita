'use client'

import { useState } from 'react'

interface Command {
  cmd: string
  note?: string
}

interface Section {
  id: string
  title: string
  purpose: string
  when: string
  cost: string
  commands: Command[]
  troubleshoot?: { issue: string; fix: string }[]
}

const SECTIONS: Section[] = [
  {
    id: 'screen-kasus',
    title: '1. Screen Kasus Korupsi',
    purpose: 'Cari catatan korupsi setiap pejabat via Kimi $web_search. Hasil di-insert ke kasus table dengan verified=null.',
    when: 'Saat ingin scan provinsi baru, atau setelah 30 hari untuk re-screen yang bersih.',
    cost: '~$0.005/pejabat × ~1.215 = ~$6 sekali jalan penuh.',
    commands: [
      { cmd: 'python scripts/screen_kasus_llm.py --resume --log', note: 'Semua provinsi, skip yang sudah di-screen ≤30 hari + punya kasus.' },
      { cmd: 'python scripts/screen_kasus_llm.py --provinsi "Jawa Timur" --log' },
      { cmd: 'python scripts/screen_kasus_llm.py --resume --rescreen-after-days 60 --log', note: 'Custom freshness window.' },
      { cmd: 'python scripts/screen_kasus_llm.py --provinsi "Aceh" --dry-run', note: 'Preview tanpa insert.' },
    ],
    troubleshoot: [
      { issue: 'ERROR: request timed out', fix: 'Re-run dengan --resume; error tidak di-log ke kasus_screened sehingga otomatis di-retry.' },
      { issue: 'FOUND tapi data salah lembaga/tahun', fix: 'Verifier akan tangkap di tahap berikutnya — biarkan dulu.' },
    ],
  },
  {
    id: 'verify-kasus',
    title: '2. Verify Kasus',
    purpose: 'Kimi thinking-mode cek tiap kasus apakah benar-benar ada. Set verified=true atau verified=false + note.',
    when: 'Setelah screen selesai untuk satu provinsi.',
    cost: '~$0.03-0.05 per kasus × jumlah unverified.',
    commands: [
      { cmd: 'python scripts/verify_kasus.py', note: 'Default: hanya unverified rows (verified IS NULL).' },
      { cmd: 'python scripts/verify_kasus.py --all', note: 'Re-verify semua, termasuk yang sudah confirmed/rejected.' },
      { cmd: 'python scripts/verify_kasus.py --dry-run', note: 'Print verdict tanpa update DB.' },
      { cmd: 'python scripts/verify_kasus.py --report-suspicious-rejects', note: 'Audit: list verified=false yang note-nya terdengar afirmatif (kemungkinan field mismatch — fix manual via SQL).' },
    ],
    troubleshoot: [
      { issue: 'REJECTED tapi note menyebut "terverifikasi"', fix: 'Jalankan --report-suspicious-rejects. Fix per row di SQL editor.' },
      { issue: 'ERROR: request timed out', fix: 'Re-run; default mode hanya proses yang masih unverified.' },
    ],
  },
  {
    id: 'crawl-hotspot',
    title: '3. Crawl Hotspot (Denyut Demokrasi)',
    purpose: 'Pull RSS Detik/CNN/Antara 24h terakhir, filter via LLM relevance gate, extract & insert ke hotspot_events. Hasil tampil di /pulse.',
    when: 'Idealnya tiap hari pagi (manual atau via Windows Task Scheduler).',
    cost: '~$0.05-0.10 per crawl × 30 hari = ~$2/bulan.',
    commands: [
      { cmd: 'python scripts/crawl_hotspot.py', note: 'Default: 8 RSS feeds, last 24h.' },
      { cmd: 'python scripts/crawl_hotspot.py --keyword "OTT KPK 2026"', note: 'Manual keyword via Kimi $web_search (bypass RSS, untuk breaking event yang belum di-index).' },
      { cmd: 'python scripts/crawl_hotspot.py --max-age-hours 48', note: 'Window 48 jam (kalau cron skip 1 hari).' },
      { cmd: 'python scripts/crawl_hotspot.py --dry-run', note: 'Lihat apa yang akan di-insert tanpa write DB.' },
      { cmd: 'python scripts/crawl_hotspot.py --batch-size 5 --concurrency 2', note: 'Lebih kecil & lambat — jika hit rate limit Kimi.' },
    ],
    troubleshoot: [
      { issue: '! <feed>: HTTP 404', fix: 'Outlet ganti URL RSS. Edit FEEDS di scripts/crawl_hotspot.py dan re-verify.' },
      { issue: 'rejected = nyaris semua, inserted = 0', fix: 'LLM relevance gate terlalu ketat. Cek beberapa article rejected — kalau ada yang harusnya kept, tune SYSTEM_PROMPT.' },
      { issue: 'parse_fail tinggi', fix: 'Kimi return non-JSON. Coba --batch-size 5 (less load) atau cek log Kimi.' },
    ],
  },
  {
    id: 'rekam-bersih-pipeline',
    title: '4. Pipeline Lengkap (provinsi baru)',
    purpose: 'Urutan run untuk provinsi yang belum di-screen.',
    when: 'Sekali per provinsi baru.',
    cost: '~$0.005/pejabat screen + ~$0.03-0.05/kasus verify.',
    commands: [
      { cmd: '# 1. Screen — cari kandidat kasus', note: '' },
      { cmd: 'python scripts/screen_kasus_llm.py --provinsi "<Nama>" --log' },
      { cmd: '# 2. Verify — konfirmasi atau tolak', note: '' },
      { cmd: 'python scripts/verify_kasus.py' },
      { cmd: '# 3. Audit false-rejects', note: '' },
      { cmd: 'python scripts/verify_kasus.py --report-suspicious-rejects' },
    ],
  },
]

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const isComment = text.startsWith('#')
  return (
    <button
      className="cmd-row"
      onClick={() => {
        if (isComment) return
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title={isComment ? '' : 'Klik untuk copy'}
      style={{ cursor: isComment ? 'default' : 'pointer' }}
    >
      <code className={isComment ? 'cmd-comment' : 'cmd-text'}>{text}</code>
      {!isComment && <span className="cmd-copy">{copied ? '✓' : 'copy'}</span>}
    </button>
  )
}

export default function AdminRunbookPage() {
  return (
    <div className="rb-wrap">
      <style>{styles}</style>
      <h1 className="rb-h1">Runbook — Command Lokal</h1>
      <p className="rb-lede">
        Daftar perintah Python lokal untuk maintain data: screening kasus, verifikasi, dan crawl hotspot.
        Semua perintah dijalankan dari root project di terminal (PowerShell / Bash). Klik baris perintah untuk copy.
      </p>

      <nav className="rb-toc">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rb-toc-link">{s.title}</a>
        ))}
      </nav>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="rb-section">
          <h2 className="rb-h2">{s.title}</h2>

          <div className="rb-meta">
            <div><strong>Apa:</strong> {s.purpose}</div>
            <div><strong>Kapan:</strong> {s.when}</div>
            <div><strong>Biaya:</strong> {s.cost}</div>
          </div>

          <div className="rb-cmds">
            {s.commands.map((c, i) => (
              <div key={i} className="rb-cmd-block">
                <Copy text={c.cmd} />
                {c.note && <div className="rb-cmd-note">{c.note}</div>}
              </div>
            ))}
          </div>

          {s.troubleshoot && s.troubleshoot.length > 0 && (
            <details className="rb-trouble">
              <summary>Troubleshoot</summary>
              <dl>
                {s.troubleshoot.map((t, i) => (
                  <div key={i} className="rb-trouble-row">
                    <dt>{t.issue}</dt>
                    <dd>{t.fix}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </section>
      ))}

      <section className="rb-footer">
        <h3>Catatan umum</h3>
        <ul>
          <li>Semua script baca <code>.env</code> dari root project — pastikan <code>MOONSHOT_API_KEY</code>, <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> terisi.</li>
          <li>Provider LLM diatur di <code>config.yaml</code> (default: moonshot/kimi-k2.6).</li>
          <li>Override sementara: <code>ACTIVE_LLM_PROVIDER=zhipu python scripts/...</code> (untuk script yang support).</li>
          <li>Idle terminal saat script jalan boleh; semua progres tercetak realtime.</li>
        </ul>
      </section>
    </div>
  )
}

const styles = `
.rb-wrap { max-width: 880px; padding-bottom: 60px; }
.rb-h1 { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 400; margin-bottom: 8px; color: var(--ink); }
.rb-lede { font-size: 12px; color: var(--muted); margin-bottom: 24px; max-width: 70ch; line-height: 1.6; }
.rb-toc { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; background: #fbf7ee; border: 1px solid var(--rule); border-radius: 4px; margin-bottom: 32px; }
.rb-toc-link { font-size: 12px; color: var(--ink); text-decoration: none; padding: 4px 0; }
.rb-toc-link:hover { color: var(--accent); }
.rb-section { margin-bottom: 40px; padding-bottom: 32px; border-bottom: 1px solid var(--rule); }
.rb-section:last-of-type { border-bottom: none; }
.rb-h2 { font-family: 'Fraunces', serif; font-size: 20px; font-weight: 400; margin-bottom: 14px; color: var(--ink); scroll-margin-top: 24px; }
.rb-meta { font-size: 12px; line-height: 1.7; color: var(--muted); margin-bottom: 16px; padding: 12px 16px; background: rgba(255,255,255,0.5); border-left: 2px solid var(--accent); }
.rb-meta strong { color: var(--ink); font-weight: 500; }
.rb-cmds { display: flex; flex-direction: column; gap: 6px; }
.rb-cmd-block { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.cmd-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #0f1117; border: none; border-radius: 3px; text-align: left; width: 100%; font-family: 'DM Mono', monospace; }
.cmd-row:hover .cmd-copy { color: var(--accent); }
.cmd-text { color: #f5f1ea; font-size: 12px; flex: 1; word-break: break-all; }
.cmd-comment { color: #6b6859; font-size: 11px; font-style: italic; }
.cmd-copy { color: #5a5e6a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-left: 12px; }
.rb-cmd-note { font-size: 11px; color: var(--muted); padding-left: 12px; line-height: 1.5; }
.rb-trouble { margin-top: 18px; }
.rb-trouble summary { font-size: 11px; color: var(--muted); cursor: pointer; padding: 4px 0; text-transform: uppercase; letter-spacing: 0.08em; }
.rb-trouble summary:hover { color: var(--ink); }
.rb-trouble dl { margin-top: 10px; padding: 12px 16px; background: rgba(192,57,43,0.05); border-radius: 3px; }
.rb-trouble-row { margin-bottom: 12px; font-size: 12px; }
.rb-trouble-row:last-child { margin-bottom: 0; }
.rb-trouble-row dt { color: var(--accent); font-family: 'DM Mono', monospace; font-size: 11px; margin-bottom: 3px; }
.rb-trouble-row dd { margin: 0; color: var(--ink); line-height: 1.5; }
.rb-footer { margin-top: 40px; padding: 18px 20px; background: #fbf7ee; border: 1px solid var(--rule); border-radius: 4px; }
.rb-footer h3 { font-family: 'Fraunces', serif; font-size: 14px; font-weight: 400; margin-bottom: 10px; color: var(--ink); }
.rb-footer ul { font-size: 12px; color: var(--ink); line-height: 1.7; padding-left: 20px; }
.rb-footer li { margin-bottom: 4px; }
.rb-footer code { background: #ece7dc; padding: 1px 6px; border-radius: 2px; font-size: 11px; }
`
