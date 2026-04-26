import { notFound } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase'
import { PejabatRow, JabatanRow, Wilayah } from '@/lib/types'
import ProfileClient from './ProfileClient'

interface Props {
  params: Promise<{ 'pejabat-id': string }>
}

export default async function PejabatProfilePage({ params }: Props) {
  const { 'pejabat-id': id } = await params
  const supabase = await createServerSupabase()

  const [pejabatRes, jabatanRes] = await Promise.all([
    supabase.from('pejabat').select('*').eq('id', id).single(),
    supabase
      .from('jabatan')
      .select('*, wilayah:wilayah_id(nama, kode_bps)')
      .eq('pejabat_id', id)
      .order('mulai_jabatan', { ascending: false }),
  ])

  if (pejabatRes.error || !pejabatRes.data) notFound()

  const pejabat = pejabatRes.data as PejabatRow
  const jabatan = (jabatanRes.data ?? []) as (JabatanRow & { wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'> })[]

  return <ProfileClient pejabat={pejabat} jabatan={jabatan} />
}
