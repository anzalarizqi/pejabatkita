// supabase/functions/crawl-hotspot/resolve.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  const exact = list.find((p) => p.normalized === normLokasi)
  if (exact) return exact.id

  const sub = list.find((p) => p.normalized.includes(normLokasi) || normLokasi.includes(p.normalized))
  if (sub) return sub.id

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
