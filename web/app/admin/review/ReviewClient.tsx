'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FlagWithPejabat } from '@/lib/types'
import FlagCard from './FlagCard'

export default function ReviewClient({ flags: initialFlags }: { flags: FlagWithPejabat[] }) {
  const [flags, setFlags] = useState(initialFlags)
  const router = useRouter()

  function removeFlag(id: string) {
    setFlags((prev) => prev.filter((f) => f.id !== id))
  }

  return (
    <>
      <style>{`
        .review-header {
          display: flex;
          align-items: baseline;
          gap: 16px;
          margin-bottom: 32px;
        }

        .review-title {
          font-family: 'Fraunces', serif;
          font-size: 22px;
          font-weight: 300;
          color: #0f1117;
        }

        .review-count {
          font-size: 11px;
          letter-spacing: 0.08em;
          color: #8a857c;
        }

        .flag-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 800px;
        }

        .empty-state {
          padding: 60px 0;
          text-align: center;
          color: #8a857c;
          font-size: 12px;
          letter-spacing: 0.04em;
        }

        .empty-icon {
          font-size: 28px;
          color: #d4cfc5;
          margin-bottom: 12px;
        }
      `}</style>

      <div className="review-header">
        <h2 className="review-title">Antrian Tinjauan</h2>
        <span className="review-count">{flags.length} pending</span>
      </div>

      {flags.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <div>Tidak ada bendera yang perlu ditinjau.</div>
        </div>
      ) : (
        <div className="flag-list">
          {flags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} onResolved={removeFlag} />
          ))}
        </div>
      )}
    </>
  )
}
