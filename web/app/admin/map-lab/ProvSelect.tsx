'use client'

import { useRouter } from 'next/navigation'

interface Props {
  provinces: string[]
  selected: string
}

export default function ProvSelect({ provinces, selected }: Props) {
  const router = useRouter()
  return (
    <label style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#0f1117' }}>
      Provinsi (peta kab/kota):{' '}
      <select
        value={selected}
        onChange={(e) => router.push(`/admin/map-lab?prov=${encodeURIComponent(e.target.value)}`)}
        style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, padding: '4px 6px' }}
      >
        {provinces.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </label>
  )
}
