// Canonical Indonesian political-party names + alias normalization.
// Mirror of scripts/_partai.py — keep both in sync (one line per new party).

const PARTAI_ALIASES: Record<string, string[]> = {
  PDIP: ['pdip', 'pdi-p', 'pdi p', 'pdi perjuangan', 'partai pdip',
    'partai demokrasi indonesia perjuangan'],
  Golkar: ['golkar', 'partai golkar'],
  Gerindra: ['gerindra', 'partai gerindra'],
  PKB: ['pkb', 'partai kebangkitan bangsa'],
  NasDem: ['nasdem', 'nasional demokrat', 'partai nasdem', 'partai nasional demokrat'],
  PPP: ['ppp', 'partai persatuan pembangunan'],
  PKS: ['pks', 'partai keadilan sejahtera'],
  Demokrat: ['demokrat', 'partai demokrat'],
  PAN: ['pan', 'partai amanat nasional'],
  PSI: ['psi', 'partai solidaritas indonesia'],
  Perindo: ['perindo', 'partai perindo'],
  Hanura: ['hanura', 'partai hanura'],
  PBB: ['pbb', 'partai bulan bintang'],
  Independen: ['independen', 'perseorangan', 'non-partai', 'nonpartai',
    'jalur independen', 'jalur perseorangan'],
}

export const CANONICAL_PARTAI: ReadonlySet<string> = new Set(Object.keys(PARTAI_ALIASES))

const ALIAS_TO_CANONICAL: Record<string, string> = Object.fromEntries(
  Object.entries(PARTAI_ALIASES).flatMap(([canon, aliases]) =>
    aliases.map(a => [a, canon] as const),
  ),
)

function key(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).join(' ')
}

/**
 * Returns [value, known].
 * - known alias  -> [canonical short name, true]
 * - empty        -> ['', false]
 * - unrecognized -> [trimmed input, false]   // never rejected
 */
export function normalizePartai(raw: string | null | undefined): [string, boolean] {
  if (!raw || !raw.trim()) return ['', false]
  const canon = ALIAS_TO_CANONICAL[key(raw)]
  if (canon) return [canon, true]
  return [raw.trim(), false]
}
