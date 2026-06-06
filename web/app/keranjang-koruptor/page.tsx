import { listKeranjangKoruptor } from '@/lib/queries'
import KeranjangShell from './KeranjangShell'

export const revalidate = 300
export const metadata = {
  title: 'Keranjang Koruptor — Pejabat Ditangkap Era Prabowo',
  description: 'Daftar pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024.',
}

export default async function KeranjangKoruptorPage() {
  const rows = await listKeranjangKoruptor()
  return <KeranjangShell rows={rows} />
}
