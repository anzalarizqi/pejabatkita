#!/usr/bin/env python3
"""
Local hotspot crawler — mirrors the deprecated Supabase edge function.

Pulls RSS feeds (or runs a Kimi $web_search if --keyword), filters to last 24h,
dedupes against DB, sends batches to Kimi for relevance gate + structured
extraction, resolves wilayah/pejabat, inserts to hotspot_events.

Usage:
  python scripts/crawl_hotspot.py                  # default RSS pull, last 24h
  python scripts/crawl_hotspot.py --keyword "OTT KPK Pati"
  python scripts/crawl_hotspot.py --max-age-hours 48
  python scripts/crawl_hotspot.py --dry-run        # no DB writes, prints what would happen
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yaml
from dotenv import load_dotenv

if hasattr(sys.stdout, "buffer"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

# ─── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

FEEDS = [
    {"name": "Detik berita",          "url": "https://news.detik.com/berita/rss"},
    {"name": "CNN Indonesia nasional", "url": "https://www.cnnindonesia.com/nasional/rss"},
    {"name": "Antara politik",        "url": "https://www.antaranews.com/rss/politik.xml"},
    {"name": "Antara hukum",          "url": "https://www.antaranews.com/rss/hukum.xml"},
    {"name": "Antara terkini",        "url": "https://www.antaranews.com/rss/terkini.xml"},
    # Google News proxy for outlets without public RSS
    {"name": "Kompas (via GN)",  "url": "https://news.google.com/rss/search?q=site:kompas.com+(pejabat+OR+korupsi+OR+DPR+OR+menteri+OR+presiden)&hl=id&gl=ID&ceid=ID:id"},
    {"name": "Tirto (via GN)",   "url": "https://news.google.com/rss/search?q=site:tirto.id+(pejabat+OR+korupsi+OR+DPR+OR+menteri+OR+presiden)&hl=id&gl=ID&ceid=ID:id"},
    {"name": "Kumparan (via GN)", "url": "https://news.google.com/rss/search?q=site:kumparan.com+(pejabat+OR+korupsi+OR+DPR+OR+menteri+OR+presiden)&hl=id&gl=ID&ceid=ID:id"},
]

VALID_KATEGORI = {"korupsi", "pernyataan", "demonstrasi", "kebijakan", "kritik", "lainnya"}


def _kimi_creds() -> tuple[str, str, str]:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for p in cfg.get("llm_providers", []):
        if p["name"] == "moonshot":
            base_url = p.get("base_url", "https://api.moonshot.ai/v1")
            api_key  = os.getenv(p.get("api_key_env", "MOONSHOT_API_KEY"), "")
            model    = p.get("model", "kimi-k2.6")
            return base_url, model, api_key
    raise RuntimeError("moonshot provider not found in config.yaml")


# ─── RSS parsing ─────────────────────────────────────────────────────────────

def _clean_text(s: str) -> str:
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s, flags=re.DOTALL)
    s = (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'")
           .replace("&nbsp;", " "))
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _extract_tag(item_xml: str, tag: str) -> str:
    m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", item_xml, re.IGNORECASE | re.DOTALL)
    return _clean_text(m.group(1)) if m else ""


def parse_feed_xml(xml: str, source: str) -> list[dict]:
    items = []
    for m in re.finditer(r"<item[^>]*>(.*?)</item>", xml, re.IGNORECASE | re.DOTALL):
        block = m.group(1)
        title = _extract_tag(block, "title")
        link  = _extract_tag(block, "link")
        if not title or not link:
            continue
        items.append({
            "title":       title,
            "description": _extract_tag(block, "description"),
            "url":         link,
            "pubDate":     _extract_tag(block, "pubDate") or None,
            "source":      source,
        })
    return items


def fetch_one_feed(client: httpx.Client, feed: dict) -> list[dict]:
    try:
        resp = client.get(feed["url"], timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (compatible; PejabatKita/1.0)",
        })
        resp.raise_for_status()
        return parse_feed_xml(resp.text, feed["name"])
    except Exception as e:
        print(f"  ! {feed['name']}: {e}", file=sys.stderr)
        return []


def fetch_rss_articles(max_age_hours: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    all_items: list[dict] = []
    with httpx.Client() as client, ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(fetch_one_feed, client, f): f for f in FEEDS}
        for fut in as_completed(futures):
            feed = futures[fut]
            items = fut.result()
            print(f"  ✓ {feed['name']}: {len(items)} items")
            all_items.extend(items)

    # Filter by pubDate (keep if parse fails)
    filtered = []
    for a in all_items:
        if not a["pubDate"]:
            filtered.append(a); continue
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(a["pubDate"])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt >= cutoff:
                filtered.append(a)
        except Exception:
            filtered.append(a)

    # Dedup by URL
    seen = set()
    unique = []
    for a in filtered:
        if a["url"] in seen: continue
        seen.add(a["url"])
        unique.append(a)
    return unique


# ─── Kimi LLM batch extraction ───────────────────────────────────────────────

BATCH_SYSTEM_PROMPT = """\
Kamu adalah editor watchdog antikorupsi & akuntabilitas pejabat publik Indonesia.
Platform kami HANYA memublikasikan "hotspot" — berita BURUK / KONTROVERSIAL yang menjadi sorotan publik.
Bukan press release, bukan PR pemerintah, bukan agenda rutin.

TERIMA artikel HANYA jika memenuhi salah satu kriteria berikut:
1. KORUPSI / HUKUM: pejabat ditetapkan tersangka/terdakwa/terpidana, OTT KPK/Kejagung, kasus suap/gratifikasi, dakwaan, vonis, pelanggaran etik (KPK/MK/DKPP).
2. KONTROVERSI / KRITIK: pernyataan pejabat yang memicu kemarahan publik, kebijakan yang ditolak publik, blunder pejabat, perilaku tidak pantas (arogan, mobil dinas disalahgunakan, gaya hidup mewah, dll).
3. DEMONSTRASI / KONFLIK: demo terhadap pejabat/kebijakan, bentrok publik vs aparat, mosi tidak percaya.
4. PELANGGARAN HAM / DEMOKRASI: pembungkaman pers, intimidasi aktivis, pembubaran ibadah/pertemuan oleh aparat, pelanggaran hak warga.
5. SKANDAL / DUGAAN: dugaan penyalahgunaan jabatan, konflik kepentingan, nepotisme, dinasti politik.
6. PUTUSAN PENGADILAN SIGNIFIKAN: putusan kontroversial, vonis ringan/berat yang disorot publik.
7. KEBIJAKAN KONTROVERSIAL: RUU/perpres/perppu yang menuai protes, kenaikan harga/pajak yang ditolak, pemotongan anggaran sektor publik.

TOLAK SEMUANYA YANG INI (output skip:true):
- Press release / kegiatan seremonial / kunjungan kerja rutin / pelantikan biasa
- Distribusi bantuan, hewan kurban, paket bansos rutin (kecuali ada skandal)
- Pemerintah mengumumkan program baru tanpa kontroversi
- Pernyataan dukungan, ucapan selamat, kondolensi
- Pencapaian / penghargaan pejabat
- Statemen normatif tentang nilai/spirit/momentum (Bamsoet bilang X "momentum perkuat...")
- Liputan FOTO seremonial, momen Idul Adha/lebaran/HUT
- Olahraga, hiburan, selebriti non-pejabat
- Bisnis murni, ekonomi makro tanpa intervensi pejabat
- Bencana alam tanpa kontroversi penanganan
- Kriminal biasa non-pejabat
- Opini umum/wawancara pakar tanpa peristiwa konkret
- Berita teknologi/program kerja rutin kementerian

Ujian sederhana: "Apakah ini akan dikutip warga ketika mempertanyakan kinerja/integritas pejabat?" Kalau TIDAK, tolak.

Untuk artikel TERIMA, kembalikan objek:
{ "url": "<url asli dari input>", "judul": "<judul ringkas, maks 120 karakter>", "ringkasan": "<2-3 kalimat yang menjelaskan KENAPA ini buruk/kontroversial>", "kategori": "korupsi|pernyataan|demonstrasi|kebijakan|kritik|lainnya", "lokasi_nama": "<provinsi/kota>" | null, "pejabat_nama": "<nama lengkap>" | null }

ATURAN LOKASI:
- Untuk peristiwa SKALA NASIONAL (presiden, menteri, kementerian, DPR/DPD/MPR, KPK Pusat, MUI Pusat, Kejagung, lembaga negara di pusat) — SELALU gunakan "lokasi_nama": "DKI Jakarta".
- Untuk peristiwa di provinsi/kota tertentu, gunakan nama provinsi yang tepat ("DKI Jakarta", "Jawa Barat", "DI Yogyakarta", dll).
- Hanya gunakan null jika benar-benar tidak ada konteks lokasi.

Untuk artikel TOLAK:
{ "url": "<url asli>", "skip": true, "reason": "<alasan singkat>" }

Output: JSON array, satu objek per artikel input, urutan sama. Tanpa teks lain di luar array."""


def kimi_extract_batch(client: httpx.Client, base_url: str, model: str, api_key: str,
                      articles: list[dict]) -> list[dict]:
    payload_input = [
        {"idx": i, "url": a["url"], "title": a["title"],
         "description": (a["description"] or "")[:600], "source": a["source"]}
        for i, a in enumerate(articles)
    ]
    resp = client.post(
        f"{base_url}/chat/completions",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": BATCH_SYSTEM_PROMPT},
                {"role": "user", "content": f"Artikel input ({len(articles)} buah):\n\n{json.dumps(payload_input, ensure_ascii=False)}"},
            ],
            "temperature": 0.6,
            "thinking": {"type": "disabled"},
        },
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=180,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"].strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


# ─── Kimi $web_search path (manual keyword) ──────────────────────────────────

SEARCH_SYSTEM_PROMPT = """\
Kamu adalah pengumpul berita Indonesia. Pakai web search untuk mencari berita relevan dengan kueri pengguna.

Untuk setiap artikel, kembalikan:
{ "title": "<judul>", "description": "<ringkasan singkat>", "url": "<url asli, wajib>", "pubDate": "<tanggal jika ada>" | null }

Jawab HANYA dengan JSON array murni, tanpa teks lain. Jika tidak ada artikel, kembalikan []."""


def kimi_search_articles(client: httpx.Client, base_url: str, model: str, api_key: str,
                         keyword: str) -> list[dict]:
    messages = [
        {"role": "system", "content": SEARCH_SYSTEM_PROMPT},
        {"role": "user",   "content": f"Cari berita terkini tentang: {keyword}"},
    ]
    tools = [{"type": "builtin_function", "function": {"name": "$web_search"}}]
    for _ in range(6):
        resp = client.post(
            f"{base_url}/chat/completions",
            json={
                "model": model, "messages": messages, "tools": tools,
                "temperature": 0.6, "thinking": {"type": "disabled"},
            },
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        message = choice["message"]
        if choice["finish_reason"] == "tool_calls":
            messages.append(message)
            for tc in message.get("tool_calls", []):
                messages.append({"role": "tool", "tool_call_id": tc["id"],
                                 "name": tc["function"]["name"], "content": tc["function"]["arguments"]})
            continue
        raw = (message.get("content") or "").strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()
        try:
            parsed = json.loads(cleaned)
            if not isinstance(parsed, list): return []
            return [{
                "title": a.get("title", ""), "description": a.get("description", ""),
                "url": a.get("url", ""), "pubDate": a.get("pubDate") or None,
                "source": f"kimi-search: {keyword}",
            } for a in parsed if a.get("title") and a.get("url")]
        except json.JSONDecodeError:
            return []
    return []


# ─── Supabase helpers ────────────────────────────────────────────────────────

def fetch_all(client: httpx.Client, table: str, select: str, filters: dict | None = None) -> list[dict]:
    rows, offset = [], 0
    while True:
        params = {"select": select, "limit": 1000, "offset": offset}
        if filters: params.update(filters)
        resp = client.get(f"{SUPABASE_URL}/rest/v1/{table}", params=params,
                          headers={**SB_HEADERS, "Prefer": "count=none"})
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < 1000: break
        offset += 1000
    return rows


_wilayah_cache: list[dict] | None = None

def _normalize_wilayah(s: str) -> str:
    s = s.lower()
    s = re.sub(r"^(kota|kabupaten|kab\.?|provinsi|prov\.?)\s+", "", s)
    s = re.sub(r"[^a-z\s]", "", s)
    return s.strip()

ALIASES = {
    "jakarta": "DKI Jakarta", "jogja": "DI Yogyakarta", "yogyakarta": "DI Yogyakarta",
    "jawa barat": "Jawa Barat", "jawa tengah": "Jawa Tengah", "jawa timur": "Jawa Timur",
    "sulsel": "Sulawesi Selatan", "sumsel": "Sumatera Selatan", "sumut": "Sumatera Utara",
    "sumbar": "Sumatera Barat", "kaltim": "Kalimantan Timur", "kalsel": "Kalimantan Selatan",
    "kalbar": "Kalimantan Barat", "kalteng": "Kalimantan Tengah",
    "sulut": "Sulawesi Utara", "sulteng": "Sulawesi Tengah", "sultra": "Sulawesi Tenggara",
    "ntb": "Nusa Tenggara Barat", "ntt": "Nusa Tenggara Timur",
    "papua": "Papua", "maluku": "Maluku",
}

def resolve_wilayah_id(client: httpx.Client, lokasi: str | None) -> str | None:
    global _wilayah_cache
    if not lokasi: return None
    if _wilayah_cache is None:
        _wilayah_cache = fetch_all(client, "wilayah", "id,nama", {"level": "eq.provinsi"})
    norm = _normalize_wilayah(lokasi)
    for w in _wilayah_cache:
        if _normalize_wilayah(w["nama"]) == norm: return w["id"]
    for w in _wilayah_cache:
        wn = _normalize_wilayah(w["nama"])
        if wn in norm or norm in wn: return w["id"]
    for alias, prov in ALIASES.items():
        if alias in norm:
            for w in _wilayah_cache:
                if w["nama"] == prov: return w["id"]
    return None


def resolve_pejabat_id(client: httpx.Client, nama: str | None) -> str | None:
    if not nama: return None
    resp = client.get(f"{SUPABASE_URL}/rest/v1/pejabat",
                      params={"select": "id", "nama_lengkap": f"ilike.*{nama}*", "limit": 1},
                      headers=SB_HEADERS)
    if resp.status_code == 200:
        data = resp.json()
        return data[0]["id"] if data else None
    return None


def insert_event(client: httpx.Client, row: dict, dry_run: bool) -> bool:
    if dry_run: return True
    resp = client.post(f"{SUPABASE_URL}/rest/v1/hotspot_events", json=row,
                       headers={**SB_HEADERS, "Prefer": "return=minimal"})
    if resp.status_code in (200, 201): return True
    print(f"  ! insert failed {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", help="If set, runs Kimi $web_search with this keyword instead of RSS")
    parser.add_argument("--max-age-hours", type=int, default=24, help="RSS freshness window (default 24)")
    parser.add_argument("--batch-size", type=int, default=10, help="Articles per LLM batch (default 10)")
    parser.add_argument("--concurrency", type=int, default=3, help="Parallel LLM calls (default 3)")
    parser.add_argument("--dry-run", action="store_true", help="No DB writes")
    args = parser.parse_args()

    base_url, model, api_key = _kimi_creds()
    if not api_key:
        print("ERROR: MOONSHOT_API_KEY not set"); sys.exit(1)

    t0 = time.time()

    # ─── Stage 1: input ───
    print(f"Mode: {'keyword' if args.keyword else 'rss'}")
    if args.keyword:
        print(f"Keyword: {args.keyword}")
        with httpx.Client() as c:
            articles = kimi_search_articles(c, base_url, model, api_key, args.keyword)
        print(f"Search returned {len(articles)} articles")
    else:
        print(f"Fetching {len(FEEDS)} RSS feeds (last {args.max_age_hours}h)...")
        articles = fetch_rss_articles(args.max_age_hours)
        print(f"Total in window: {len(articles)}")

    if not articles:
        print("\nDone. No articles to process."); return

    # ─── Stage 2: dedup against DB ───
    with httpx.Client(timeout=30) as db_client:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        existing = fetch_all(db_client, "hotspot_events", "url_sumber",
                             {"crawled_at": f"gte.{cutoff}"})
        existing_urls = {r["url_sumber"] for r in existing if r.get("url_sumber")}
        fresh = [a for a in articles if a["url"] not in existing_urls]
        print(f"After dedup: {len(fresh)} new")

        if not fresh:
            print("\nDone. All articles already in DB."); return

        # ─── Stage 3: LLM batch ───
        batches = [fresh[i:i+args.batch_size] for i in range(0, len(fresh), args.batch_size)]
        print(f"\nProcessing {len(batches)} batches × {args.batch_size} (concurrency={args.concurrency})...")

        all_results: list[tuple[dict, dict | None]] = []  # (article, result_or_None)

        with httpx.Client() as llm_client, ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {pool.submit(kimi_extract_batch, llm_client, base_url, model, api_key, b): b
                       for b in batches}
            for i, fut in enumerate(as_completed(futures), 1):
                batch = futures[fut]
                try:
                    results = fut.result()
                except Exception as e:
                    print(f"  ! batch {i} failed: {e}", file=sys.stderr)
                    for a in batch: all_results.append((a, None))
                    continue
                by_url = {r["url"]: r for r in results if "url" in r}
                kept = sum(1 for a in batch if by_url.get(a["url"], {}).get("judul"))
                print(f"  batch {i}/{len(batches)}: {len(results)} results, {kept} kept")
                for a in batch: all_results.append((a, by_url.get(a["url"])))

        # ─── Stage 4: resolve + insert ───
        inserted = rejected = parse_failed = db_errors = 0
        print()
        for article, r in all_results:
            if r is None: parse_failed += 1; continue
            if r.get("skip") or not r.get("judul"): rejected += 1; continue

            kategori = r.get("kategori") if r.get("kategori") in VALID_KATEGORI else "lainnya"
            lokasi = r.get("lokasi_nama")
            pejabat_nama = r.get("pejabat_nama")
            wilayah_id = resolve_wilayah_id(db_client, lokasi)
            pejabat_id = resolve_pejabat_id(db_client, pejabat_nama)

            try:
                host = urlparse(article["url"]).hostname or ""
                sumber_nama = host.replace("www.", "")
                # Google News proxy: extract real outlet from title suffix "... - Outlet"
                if "news.google.com" in host:
                    m = re.search(r"\s[-–]\s([A-Za-z0-9.\s]+)\s*$", article.get("title", ""))
                    if m:
                        sumber_nama = m.group(1).strip().lower()
            except Exception:
                sumber_nama = article["source"]

            crawled_at = article.get("pubDate") or datetime.now(timezone.utc).isoformat()

            row = {
                "judul": r["judul"][:120],
                "ringkasan": r.get("ringkasan", ""),
                "kategori": kategori,
                "lokasi_nama": lokasi,
                "wilayah_id": wilayah_id,
                "pejabat_id": pejabat_id,
                "url_sumber": article["url"],
                "sumber_nama": sumber_nama,
                "crawled_at": crawled_at,
                "is_manual": bool(args.keyword),
            }
            if insert_event(db_client, row, args.dry_run):
                inserted += 1
                print(f"  + {r['judul'][:80]}")
            else:
                db_errors += 1

    print(f"\nDone in {time.time()-t0:.1f}s.")
    print(f"  inserted:    {inserted}")
    print(f"  rejected:    {rejected}")
    print(f"  parse_fail:  {parse_failed}")
    print(f"  db_errors:   {db_errors}")
    if args.dry_run: print("  (dry-run — no DB writes)")


if __name__ == "__main__":
    main()
