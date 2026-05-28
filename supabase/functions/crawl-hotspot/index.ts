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

      let pejabat_id: string | null = null
      if (extracted.pejabat_nama) {
        const { data: matches } = await supabase
          .from('pejabat')
          .select('id')
          .ilike('nama_lengkap', `%${extracted.pejabat_nama}%`)
          .limit(1)
        pejabat_id = matches?.[0]?.id ?? null
      }

      let sumber_nama = ''
      try { sumber_nama = new URL(result.url).hostname.replace('www.', '') } catch {}

      const { error } = await supabase.from('hotspot_events').insert({
        judul: extracted.judul,
        ringkasan: extracted.ringkasan,
        kategori: extracted.kategori,
        lokasi_nama: extracted.lokasi_nama,
        wilayah_id,
        pejabat_id,
        url_sumber: result.url,
        sumber_nama,
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
