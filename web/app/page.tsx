import { getSiteStats, listHotspotEvents, listLeaderRoster, listPejabatPusat, listProvinceCounts, listProvinceHotspotCounts, listProvinceKasusCounts } from '@/lib/queries'
import HomeShell from './_components/HomeShell'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Peta Pejabat Indonesia',
  description:
    'Agregator data publik pejabat eksekutif daerah di Indonesia — gubernur, bupati, walikota, dan wakilnya. Bersumber dari Wikipedia, situs resmi pemerintah, dan penelusuran web terverifikasi.',
}

export default async function HomePage() {
  const [
    provinces,
    stats,
    leaders,
    pusatOfficials,
    kasusCounts,
    hotspotEvents24h,
    hotspotEvents7d,
    provinceHotspot24h,
    provinceHotspot7d,
  ] = await Promise.all([
    listProvinceCounts(),
    getSiteStats(),
    listLeaderRoster(),
    listPejabatPusat(),
    listProvinceKasusCounts(),
    listHotspotEvents('24h'),
    listHotspotEvents('7d'),
    listProvinceHotspotCounts('24h'),
    listProvinceHotspotCounts('7d'),
  ])

  return (
    <HomeShell
      provinces={provinces}
      stats={stats}
      leaders={leaders}
      pusatOfficials={pusatOfficials}
      kasusCounts={kasusCounts}
      hotspotEvents24h={hotspotEvents24h}
      hotspotEvents7d={hotspotEvents7d}
      provinceHotspot24h={provinceHotspot24h}
      provinceHotspot7d={provinceHotspot7d}
    />
  )
}
