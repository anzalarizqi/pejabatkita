# PRD: Peta Pejabat Indonesia
**Product Requirements Document**
Version: 0.2 — Draft
Status: In Discussion

---

## 1. Overview

### 1.1 Problem Statement

Data pejabat publik Indonesia tersebar di banyak sumber: Wikipedia, website resmi Pemda, KPK (LHKPN), KPU, ICW RekamJejak, dan lain-lain. Tidak ada satu platform terpadu yang memungkinkan masyarakat melihat profil lengkap seorang pejabat — siapa dia, latar belakang pendidikannya apa, jabatan apa yang pernah dia pegang, pernah terseret kasus hukum apa — dalam satu tempat.

Kalau mau tahu itu semua, orang harus browsing satu per satu. Tool ini mengotomatisasi proses tersebut.

### 1.2 Vision

> **"Semua informasi publik tentang pejabat Indonesia, terpadu dalam satu platform — sama seperti kalau lo browsing sendiri, tapi lebih cepat, lebih lengkap, dan bisa diakses semua orang."**

### 1.3 Inspirasi

- **Nemesis (nemesis.assai.id)** — OSINT pengadaan yang tidak wajar, bersumber dari INAPROC. Sama spiritnya: ambil data publik yang tersebar, jadikan mudah diakses dan dianalisis.
- **RekamJejak.net (ICW)** — Rekam jejak caleg, tapi terbatas scope dan tidak punya visualisasi geografis.

---

## 2. System Architecture

Sistem terdiri dari tiga komponen utama dalam satu monorepo:

```
pejabatkita/
├── scraper/          ← Python CLI: scrape + output JSON
├── verifier/         ← Python CLI: LLM fact-check pass on JSON
├── web/              ← Next.js: admin dashboard + public frontend
└── supabase/         ← migrations + seed data (BPS wilayah reference)
```

### 2.1 Data Flow

```
scraper/ (Python CLI)
     ↓ JSON file per provinsi
verifier/ (Python CLI)
     ↓ verified JSON
web/admin/import (Next.js)
     ↓ diff preview → confirm
Supabase (Postgres)
     ↓
web/(public) — peta + profil
```

**Prinsip:** scraper tidak menyentuh Supabase langsung. JSON adalah format transport. Supabase adalah store final.

### 2.2 Tech Stack

| Komponen | Tech |
|---|---|
| Scraper & Verifier | Python 3.11+, httpx, playwright-python |
| LLM abstraction | Custom thin wrapper (config-driven, no litellm) |
| Web | Next.js (App Router) |
| Database | Supabase (Postgres) |
| Config | config.yaml + .env untuk API keys |

---

## 3. Goals & Non-Goals

### Goals (V1)
- Scraper CLI: trigger manual per provinsi, proses urut (Gubernur → kota/kab satu per satu)
- Verifier CLI: LLM fact-check pass terpisah dari scraping
- Output: JSON terstruktur per provinsi, siap di-import
- Multi-LLM provider support dengan auto-fallback
- Confidence scoring berbasis corroboration + kelengkapan data
- Admin web: import JSON dengan diff preview, coverage dashboard, review queue
- Public web: flag profil yang datanya salah/outdated

### Goals (V2 — Future)
- Cron job untuk auto-update berkala
- Tambah data: pernyataan kontroversial + berita kontroversial per pejabat
- Tambah data: riwayat kasus pidana / korupsi (KPK, Kejaksaan)
- Frontend: peta Indonesia interaktif dengan profil per pejabat

### Non-Goals (V1)
- Bukan real-time tracker
- Tidak meng-cover pejabat di bawah level Bupati/Walikota (camat, lurah, dll)
- Tidak ada user authentication di public site
- Tidak ada frontend peta di V1 — public site hanya profil dasar

---

## 4. Scope Data

### 4.1 Pejabat yang Di-cover

| Level | Jabatan |
|---|---|
| Nasional | Presiden, Wakil Presiden |
| Nasional | Menteri, Wakil Menteri, Kepala Lembaga setingkat Menteri |
| Provinsi | Gubernur, Wakil Gubernur (38 provinsi) |
| Kab/Kota | Bupati, Wakil Bupati, Walikota, Wakil Walikota (~514 kab/kota) |

### 4.2 Schema Data per Pejabat

```json
{
  "id": "uuid-generated",
  "nama_lengkap": "string",
  "gelar_depan": "string | null",
  "gelar_belakang": "string | null",

  "jabatan": [
    {
      "posisi": "string",
      "level": "nasional | provinsi | kabupaten | kota",
      "wilayah": "string",
      "kode_wilayah": "string (kode BPS)",
      "partai": "string | null",
      "mulai_jabatan": "YYYY-MM-DD | null",
      "selesai_jabatan": "YYYY-MM-DD | null",
      "status": "aktif | penjabat | nonaktif"
    }
  ],

  "biodata": {
    "tempat_lahir": "string | null",
    "tanggal_lahir": "YYYY-MM-DD | null",
    "jenis_kelamin": "L | P | null",
    "agama": "string | null"
  },

  "pendidikan": [
    {
      "jenjang": "SD | SMP | SMA | D3 | S1 | S2 | S3 | lainnya",
      "institusi": "string",
      "jurusan": "string | null",
      "tahun_lulus": "integer | null"
    }
  ],

  "metadata": {
    "sources": [
      {
        "url": "string",
        "domain": "string",
        "scraped_at": "ISO 8601 datetime",
        "type": "wikipedia | pemda | kpu | kpk | news | other"
      }
    ],
    "confidence": {
      "score": "0.0 - 1.0",
      "completeness": "0.0 - 1.0",
      "corroboration": "0.0 - 1.0",
      "notes": "string | null"
    },
    "last_updated": "ISO 8601 datetime",
    "needs_review": "boolean"
  }
}
```

> **Catatan:** `jabatan` adalah array untuk mendukung rekam jejak — satu orang bisa pernah menjabat di beberapa posisi berbeda.

### 4.3 Confidence Score — Metodologi

Confidence score terdiri dari dua komponen:

**Completeness (bobot 40%):**
Persentase field penting yang terisi (nama, jabatan, wilayah, pendidikan, tanggal lahir, dsb.)

**Corroboration (bobot 60%):**
Berapa banyak sumber independen yang mengonfirmasi data yang sama.
- 1 sumber → 0.3
- 2 sumber → 0.6
- 3+ sumber → 1.0
- Sumber konflik satu sama lain → score turun, `needs_review: true`

**Threshold:**
- `≥ 0.8` → Data solid, siap publish
- `0.5 – 0.79` → Data cukup, flag untuk review opsional
- `< 0.5` → Data lemah, wajib review manual sebelum publish

---

## 5. Scraper — Spesifikasi

### 5.1 Cara Kerja

```
User input: nama / kode provinsi
     ↓
Ambil daftar kab/kota di provinsi tsb (dari wilayah reference table)
     ↓
Urutan scraping: Gubernur/Wagub dulu → lalu kab/kota satu per satu (A sampai Z)
     ↓
Per pejabat: jalankan pipeline scraping
     ↓
1. Wikipedia API (structured, gratis)
     ↓ (jika data kurang / tidak ditemukan)
2. Web search: DDG via Jina → SearXNG fallback → baca URL terbaik via Jina read-url
     ↓ (jika halaman JS-heavy)
3. Playwright browser (headless Chromium) untuk Pemda sites
     ↓
LLM: normalisasi + ekstraksi ke schema
     ↓
Hitung confidence score
     ↓
Output: JSON file per provinsi
```

### 5.2 Sumber Data (Prioritas)

| Prioritas | Sumber | Keterangan |
|---|---|---|
| 1 | Wikipedia API (bahasa Indonesia) | Gratis, structured, coverage lumayan untuk tokoh besar |
| 2 | Web search (DDG via Jina + SearXNG) | Cari URL terbaik, baca via Jina read-url |
| 3 | Playwright browser | Untuk Pemda sites yang JS-heavy atau tidak ada structured data |
| 4 | KPU | Validasi jabatan + partai pengusung |

### 5.3 LLM Provider Configuration

Tool harus support konfigurasi provider via file eksternal (YAML atau .env), dengan mekanisme auto-fallback berdasarkan priority. **Provider dan model harus bisa diganti tanpa mengubah kode** — cukup edit config atau set env var.

```yaml
# config.yaml — contoh struktur
# Tambah / hapus / reorder provider bebas. Aktif = priority terendah yang API key-nya tersedia.
llm_providers:
  - name: anthropic
    model: claude-sonnet-4-6        # ganti model di sini, tidak perlu ubah kode
    api_key_env: ANTHROPIC_API_KEY
    priority: 1
  - name: openai
    model: gpt-4o
    api_key_env: OPENAI_API_KEY
    priority: 2
  - name: google
    model: gemini-2.0-flash
    api_key_env: GOOGLE_API_KEY
    priority: 3
  - name: groq                      # gratis, Llama 3.3 70B — cocok untuk fallback murah
    model: llama-3.3-70b-versatile
    api_key_env: GROQ_API_KEY
    priority: 4
  - name: moonshot                  # Kimi K2 — opsional
    model: kimi-k2
    api_key_env: MOONSHOT_API_KEY
    priority: 5

# Override aktif via env tanpa edit file:
# ACTIVE_LLM_PROVIDER=groq python scraper.py --provinsi "Jawa Barat"

scraper:
  delay_between_requests: 2        # seconds, hindari rate limiting
  max_retries: 3
  confidence_threshold_review: 0.5
```

**Fallback logic:**
- Kalau provider aktif gagal (rate limit / quota / API error) → otomatis coba provider berikutnya by priority
- Provider di-skip kalau API key env-nya tidak di-set (tidak perlu hapus dari config)
- Override provider untuk satu run via env var `ACTIVE_LLM_PROVIDER=<name>` tanpa mengubah config file

### 5.4 CLI Interface

```bash
# Trigger manual satu provinsi
python scraper.py --provinsi "Jawa Barat"
python scraper.py --kode-provinsi "32"

# Trigger satu wilayah spesifik
python scraper.py --wilayah "Kabupaten Bandung"

# Dry run — cek struktur output tanpa menyimpan
python scraper.py --provinsi "Jawa Barat" --dry-run

# Verbose logging
python scraper.py --provinsi "Jawa Barat" --verbose

# Output ke direktori custom
python scraper.py --provinsi "Jawa Barat" --output ./data/raw/
```

### 5.5 Output

```
/output
  /jawa-barat
    metadata.json        ← summary run: jumlah pejabat, avg confidence, timestamp
    pejabat.json         ← array semua pejabat di provinsi ini
    needs_review.json    ← subset yang confidence < threshold
    run.log              ← log detail per pejabat
```

---

## 6. Verifier — Spesifikasi

Verifier adalah CLI terpisah yang menerima output scraper dan melakukan LLM fact-check pass sebelum import ke Supabase. Dijalankan setelah scraper selesai, bukan bagian dari pipeline scraping.

```bash
python verifier.py --file output/jawa-barat/pejabat.json
python verifier.py --file output/jawa-barat/pejabat.json --only-needs-review
```

**Apa yang dilakukan verifier:**
- Cross-check field kritis (nama, jabatan, wilayah) via web search
- Flag inkonsistensi yang tidak tertangkap scraper
- Update confidence score berdasarkan temuan baru
- Output: file JSON yang sama dengan flag dan notes diperbarui

**Kenapa dipisah dari scraper:**
- Bisa re-run verifier tanpa re-scrape
- Bisa skip verifier kalau datanya sudah cukup confident
- Menggunakan LLM call yang berbeda (focused on fact-check, bukan extraction)

---

## 7. Database Schema (Supabase)

### 7.1 Tabel Utama

**`wilayah`** — reference table BPS, di-seed sekali, tidak berubah kecuali ada pemekaran

```sql
id          uuid PK
kode_bps    varchar UNIQUE   -- e.g. "32", "32.01"
nama        varchar
level       enum(nasional, provinsi, kabupaten, kota)
parent_id   uuid FK → wilayah(id)
```

**`pejabat`** — satu baris per orang

```sql
id              uuid PK
nama_lengkap    varchar
gelar_depan     varchar NULL
gelar_belakang  varchar NULL
biodata         jsonb
pendidikan      jsonb   -- array
metadata        jsonb   -- sources, confidence, needs_review
last_updated    timestamptz
```

**`jabatan`** — array jabatan per pejabat (relasi terpisah untuk query efisien)

```sql
id              uuid PK
pejabat_id      uuid FK → pejabat(id)
wilayah_id      uuid FK → wilayah(id)
posisi          varchar
partai          varchar NULL
mulai_jabatan   date NULL
selesai_jabatan date NULL
status          enum(aktif, penjabat, nonaktif)
```

**`scrape_runs`** — audit log setiap scraper run

```sql
id              uuid PK
provinsi        varchar
kode_provinsi   varchar
started_at      timestamptz
finished_at     timestamptz NULL
status          enum(running, done, failed)
total_pejabat   integer
avg_confidence  float
needs_review_count integer
```

**`flags`** — laporan dari publik + system flags

```sql
id          uuid PK
pejabat_id  uuid FK → pejabat(id)
type        enum(system, public)
reason      text
source_url  varchar NULL    -- bukti dari pelapor (opsional)
status      enum(pending, resolved, dismissed)
created_at  timestamptz
resolved_at timestamptz NULL
```

### 7.2 Coverage Calculation

Coverage per provinsi dihitung dari:
```sql
-- pejabat yang sudah ada di DB / total expected dari wilayah reference
SELECT
  w.nama,
  COUNT(j.id) AS scraped,
  expected.total AS expected,
  ROUND(COUNT(j.id)::numeric / expected.total * 100) AS pct
FROM wilayah w
...
```

---

## 8. Web App — Spesifikasi

### 8.1 Admin Area (`/admin`)

#### `/admin/dashboard` — Coverage Monitoring

Tampilan progress scraping seluruh Indonesia:

```
Indonesia Coverage — 38 provinsi
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
● Jawa Barat      ████████░░  78%   last run: 2026-04-20   avg confidence: 0.82
  ├ Kab. Bandung  ██████████ 100%   ✓ verified
  ├ Kota Bandung  ██████████ 100%   ✓ verified
  ├ Kab. Bogor    ████░░░░░░  40%   ⚠ 3 needs review
  └ ...

○ Papua Barat     ░░░░░░░░░░   0%   never scraped
```

**Status warna:**
- Hijau = confidence ≥ 0.8, tidak ada pending flags
- Kuning = ada `needs_review` atau pending flags
- Abu-abu = belum pernah di-scrape

#### `/admin/import` — JSON Import + Diff Preview

Alur:
1. Upload file JSON hasil scraper/verifier
2. Sistem compare vs data yang sudah ada di Supabase untuk provinsi tersebut
3. Tampilkan diff: baris baru, field yang berubah, field yang hilang
4. Admin konfirmasi → upsert ke Supabase

**Diff view menampilkan:**
- Pejabat baru (belum ada di DB)
- Pejabat yang datanya berubah (field by field, nilai lama vs baru)
- Perubahan confidence score
- Flag baru yang muncul

#### `/admin/review` — Review Queue

Unified queue untuk dua jenis flag:
- **System flags** — dari scraper (`needs_review: true`, confidence rendah, sumber konflik)
- **Public flags** — laporan dari pengguna di halaman publik

Setiap item review menampilkan:
- Profil pejabat
- Alasan flag + sumber yang konflik (untuk system) atau alasan pelapor + URL bukti (untuk public)
- Tiga aksi: **Perbaiki data**, **Dismiss** (data sudah benar), **Re-scrape** (trigger scraper ulang untuk pejabat ini)

### 8.2 Public Area (`/`)

#### Halaman profil pejabat
- Biodata + jabatan + pendidikan
- Link ke sumber eksternal (Wikipedia, LHKPN KPK, RekamJejak, Pemda)
- Tombol **"Laporkan Data"** — form sederhana: alasan + URL bukti (opsional), tanpa auth, rate-limited by IP

#### V2 additions
- Peta Indonesia interaktif (klik provinsi → list pejabat)
- Filter: pendidikan, partai, jabatan, wilayah

---

## 9. Roadmap

### V1 — Data Pipeline + Admin
- [ ] `scraper/` — CLI scraper (Wikipedia + web search + Playwright + LLM normalization)
  - [ ] Urutan scraping: Gubernur/Wagub dulu → kab/kota A–Z
  - [ ] `--pejabat-id` flag untuk re-scrape satu pejabat (dipakai dari admin review queue)
- [ ] `verifier/` — CLI verifier (LLM fact-check pass)
- [ ] `supabase/` — migrations + seed wilayah BPS
- [ ] `web/admin/dashboard` — coverage monitoring
- [ ] `web/admin/import` — JSON import dengan diff preview
- [ ] `web/admin/review` — review queue (system + public flags) dengan aksi: fix, dismiss, re-scrape
- [ ] Public halaman profil dasar + tombol "Laporkan Data" (rate-limited by IP)

### V1.5 — Data Enrichment
- [ ] Cron job untuk auto-update (re-scrape, detect perubahan jabatan)
- [ ] Tambah data: berita kontroversial per pejabat (Kompas, Tempo, CNN Indonesia)
- [ ] Deteksi perubahan jabatan (misal: Pj. → definitif pasca Pilkada)

### V2 — Public Frontend
- [ ] Peta Indonesia interaktif
- [ ] Filter: pendidikan, partai, jabatan
- [ ] Link ke LHKPN KPK, RekamJejak

### V3 — Enrichment Lanjutan
- [ ] Integrasi data LHKPN (harta kekayaan dari KPK)
- [ ] Integrasi data kasus dari KPK (tersangka / terpidana)
- [ ] Jaringan relasi: keluarga, bisnis, partai

---

## 10. Prinsip & Etika

- **Hanya data publik.** Semua data yang dikumpulkan adalah informasi yang sudah tersedia di ruang publik. Tidak ada scraping di balik login atau data yang dilindungi privasi.
- **Transparansi sumber.** Setiap data punya `sources` yang mencatat dari mana ia berasal.
- **Akurasi di atas kecepatan.** Confidence score, `needs_review` flag, verifier step, dan review queue ada justru untuk tidak menyebarkan data yang belum valid.
- **Spirit civic tech.** Tujuan akhirnya adalah memberdayakan masyarakat dengan data — bukan untuk menyerang individu.
- **Public flagging sebagai quality control.** Masyarakat adalah validator terbaik untuk data lokal. Sistem flag memberi mereka jalur resmi untuk berkontribusi.

---

## 11. Catatan untuk Developer

**Yang wajib dipertahankan:**
- Struktur schema JSON (section 4.2)
- Mekanisme multi-LLM provider dengan fallback (section 5.3)
- CLI interface scraper dan verifier (section 5.4, 6)
- Scraper tidak menyentuh Supabase langsung — JSON sebagai transport

**Reference implementations (Node.js, port ke Python):**
- `C:\Users\anzal\PROJECT\semarproject\tools\search.js` — DDG via Jina + SearXNG
- `C:\Users\anzal\PROJECT\semarproject\tools\browser.js` — Playwright lazy browser pattern

---

*Dokumen ini adalah living document. Akan di-update seiring development dan feedback.*
