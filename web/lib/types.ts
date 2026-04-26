// ─── Enums ────────────────────────────────────────────────────────────────────

export type WilayahLevel = 'nasional' | 'provinsi' | 'kabupaten' | 'kota'
export type JabatanStatus = 'aktif' | 'penjabat' | 'nonaktif'
export type ScrapeStatus = 'running' | 'done' | 'failed'
export type FlagType = 'system' | 'public'
export type FlagStatus = 'pending' | 'resolved' | 'dismissed'
export type SourceType = 'wikipedia' | 'pemda' | 'kpu' | 'kpk' | 'news' | 'other'
export type Jenjang = 'SD' | 'SMP' | 'SMA' | 'D3' | 'S1' | 'S2' | 'S3' | 'lainnya'
export type JenisKelamin = 'L' | 'P'

// ─── Nested JSON types (stored in jsonb columns) ──────────────────────────────

export interface Biodata {
  tempat_lahir: string | null
  tanggal_lahir: string | null
  jenis_kelamin: JenisKelamin | null
  agama: string | null
}

export interface Pendidikan {
  jenjang: Jenjang
  institusi: string
  jurusan: string | null
  tahun_lulus: number | null
}

export interface DataSource {
  url: string
  domain: string
  scraped_at: string
  type: SourceType
}

export interface ConfidenceScore {
  score: number
  completeness: number
  corroboration: number
  notes: string | null
}

export interface PejabatMetadata {
  sources: DataSource[]
  confidence: ConfidenceScore
  last_updated: string
  needs_review: boolean
}

// ─── DB row types ─────────────────────────────────────────────────────────────

export interface Wilayah {
  id: string
  kode_bps: string
  nama: string
  level: WilayahLevel
  parent_id: string | null
}

export interface PejabatRow {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  biodata: Biodata
  pendidikan: Pendidikan[]
  metadata: PejabatMetadata
  last_updated: string
}

export interface JabatanRow {
  id: string
  pejabat_id: string
  wilayah_id: string
  posisi: string
  partai: string | null
  mulai_jabatan: string | null
  selesai_jabatan: string | null
  status: JabatanStatus
}

export interface ScrapeRun {
  id: string
  provinsi: string
  kode_provinsi: string
  started_at: string
  finished_at: string | null
  status: ScrapeStatus
  total_pejabat: number
  avg_confidence: number | null
  needs_review_count: number
}

export interface Flag {
  id: string
  pejabat_id: string
  type: FlagType
  reason: string
  source_url: string | null
  reporter_ip_hash: string | null
  status: FlagStatus
  created_at: string
  resolved_at: string | null
}

// ─── Joined/enriched types ────────────────────────────────────────────────────

export interface PejabatWithJabatan extends PejabatRow {
  jabatan: (JabatanRow & { wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'> })[]
}

export interface FlagWithPejabat extends Flag {
  pejabat: Pick<PejabatRow, 'id' | 'nama_lengkap' | 'biodata' | 'metadata'> | null
  jabatan: (Pick<JabatanRow, 'posisi' | 'status'> & { wilayah?: Pick<Wilayah, 'nama'> })[]
}

// ─── JSON import types (scraper/verifier output) ──────────────────────────────

export interface JabatanJSON {
  posisi: string
  level: WilayahLevel
  wilayah: string
  kode_wilayah: string
  partai: string | null
  mulai_jabatan: string | null
  selesai_jabatan: string | null
  status: JabatanStatus
}

export interface PejabatJSON {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  jabatan: JabatanJSON[]
  biodata: Biodata
  pendidikan: Pendidikan[]
  metadata: PejabatMetadata
}

// ─── Diff types for import preview ───────────────────────────────────────────

export type DiffAction = 'new' | 'updated' | 'unchanged'

export interface DiffEntry {
  action: DiffAction
  incoming: PejabatJSON
  existing?: PejabatWithJabatan
  changedFields?: string[]
}

export interface ImportDiff {
  province: string
  newCount: number
  updatedCount: number
  unchangedCount: number
  entries: DiffEntry[]
}

// ─── Coverage types for dashboard ────────────────────────────────────────────

export interface WilayahCoverage {
  wilayah: Wilayah
  scraped: number
  expected: number
  pct: number
  avgConfidence: number | null
  lastScrapedAt: string | null
  pendingFlags: number
  status: 'green' | 'yellow' | 'gray'
  children?: WilayahCoverage[]
}
