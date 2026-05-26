# Daily Hotspot (`/pulse`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the democracy pulse map at `/pulse` — automated daily crawl (Supabase Edge Function + pg_cron at 09:00 WIB), admin manual keyword override, full archive with time-filter presets, map dots per province, and searchable sidebar.

**Architecture:** Edge Function `crawl-hotspot` calls Jina search, passes results to LLM (ZhipuAI or OpenAI-compatible), extracts `judul/ringkasan/kategori/lokasi_nama/pejabat_name`, resolves `lokasi_nama → wilayah_id` (province level), deduplicates by URL. pg_cron triggers at `0 2 * * *` UTC (09:00 WIB). Admin `/admin/hotspot` page triggers the function on-demand with optional keyword. `/pulse` page renders map + sidebar. Prerequisite: Plan 1 migration must be applied (`hotspot_events` and `settings` tables exist).

**Tech Stack:** Supabase Edge Functions (Deno), pg_cron, Next.js 16.2 + React 19, TypeScript

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/functions/crawl-hotspot/index.ts` | Crawler edge function |
| Create | `supabase/functions/crawl-hotspot/llm.ts` | LLM extraction helper |
| Create | `supabase/functions/crawl-hotspot/resolve.ts` | `lokasi_nama → wilayah_id` resolver |
| Create | `supabase/migrations/008_pg_cron_hotspot.sql` | pg_cron schedule setup |
| Modify | `web/lib/queries.ts` | Add hotspot queries |
| Create | `web/app/pulse/page.tsx` | Server component |
| Create | `web/app/pulse/PulseShell.tsx` | Client shell (use frontend-design skill) |
| Create | `web/app/_components/HotspotMap.tsx` | Map with province dots |
| Create | `web/app/_components/HotspotSidebar.tsx` | Event feed + search |
| Create | `web/app/_components/HotspotModal.tsx` | Event detail modal |
| Create | `web/app/admin/hotspot/page.tsx` | Admin manual trigger page |
| Create | `web/app/admin/settings/page.tsx` | LLM settings page |
| Modify | `web/app/_components/HomeShell.tsx` | Add "Pulse" nav link |

---

### Task 1: Edge Function — LLM extraction helper

**Files:**
- Create: `supabase/functions/crawl-hotspot/llm.ts`

- [ ] **Step 1: Write the LLM helper**

```typescript
// supabase/functions/crawl-hotspot/llm.ts

export interface ExtractedEvent {
  judul: string
  ringkasan: string
  kategori: 'korupsi' | 'pernyataan' | 'demonstrasi' | 'kebijakan' | 'kritik' | 'lainnya'
  lokasi_nama: string | null
  pejabat_nama: string | null
}

const SYSTEM_PROMPT = `Kamu adalah analis berita Indonesia. Dari artikel berita berikut, ekstrak informasi:
- judul: judul singkat (maks 120 karakter)
- ringkasan: ringkasan 2-3 kalimat dalam bahasa Indonesia
- kategori: salah satu dari: korupsi, pernyataan, demonstrasi, kebijakan, kritik, lainnya
- lokasi_nama: nama kota/provinsi yang paling relevan dengan berita (null jika tidak ada)
- pejabat_nama: nama lengkap pejabat yang paling terkait (null jika tidak ada)

Jawab HANYA dengan JSON valid, tanpa komentar atau teks lain.`

export async function extractEvent(
  articleText: string,
  apiKey: string,
  model: string,
  provider: string,
): Promise<ExtractedEvent | null> {
  const baseUrl = provider === 'zhipu'
    ? 'https://open.bigmodel.cn/api/paas/v4'
    : 'https://api.openai.com/v1'

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: articleText.slice(0, 4000) },
      ],
      temperature: 0.1,
      max_tokens: 400,
    }),
  })

  if (!resp.ok) return null
  const data = await resp.json()
  const raw = data.choices?.[0]?.message?.content ?? ''

  try {
    const parsed = JSON.parse(raw.replace(/```json\n?|```/g, '').trim())
    return {
      judul: parsed.judul ?? '',
      ringkasan: parsed.ringkasan ?? '',
      kategori: parsed.kategori ?? 'lainnya',
      lokasi_nama: parsed.lokasi_nama ?? null,
      pejabat_nama: parsed.pejabat_nama ?? null,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crawl-hotspot/llm.ts
git commit -m "feat: edge function LLM extraction helper"
```

---

### Task 2: Edge Function — location resolver

**Files:**
- Create: `supabase/functions/crawl-hotspot/resolve.ts`

- [ ] **Step 1: Write the resolver**

```typescript
// supabase/functions/crawl-hotspot/resolve.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Normalize text for fuzzy match: lowercase, remove common prefixes
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(kota|kabupaten|kab\.?|provinsi|prov\.?)\s+/i, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

let provinsiCache: Array<{ id: string; nama: string; normalized: string }> | null = null

async function getProvinsiList(supabase: ReturnType<typeof createClient>) {
  if (provinsiCache) return provinsiCache
  const { data } = await supabase
    .from('wilayah')
    .select('id, nama')
    .eq('level', 'provinsi')
  provinsiCache = (data ?? []).map((w: { id: string; nama: string }) => ({
    id: w.id,
    nama: w.nama,
    normalized: normalize(w.nama),
  }))
  return provinsiCache
}

export async function resolveWilayahId(
  lokasi: string | null,
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  if (!lokasi) return null
  const list = await getProvinsiList(supabase)
  const normLokasi = normalize(lokasi)

  // Exact match first
  const exact = list.find((p) => p.normalized === normLokasi)
  if (exact) return exact.id

  // Substring match
  const sub = list.find((p) => p.normalized.includes(normLokasi) || normLokasi.includes(p.normalized))
  if (sub) return sub.id

  // Special cases
  const ALIASES: Record<string, string> = {
    jakarta: 'DKI Jakarta',
    jogja: 'DI Yogyakarta',
    yogyakarta: 'DI Yogyakarta',
    'jawa barat': 'Jawa Barat',
    'jawa tengah': 'Jawa Tengah',
    'jawa timur': 'Jawa Timur',
    sulsel: 'Sulawesi Selatan',
    sumsel: 'Sumatera Selatan',
    sumut: 'Sumatera Utara',
    sumbar: 'Sumatera Barat',
    kaltim: 'Kalimantan Timur',
    kalsel: 'Kalimantan Selatan',
    kalbar: 'Kalimantan Barat',
    kalteng: 'Kalimantan Tengah',
    sulut: 'Sulawesi Utara',
    sulteng: 'Sulawesi Tengah',
    sultra: 'Sulawesi Tenggara',
    ntb: 'Nusa Tenggara Barat',
    ntt: 'Nusa Tenggara Timur',
    papua: 'Papua',
    maluku: 'Maluku',
  }

  for (const [alias, provName] of Object.entries(ALIASES)) {
    if (normLokasi.includes(alias)) {
      const match = list.find((p) => p.nama === provName)
      if (match) return match.id
    }
  }

  return null
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crawl-hotspot/resolve.ts
git commit -m "feat: edge function location resolver"
```

---

### Task 3: Edge Function — main crawler

**Files:**
- Create: `supabase/functions/crawl-hotspot/index.ts`

- [ ] **Step 1: Write the main function**

```typescript
// supabase/functions/crawl-hotspot/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractEvent } from './llm.ts'
import { resolveWilayahId } from './resolve.ts'

const DAILY_QUERIES = [
  'pejabat Indonesia kontroversial hari ini',
  'korupsi pejabat Indonesia terbaru',
  'demonstrasi Indonesia pejabat',
  'kebijakan kontroversial Indonesia',
  'pejabat Indonesia dikritik publik',
]

async function searchJina(query: string): Promise<Array<{ url: string; title: string; content: string }>> {
  const encoded = encodeURIComponent(query)
  const resp = await fetch(`https://s.jina.ai/${encoded}`, {
    headers: { Accept: 'application/json' },
  })
  if (!resp.ok) return []
  const data = await resp.json()
  return (data.data ?? []).slice(0, 5).map((item: Record<string, string>) => ({
    url: item.url ?? '',
    title: item.title ?? '',
    content: item.content ?? '',
  }))
}

async function getSettings(supabase: ReturnType<typeof createClient>): Promise<{
  llm_provider: string
  llm_model: string
  hotspot_keywords: string[]
}> {
  const { data } = await supabase.from('settings').select('key, value')
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    llm_provider: map.get('llm_provider') ?? 'zhipu',
    llm_model: map.get('llm_model') ?? 'glm-4.5-air',
    hotspot_keywords: JSON.parse(map.get('hotspot_keywords') ?? '[]'),
  }
}

async function getExistingUrls(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const { data } = await supabase
    .from('hotspot_events')
    .select('url_sumber')
    .gte('crawled_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
  return new Set((data ?? []).map((r: { url_sumber: string }) => r.url_sumber).filter(Boolean))
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const llmApiKey = Deno.env.get('LLM_API_KEY')!

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Parse optional manual keyword from request body
  let extraKeyword: string | null = null
  let isManual = false
  try {
    const body = await req.json()
    extraKeyword = body?.keyword ?? null
    isManual = !!body?.is_manual
  } catch { /* no body */ }

  const settings = await getSettings(supabase)
  const existingUrls = await getExistingUrls(supabase)

  const queries = [
    ...DAILY_QUERIES,
    ...settings.hotspot_keywords,
    ...(extraKeyword ? [extraKeyword] : []),
  ]

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const query of queries) {
    let results: Array<{ url: string; title: string; content: string }>
    try {
      results = await searchJina(query)
    } catch (e) {
      errors.push(`Search failed for "${query}": ${e}`)
      continue
    }

    for (const result of results) {
      if (!result.url || existingUrls.has(result.url)) { skipped++; continue }

      const articleText = `Judul: ${result.title}\n\n${result.content}`
      const extracted = await extractEvent(articleText, llmApiKey, settings.llm_model, settings.llm_provider)
      if (!extracted || !extracted.judul) { skipped++; continue }

      const wilayah_id = await resolveWilayahId(extracted.lokasi_nama, supabase)

      // Resolve pejabat_id from name (best-effort)
      let pejabat_id: string | null = null
      if (extracted.pejabat_nama) {
        const { data: matches } = await supabase
          .from('pejabat')
          .select('id')
          .ilike('nama_lengkap', `%${extracted.pejabat_nama}%`)
          .limit(1)
        pejabat_id = matches?.[0]?.id ?? null
      }

      const { error } = await supabase.from('hotspot_events').insert({
        judul: extracted.judul,
        ringkasan: extracted.ringkasan,
        kategori: extracted.kategori,
        lokasi_nama: extracted.lokasi_nama,
        wilayah_id,
        pejabat_id,
        url_sumber: result.url,
        sumber_nama: new URL(result.url).hostname.replace('www.', ''),
        is_manual: isManual,
      })

      if (error) {
        errors.push(`Insert failed: ${error.message}`)
      } else {
        existingUrls.add(result.url)
        inserted++
      }
    }
  }

  return Response.json({ inserted, skipped, errors, queries_run: queries.length })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/crawl-hotspot/index.ts
git commit -m "feat: crawl-hotspot edge function — search, extract, insert"
```

---

### Task 4: pg_cron schedule

**Files:**
- Create: `supabase/migrations/008_pg_cron_hotspot.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/008_pg_cron_hotspot.sql
-- Requires pg_cron and pg_net extensions (enable in Supabase dashboard first)
-- Schedule: 0 2 * * * UTC = 09:00 WIB

SELECT cron.schedule(
  'crawl-hotspot-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/crawl-hotspot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  )
  $$
);
```

- [ ] **Step 2: Enable extensions and apply**

In Supabase dashboard:
1. Go to Database → Extensions → enable `pg_cron` and `pg_net`
2. Go to Settings → API → copy Service Role Key
3. Run in SQL editor:
```sql
ALTER DATABASE postgres SET app.supabase_url = 'https://<your-project>.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = '<service-role-key>';
```
4. Run the migration SQL.

Verify:
```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'crawl-hotspot-daily';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/008_pg_cron_hotspot.sql
git commit -m "feat: pg_cron daily schedule for crawl-hotspot at 09:00 WIB"
```

---

### Task 5: Hotspot queries

**Files:**
- Modify: `web/lib/queries.ts`

- [ ] **Step 1: Add hotspot types and queries** (append to `queries.ts`)

```typescript
// ─── Hotspot events ──────────────────────────────────────────────────────────

import type { HotspotEvent } from './types'

export type HotspotTimeFilter = '24h' | '7d' | '30d' | '90d' | 'all'

function hotspotSince(filter: HotspotTimeFilter): string | null {
  if (filter === 'all') return null
  const ms = { '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 }[filter]
  return new Date(Date.now() - ms).toISOString()
}

export interface HotspotEventWithPejabat extends HotspotEvent {
  pejabat_nama: string | null
  provinsi_nama: string | null
}

export async function listHotspotEvents(
  filter: HotspotTimeFilter = '24h',
): Promise<HotspotEventWithPejabat[]> {
  const supabase = await createServerSupabase()
  const since = hotspotSince(filter)

  let q = supabase
    .from('hotspot_events')
    .select('*')
    .order('crawled_at', { ascending: false })
    .limit(500)

  if (since) q = q.gte('crawled_at', since)

  const { data: events } = await q
  const rows = (events ?? []) as HotspotEvent[]

  if (rows.length === 0) return []

  // Resolve pejabat names
  const pejabatIds = [...new Set(rows.map((r) => r.pejabat_id).filter(Boolean))] as string[]
  const wilayahIds = [...new Set(rows.map((r) => r.wilayah_id).filter(Boolean))] as string[]

  const [pejabatRows, wilayahRows] = await Promise.all([
    pejabatIds.length
      ? supabase.from('pejabat').select('id, nama_lengkap').in('id', pejabatIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
    wilayahIds.length
      ? supabase.from('wilayah').select('id, nama').in('id', wilayahIds)
          .then(({ data }) => data ?? [])
      : Promise.resolve([]),
  ])

  const pejabatMap = new Map((pejabatRows as Array<{ id: string; nama_lengkap: string }>).map((p) => [p.id, p.nama_lengkap]))
  const wilayahMap = new Map((wilayahRows as Array<{ id: string; nama: string }>).map((w) => [w.id, w.nama]))

  return rows.map((r) => ({
    ...r,
    pejabat_nama: r.pejabat_id ? (pejabatMap.get(r.pejabat_id) ?? null) : null,
    provinsi_nama: r.wilayah_id ? (wilayahMap.get(r.wilayah_id) ?? null) : null,
  }))
}

export interface ProvinceHotspotCount {
  wilayah_id: string
  provinsi_nama: string
  count: number
  kategori_counts: Record<string, number>
}

export async function listProvinceHotspotCounts(
  filter: HotspotTimeFilter = '24h',
): Promise<ProvinceHotspotCount[]> {
  const events = await listHotspotEvents(filter)
  const byWilayah = new Map<string, { nama: string; count: number; kategori: Record<string, number> }>()

  for (const e of events) {
    if (!e.wilayah_id || !e.provinsi_nama) continue
    const cur = byWilayah.get(e.wilayah_id) ?? { nama: e.provinsi_nama, count: 0, kategori: {} }
    cur.count++
    cur.kategori[e.kategori ?? 'lainnya'] = (cur.kategori[e.kategori ?? 'lainnya'] ?? 0) + 1
    byWilayah.set(e.wilayah_id, cur)
  }

  return Array.from(byWilayah.entries()).map(([wilayah_id, v]) => ({
    wilayah_id,
    provinsi_nama: v.nama,
    count: v.count,
    kategori_counts: v.kategori,
  }))
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/queries.ts
git commit -m "feat: add listHotspotEvents and listProvinceHotspotCounts queries"
```

---

### Task 6: `/pulse` page and components

**Files:**
- Create: `web/app/pulse/page.tsx`
- Create: `web/app/pulse/PulseShell.tsx`
- Create: `web/app/_components/HotspotMap.tsx`
- Create: `web/app/_components/HotspotSidebar.tsx`
- Create: `web/app/_components/HotspotModal.tsx`

- [ ] **Step 1: Invoke `frontend-design` skill**

Before implementing any of these components, invoke the `frontend-design` skill. Design notes:
- Same newspaper aesthetic as homepage (Fraunces + DM Mono, same CSS vars)
- Map: same `IndonesiaMap` component, province dots colored by kategori (red=korupsi, orange=demonstrasi, yellow=pernyataan, grey=lainnya), sized by event count
- Layout: map on left/top, sidebar on right (searchable, scrollable event feed)
- Modal: slides up or appears as overlay, shows judul, ringkasan, kategori badge, sumber link, pejabat link, timestamp
- Time filter tabs: `Hari Ini | 7 Hari | 30 Hari | 90 Hari | Semua`
- The page heading should convey "democracy pulse / denyut demokrasi"

- [ ] **Step 2: Create the server component**

```typescript
// web/app/pulse/page.tsx
import { listHotspotEvents, listProvinceHotspotCounts, listProvinceCounts } from '@/lib/queries'
import PulseShell from './PulseShell'

export const revalidate = 300 // re-fetch every 5 min

export default async function PulsePage() {
  const [events, provinceCounts, allProvinces] = await Promise.all([
    listHotspotEvents('24h'),
    listProvinceHotspotCounts('24h'),
    listProvinceCounts(),
  ])

  return (
    <PulseShell
      initialEvents={events}
      initialProvinceCounts={provinceCounts}
      allProvinces={allProvinces}
    />
  )
}
```

- [ ] **Step 3: Create `PulseShell.tsx`** (implement per frontend-design skill)

```typescript
// web/app/pulse/PulseShell.tsx
'use client'

import { useState, useMemo } from 'react'
import type { HotspotEventWithPejabat, ProvinceHotspotCount, HotspotTimeFilter, ProvinceCount } from '@/lib/queries'
import HotspotMap from '@/app/_components/HotspotMap'
import HotspotSidebar from '@/app/_components/HotspotSidebar'
import HotspotModal from '@/app/_components/HotspotModal'

const TIME_FILTERS: { key: HotspotTimeFilter; label: string }[] = [
  { key: '24h', label: 'Hari Ini' },
  { key: '7d', label: '7 Hari' },
  { key: '30d', label: '30 Hari' },
  { key: '90d', label: '90 Hari' },
  { key: 'all', label: 'Semua' },
]

interface Props {
  initialEvents: HotspotEventWithPejabat[]
  initialProvinceCounts: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
}

export default function PulseShell({ initialEvents, initialProvinceCounts, allProvinces }: Props) {
  const [timeFilter, setTimeFilter] = useState<HotspotTimeFilter>('24h')
  const [events, setEvents] = useState(initialEvents)
  const [provinceCounts, setProvinceCounts] = useState(initialProvinceCounts)
  const [selectedEvent, setSelectedEvent] = useState<HotspotEventWithPejabat | null>(null)
  const [loading, setLoading] = useState(false)

  // When time filter changes, re-fetch via route handler
  async function changeFilter(f: HotspotTimeFilter) {
    setTimeFilter(f)
    setLoading(true)
    const resp = await fetch(`/api/hotspot?filter=${f}`)
    const data = await resp.json()
    setEvents(data.events)
    setProvinceCounts(data.provinceCounts)
    setLoading(false)
  }

  // Province dot color by dominant kategori
  const provinceColor = useMemo(() => {
    const KATEGORI_COLOR: Record<string, string> = {
      korupsi: '#c0392b',
      demonstrasi: '#e67e22',
      pernyataan: '#f39c12',
      kebijakan: '#8e44ad',
      kritik: '#2980b9',
      lainnya: '#7f8c8d',
    }
    return (wilayahId: string): string => {
      const pc = provinceCounts.find((p) => p.wilayah_id === wilayahId)
      if (!pc) return 'transparent'
      const top = Object.entries(pc.kategori_counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'lainnya'
      return KATEGORI_COLOR[top] ?? KATEGORI_COLOR.lainnya
    }
  }, [provinceCounts])

  // ... implement per frontend-design skill
  return null // replace with actual JSX
}
```

- [ ] **Step 4: Create API route for client-side filter changes**

```typescript
// web/app/api/hotspot/route.ts
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
```

- [ ] **Step 5: Create `HotspotMap.tsx`** (implement per frontend-design skill)

```typescript
// web/app/_components/HotspotMap.tsx
'use client'

import IndonesiaMap from './IndonesiaMap'
import type { ProvinceHotspotCount, ProvinceCount } from '@/lib/queries'

interface Props {
  provinceCounts: ProvinceHotspotCount[]
  allProvinces: ProvinceCount[]
  onProvinceClick: (wilayahId: string) => void
}

export default function HotspotMap({ provinceCounts, allProvinces, onProvinceClick }: Props) {
  // Reuse IndonesiaMap with colorBy returning dot opacity based on event count
  // Provinces with events show colored fill; others show neutral
  // Click triggers onProvinceClick(wilayahId)
  // Tooltip: "${count} kejadian · klik untuk lihat"
  return null // implement per frontend-design skill
}
```

- [ ] **Step 6: Create `HotspotSidebar.tsx`** (implement per frontend-design skill)

```typescript
// web/app/_components/HotspotSidebar.tsx
'use client'

import type { HotspotEventWithPejabat } from '@/lib/queries'

interface Props {
  events: HotspotEventWithPejabat[]
  onEventClick: (event: HotspotEventWithPejabat) => void
  loading: boolean
}

export default function HotspotSidebar({ events, onEventClick, loading }: Props) {
  // Searchable feed: text input filters on judul + ringkasan (client-side)
  // Each item: kategori badge, judul, sumber_nama, relative timestamp, pejabat_nama if set
  // Click → triggers onEventClick
  return null // implement per frontend-design skill
}
```

- [ ] **Step 7: Create `HotspotModal.tsx`** (implement per frontend-design skill)

```typescript
// web/app/_components/HotspotModal.tsx
'use client'

import Link from 'next/link'
import type { HotspotEventWithPejabat } from '@/lib/queries'

interface Props {
  event: HotspotEventWithPejabat | null
  onClose: () => void
}

export default function HotspotModal({ event, onClose }: Props) {
  if (!event) return null
  // Overlay modal: judul (Fraunces), ringkasan, kategori badge, sumber link, pejabat link if set, timestamp
  // Dismiss on overlay click or ESC key
  return null // implement per frontend-design skill
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 9: Test in dev**

```bash
cd web && npm run dev
```
Navigate to `http://localhost:3000/pulse`. Expect the page to load (empty state if no events yet). Trigger a manual crawl from admin (Task 7) and reload.

- [ ] **Step 10: Commit**

```bash
git add web/app/pulse/ web/app/api/hotspot/ web/app/_components/HotspotMap.tsx web/app/_components/HotspotSidebar.tsx web/app/_components/HotspotModal.tsx
git commit -m "feat: /pulse page with HotspotMap, HotspotSidebar, HotspotModal"
```

---

### Task 7: Admin pages

**Files:**
- Create: `web/app/admin/hotspot/page.tsx`
- Create: `web/app/admin/settings/page.tsx`

- [ ] **Step 1: Invoke `frontend-design` skill**

Invoke for both admin pages. They should match the existing admin aesthetic (see `/admin/dashboard` for reference). Admin hotspot page has: a "Jalankan Crawl" button, an optional keyword input, a log of last crawl results, and a list of persistent keywords. Admin settings page has: LLM provider select, LLM model text input, save button, and a note about API keys.

- [ ] **Step 2: Create `web/app/admin/hotspot/page.tsx`**

```typescript
// web/app/admin/hotspot/page.tsx
'use client'

import { useState } from 'react'

export default function AdminHotspotPage() {
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(false)

  async function runCrawl() {
    setLoading(true)
    setResult(null)
    const body = keyword.trim() ? { keyword: keyword.trim(), is_manual: true } : { is_manual: true }
    const resp = await fetch('/api/admin/hotspot/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    setResult(data)
    setLoading(false)
  }

  // Implement UI per frontend-design skill
  return null
}
```

- [ ] **Step 3: Create `/api/admin/hotspot/crawl` route handler**

```typescript
// web/app/api/admin/hotspot/crawl/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  // Auth check
  const cookieStore = await cookies()
  if (!cookieStore.get('admin_session')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const supabaseUrl = process.env.SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const resp = await fetch(`${supabaseUrl}/functions/v1/crawl-hotspot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  })

  const data = await resp.json()
  return NextResponse.json(data)
}
```

- [ ] **Step 4: Create `web/app/admin/settings/page.tsx`**

```typescript
// web/app/admin/settings/page.tsx
'use client'

import { useState, useEffect } from 'react'

const LLM_PROVIDERS = ['zhipu', 'openai', 'anthropic'] as const

export default function AdminSettingsPage() {
  const [provider, setProvider] = useState('zhipu')
  const [model, setModel] = useState('glm-4.5-air')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings').then((r) => r.json()).then((data) => {
      setProvider(data.llm_provider ?? 'zhipu')
      setModel(data.llm_model ?? 'glm-4.5-air')
    })
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_provider: provider, llm_model: model }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Implement UI per frontend-design skill
  // Show: provider select, model input, save button
  // Note: "API key dikelola via Supabase Secrets, bukan di sini"
  return null
}
```

- [ ] **Step 5: Create settings API routes**

```typescript
// web/app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerSupabase } from '@/lib/supabase'

async function checkAuth() {
  const cookieStore = await cookies()
  return !!cookieStore.get('admin_session')
}

export async function GET() {
  if (!await checkAuth()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('settings').select('key, value')
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return NextResponse.json(map)
}

export async function POST(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json()
  const supabase = await createServerSupabase()
  const allowed = ['llm_provider', 'llm_model'] as const
  for (const key of allowed) {
    if (body[key] !== undefined) {
      await supabase.from('settings').upsert({ key, value: String(body[key]) })
    }
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 7: Test admin crawl**

Start dev server, log in to `/admin`, navigate to `/admin/hotspot`. Click "Jalankan Crawl". Check Supabase `hotspot_events` table — expect new rows. Then visit `/pulse` — expect events in sidebar.

- [ ] **Step 8: Commit**

```bash
git add web/app/admin/hotspot/ web/app/admin/settings/ web/app/api/admin/
git commit -m "feat: admin hotspot manual crawl and LLM settings pages"
```

---

### Task 8: Add "Pulse" nav link

**Files:**
- Modify: `web/app/_components/HomeShell.tsx`

- [ ] **Step 1: Add the nav link**

In `PreviewShell`, in the `<nav className="pv-nav">` block, add after "Direktori":

```typescript
<Link href="/pulse" className="pv-nav-link">Denyut</Link>
```

- [ ] **Step 2: Verify dev server**

```bash
cd web && npm run dev
```
Confirm "Denyut" appears in nav and links to `/pulse`.

- [ ] **Step 3: Commit**

```bash
git add web/app/_components/HomeShell.tsx
git commit -m "feat: add Denyut (pulse) nav link to homepage"
```
