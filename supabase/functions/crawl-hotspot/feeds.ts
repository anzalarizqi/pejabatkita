// supabase/functions/crawl-hotspot/feeds.ts
// Verified Tier 1 Indonesian news RSS feeds. Tested 2026-05-28.

export interface FeedSource {
  name: string
  url: string
  /** true = publisher already filtered to political/legal topics */
  preFiltered: boolean
}

export const FEEDS: FeedSource[] = [
  { name: 'Detik berita',         url: 'https://news.detik.com/berita/rss',        preFiltered: false },
  { name: 'CNN Indonesia nasional', url: 'https://www.cnnindonesia.com/nasional/rss', preFiltered: true  },
  { name: 'Antara politik',       url: 'https://www.antaranews.com/rss/politik.xml', preFiltered: true  },
  { name: 'Antara hukum',         url: 'https://www.antaranews.com/rss/hukum.xml',   preFiltered: true  },
  { name: 'Antara terkini',       url: 'https://www.antaranews.com/rss/terkini.xml', preFiltered: false },
]
