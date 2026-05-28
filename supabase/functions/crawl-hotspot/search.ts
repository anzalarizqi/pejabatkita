// supabase/functions/crawl-hotspot/search.ts
// Kimi $web_search-based article fetcher for the manual-keyword path.
// Returns RawArticle[] in the same shape as rss.ts so the downstream
// pipeline is identical.

import type { RawArticle } from './rss.ts'

interface ChatMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

const SYSTEM_PROMPT = `Kamu adalah pengumpul berita Indonesia. Pakai web search untuk mencari berita yang relevan dengan kueri pengguna. Kumpulkan SEMUA artikel berita yang ditemukan.

Untuk setiap artikel, kembalikan:
- title: judul artikel asli
- description: ringkasan singkat dari isi artikel (1-2 kalimat)
- url: URL artikel asli (WAJIB ada, tidak boleh kosong)
- pubDate: tanggal publikasi jika tertera (format ISO atau RFC 2822), atau null

Jawab HANYA dengan JSON array murni, tanpa teks lain:
[{"title":"...","description":"...","url":"...","pubDate":"..."}]

Jika tidak ada artikel, kembalikan: []`

export async function fetchSearchArticles(
  keyword: string,
  apiKey: string,
  model: string,
): Promise<RawArticle[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Cari berita terkini tentang: ${keyword}` },
  ]
  const tools = [{ type: 'builtin_function', function: { name: '$web_search' } }]

  for (let round = 0; round < 6; round++) {
    const resp = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        tools,
        temperature: 0.6,
        thinking: { type: 'disabled' },
      }),
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
    }

    const data = await resp.json()
    const choice = data.choices?.[0]
    const message = choice?.message
    if (!choice || !message) throw new Error('Empty response')

    if (choice.finish_reason === 'tool_calls') {
      messages.push(message)
      for (const tc of message.tool_calls ?? []) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: tc.function.arguments,
        })
      }
      continue
    }

    const raw = (message.content ?? '').trim()
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((a): a is Record<string, unknown> => a && typeof a === 'object' && !!a.title && !!a.url)
        .map((a): RawArticle => ({
          title: String(a.title),
          description: String(a.description ?? ''),
          url: String(a.url),
          pubDate: a.pubDate ? String(a.pubDate) : null,
          source: `kimi-search: "${keyword}"`,
        }))
    } catch {
      return []
    }
  }

  return []
}
