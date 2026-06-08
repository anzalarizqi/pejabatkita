import Link from 'next/link'
import type { PartaiKoruptorResult } from '@/lib/partaiKoruptor'

export default function PartaiKoruptorPanel({ data }: { data: PartaiKoruptorResult }) {
  if (!data.rows.length && !data.belumDikaitkanCount) return null
  const maxCount = data.rows.reduce((m, r) => Math.max(m, r.koruptorCount), 0) || 1

  return (
    <section className="pk-panel" aria-label="Koruptor per partai">
      <style>{styles}</style>
      <div className="pk-head">
        <h2 className="pk-title">Koruptor per Partai</h2>
        <span className="pk-note">jumlah pejabat dengan kasus terverifikasi · partai saat kasus</span>
      </div>

      <ul className="pk-list" role="list">
        {data.rows.map((r) => (
          <li key={r.partai} className="pk-row">
            <details>
              <summary className="pk-summary">
                <span className="pk-partai">{r.partai}</span>
                <span className="pk-bar-wrap">
                  <span className="pk-bar" style={{ width: `${(r.koruptorCount / maxCount) * 100}%` }} />
                </span>
                <span className="pk-count">
                  {r.koruptorCount} koruptor
                  <span className="pk-terdata"> · dari {r.terdataCount} pejabat terdata</span>
                </span>
              </summary>
              <ul className="pk-people" role="list">
                {r.koruptorList.map((k) => (
                  <li key={k.pejabat_id} className="pk-person">
                    <Link href={`/${k.pejabat_id}`} className="pk-person-name">{k.nama}</Link>
                    <span className="pk-person-meta">
                      {[k.posisi, k.status].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      {data.belumDikaitkanCount > 0 && (
        <p className="pk-belum">Belum dikaitkan ke partai: {data.belumDikaitkanCount} pejabat</p>
      )}
    </section>
  )
}

const styles = `
.pk-panel {
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2dccb;
  font-family: 'DM Mono', monospace;
  box-sizing: border-box;
}
.pk-head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.pk-title { font-family: 'Fraunces', serif; font-size: 1.25rem; font-weight: 400; margin: 0; color: #0f1117; }
.pk-note { font-size: .68rem; letter-spacing: .06em; color: #8a857c; }
.pk-list { list-style: none; margin: 0; padding: 0; }
.pk-row { border-top: 1px dashed #e2dccb; }
.pk-row:first-child { border-top: none; }
.pk-summary {
  display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: .75rem;
  padding: .55rem 0; cursor: pointer; list-style: none;
}
.pk-summary::-webkit-details-marker { display: none; }
.pk-partai { font-size: .82rem; color: #0f1117; }
.pk-bar-wrap { background: #ece7dc; height: 8px; border-radius: 2px; overflow: hidden; }
.pk-bar { display: block; height: 100%; background: #c0392b; }
.pk-count { font-size: .72rem; color: #0f1117; white-space: nowrap; }
.pk-terdata { color: #8a857c; }
.pk-people { list-style: none; margin: 0 0 .5rem; padding: 0 0 .25rem 110px; }
.pk-person { display: flex; gap: .6rem; align-items: baseline; padding: .2rem 0; }
.pk-person-name { font-family: 'Fraunces', serif; font-size: .92rem; color: #0f1117; text-decoration: none; border-bottom: 1px solid transparent; }
.pk-person-name:hover { color: #c0392b; border-bottom-color: #c0392b; }
.pk-person-meta { font-size: .68rem; color: #8a857c; letter-spacing: .04em; }
.pk-belum { font-size: .7rem; color: #8a857c; margin: .75rem 0 0; }
@media (max-width: 640px) {
  .pk-summary { grid-template-columns: 90px 1fr; }
  .pk-count { grid-column: 2; }
  .pk-bar-wrap { display: none; }
  .pk-people { padding-left: 0; }
}
`
