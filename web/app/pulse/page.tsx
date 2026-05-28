import { listHotspotEvents, listProvinceHotspotCounts, listProvinceCounts } from '@/lib/queries'
import PulseShell from './PulseShell'

export const revalidate = 300

export default async function PulsePage() {
  const [events, provinceCounts, allProvinces] = await Promise.all([
    listHotspotEvents('24h'),
    listProvinceHotspotCounts('24h'),
    listProvinceCounts(),
  ])

  return (
    <PulseShell
      initialEvents={events}
      initialProvinceCounts={provinceCounts}
      allProvinces={allProvinces}
    />
  )
}
