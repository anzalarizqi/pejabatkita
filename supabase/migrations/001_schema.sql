-- Peta Pejabat Indonesia — Database Schema
-- Run via Supabase dashboard SQL editor or supabase db push

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE wilayah_level   AS ENUM ('nasional', 'provinsi', 'kabupaten', 'kota');
CREATE TYPE jabatan_status  AS ENUM ('aktif', 'penjabat', 'nonaktif');
CREATE TYPE scrape_status   AS ENUM ('running', 'done', 'failed');
CREATE TYPE flag_type       AS ENUM ('system', 'public');
CREATE TYPE flag_status     AS ENUM ('pending', 'resolved', 'dismissed');

-- ─── wilayah ──────────────────────────────────────────────────────────────────
-- BPS reference table: 38 provinsi + ~514 kab/kota. Seeded once, rarely changes.

CREATE TABLE wilayah (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode_bps   varchar NOT NULL UNIQUE,
    nama       varchar NOT NULL,
    level      wilayah_level NOT NULL,
    parent_id  uuid REFERENCES wilayah(id)
);

CREATE INDEX idx_wilayah_kode_bps  ON wilayah(kode_bps);
CREATE INDEX idx_wilayah_parent_id ON wilayah(parent_id);
CREATE INDEX idx_wilayah_level     ON wilayah(level);

-- ─── pejabat ──────────────────────────────────────────────────────────────────
-- One row per person. biodata and pendidikan stored as JSONB for flexibility.

CREATE TABLE pejabat (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_lengkap    varchar NOT NULL,
    gelar_depan     varchar,
    gelar_belakang  varchar,
    biodata         jsonb NOT NULL DEFAULT '{}',
    pendidikan      jsonb NOT NULL DEFAULT '[]',
    metadata        jsonb NOT NULL DEFAULT '{}',
    last_updated    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pejabat_nama ON pejabat(nama_lengkap);

-- ─── jabatan ──────────────────────────────────────────────────────────────────
-- Position history. One person can hold multiple positions across time.

CREATE TABLE jabatan (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pejabat_id      uuid NOT NULL REFERENCES pejabat(id) ON DELETE CASCADE,
    wilayah_id      uuid NOT NULL REFERENCES wilayah(id),
    posisi          varchar NOT NULL,
    partai          varchar,
    mulai_jabatan   date,
    selesai_jabatan date,
    status          jabatan_status NOT NULL DEFAULT 'aktif'
);

CREATE INDEX idx_jabatan_pejabat_id  ON jabatan(pejabat_id);
CREATE INDEX idx_jabatan_wilayah_id  ON jabatan(wilayah_id);
CREATE INDEX idx_jabatan_status      ON jabatan(status);

-- ─── scrape_runs ──────────────────────────────────────────────────────────────
-- Audit log for every scraper CLI run.

CREATE TABLE scrape_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provinsi            varchar NOT NULL,
    kode_provinsi       varchar NOT NULL,
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    status              scrape_status NOT NULL DEFAULT 'running',
    total_pejabat       integer NOT NULL DEFAULT 0,
    avg_confidence      float,
    needs_review_count  integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_scrape_runs_kode_provinsi ON scrape_runs(kode_provinsi);
CREATE INDEX idx_scrape_runs_status        ON scrape_runs(status);

-- ─── flags ────────────────────────────────────────────────────────────────────
-- Unified queue for system-generated flags and public reports.

CREATE TABLE flags (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pejabat_id  uuid NOT NULL REFERENCES pejabat(id) ON DELETE CASCADE,
    type        flag_type NOT NULL,
    reason      text NOT NULL,
    source_url  varchar,
    status      flag_status NOT NULL DEFAULT 'pending',
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);

CREATE INDEX idx_flags_pejabat_id ON flags(pejabat_id);
CREATE INDEX idx_flags_status     ON flags(status);
CREATE INDEX idx_flags_type       ON flags(type);
