#!/usr/bin/env python3
"""
Cheap first-pass corruption screener using GLM-4.7-Flash (free) + search_pro_jina.

High-recall design: flags anything that looks suspicious so verify_kasus.py
(Kimi thinking) can do the quality gate. False positives are fine here.

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

Cost: GLM-4.7-Flash is FREE. Only web search calls may have cost (TBD from Zhipu).
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

# ─── GLM config ──────────────────────────────────────────────────────────────

GLM_MODEL = "glm-4.7-flash"

def _glm_creds() -> tuple[str, str]:
    with open(ROOT / "config.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for p in cfg.get("llm_providers", []):
        if p["name"] == "zhipu":
            base_url = p.get("base_url", "https://api.z.ai/api/coding/paas/v4")
            api_key  = os.getenv(p.get("api_key_env", "ZHIPUAI_API_KEY"), "")
            return base_url, api_key
    raise RuntimeError("zhipu provider not found in config.yaml")

# ─── Prompts ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
Kamu adalah asisten riset antikorupsi Indonesia yang bertugas melakukan screening awal.
Tugasmu: gunakan web search untuk mencari apakah pejabat yang disebutkan PERNAH terlibat
kasus korupsi, suap, gratifikasi, atau tipikor.

Aturan WAJIB:
- HARUS gunakan web search terlebih dahulu sebelum menjawab.
- has_record hanya boleh true jika kamu menemukan artikel/sumber nyata dari hasil web search.
- WAJIB isi url_sumber dengan URL artikel yang kamu temukan. Jika tidak ada URL konkret
  dari hasil pencarian, set has_record=false — JANGAN mengarang.
- Jangan mengandalkan pengetahuan internal — hanya laporkan apa yang ditemukan web search.
- Kembalikan JSON murni saja, tanpa teks lain.

Format output:
{
  "has_record": true | false,
  "status": "tersangka" | "terdakwa" | "terpidana" | "diselidiki" | null,
  "jenis": "korupsi" | "suap" | "gratifikasi" | "pencucian_uang" | "lainnya" | null,
  "lembaga": "KPK" | "Kejagung" | "Kejati" | "Polda" | "lainnya" | null,
  "tahun": <integer> | null,
  "ringkasan": "<1-2 kalimat ringkasan dari artikel yang ditemukan>" | null,
  "url_sumber": "<URL artikel nyata dari web search — WAJIB jika has_record=true>" | null,
  "keyakinan": "tinggi" | "sedang" | "rendah"
}\
"""

USER_PROMPT_TEMPLATE = (
    "Cari rekam jejak korupsi {nama}, {jabatan} di {provinsi}. "
    "Apakah ada kasus korupsi, suap, tipikor, atau penyelidikan yang melibatkan beliau? "
    "Cari juga dengan nama tanpa gelar."
)

# ─── GLM search call ──────────────────────────────────────────────────────────

def glm_screen(
    base_url: str, api_key: str,
    nama: str, jabatan: str, provinsi: str,
    timeout: int = 90,
) -> dict:
    """Single GLM call with search_pro_jina web search. Returns parsed JSON or {"error": ...}."""
    prompt = USER_PROMPT_TEMPLATE.format(nama=nama, jabatan=jabatan, provinsi=provinsi)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]
    tools = [{"type": "web_search", "web_search": {"search_engine": "search_pro_jina", "search_query": f"korupsi tipikor {nama} {jabatan} {provinsi}"}}]

    with httpx.Client(timeout=timeout) as client:
        for _ in range(6):
            try:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    json={
                        "model":    GLM_MODEL,
                        "messages": messages,
                        "tools":    tools,
                        "thinking": {"type": "disabled"},
                    },
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type":  "application/json",
                    },
                )
            except httpx.TimeoutException:
                return {"error": "request timed out"}
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

            data    = resp.json()
            choice  = data["choices"][0]
            message = choice["message"]

            if choice["finish_reason"] == "tool_calls":
                messages.append(message)
                for tc in message.get("tool_calls", []):
                    messages.append({
                        "role":         "tool",
                        "tool_call_id": tc["id"],
                        "name":         tc["function"]["name"],
                        "content":      tc["function"]["arguments"],
                    })
            else:
                content = (message.get("content") or "").strip()
                content = re.sub(r"^```[a-z]*\n?", "", content)
                content = re.sub(r"\n?```$", "", content.strip())
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    messages.append(message)
                    messages.append({
                        "role": "user",
                        "content": "Kembalikan HANYA JSON murni sesuai format, tanpa teks lain.",
                    })

    return {"error": "max tool-call rounds exceeded"}

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
        "pejabat_id":      pejabat_id,
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
    parser.add_argument("--provinsi",             help="Filter to a single province")
    parser.add_argument("--resume",               action="store_true",
                        help="Skip pejabat with kasus + recently screened (≤30 days)")
    parser.add_argument("--rescreen-after-days",  type=int, default=30)
    parser.add_argument("--dry-run",              action="store_true")
    parser.add_argument("--log",                  action="store_true",
                        help="Append JSON results to scripts/kasus_screen_glm.log")
    args = parser.parse_args()

    base_url, api_key = _glm_creds()
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
            kasus_rows    = fetch_all(client, "kasus", "pejabat_id")
            existing_ids  = {r["pejabat_id"] for r in kasus_rows}

            from datetime import datetime, timedelta, timezone
            cutoff = datetime.now(timezone.utc) - timedelta(days=args.rescreen_after_days)
            screened_rows = fetch_all(client, "kasus_screened", "pejabat_id,last_screened_at")
            fresh = {
                r["pejabat_id"] for r in screened_rows
                if datetime.fromisoformat(r["last_screened_at"].replace("Z", "+00:00")) >= cutoff
            }
            existing_ids |= fresh
            print(
                f"Resume: {len(kasus_rows)} with kasus + {len(fresh)} screened "
                f"in last {args.rescreen_after_days} days ({len(existing_ids)} unique skipped)"
            )

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

    print(f"Model: {GLM_MODEL}  |  base: {base_url}")
    print(f"Officials: {len(officials)} total, {skip_count} skipped, {len(work)} to screen")
    if args.dry_run:
        print("DRY RUN — no DB writes")
    print()

    found_total = error_total = 0

    with httpx.Client(timeout=30) as db_client:
        for i, o in enumerate(work, 1):
            label = f"[{i}/{len(work)}] {o['nama']} ({o['jabatan']}, {o['provinsi']})"
            print(label, end=" ... ", flush=True)

            result = glm_screen(base_url, api_key, o["nama"], o["jabatan"], o["provinsi"])

            if "error" in result:
                print(f"ERROR: {result['error']}")
                error_total += 1
                if log_path:
                    with open(log_path, "a", encoding="utf-8") as lf:
                        lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")
                # Don't write to kasus_screened on error — resume will retry
                time.sleep(1)
                continue

            has_record = result.get("has_record", False)
            keyakinan  = result.get("keyakinan", "rendah")

            if log_path:
                with open(log_path, "a", encoding="utf-8") as lf:
                    lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")

            # Require url_sumber for any FOUND — no URL = hallucination, treat as bersih
            if not has_record or not result.get("status") or not result.get("url_sumber"):
                if has_record and not result.get("url_sumber"):
                    print(f"no-url (flagged but no source — treating as bersih)")
                else:
                    label = "bersih" if not has_record else "tidak terbukti (no status)"
                    print(f"{label} ({keyakinan})")
                upsert_screened(db_client, o["pejabat_id"], "bersih_glm", keyakinan, args.dry_run)
                time.sleep(1)
                continue

            # Insert to kasus — verified=null so verify_kasus.py picks it up
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
            # Don't log to kasus_screened — pejabat is in kasus table, resume skips them
            marker = "FOUND" + (" (dry)" if args.dry_run else "")
            print(f"{marker}  [{keyakinan}]  {result.get('lembaga', '-')} {result.get('status', '-')} {result.get('tahun', '-')}")
            ring = (result.get("ringkasan") or "")[:80]
            if ring:
                print(f"    {ring}")
            if ok:
                found_total += 1

            time.sleep(1)

    print(f"\nDone. {found_total} kasus inserted, {error_total} errors, {len(work) - found_total - error_total} bersih.")
    if args.dry_run:
        print("(dry-run — nothing written to DB)")
    if log_path:
        print(f"Full log: {log_path}")
    print("\nNext step: run verify_kasus.py to confirm/reject GLM-found cases.")


if __name__ == "__main__":
    main()
