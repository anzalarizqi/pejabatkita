import { getSiteStats, listLeaderRoster, listPejabatPusat, listProvinceCounts, listProvinceKasusCounts } from '@/lib/queries'
import type { ProvinceKasusCount } from '@/lib/queries'
import HomeShell from './_components/HomeShell'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Peta Pejabat Indonesia',
  description:
    'Agregator data publik pejabat eksekutif daerah di Indonesia — gubernur, bupati, walikota, dan wakilnya. Bersumber dari Wikipedia, situs resmi pemerintah, dan penelusuran web terverifikasi.',
}

export default async function HomePage() {
  const [provinces, stats, leaders, pusatOfficials, kasusCounts] = await Promise.all([
    listProvinceCounts(),
    getSiteStats(),
    listLeaderRoster(),
    listPejabatPusat(),
    listProvinceKasusCounts(),
  ])

  return <HomeShell provinces={provinces} stats={stats} leaders={leaders} pusatOfficials={pusatOfficials} kasusCounts={kasusCounts} />
}
