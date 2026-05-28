// supabase/functions/crawl-hotspot/index.ts
// Uses Kimi $web_search builtin: one call per query, Kimi searches AND extracts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { kimiSearchAndExtract, type ExtractedEvent } from './llm.ts'
import { resolveWilayahId } from './resolve.ts'

const DAILY_QUERIES = [
  'pejabat Indonesia kontroversial hari ini',
  'korupsi pejabat Indonesia terbaru',
  'demonstrasi Indonesia pejabat',
  'kebijakan kontroversial Indonesia',
  'pejabat Indonesia dikritik publik',
]

async function getSettings(supabase: ReturnType<typeof createClient>): Promise<{
  llm_provider: string
  llm_model: string
  hotspot_keywords: string[]
}> {
  const { data } = await supabase.from('settings').select('key, value')
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    llm_provider: map.get('llm_provider') ?? 'moonshot',
    llm_model: map.get('llm_model') ?? 'kimi-k2.6',
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

  // Run all Kimi search+extract calls in parallel (each takes ~20-40s)
  const results = await Promise.allSettled(
    queries.map((q) => kimiSearchAndExtract(q, llmApiKey, settings.llm_model)),
  )

  const allEvents: ExtractedEvent[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allEvents.push(...r.value)
    } else {
      errors.push(`Search/extract failed for "${queries[i]}": ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  })

  // Dedupe events within this batch by URL
  const seenInBatch = new Set<string>()
  const uniqueEvents = allEvents.filter((e) => {
    if (!e.url_sumber || seenInBatch.has(e.url_sumber)) return false
    seenInBatch.add(e.url_sumber)
    return true
  })

  {
    for (const ev of uniqueEvents) {
      if (!ev.url_sumber || !ev.judul) { skipped++; continue }
      if (existingUrls.has(ev.url_sumber)) { skipped++; continue }

      const wilayah_id = await resolveWilayahId(ev.lokasi_nama, supabase)

      let pejabat_id: string | null = null
      if (ev.pejabat_nama) {
        const { data: matches } = await supabase
          .from('pejabat')
          .select('id')
          .ilike('nama_lengkap', `%${ev.pejabat_nama}%`)
          .limit(1)
        pejabat_id = matches?.[0]?.id ?? null
      }

      let sumber_nama = ''
      try { sumber_nama = new URL(ev.url_sumber).hostname.replace('www.', '') } catch {}

      const { error } = await supabase.from('hotspot_events').insert({
        judul: ev.judul,
        ringkasan: ev.ringkasan,
        kategori: ev.kategori,
        lokasi_nama: ev.lokasi_nama,
        wilayah_id,
        pejabat_id,
        url_sumber: ev.url_sumber,
        sumber_nama,
        is_manual: isManual,
      })

      if (error) {
        errors.push(`Insert failed: ${error.message}`)
      } else {
        existingUrls.add(ev.url_sumber)
        inserted++
      }
    }
  }

  return Response.json({ inserted, skipped, errors, queries_run: queries.length })
})
