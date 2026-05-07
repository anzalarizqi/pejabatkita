import Link from 'next/link'
import { listPejabat, listProvinceCounts } from '@/lib/queries'
import PejabatBrowse from './PejabatBrowse'

interface SearchParams {
  provinsi?: string
  q?: string
  page?: string
}

export const dynamic = 'force-dynamic'

export default async function PejabatPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const provinsi = sp.provinsi?.trim() || undefined
  const search = sp.q?.trim() || undefined
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10)) : 1

  const [list, provinceCounts] = await Promise.all([
    listPejabat({ provinsi, search, page, pageSize: 24 }),
    listProvinceCounts(),
  ])

  return (
    <PejabatBrowse
      provinsi={provinsi ?? null}
      search={search ?? ''}
      page={page}
      list={list}
      provinces={provinceCounts}
    />
  )
}
