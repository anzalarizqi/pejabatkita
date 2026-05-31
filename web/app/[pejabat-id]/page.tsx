import { notFound } from 'next/navigation'
import { Metadata } from 'next'
import { createServerSupabase } from '@/lib/supabase'
import { PejabatRow, JabatanRow, Wilayah, KasusRow } from '@/lib/types'
import { getKasusByPejabat } from '@/lib/queries'
import ProfileClient from './ProfileClient'

interface Props {
  params: Promise<{ 'pejabat-id': string }>
}

export const dynamic = 'force-dynamic'

async function loadProfile(id: string) {
  const supabase = await createServerSupabase()
  const [pejabatRes, jabatanRes, kasus] = await Promise.all([
    supabase.from('pejabat').select('*').eq('id', id).single(),
    supabase
      .from('jabatan')
      .select('*, wilayah:wilayah_id(nama, kode_bps)')
      .eq('pejabat_id', id)
      .order('mulai_jabatan', { ascending: false }),
    getKasusByPejabat(id),
  ])
  if (pejabatRes.error || !pejabatRes.data) return null

  const pejabat = pejabatRes.data as PejabatRow
  const jabatan = (jabatanRes.data ?? []) as (JabatanRow & {
    wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'>
  })[]

  // Resolve provinsi from the first jabatan's wilayah kode_bps prefix
  const firstKode = jabatan.find((j) => j.wilayah?.kode_bps)?.wilayah?.kode_bps
  let provinsiNama: string | null = null
  if (firstKode) {
    const provKode = firstKode.split('.')[0]
    const provRes = await supabase
      .from('wilayah')
      .select('nama')
      .eq('level', 'provinsi')
      .eq('kode_bps', provKode)
      .maybeSingle()
    provinsiNama = (provRes.data as { nama: string } | null)?.nama ?? null
  }

  return { pejabat, jabatan, provinsiNama, kasus }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { 'pejabat-id': id } = await params
  const data = await loadProfile(id)
  if (!data) return { title: 'Pejabat tidak ditemukan' }
  const { pejabat, jabatan } = data
  const nama = [pejabat.gelar_depan, pejabat.nama_lengkap, pejabat.gelar_belakang]
    .filter(Boolean).join(' ')
  const aktif = jabatan.find((j) => j.status === 'aktif')
  const subtitle = aktif ? `${aktif.posisi} ${aktif.wilayah?.nama ?? ''}`.trim() : 'Profil pejabat'
  return {
    title: `${nama} — ${subtitle}`,
    description: `Profil publik ${nama}. ${subtitle}. Sumber data terverifikasi.`,
  }
}

export default async function PejabatProfilePage({ params }: Props) {
  const { 'pejabat-id': id } = await params
  const data = await loadProfile(id)
  if (!data) notFound()

  const { pejabat, jabatan, provinsiNama, kasus } = data
  const nama = [pejabat.gelar_depan, pejabat.nama_lengkap, pejabat.gelar_belakang]
    .filter(Boolean).join(' ')
  const aktif = jabatan.find((j) => j.status === 'aktif')

  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: nama,
    ...(aktif && {
      jobTitle: aktif.posisi,
      worksFor: aktif.wilayah?.nama ? { '@type': 'GovernmentOrganization', name: aktif.wilayah.nama } : undefined,
    }),
    ...(pejabat.biodata?.tanggal_lahir && /^\d{4}-\d{2}-\d{2}/.test(pejabat.biodata.tanggal_lahir) && {
      birthDate: pejabat.biodata.tanggal_lahir.slice(0, 10),
    }),
    ...(pejabat.biodata?.tempat_lahir && { birthPlace: pejabat.biodata.tempat_lahir }),
    ...(pejabat.biodata?.jenis_kelamin && {
      gender: pejabat.biodata.jenis_kelamin === 'L' ? 'Male' : 'Female',
    }),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // Escape so a malicious name can't break out of <script> (audit PK-M1)
          __html: JSON.stringify(ldJson).replace(/[<>&]/g, (c) =>
            '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
          ),
        }}
      />
      <ProfileClient pejabat={pejabat} jabatan={jabatan} provinsiNama={provinsiNama} kasus={kasus} />
    </>
  )
}
