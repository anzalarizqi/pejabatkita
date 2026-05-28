import { listPejabat, listProvinceCounts, listWilayahCounts, listProvinceKasusCounts, listWilayahKasusCounts } from '@/lib/queries'
import PejabatBrowse from './PejabatBrowse'

interface SearchParams {
  provinsi?: string
  wilayah?: string
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
  const wilayah = sp.wilayah?.trim() || undefined
  const search = sp.q?.trim() || undefined
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10)) : 1

  const [list, provinceCounts, wilayahCounts, kasusCounts, wilayahKasusCounts] = await Promise.all([
    listPejabat({ provinsi, wilayah, search, page, pageSize: 24 }),
    listProvinceCounts(),
    provinsi ? listWilayahCounts(provinsi) : Promise.resolve([]),
    listProvinceKasusCounts(),
    provinsi ? listWilayahKasusCounts(provinsi) : Promise.resolve([]),
  ])

  return (
    <PejabatBrowse
      provinsi={provinsi ?? null}
      wilayah={wilayah ?? null}
      search={search ?? ''}
      page={page}
      list={list}
      provinces={provinceCounts}
      wilayahCounts={wilayahCounts}
      kasusCounts={kasusCounts}
      wilayahKasusCounts={wilayahKasusCounts}
    />
  )
}
