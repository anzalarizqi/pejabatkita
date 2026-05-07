import { getSiteStats, listLeaderRoster, listProvinceCounts } from '@/lib/queries'
import PreviewShell from './PreviewShell'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Peta Pejabat Indonesia',
  description:
    'Agregator data publik pejabat eksekutif daerah di Indonesia — gubernur, bupati, walikota, dan wakilnya. Bersumber dari Wikipedia, situs resmi pemerintah, dan penelusuran web terverifikasi.',
}

export default async function PreviewPage() {
  const [provinces, stats, leaders] = await Promise.all([
    listProvinceCounts(),
    getSiteStats(),
    listLeaderRoster(),
  ])

  return <PreviewShell provinces={provinces} stats={stats} leaders={leaders} />
}
