import { listKeranjangKoruptor, listPartaiKoruptor } from '@/lib/queries'
import KeranjangShell from './KeranjangShell'
import PartaiKoruptorPanel from './PartaiKoruptorPanel'

export const revalidate = 300
export const metadata = {
  title: 'Keranjang Koruptor — Pejabat Ditangkap Era Prabowo',
  description: 'Daftar pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024.',
}

export default async function KeranjangKoruptorPage() {
  const [rows, partai] = await Promise.all([listKeranjangKoruptor(), listPartaiKoruptor()])
  return <KeranjangShell rows={rows} panel={<PartaiKoruptorPanel data={partai} />} />
}
