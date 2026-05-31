// Internal security audit dossier — point-in-time, 31 May 2026.
// Static server component on purpose: no extra API/JS surface on a security page.
// Two registers per finding: plain-language impact (always visible, for non-coders)
// + technical detail/fix tucked into a native <details> disclosure (for engineers).

type Sev = 'critical' | 'high' | 'medium' | 'low'

const SEV: Record<Sev, { label: string; num: string; rail: string; tag: string }> = {
  critical: { label: 'Kritis', num: '#e0564a', rail: '#a01f17', tag: '#a01f17' },
  high:     { label: 'Tinggi', num: '#e0904a', rail: '#b5532a', tag: '#b5532a' },
  medium:   { label: 'Sedang', num: '#dcc24a', rail: '#8a6d1b', tag: '#8a6d1b' },
  low:      { label: 'Rendah', num: '#9aa3ad', rail: '#6b7280', tag: '#5f6670' },
}

interface Finding {
  id: string
  sev: Sev
  status?: 'fixed'   // remediated & verified as of the latest pass
  title: string      // plain-language headline
  impact: string     // what it means, in real-world terms (stakeholder)
  location: string   // file:line for engineers
  detail: string     // why it's a problem, technically
  fix: string        // concrete remediation
}

const FINDINGS: Finding[] = [
  {
    id: 'PK-C1',
    sev: 'critical',
    status: 'fixed',
    title: 'Alat admin bisa dipakai tanpa kata sandi yang benar',
    impact:
      'Semua alat admin yang menulis ke basis data hanya memeriksa apakah ADA cookie login — bukan apakah cookie-nya benar. Siapa pun di internet bisa berpura-pura sudah login hanya dengan mengirim cookie buatan, lalu: menanam kasus korupsi PALSU atas pejabat sungguhan, mengganti nama pejabat, mengubah pengaturan sistem, dan mengunduh seluruh data. Untuk situs akuntabilitas korupsi, menempelkan label "tersangka" palsu pada orang nyata adalah dampak terburuk sekaligus risiko hukum tertinggi (pencemaran nama baik / UU ITE).',
    location:
      '8 rute di web/app/api/admin/* — import-csv:48, import-kasus-csv:52, import-enrichment:54, settings:6, export-csv:38, export-all-csv:38, export-kasus-csv:67, export-enrichment:60',
    detail:
      'Setiap rute memakai `if (!session?.value) return 401` — hanya mengecek keberadaan cookie, bukan nilainya, jadi `admin_session=apa-saja` lolos. Semua rute memakai `createServerSupabase(true)` (service role) yang MELEWATI RLS. Gerbang proxy.ts memakai matcher `/admin/:path*` yang tidak pernah cocok dengan path `/api/admin/*`, jadi rute API sepenuhnya bergantung pada cek lemah ini.',
    fix:
      'Buat satu helper bersama isAdmin() yang membandingkan cookie dengan secret memakai timingSafeEqual (constant-time), lalu pakai `if (!(await isAdmin())) return 401` di kedelapan rute. Ini menutup seluruh kelas masalah sekaligus.',
  },
  {
    id: 'PK-H1',
    sev: 'high',
    status: 'fixed',
    title: 'Cookie login berisi kata sandi admin; login tidak dibatasi',
    impact:
      'Cookie login secara harfiah menyimpan kata sandi admin. Jika cookie bocor (log, laptop pinjaman, ekstensi browser), kata sandi asli ikut bocor dan tidak bisa diganti per-sesi. Selain itu, halaman login bisa dicoba berulang tanpa batas — tidak ada penguncian setelah gagal berkali-kali.',
    location: 'web/app/api/auth/route.ts:11, web/proxy.ts:8',
    detail:
      'auth/route.ts:11 menyetel cookie = ADMIN_PASSWORD; proxy.ts dan rute "cek kuat" membandingkan cookie === ADMIN_PASSWORD (bukan constant-time). Tidak ada rate-limit pada POST /api/auth → kata sandi bisa di-brute-force.',
    fix:
      'Saat login, terbitkan token sesi acak/HMAC terpisah (cookie ≠ kata sandi). Bandingkan secara constant-time. Tambahkan pembatasan percobaan per-IP pada /api/auth.',
  },
  {
    id: 'PK-H2',
    sev: 'high',
    status: 'fixed',
    title: 'Tombol "scrape ulang" bisa menjalankan perintah sistem',
    impact:
      'Fitur scrape ulang menyusun perintah sistem dengan menempelkan nilai yang dikirim pengguna apa adanya. Nilai yang dirancang khusus bisa membuat server menjalankan perintah sembarang — berpotensi membocorkan semua kunci API yang tersimpan. Saat ini terlindung kata sandi, tetapi kelemahan login di atas membuat lapisan itu tipis.',
    location: 'web/app/api/rescrape/route.ts:23-37',
    detail:
      'Memanggil exec(`python scraper.py ${args}`) lewat shell dengan field dari body (pejabat_id/provinsi). Selain itu `env:{...process.env}` mewariskan SEMUA secret ke subproses.',
    fix:
      'Pakai execFile(\'python\', [...args]) tanpa shell. Validasi pejabat_id sebagai UUID dan provinsi terhadap daftar wilayah yang sah.',
  },
  {
    id: 'PK-H3',
    sev: 'high',
    status: 'fixed',
    title: 'Tabel pengaturan terbuka untuk publik',
    impact:
      'Satu tabel konfigurasi tidak pernah dikunci. Lewat kunci publik yang dikirim ke setiap browser, orang luar bisa membaca dan menimpa pengaturan sistem (model AI mana yang dipakai, kata kunci crawl).',
    location: 'supabase/migrations/007_pusat_korupsi_hotspot.sql:44',
    detail:
      'Tabel settings dibuat tanpa `ENABLE ROW LEVEL SECURITY`, sementara 8 tabel lain memilikinya. Di Supabase, tabel di skema public tanpa RLS terekspos lewat kunci anon (publik) sesuai grant bawaan — inilah yang ditandai sebagai error oleh Security Advisor Supabase.',
    fix:
      'Migrasi baru: ALTER TABLE settings ENABLE ROW LEVEL SECURITY; (tanpa policy anon — service role tetap jalan). Lalu jalankan Dashboard → Advisors → Security untuk memastikan tidak ada tabel lain yang terlewat.',
  },
  {
    id: 'PK-H4',
    sev: 'high',
    status: 'fixed',
    title: 'Tuduhan korupsi yang belum diverifikasi tampil ke publik',
    impact:
      'Catatan korupsi yang belum diperiksa — atau yang sudah dinilai TIDAK benar — bisa dilihat siapa saja. Menerbitkan tuduhan yang belum terverifikasi terhadap orang yang disebut namanya adalah risiko pencemaran nama baik (UU ITE) dan menggerus kredibilitas situs.',
    location: 'supabase/migrations/008_kasus_rls.sql:3, web/lib/queries.ts:640',
    detail:
      'Policy kasus memakai `USING (true)` sehingga baris dengan verified IS NULL (belum dicek) dan verified=false (ditolak) ikut terbaca anon. getKasusByPejabat memakai `.select(\'*\')` tanpa filter verified, jadi baris itu tampil di halaman profil.',
    fix:
      'Ubah policy menjadi `USING (verified IS TRUE)` dan tambahkan `.eq(\'verified\', true)` pada kueri. Hanya kasus terverifikasi yang publik.',
  },
  {
    id: 'PK-M1',
    sev: 'medium',
    status: 'fixed',
    title: 'Celah penyisipan skrip (XSS) lewat nama pejabat',
    impact:
      'Sebuah kolom nama disisipkan ke halaman dengan cara yang, bila nama itu berisi kode berbahaya, kode tersebut bisa berjalan di browser pengunjung. Digabung dengan temuan PK-C1 (siapa pun bisa menulis nama), celah ini dapat dijangkau.',
    location: 'web/app/[pejabat-id]/page.tsx:95',
    detail:
      'dangerouslySetInnerHTML={{__html: JSON.stringify(ldJson)}} — JSON.stringify tidak meng-escape karakter `<`, sehingga nama seperti `</script>…` bisa keluar dari blok JSON-LD.',
    fix:
      'Escape `<`, `>`, serta U+2028/U+2029 pada hasil JSON sebelum disisipkan (mis. .replace(/</g, \'\\\\u003c\')).',
  },
  {
    id: 'PK-M2',
    sev: 'medium',
    status: 'fixed',
    title: 'Header keamanan browser belum lengkap',
    impact:
      'Dua proteksi standar browser belum ada: satu membatasi kerusakan jika skrip berbahaya berhasil masuk (CSP), satu lagi memaksa koneksi selalu aman/terenkripsi (HSTS).',
    location: 'web/next.config.ts:3',
    detail:
      'securityHeaders sudah memuat X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, tetapi tidak ada Content-Security-Policy maupun Strict-Transport-Security.',
    fix:
      'Tambahkan Content-Security-Policy (izinkan Google Fonts yang dipakai layout admin) dan Strict-Transport-Security.',
  },
  {
    id: 'PK-M3',
    sev: 'medium',
    status: 'fixed',
    title: 'Scraper bisa diarahkan ke alamat internal (SSRF)',
    impact:
      'Browser scraping bisa diarahkan ke alamat internal/cloud tanpa penjagaan. Di lingkungan cloud, ini bisa membocorkan kredensial mesin (mis. endpoint metadata).',
    location: 'scraper/pipeline/browser.py:85, 109; scraper/pipeline/websearch.py:24',
    detail:
      'browser.navigate()/extract() mengambil URL langsung tanpa cek is_private_url. Selain itu is_private_url meng-"izinkan" nama domain apa pun tanpa me-resolve DNS — domain yang mengarah ke 169.254.169.254 lolos.',
    fix:
      'Terapkan penjagaan pada jalur browser; resolve hostname lalu blokir IP privat/loopback/link-local.',
  },
  {
    id: 'PK-M4',
    sev: 'medium',
    status: 'fixed',
    title: 'Fungsi crawl bisa dipicu siapa saja → boros biaya AI',
    impact:
      'Fungsi crawl di cloud tidak punya kunci di tingkat aplikasi dan tidak dibatasi laju. Orang luar bisa memicunya berulang kali sehingga menaikkan tagihan AI/pencarian, atau menspam feed hotspot.',
    location: 'supabase/functions/crawl-hotspot/index.ts:31',
    detail:
      'Deno.serve tidak mengecek secret bersama; tidak ada config.toml verify_jwt; tidak ada throttle. Dapat dipanggil dengan kunci anon yang bersifat publik.',
    fix:
      'Wajibkan header secret bersama untuk pemicuan; tambahkan rate-limit.',
  },
  {
    id: 'PK-M5',
    sev: 'medium',
    status: 'fixed',
    title: 'Pustaka pembaca Excel yang rentan',
    impact:
      'Komponen pembaca file spreadsheet yang diunggah punya bug keamanan yang sudah diketahui dan tidak lagi dirawat pada kanal saat ini; file yang dirancang khusus bisa mengeksploitasinya.',
    location: 'web/package.json:21 — xlsx@0.18.5',
    detail:
      'CVE-2023-30533 (prototype pollution) dan CVE-2024-22363 (ReDoS). Endpoint import memproses file yang diunggah pengguna lewat XLSX.read.',
    fix:
      'Perbarui ke build SheetJS yang dirawat; tambahkan `npm audit` ke CI.',
  },
  {
    id: 'PK-L1',
    sev: 'low',
    status: 'fixed',
    title: 'Kata sandi admin dipakai ulang sebagai "garam" hash IP',
    impact:
      'Jika hash IP pernah bocor dan alamat IP diketahui, kata sandi admin bisa ditebak secara offline.',
    location: 'web/app/api/flags/route.ts:7',
    detail: 'hashIp memakai ADMIN_PASSWORD sebagai salt — mencampur rahasia tinggi ke nilai non-rahasia.',
    fix: 'Pakai variabel khusus HASH_SALT, bukan kata sandi admin.',
  },
  {
    id: 'PK-L2',
    sev: 'low',
    title: 'Chromium berjalan dengan --no-sandbox',
    impact: 'Mengurangi isolasi browser headless saat memproses halaman web tak tepercaya.',
    location: 'scraper/pipeline/browser.py:34',
    detail: 'Flag --no-sandbox/--disable-setuid-sandbox dipakai (umum di kontainer, tetapi melemahkan sandbox).',
    fix: 'Jalankan sebagai user non-root di kontainer dan hapus flag bila memungkinkan.',
  },
  {
    id: 'PK-L3',
    sev: 'low',
    status: 'fixed',
    title: 'Slug provinsi tidak disanitasi saat menulis file',
    impact: 'Pertahanan berlapis: saat ini nilai dikendalikan operator, jadi belum bisa dijangkau dari web.',
    location: 'scraper/core/output.py:15',
    detail: 'base = Path(output_dir) / provinsi_slug tanpa validasi terhadap path traversal.',
    fix: 'Validasi slug (whitelist karakter) sebelum dipakai sebagai nama folder.',
  },
  {
    id: 'PK-L4',
    sev: 'low',
    status: 'fixed',
    title: 'Cookie admin sameSite=lax tanpa kedaluwarsa sisi server',
    impact: 'Sesi tidak bisa dicabut dari sisi server sebelum 7 hari; perlindungan lintas-situs bisa diperketat.',
    location: 'web/app/api/auth/route.ts:11-17',
    detail: 'sameSite=lax + maxAge 7 hari, tanpa daftar sesi yang bisa dibatalkan.',
    fix: 'Pertimbangkan sameSite=strict untuk admin dan token sesi yang bisa dicabut (lihat PK-H1).',
  },
]

const POSITIVES = [
  'Tidak ada kredensial yang ter-commit — .env di-gitignore, konfigurasi memakai variabel lingkungan.',
  'RLS aktif di 8 dari 9 tabel; publik hanya diberi akses BACA pada data publik.',
  'Python aman: yaml.safe_load di mana-mana, tanpa shell=True / eval / pickle.',
  'Kueri basis data terparameter (.eq/.ilike) — tidak ada celah injeksi filter.',
  'Header keamanan dasar sudah ada (anti-clickjacking, nosniff, referrer-policy).',
]

interface Stage {
  no: string
  when: string
  items: string
  what: string
  effort: string
  impact: string
  done?: boolean
}

const ROADMAP: Stage[] = [
  {
    no: '1',
    when: 'Hari ini',
    done: true,
    items: 'PK-C1 · PK-H3 · PK-H4',
    what: 'Menutup jalur pemalsuan kasus korupsi (PK-C1), mengunci tabel pengaturan (PK-H3), dan menyembunyikan tuduhan yang belum terverifikasi (PK-H4). Hanya 1 helper auth + 2 migrasi SQL singkat — tetapi menghapus risiko hukum & reputasi terbesar.',
    effort: 'Kecil',
    impact: 'Sangat tinggi',
  },
  {
    no: '2',
    when: 'Minggu ini',
    done: true,
    items: 'PK-H1 · PK-H2',
    what: 'Sesi login yang benar (cookie ≠ kata sandi) + pembatasan percobaan login; jalankan perintah scraper tanpa shell.',
    effort: 'Sedang',
    impact: 'Tinggi',
  },
  {
    no: '3',
    when: 'Sprint berikutnya',
    done: true,
    items: 'PK-M1 · PK-M2 · PK-M5',
    what: 'Tutup celah XSS, lengkapi header keamanan browser (CSP/HSTS), perbarui pustaka Excel yang rentan.',
    effort: 'Sedang',
    impact: 'Sedang',
  },
  {
    no: '4',
    when: 'Backlog terjadwal',
    done: true,
    items: 'PK-M3 · PK-M4 · PK-L1–L4',
    what: 'Penjagaan SSRF, kunci fungsi crawl, perbaikan salt hash, sandbox browser, dan sanitasi slug.',
    effort: 'Kecil–Sedang',
    impact: 'Sedang–Rendah',
  },
]

function countBy(sev: Sev) {
  return FINDINGS.filter((f) => f.sev === sev).length
}

export default function SecurityAuditPage() {
  const order: Sev[] = ['critical', 'high', 'medium', 'low']

  return (
    <>
      <style>{`
        .sec { max-width: 880px; color: #2a2c33; }

        .sec-kicker {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: #a01f17;
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .sec-kicker::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #d4cfc5;
        }
        .sec-title {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 40px;
          line-height: 1.05;
          color: #0f1117;
          letter-spacing: -0.01em;
          margin-bottom: 14px;
        }
        .sec-meta {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          color: #8a857c;
          line-height: 1.9;
          padding-bottom: 22px;
          border-bottom: 3px double #c9c3b8;
          margin-bottom: 28px;
        }

        .sec-lede {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 19px;
          line-height: 1.55;
          color: #2a2c33;
          margin-bottom: 22px;
        }
        .sec-lede em { color: #a01f17; font-style: italic; }

        .sec-alert {
          border-left: 3px solid #a01f17;
          background: #fbeae8;
          padding: 18px 22px;
          margin-bottom: 34px;
        }
        .sec-alert-label {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #a01f17;
          margin-bottom: 8px;
        }
        .sec-alert-body {
          font-size: 13px;
          line-height: 1.7;
          color: #3a2422;
        }

        .sec-h {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #8a857c;
          margin: 0 0 16px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .sec-h::before {
          content: '§';
          color: #c0392b;
          font-size: 13px;
        }

        /* Scorecard */
        .sec-score {
          background: #0f1117;
          padding: 26px 32px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 38px;
        }
        .sec-score-cell { text-align: center; border-right: 1px solid #20242f; }
        .sec-score-cell:last-child { border-right: none; }
        .sec-score-num {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 38px;
          line-height: 1;
          margin-bottom: 6px;
        }
        .sec-score-label {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #6a6f7d;
        }

        /* Positives */
        .sec-ok {
          border: 1px solid #cfe3d6;
          background: #f1f7f2;
          padding: 22px 26px;
          margin-bottom: 38px;
        }
        .sec-ok-title {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 17px;
          color: #1e7a45;
          margin-bottom: 12px;
        }
        .sec-ok ul { list-style: none; }
        .sec-ok li {
          font-size: 12px;
          line-height: 1.5;
          color: #3c4a40;
          padding: 5px 0 5px 22px;
          position: relative;
        }
        .sec-ok li::before {
          content: '✓';
          position: absolute;
          left: 0;
          color: #1e7a45;
          font-size: 12px;
        }

        /* Roadmap */
        .sec-roadmap { margin-bottom: 40px; }
        .sec-stage {
          display: grid;
          grid-template-columns: 56px 1fr;
          gap: 18px;
          padding: 20px 0;
          border-top: 1px solid #d4cfc5;
        }
        .sec-stage:last-child { border-bottom: 1px solid #d4cfc5; }
        .sec-stage-no {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 34px;
          color: #c0392b;
          line-height: 1;
        }
        .sec-stage-when {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #8a857c;
          margin-top: 6px;
        }
        .sec-stage-items {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          letter-spacing: 0.04em;
          color: #0f1117;
          margin-bottom: 6px;
        }
        .sec-stage-what { font-size: 12.5px; line-height: 1.6; color: #3a3c43; margin-bottom: 10px; }
        .sec-chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .sec-chip {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 9px;
          border: 1px solid #d4cfc5;
          color: #5a5750;
          background: #faf7f1;
        }

        /* Findings */
        .sec-find {
          border: 1px solid #d4cfc5;
          border-left-width: 3px;
          padding: 22px 26px;
          margin-bottom: 16px;
          background: #faf7f1;
        }
        .sec-find-top { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .sec-tag {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #f5f1ea;
          padding: 3px 9px;
        }
        .sec-id {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          color: #8a857c;
        }
        .sec-fixed {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #1e7a45;
          border: 1px solid #1e7a45;
          padding: 2px 8px;
        }
        .sec-find-title {
          font-family: 'Fraunces', serif;
          font-weight: 300;
          font-size: 19px;
          line-height: 1.3;
          color: #0f1117;
          margin: 0 0 10px;
        }
        .sec-impact { font-size: 13px; line-height: 1.7; color: #33353c; }

        .sec-details { margin-top: 14px; border-top: 1px dashed #d4cfc5; padding-top: 12px; }
        .sec-details > summary {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #c0392b;
          cursor: pointer;
          list-style: none;
          user-select: none;
        }
        .sec-details > summary::-webkit-details-marker { display: none; }
        .sec-details > summary::before { content: '▸ '; }
        .sec-details[open] > summary::before { content: '▾ '; }
        .sec-tech { margin-top: 14px; display: grid; gap: 12px; }
        .sec-tech-row {}
        .sec-tech-k {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #8a857c;
          margin-bottom: 4px;
        }
        .sec-tech-v { font-size: 12px; line-height: 1.6; color: #2a2c33; }
        .sec-tech-v.mono {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #0f1117;
          background: rgba(0,0,0,0.04);
          padding: 8px 10px;
          word-break: break-word;
        }

        .sec-footer {
          margin-top: 36px;
          padding-top: 20px;
          border-top: 3px double #c9c3b8;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.05em;
          color: #8a857c;
          line-height: 1.8;
        }
      `}</style>

      <div className="sec">
        <div className="sec-kicker">Dokumen Internal · Rahasia</div>
        <h1 className="sec-title">Audit Keamanan</h1>
        <div className="sec-meta">
          Lingkup: aplikasi web (Next.js + Supabase), rute API, kebijakan RLS, fungsi edge, dan scraper Python.<br />
          Potret per 31 Mei 2026 · 14 temuan · Status: 13/14 diperbaiki (Tahap 1–3) · sisa PK-L2 (sandbox — bersifat lingkungan/kontainer)
        </div>

        <p className="sec-lede">
          Kami meninjau seluruh sistem. Sebagian besar fondasinya sehat — tetapi ada{' '}
          <em>satu lubang kritis</em> yang memungkinkan orang luar menanam catatan korupsi
          palsu pada pejabat sungguhan tanpa kata sandi. Di bawah ini: apa yang ditemukan,
          apa artinya dalam bahasa sederhana, dan urutan perbaikan yang disarankan.
        </p>

        <div className="sec-alert" style={{ borderLeftColor: '#1e7a45', background: '#f1f7f2' }}>
          <div className="sec-alert-label" style={{ color: '#1e7a45' }}>✓ Pembaruan remediasi — Tahap 1–3 selesai (31 Mei 2026)</div>
          <div className="sec-alert-body">
            <strong>13 dari 14 temuan ditutup.</strong> Seluruh Kritis + Tinggi + Sedang + sebagian besar
            Rendah sudah diperbaiki: token sesi bertanda tangan, gerbang admin per-rute, scraper tanpa shell,
            RLS terkunci, kasus publik hanya yang terverifikasi, CSP + HSTS, penjagaan SSRF, dan pembaruan
            dependensi (Next.js → 16.2.6 menutup advisory HIGH middleware/SSRF; xlsx → build SheetJS yang
            dipatch). Sisa satu: <strong>PK-L2</strong> (Chromium --no-sandbox) — bersifat lingkungan/kontainer,
            didokumentasikan, bukan perubahan kode.
          </div>
        </div>

        <div className="sec-alert" style={{ borderLeftColor: '#1e7a45', background: '#f1f7f2' }}>
          <div className="sec-alert-label" style={{ color: '#1e7a45' }}>✓ Validasi eksternal — Pemindaian OWASP ZAP (1 Juni 2026)</div>
          <div className="sec-alert-body">
            Aplikasi dipindai dengan <strong>OWASP ZAP</strong> (DAST) terhadap <em>build produksi</em>{' '}
            (<code>localhost:3100</code>, <code>NODE_ENV=production</code>). Hasilnya{' '}
            <strong>nol temuan Kritis dan nol Tinggi</strong> — memperkuat kesimpulan audit di atas.
            Tiga temuan Sedang yang tersisa semuanya soal CSP dan merupakan <strong>risiko sisa yang
            diterima secara sadar</strong>; satu temuan Rendah (header <code>X-Powered-By</code>) sudah
            ditutup di pemindaian ini juga.
            <details className="sec-details" style={{ borderTopColor: '#bcd9c4' }}>
              <summary style={{ color: '#1e7a45' }}>Rincian pemindaian &amp; tindak lanjut</summary>
              <div className="sec-tech">
                <div className="sec-tech-row">
                  <div className="sec-tech-k">Diperbaiki di rilis ini</div>
                  <div className="sec-tech-v">
                    <strong>Server Leaks Information via X-Powered-By (Rendah)</strong> — Next.js mengirim
                    header <code>X-Powered-By: Next.js</code> yang membocorkan teknologi server. Ditutup
                    dengan <code>poweredByHeader: false</code> di <code>web/next.config.ts:35</code>.
                  </div>
                </div>
                <div className="sec-tech-row">
                  <div className="sec-tech-k">Risiko sisa yang diterima (3× Sedang)</div>
                  <div className="sec-tech-v">
                    <code>script-src &apos;unsafe-inline&apos;</code>, <code>style-src &apos;unsafe-inline&apos;</code>,
                    dan <code>img-src https:</code> (wildcard). Diperlukan oleh skrip bootstrap inline Next.js,
                    blok <code>&lt;style&gt;</code> inline aplikasi, dan foto profil dari sumber arbitrer.
                    Pertahanan XSS utama tetap utuh tanpa bergantung pada CSP: auto-escape React +
                    JSON-LD yang sudah di-escape (PK-M1). CSP berbasis nonce ditunda — bukan nilai
                    sepadan dengan kompleksitas Next.js saat ini.
                  </div>
                </div>
                <div className="sec-tech-row">
                  <div className="sec-tech-k">Terbukti hilang di build produksi</div>
                  <div className="sec-tech-v">
                    <code>script-src &apos;unsafe-eval&apos;</code> (hanya dev, untuk React Fast Refresh) dan
                    &ldquo;Information Disclosure – Suspicious Comments&rdquo; (×40, hilang setelah minifikasi).
                  </div>
                </div>
                <div className="sec-tech-row">
                  <div className="sec-tech-k">Positif palsu / informasional (tanpa tindakan)</div>
                  <div className="sec-tech-v">
                    &ldquo;User Controllable HTML Element Attribute (Potential XSS)&rdquo; pada{' '}
                    <code>/pejabat?provinsi=</code> — nilai di-render lewat JSX React (<code>PejabatBrowse.tsx:167</code>,
                    auto-escape) dan dibatasi ke daftar provinsi tetap. &ldquo;Timestamp Disclosure&rdquo;
                    (hash aset 10-digit), &ldquo;Content-Type Missing&rdquo;, &ldquo;Modern Web Application&rdquo;.
                    &ldquo;HSTS Not Set&rdquo; tercatat hanya untuk <code>www.google.com</code> — ZAP merayap
                    ke luar situs; HSTS aplikasi sendiri aktif di produksi.
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <h2 className="sec-h">Ringkasan tingkat keparahan</h2>
        <div className="sec-score">
          {order.map((s) => (
            <div className="sec-score-cell" key={s}>
              <div className="sec-score-num" style={{ color: SEV[s].num }}>{countBy(s)}</div>
              <div className="sec-score-label">{SEV[s].label}</div>
            </div>
          ))}
        </div>

        <div className="sec-ok">
          <div className="sec-ok-title">Yang sudah benar (jangan sampai mundur)</div>
          <ul>
            {POSITIVES.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>

        <h2 className="sec-h">Urutan perbaikan yang disarankan</h2>
        <div className="sec-roadmap">
          {ROADMAP.map((st) => (
            <div className="sec-stage" key={st.no}>
              <div>
                <div className="sec-stage-no">{st.no}</div>
                <div className="sec-stage-when">{st.when}</div>
              </div>
              <div>
                <div className="sec-stage-items">{st.items}</div>
                <div className="sec-stage-what">{st.what}</div>
                <div className="sec-chips">
                  {st.done && (
                    <span className="sec-chip" style={{ color: '#1e7a45', borderColor: '#1e7a45' }}>✓ Selesai</span>
                  )}
                  <span className="sec-chip">Usaha: {st.effort}</span>
                  <span className="sec-chip">Dampak: {st.impact}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h2 className="sec-h">Temuan lengkap</h2>
        {order.map((s) =>
          FINDINGS.filter((f) => f.sev === s).map((f) => (
            <div className="sec-find" key={f.id} id={f.id} style={{ borderLeftColor: f.status === 'fixed' ? '#1e7a45' : SEV[f.sev].rail }}>
              <div className="sec-find-top">
                <span className="sec-tag" style={{ background: SEV[f.sev].tag }}>{SEV[f.sev].label}</span>
                <span className="sec-id">{f.id}</span>
                {f.status === 'fixed' && <span className="sec-fixed">✓ Diperbaiki</span>}
              </div>
              <h3 className="sec-find-title">{f.title}</h3>
              <p className="sec-impact">{f.impact}</p>

              <details className="sec-details">
                <summary>Detail teknis &amp; perbaikan</summary>
                <div className="sec-tech">
                  <div className="sec-tech-row">
                    <div className="sec-tech-k">Lokasi</div>
                    <div className="sec-tech-v mono">{f.location}</div>
                  </div>
                  <div className="sec-tech-row">
                    <div className="sec-tech-k">Mengapa bermasalah</div>
                    <div className="sec-tech-v">{f.detail}</div>
                  </div>
                  <div className="sec-tech-row">
                    <div className="sec-tech-k">Perbaikan</div>
                    <div className="sec-tech-v">{f.fix}</div>
                  </div>
                </div>
              </details>
            </div>
          )),
        )}

        <div className="sec-footer">
          Dokumen ini sendiri bersifat sensitif dan berada di balik gerbang admin.<br />
          Tahap 1–2 selesai &amp; terverifikasi (31 Mei 2026). Sisa: 5 Sedang, 4 Rendah — pertahanan berlapis, tidak mendesak.
        </div>
      </div>
    </>
  )
}
