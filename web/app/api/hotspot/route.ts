import { NextRequest, NextResponse } from 'next/server'
import { listHotspotEvents, listProvinceHotspotCounts, type HotspotTimeFilter } from '@/lib/queries'

const VALID_FILTERS: HotspotTimeFilter[] = ['24h', '7d', '30d', '90d', 'all']

export async function GET(req: NextRequest) {
  const filter = (req.nextUrl.searchParams.get('filter') ?? '24h') as HotspotTimeFilter
  if (!VALID_FILTERS.includes(filter)) {
    return NextResponse.json({ error: 'invalid filter' }, { status: 400 })
  }
  const [events, provinceCounts] = await Promise.all([
    listHotspotEvents(filter),
    listProvinceHotspotCounts(filter),
  ])
  return NextResponse.json({ events, provinceCounts })
}
