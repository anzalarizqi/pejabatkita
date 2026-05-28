// supabase/functions/crawl-hotspot/llm.ts
// Batch relevance gate + structured extraction.
// One Kimi call per batch — no $web_search, content is already in RawArticle.

import type { RawArticle } from './rss.ts'

export interface ExtractedEvent {
  judul: string
  ringkasan: string
  kategori: 'korupsi' | 'pernyataan' | 'demonstrasi' | 'kebijakan' | 'kritik' | 'lainnya'
  lokasi_nama: string | null
  pejabat_nama: string | null
  url_sumber: string
  pubDate: string | null
  source: string
}

const SYSTEM_PROMPT = `Kamu adalah analis berita Indonesia untuk platform yang memantau pejabat publik dan demokrasi.

Untuk SETIAP artikel di input, putuskan apakah RELEVAN dengan tema platform:
- Pejabat publik Indonesia (presiden, menteri, gubernur, bupati, walikota, anggota DPR/DPD/MPR, hakim, jaksa, kapolri, panglima)
- Kebijakan pemerintah, regulasi, RUU, perpres, perppu, undang-undang
- Korupsi, suap, gratifikasi, pelanggaran etik, pelanggaran hukum oleh pejabat
- Demokrasi, pemilu, pilkada, partai politik
- Hak Asasi Manusia, putusan pengadilan signifikan
- Keamanan nasional, pertahanan, hubungan luar negeri terkait pemerintah
- Kontroversi atau kritik publik konkret terhadap pejabat tertentu

TOLAK artikel tentang: olahraga, hiburan/selebriti non-pejabat, lifestyle, ekonomi/bisnis murni tanpa intervensi pejabat, kriminal biasa non-pejabat, ramalan cuaca, gosip, opini umum tanpa peristiwa konkret, bencana alam tanpa konteks pejabat.

Gunakan penilaian — jika ada istilah/skema baru yang JELAS terkait pejabat/kebijakan/korupsi, terima walau tidak persis di daftar.

Untuk artikel RELEVAN, kembalikan objek:
{
  "url": "<url asli dari input>",
  "judul": "<judul ringkas, maks 120 karakter>",
  "ringkasan": "<2-3 kalimat bahasa Indonesia>",
  "kategori": "korupsi" | "pernyataan" | "demonstrasi" | "kebijakan" | "kritik" | "lainnya",
  "lokasi_nama": "<provinsi/kota relevan>" | null,
  "pejabat_nama": "<nama lengkap pejabat utama>" | null
}

Untuk artikel TIDAK relevan, kembalikan:
{ "url": "<url asli>", "skip": true, "reason": "<alasan singkat>" }

Output: JSON array dengan satu objek per artikel input, urutan sama dengan input. Tanpa teks lain di luar array.`

interface LlmResult {
  url: string
  judul?: string
  ringkasan?: string
  kategori?: string
  lokasi_nama?: string | null
  pejabat_nama?: string | null
  skip?: boolean
  reason?: string
}

const VALID_KATEGORI = ['korupsi', 'pernyataan', 'demonstrasi', 'kebijakan', 'kritik', 'lainnya'] as const

async function callKimiOnce(
  articles: RawArticle[],
  apiKey: string,
  model: string,
): Promise<LlmResult[]> {
  // Build a compact input — title + description + url is enough for relevance + extraction
  const input = articles.map((a, i) => ({
    idx: i,
    url: a.url,
    title: a.title,
    description: a.description.slice(0, 600),
    source: a.source,
  }))

  const resp = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Artikel input (${articles.length} buah):\n\n${JSON.stringify(input, null, 2)}` },
      ],
      temperature: 0.6,
      thinking: { type: 'disabled' },
    }),
  })

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  }

  const data = await resp.json()
  const raw = String(data.choices?.[0]?.message?.content ?? '').trim()
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is LlmResult => !!x && typeof x === 'object' && typeof x.url === 'string')
  } catch {
    return []
  }
}

export interface BatchExtractResult {
  events: ExtractedEvent[]
  rejected: number
  parse_failed: number
}

export async function extractBatch(
  articles: RawArticle[],
  apiKey: string,
  model: string,
  batchSize = 10,
): Promise<BatchExtractResult> {
  const events: ExtractedEvent[] = []
  let rejected = 0
  let parse_failed = 0

  // Process batches sequentially (Kimi rate limits + token budgets favor sequential)
  // but each batch handles 10 articles in one Kimi call.
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize)
    let results: LlmResult[] = []
    try {
      results = await callKimiOnce(batch, apiKey, model)
    } catch {
      // If a whole batch fails, mark all as parse_failed and continue
      parse_failed += batch.length
      continue
    }

    // Match results back to input by URL
    const byUrl = new Map(results.map((r) => [r.url, r]))
    for (const article of batch) {
      const r = byUrl.get(article.url)
      if (!r) { parse_failed++; continue }
      if (r.skip || !r.judul) { rejected++; continue }
      const kategori = (VALID_KATEGORI as readonly string[]).includes(r.kategori ?? '')
        ? (r.kategori as ExtractedEvent['kategori'])
        : 'lainnya'
      events.push({
        judul: r.judul.slice(0, 120),
        ringkasan: r.ringkasan ?? '',
        kategori,
        lokasi_nama: r.lokasi_nama ?? null,
        pejabat_nama: r.pejabat_nama ?? null,
        url_sumber: article.url,
        pubDate: article.pubDate,
        source: article.source,
      })
    }
  }

  return { events, rejected, parse_failed }
}
