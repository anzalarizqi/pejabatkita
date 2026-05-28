// supabase/functions/crawl-hotspot/rss.ts
// Fetches RSS feeds in parallel, parses minimally (regex-based — RSS structure is simple),
// filters items by pubDate within last 24h.

import { FEEDS, type FeedSource } from './feeds.ts'

export interface RawArticle {
  title: string
  description: string
  url: string
  pubDate: string | null
  source: string
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function clean(s: string): string {
  return decodeEntities(stripCdata(s)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function extractTag(itemXml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(itemXml)
  return m ? clean(m[1]) : ''
}

function parseFeedXml(xml: string, sourceName: string): RawArticle[] {
  const items: RawArticle[] = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const description = extractTag(block, 'description')
    const pubDate = extractTag(block, 'pubDate')
    if (!title || !link) continue
    items.push({
      title,
      description,
      url: link,
      pubDate: pubDate || null,
      source: sourceName,
    })
  }
  return items
}

async function fetchOneFeed(feed: FeedSource, timeoutMs: number): Promise<RawArticle[]> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PejabatKita/1.0; +https://pejabatkita.vercel.app)' },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const xml = await resp.text()
    return parseFeedXml(xml, feed.name)
  } finally {
    clearTimeout(t)
  }
}

export interface RssResult {
  articles: RawArticle[]
  feeds_ok: number
  feeds_failed: { feed: string; error: string }[]
  total_items: number
  within_24h: number
}

export async function fetchRssArticles(maxAgeHours = 24): Promise<RssResult> {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000
  const settled = await Promise.allSettled(FEEDS.map((f) => fetchOneFeed(f, 8000)))

  const failed: { feed: string; error: string }[] = []
  const allItems: RawArticle[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      allItems.push(...r.value)
    } else {
      failed.push({
        feed: FEEDS[i].name,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      })
    }
  })

  // Filter by pubDate within window. If pubDate missing or unparseable, KEEP
  // (don't drop signal from feeds with weak date metadata).
  const filtered = allItems.filter((a) => {
    if (!a.pubDate) return true
    const ts = Date.parse(a.pubDate)
    if (Number.isNaN(ts)) return true
    return ts >= cutoff
  })

  // Dedup within batch by URL (some outlets republish)
  const seen = new Set<string>()
  const unique = filtered.filter((a) => {
    if (seen.has(a.url)) return false
    seen.add(a.url)
    return true
  })

  return {
    articles: unique,
    feeds_ok: settled.filter((s) => s.status === 'fulfilled').length,
    feeds_failed: failed,
    total_items: allItems.length,
    within_24h: unique.length,
  }
}
