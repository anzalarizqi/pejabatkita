import IndonesiaMap from '@/app/_components/IndonesiaMap'
import KabKotaMap from '@/app/_components/KabKotaMap'
import { listProvinceCounts, listWilayahCounts } from '@/lib/queries'
import ProvSelect from './ProvSelect'

function provSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

export default async function MapLabPage({
  searchParams,
}: {
  searchParams: Promise<{ prov?: string }>
}) {
  const sp = await searchParams
  const prov = sp.prov ?? 'Jawa Barat'

  const provinces = await listProvinceCounts()
  const wilayahCounts = await listWilayahCounts(prov)
  const provinceNames = provinces.map((p) => p.nama).sort((a, b) => a.localeCompare(b, 'id'))

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px', fontFamily: "'DM Mono', monospace" }}>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 24 }}>
        Map Lab — zoom / pan sandbox
      </h1>
      <p style={{ fontSize: 12, color: '#6b6859', lineHeight: 1.6 }}>
        Test: scroll-wheel zoom (toward cursor), click-drag to pan, pinch on touch,
        the +/−/⌖ buttons, and recenter (⌖) returning to the default view. Borders
        should stay crisp; dots should track the map. This page is admin-only and not linked publicly.
      </p>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c' }}>
          IndonesiaMap
        </h2>
        <IndonesiaMap provinces={provinces} height={460} zoomable />
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a857c' }}>
          KabKotaMap
        </h2>
        <div style={{ margin: '8px 0 12px' }}>
          <ProvSelect provinces={provinceNames} selected={prov} />
        </div>
        <KabKotaMap
          provinsi={prov}
          provinsiSlug={provSlug(prov)}
          wilayahCounts={wilayahCounts}
          height={420}
          zoomable
        />
      </section>
    </main>
  )
}
