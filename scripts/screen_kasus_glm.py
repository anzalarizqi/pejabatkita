#!/usr/bin/env python3
"""
Cheap first-pass corruption screener: Zhipu web-search API + GLM-4.7-Flash extraction.

Flow (Option B — no tool calling):
  1. Call Zhipu web-search REST API directly → get real URLs + summaries
  2. If no relevant results → mark bersih immediately (no LLM cost)
  3. Pass real snippets to GLM-4.7-Flash → extract structured JSON (no search, no hallucination)

Pipeline:
  screen_kasus_glm.py  →  FOUND → inserts kasus (verified=null)
                       →  BERSIH → logs to kasus_screened (last_result=bersih_glm)
  verify_kasus.py      →  picks up verified=null rows → confirms or rejects

Usage:
  python scripts/screen_kasus_glm.py                     # all pejabat
  python scripts/screen_kasus_glm.py --provinsi "Aceh"   # single province
  python scripts/screen_kasus_glm.py --resume             # skip recently screened + pejabat with kasus
  python scripts/screen_kasus_glm.py --dry-run            # no DB writes
  python scripts/screen_kasus_glm.py --log                # append to kasus_screen_glm.log
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

if hasattr(sys.stdout, "buffer"):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT))

# ─── Supabase config ─────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}

# ─── GLM / Zhipu config ──────────────────────────────────────────────────────

GLM_MODEL       = "glm-4.7-flash"
WEBSEARCH_URL   = "https://api.z.ai/api/paas/v4/web_search"

def _zhipu_creds() -> tuple[str, str]:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for p in cfg.get("llm_providers", []):
        if p["name"] == "zhipu":
            base_url = p.get("base_url", "https://api.z.ai/api/coding/paas/v4")
            api_key  = os.getenv(p.get("api_key_env", "ZHIPUAI_API_KEY"), "")
            return base_url, api_key
    raise RuntimeError("zhipu provider not found in config.yaml")

# ─── Keywords that make a snippet relevant ────────────────────────────────────

CORRUPTION_KEYWORDS = {
    "korupsi", "tipikor", "tersangka", "terdakwa", "terpidana",
    "suap", "gratifikasi", "kpk", "kejati", "kejagung", "ott",
    "penyidikan", "penuntutan", "vonis", "dakwaan", "pidana",
}

def is_relevant(snippet: str, nama_keywords: set[str]) -> bool:
    """True if snippet mentions the person AND a corruption keyword."""
    lower = snippet.lower()
    has_corruption = any(kw in lower for kw in CORRUPTION_KEYWORDS)
    has_name = any(kw in lower for kw in nama_keywords)
    return has_corruption and has_name

# ─── Step 1: Web search ───────────────────────────────────────────────────────

def web_search(api_key: str, query: str, count: int = 8) -> list[dict]:
    """Call Zhipu web-search REST API. Returns list of {title, content, link, publish_date}."""
    try:
        resp = httpx.post(
            WEBSEARCH_URL,
            json={"search_engine": "search-prime", "search_query": query, "count": count},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=30,
        )
        if resp.status_code != 200:
            return []
        return resp.json().get("search_result", [])
    except Exception:
        return []

# ─── Step 2: GLM extraction from real snippets ───────────────────────────────

SYSTEM_EXTRACT = """\
Kamu adalah ekstractor data antikorupsi Indonesia.
Kamu akan diberikan hasil pencarian web (judul + ringkasan artikel) tentang seorang pejabat.
Tugasmu: baca hasil pencarian dan tentukan apakah pejabat tersebut terlibat kasus korupsi/tipikor.

Aturan KETAT:
- Hanya laporkan berdasarkan isi artikel yang diberikan — JANGAN menambah informasi sendiri.
- has_record = true HANYA jika artikel secara eksplisit menyebut nama pejabat sebagai
  tersangka/terdakwa/terpidana dalam kasus korupsi.
- url_sumber HARUS diambil dari field "link" di artikel yang relevan — jangan karang.
- Kembalikan JSON murni saja, tanpa teks lain.\
"""

def glm_extract(base_url: str, api_key: str, nama: str, snippets: list[dict]) -> dict:
    """Ask GLM to extract corruption record from real search snippets. No tool calling."""
    articles_text = "\n\n".join(
        f"[{i+1}] {s.get('title','')}\nLink: {s.get('link','')}\n"
        f"Tanggal: {s.get('publish_date','')}\nRingkasan: {s.get('content','')}"
        for i, s in enumerate(snippets)
    )

    user_msg = (
        f"Nama pejabat yang dicari: {nama}\n\n"
        f"Hasil pencarian web:\n{articles_text}\n\n"
        "Berdasarkan hasil pencarian di atas, apakah ada bukti kasus korupsi/tipikor "
        f"yang melibatkan {nama}? Kembalikan JSON sesuai format."
    )

    schema = """{
  "has_record": true | false,
  "status": "tersangka" | "terdakwa" | "terpidana" | "diselidiki" | null,
  "jenis": "korupsi" | "suap" | "gratifikasi" | "pencucian_uang" | "lainnya" | null,
  "lembaga": "KPK" | "Kejagung" | "Kejati" | "Polda" | "lainnya" | null,
  "tahun": <integer> | null,
  "ringkasan": "<1-2 kalimat dari artikel>" | null,
  "url_sumber": "<link dari artikel relevan — WAJIB jika has_record=true>" | null,
  "keyakinan": "tinggi" | "sedang" | "rendah"
}"""

    messages = [
        {"role": "system", "content": SYSTEM_EXTRACT + f"\n\nFormat output:\n{schema}"},
        {"role": "user",   "content": user_msg},
    ]

    try:
        resp = httpx.post(
            f"{base_url}/chat/completions",
            json={"model": GLM_MODEL, "messages": messages},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=60,
        )
    except httpx.TimeoutException:
        return {"error": "request timed out"}
    if resp.status_code != 200:
        return {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

    content = (resp.json()["choices"][0]["message"].get("content") or "").strip()
    content = re.sub(r"^```[a-z]*\n?", "", content)
    content = re.sub(r"\n?```$", "", content.strip())
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"error": f"JSON parse failed: {content[:120]}"}

# ─── Combined screen ──────────────────────────────────────────────────────────

def screen(base_url: str, api_key: str, nama: str, jabatan: str, provinsi: str) -> dict:
    # Build name keywords for relevance filter (first word + last word of nama)
    clean = re.sub(r'\b(S\.E\.|S\.H\.|M\.M\.|M\.H\.|S\.T\.|M\.T\.|S\.Sos\.|S\.M\.|H\.|Hj\.)\b', '', nama)
    parts = [w for w in clean.split() if len(w) > 2]
    nama_keywords = {p.lower() for p in parts}

    query = f'korupsi tipikor "{nama}" {jabatan} {provinsi}'
    results = web_search(api_key, query)

    # Filter to snippets that mention both the person and a corruption keyword
    relevant = [r for r in results if is_relevant(
        (r.get("title","") + " " + r.get("content","")), nama_keywords
    )]

    if not relevant:
        return {"has_record": False, "keyakinan": "tinggi", "_reason": "no relevant search results"}

    # Pass only relevant snippets (max 4) to GLM for extraction
    return glm_extract(base_url, api_key, nama, relevant[:4])

# ─── Supabase helpers ─────────────────────────────────────────────────────────

def fetch_all(client: httpx.Client, table: str, select: str, filters: dict | None = None) -> list[dict]:
    rows, offset = [], 0
    params: dict = {"select": select, "limit": 1000}
    if filters:
        params.update(filters)
    while True:
        params["offset"] = offset
        resp = client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            params=params,
            headers={**SB_HEADERS, "Range-Unit": "items", "Prefer": "count=none"},
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def insert_kasus(client: httpx.Client, row: dict, dry_run: bool) -> bool:
    if dry_run:
        return True
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/kasus",
        json=row,
        headers={**SB_HEADERS, "Prefer": "return=minimal"},
    )
    if resp.status_code in (200, 201):
        return True
    print(f"    DB ERROR {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False


def upsert_screened(client: httpx.Client, pejabat_id: str, result: str, keyakinan: str | None, dry_run: bool) -> None:
    if dry_run:
        return
    row = {
        "pejabat_id":       pejabat_id,
        "last_screened_at": "now()",
        "last_result":      result,
        "last_keyakinan":   keyakinan,
    }
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/kasus_screened",
        params={"on_conflict": "pejabat_id"},
        json=row,
        headers={**SB_HEADERS, "Prefer": "return=minimal,resolution=merge-duplicates"},
    )
    if resp.status_code not in (200, 201, 204):
        print(f"    SCREENED LOG ERROR {resp.status_code}: {resp.text[:200]}", file=sys.stderr)

# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provinsi",            help="Filter to a single province")
    parser.add_argument("--resume",              action="store_true")
    parser.add_argument("--rescreen-after-days", type=int, default=30)
    parser.add_argument("--dry-run",             action="store_true")
    parser.add_argument("--log",                 action="store_true",
                        help="Append JSON results to scripts/kasus_screen_glm.log")
    args = parser.parse_args()

    base_url, api_key = _zhipu_creds()
    if not api_key:
        print("ERROR: ZHIPUAI_API_KEY not set in .env")
        sys.exit(1)

    log_path = ROOT / "scripts" / "kasus_screen_glm.log" if args.log else None

    with httpx.Client(timeout=60) as client:
        pejabat_rows = fetch_all(client, "pejabat", "id,nama_lengkap,gelar_depan,gelar_belakang")
        jabatan_rows = fetch_all(client, "jabatan", "pejabat_id,posisi,wilayah_id")
        wilayah_rows = fetch_all(client, "wilayah", "id,nama,level,parent_id")

        existing_ids: set[str] = set()
        if args.resume:
            kasus_rows   = fetch_all(client, "kasus", "pejabat_id")
            existing_ids = {r["pejabat_id"] for r in kasus_rows}
            from datetime import datetime, timedelta, timezone
            cutoff = datetime.now(timezone.utc) - timedelta(days=args.rescreen_after_days)
            screened_rows = fetch_all(client, "kasus_screened", "pejabat_id,last_screened_at")
            fresh = {
                r["pejabat_id"] for r in screened_rows
                if datetime.fromisoformat(r["last_screened_at"].replace("Z", "+00:00")) >= cutoff
            }
            existing_ids |= fresh
            print(f"Resume: {len(kasus_rows)} with kasus + {len(fresh)} recently screened ({len(existing_ids)} skipped)")

    wilayah_by_id = {w["id"]: w for w in wilayah_rows}

    def province_name(wilayah_id: str | None) -> str:
        if not wilayah_id:
            return ""
        w = wilayah_by_id.get(wilayah_id)
        if not w:
            return ""
        if w["level"] in ("provinsi", "nasional"):
            return w["nama"]
        parent = wilayah_by_id.get(w.get("parent_id") or "")
        return parent["nama"] if parent else ""

    first_jabatan: dict[str, dict] = {}
    for j in jabatan_rows:
        pid = j["pejabat_id"]
        if pid not in first_jabatan:
            first_jabatan[pid] = j

    officials: list[dict] = []
    for p in pejabat_rows:
        j    = first_jabatan.get(p["id"], {})
        prov = province_name(j.get("wilayah_id"))
        if args.provinsi and prov != args.provinsi:
            continue
        gelar_depan    = (p.get("gelar_depan") or "").strip()
        gelar_belakang = (p.get("gelar_belakang") or "").strip()
        full_name      = " ".join(filter(None, [gelar_depan, p["nama_lengkap"].strip(), gelar_belakang]))
        officials.append({
            "pejabat_id": p["id"],
            "nama":       full_name,
            "jabatan":    (j.get("posisi") or "").strip(),
            "provinsi":   prov,
        })

    work       = [o for o in officials if o["pejabat_id"] not in existing_ids]
    skip_count = len(officials) - len(work)

    print(f"Model: {GLM_MODEL} (extraction only)  |  Search: Zhipu web-search API")
    print(f"Officials: {len(officials)} total, {skip_count} skipped, {len(work)} to screen")
    if args.dry_run:
        print("DRY RUN — no DB writes")
    print()

    found_total = error_total = 0

    with httpx.Client(timeout=30) as db_client:
        for i, o in enumerate(work, 1):
            print(f"[{i}/{len(work)}] {o['nama']} ({o['jabatan']}, {o['provinsi']})", end=" ... ", flush=True)

            result = screen(base_url, api_key, o["nama"], o["jabatan"], o["provinsi"])

            if "error" in result:
                print(f"ERROR: {result['error']}")
                error_total += 1
                if log_path:
                    with open(log_path, "a", encoding="utf-8") as lf:
                        lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")
                time.sleep(1)
                continue

            has_record = result.get("has_record", False)
            keyakinan  = result.get("keyakinan", "rendah")
            reason     = result.get("_reason", "")

            if log_path:
                with open(log_path, "a", encoding="utf-8") as lf:
                    lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")

            # Reject FOUND with no url_sumber — model made it up
            if has_record and not result.get("url_sumber"):
                print(f"no-url (FOUND but no source — treating as bersih)")
                upsert_screened(db_client, o["pejabat_id"], "bersih_glm", keyakinan, args.dry_run)
                time.sleep(1)
                continue

            if not has_record or not result.get("status"):
                suffix = f" [{reason}]" if reason else f" ({keyakinan})"
                print(f"bersih{suffix}")
                upsert_screened(db_client, o["pejabat_id"], "bersih_glm", keyakinan, args.dry_run)
                time.sleep(1)
                continue

            kasus_row = {
                "pejabat_id": o["pejabat_id"],
                "status":     result.get("status"),
                "jenis":      result.get("jenis"),
                "lembaga":    result.get("lembaga"),
                "tahun":      result.get("tahun"),
                "ringkasan":  result.get("ringkasan"),
                "url_sumber": result.get("url_sumber"),
            }
            kasus_row = {k: v for k, v in kasus_row.items() if v is not None}

            ok = insert_kasus(db_client, kasus_row, args.dry_run)
            marker = "FOUND" + (" (dry)" if args.dry_run else "")
            print(f"{marker}  [{keyakinan}]  {result.get('lembaga','-')} {result.get('status','-')} {result.get('tahun','-')}")
            ring = (result.get("ringkasan") or "")[:80]
            if ring:
                print(f"    {ring}")
            if result.get("url_sumber"):
                print(f"    {result['url_sumber'][:90]}")
            if ok:
                found_total += 1

            time.sleep(1)

    print(f"\nDone. {found_total} kasus inserted, {error_total} errors, {len(work) - found_total - error_total} bersih.")
    if args.dry_run:
        print("(dry-run — nothing written to DB)")
    if log_path:
        print(f"Full log: {log_path}")
    print("\nNext: run verify_kasus.py to confirm/reject GLM-found cases.")


if __name__ == "__main__":
    main()
