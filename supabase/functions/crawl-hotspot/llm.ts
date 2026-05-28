// supabase/functions/crawl-hotspot/llm.ts
// Kimi $web_search: searches the web AND extracts structured events in one call.

export interface ExtractedEvent {
  judul: string
  ringkasan: string
  kategori: 'korupsi' | 'pernyataan' | 'demonstrasi' | 'kebijakan' | 'kritik' | 'lainnya'
  lokasi_nama: string | null
  pejabat_nama: string | null
  url_sumber: string
}

const SYSTEM_PROMPT = `Kamu adalah analis berita Indonesia. Pakai web search untuk mencari berita terkini sesuai kueri pengguna, lalu ekstrak SEMUA kejadian penting yang melibatkan pejabat publik Indonesia (gubernur, bupati, walikota, menteri, anggota DPR, dll).

Untuk setiap kejadian, ekstrak:
- judul: judul singkat (maks 120 karakter)
- ringkasan: 2-3 kalimat dalam bahasa Indonesia
- kategori: korupsi | pernyataan | demonstrasi | kebijakan | kritik | lainnya
- lokasi_nama: nama provinsi/kota relevan (null jika tidak ada)
- pejabat_nama: nama lengkap pejabat utama (null jika tidak ada)
- url_sumber: URL artikel asli (WAJIB ada, jangan kosong)

Jawab HANYA dengan JSON array murni, tanpa teks lain:
[{"judul":"...","ringkasan":"...","kategori":"...","lokasi_nama":"...","pejabat_nama":"...","url_sumber":"..."}]

Jika tidak ada kejadian relevan, jawab dengan: []`

interface ChatMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

export async function kimiSearchAndExtract(
  query: string,
  apiKey: string,
  model: string,
): Promise<ExtractedEvent[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Cari berita terkini: ${query}` },
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
        temperature: 1,
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

    // Final answer
    const raw = (message.content ?? '').trim()
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((e): e is ExtractedEvent => e && typeof e === 'object' && !!e.judul && !!e.url_sumber)
        .map((e) => ({
          judul: String(e.judul).slice(0, 120),
          ringkasan: String(e.ringkasan ?? ''),
          kategori: (['korupsi','pernyataan','demonstrasi','kebijakan','kritik','lainnya'].includes(e.kategori)
            ? e.kategori : 'lainnya') as ExtractedEvent['kategori'],
          lokasi_nama: e.lokasi_nama ?? null,
          pejabat_nama: e.pejabat_nama ?? null,
          url_sumber: String(e.url_sumber),
        }))
    } catch {
      return []
    }
  }

  return []
}
