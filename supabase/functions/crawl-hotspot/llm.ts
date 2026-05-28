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
    : provider === 'moonshot'
    ? 'https://api.moonshot.ai/v1'
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
      temperature: provider === 'moonshot' ? 1 : 0.1,
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
