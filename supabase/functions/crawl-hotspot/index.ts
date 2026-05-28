// supabase/functions/crawl-hotspot/index.ts
// Two input paths (RSS feeds OR keyword $web_search), one downstream pipeline.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchRssArticles, type RawArticle } from './rss.ts'
import { fetchSearchArticles } from './search.ts'
import { extractBatch } from './llm.ts'
import { resolveWilayahId } from './resolve.ts'

async function getSettings(supabase: ReturnType<typeof createClient>): Promise<{
  llm_provider: string
  llm_model: string
}> {
  const { data } = await supabase.from('settings').select('key, value')
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return {
    llm_provider: map.get('llm_provider') ?? 'moonshot',
    llm_model: map.get('llm_model') ?? 'kimi-k2.6',
  }
}

async function getExistingUrls(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  // Dedup against last 14 days of crawls
  const { data } = await supabase
    .from('hotspot_events')
    .select('url_sumber')
    .gte('crawled_at', new Date(Date.now() - 14 * 86400000).toISOString())
  return new Set((data ?? []).map((r: { url_sumber: string }) => r.url_sumber).filter(Boolean))
}

Deno.serve(async (req) => {
  const t0 = Date.now()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const llmApiKey = Deno.env.get('LLM_API_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Parse request body
  let keyword: string | null = null
  let isManual = false
  try {
    const body = await req.json()
    keyword = body?.keyword ? String(body.keyword).trim() : null
    isManual = !!body?.is_manual
  } catch { /* no body */ }

  const settings = await getSettings(supabase)

  // ─── Stage 1: input source ────────────────────────────────────────────────
  const stats: Record<string, unknown> = {
    mode: keyword ? 'keyword' : 'rss',
    keyword: keyword,
  }

  let articles: RawArticle[] = []
  const errors: string[] = []

  if (keyword) {
    try {
      articles = await fetchSearchArticles(keyword, llmApiKey, settings.llm_model)
      stats.search_returned = articles.length
    } catch (e) {
      errors.push(`Search failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    try {
      const rss = await fetchRssArticles(24)
      articles = rss.articles
      stats.feeds_ok = rss.feeds_ok
      stats.feeds_failed = rss.feeds_failed
      stats.total_rss_items = rss.total_items
      stats.within_24h = rss.within_24h
    } catch (e) {
      errors.push(`RSS fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ─── Stage 2: dedup against DB ────────────────────────────────────────────
  const existingUrls = await getExistingUrls(supabase)
  const fresh = articles.filter((a) => !existingUrls.has(a.url))
  stats.after_dedup = fresh.length

  // ─── Stage 3: LLM relevance gate + extraction ─────────────────────────────
  let inserted = 0
  let dbErrors = 0
  let rejected = 0
  let parseFailed = 0

  if (fresh.length > 0) {
    try {
      const batchResult = await extractBatch(fresh, llmApiKey, settings.llm_model, 10)
      rejected = batchResult.rejected
      parseFailed = batchResult.parse_failed

      // ─── Stage 4: resolve + insert ──────────────────────────────────────
      for (const ev of batchResult.events) {
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

        let sumber_nama = ev.source
        try { sumber_nama = new URL(ev.url_sumber).hostname.replace('www.', '') } catch {}

        const crawledAt = ev.pubDate
          ? new Date(ev.pubDate).toISOString()
          : new Date().toISOString()

        const { error } = await supabase.from('hotspot_events').insert({
          judul: ev.judul,
          ringkasan: ev.ringkasan,
          kategori: ev.kategori,
          lokasi_nama: ev.lokasi_nama,
          wilayah_id,
          pejabat_id,
          url_sumber: ev.url_sumber,
          sumber_nama,
          crawled_at: crawledAt,
          is_manual: isManual,
        })

        if (error) {
          dbErrors++
          errors.push(`Insert failed: ${error.message}`)
        } else {
          inserted++
        }
      }
    } catch (e) {
      errors.push(`Extract failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  stats.rejected_by_llm = rejected
  stats.parse_failed = parseFailed
  stats.inserted = inserted
  stats.db_errors = dbErrors
  stats.errors = errors
  stats.elapsed_ms = Date.now() - t0

  return Response.json(stats)
})
