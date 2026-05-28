#!/usr/bin/env python3
"""
Screen all pejabat for corruption records using Kimi built-in web search.
Auto-upserts confirmed cases directly to Supabase kasus table — no manual CSV step.

Usage:
  python scripts/screen_kasus_llm.py                     # all pejabat
  python scripts/screen_kasus_llm.py --provinsi "Aceh"   # single province
  python scripts/screen_kasus_llm.py --resume             # skip pejabat with kasus + recently screened (≤30 days)
  python scripts/screen_kasus_llm.py --resume --rescreen-after-days 60  # custom freshness window
  python scripts/screen_kasus_llm.py --dry-run            # print only, no DB writes
  python scripts/screen_kasus_llm.py --log                # append results to kasus_screen.log

Cost: ~$0.005 per search call × ~1,215 officials ≈ ~$6 total.
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

# Force UTF-8 output on Windows
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

# ─── Kimi config ─────────────────────────────────────────────────────────────

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

# ─── Prompts ─────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
Kamu adalah asisten riset antikorupsi Indonesia. \
Tugasmu: cari informasi kasus korupsi pejabat yang disebutkan, lalu jawab dengan JSON.

Aturan KETAT:
- Gunakan web search untuk mencari informasi terkini.
- Hanya laporkan kasus jika nama pejabat DISEBUTKAN EKSPLISIT sebagai tersangka/terdakwa/terpidana.
- Jangan laporkan jika mereka hanya saksi atau tidak terlibat langsung.
- Kembalikan JSON murni saja, tanpa teks lain.

Format output:
{
  "has_record": true | false,
  "status": "tersangka" | "terdakwa" | "terpidana" | null,
  "jenis": "korupsi" | "suap" | "gratifikasi" | "pencucian_uang" | "lainnya" | null,
  "lembaga": "KPK" | "Kejagung" | "Kejati" | "Pengadilan Tipikor" | null,
  "tahun": <integer> | null,
  "ringkasan": "<1-2 kalimat>" | null,
  "url_sumber": "<URL artikel>" | null,
  "keyakinan": "tinggi" | "sedang" | "rendah"
}\
"""

USER_PROMPT_TEMPLATE = (
    "Cari riwayat korupsi {nama}, {jabatan} {provinsi}. "
    "Apakah ada kasus korupsi atau tipikor yang melibatkan beliau?"
)

# ─── Kimi search ─────────────────────────────────────────────────────────────

def kimi_search(
    base_url: str, model: str, api_key: str,
    nama: str, jabatan: str, provinsi: str,
    timeout: int = 120,
) -> dict:
    """Single Kimi call with $web_search builtin. Returns parsed JSON or {"error": ...}."""
    prompt = USER_PROMPT_TEMPLATE.format(nama=nama, jabatan=jabatan, provinsi=provinsi)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": prompt},
    ]
    tools = [{"type": "builtin_function", "function": {"name": "$web_search"}}]

    with httpx.Client(timeout=timeout) as client:
        for _ in range(6):  # max 6 tool-call rounds
            try:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    json={
                        "model":    model,
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
                    # One retry: ask model to output JSON only
                    messages.append(message)
                    messages.append({
                        "role": "user",
                        "content": "Kembalikan HANYA JSON murni sesuai format, tanpa teks lain.",
                    })
                    # continue the loop for one more round

    return {"error": "max tool-call rounds exceeded"}

# ─── Supabase helpers ─────────────────────────────────────────────────────────

def fetch_all(client: httpx.Client, table: str, select: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        resp = client.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            params={"select": select, "limit": 1000, "offset": offset},
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
    """Insert one row into kasus table. Returns True on success."""
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
    """Record that this pejabat was screened — used for resume logic."""
    if dry_run:
        return
    row = {
        "pejabat_id": pejabat_id,
        "last_screened_at": "now()",
        "last_result": result,
        "last_keyakinan": keyakinan,
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
    parser.add_argument("--provinsi", help="Filter to a single province")
    parser.add_argument("--resume",   action="store_true",
                        help="Skip pejabat screened within --rescreen-after-days; always skip pejabat with confirmed kasus")
    parser.add_argument("--rescreen-after-days", type=int, default=30,
                        help="When --resume is set, re-screen pejabat last screened more than N days ago (default: 30)")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Print findings without writing to DB")
    parser.add_argument("--log",      action="store_true",
                        help="Append JSON results to scripts/kasus_screen.log")
    args = parser.parse_args()

    base_url, model, api_key = _kimi_creds()
    if not api_key:
        print("ERROR: MOONSHOT_API_KEY not set in .env")
        sys.exit(1)

    log_path = ROOT / "scripts" / "kasus_screen.log" if args.log else None

    with httpx.Client(timeout=60) as client:
        pejabat_rows = fetch_all(client, "pejabat", "id,nama_lengkap,gelar_depan,gelar_belakang")
        jabatan_rows = fetch_all(client, "jabatan", "pejabat_id,posisi,wilayah_id")
        wilayah_rows = fetch_all(client, "wilayah", "id,nama,level,parent_id")

        # Resume: skip pejabat with confirmed kasus, AND pejabat screened within freshness window
        existing_ids: set[str] = set()
        if args.resume:
            # Always skip anyone with a confirmed kasus row
            kasus_rows = fetch_all(client, "kasus", "pejabat_id")
            existing_ids = {r["pejabat_id"] for r in kasus_rows}

            # Also skip anyone screened recently (regardless of outcome)
            from datetime import datetime, timedelta, timezone
            cutoff = datetime.now(timezone.utc) - timedelta(days=args.rescreen_after_days)
            screened_rows = fetch_all(client, "kasus_screened", "pejabat_id,last_screened_at")
            fresh_screened = {
                r["pejabat_id"] for r in screened_rows
                if datetime.fromisoformat(r["last_screened_at"].replace("Z", "+00:00")) >= cutoff
            }
            existing_ids |= fresh_screened
            print(
                f"Resume: {len(kasus_rows)} pejabat with kasus + "
                f"{len(fresh_screened)} screened in last {args.rescreen_after_days} days — will skip "
                f"({len(existing_ids)} unique)"
            )

    # Build lookup structures
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

    # Build work list
    officials: list[dict] = []
    for p in pejabat_rows:
        j = first_jabatan.get(p["id"], {})
        prov = province_name(j.get("wilayah_id"))
        if args.provinsi and prov != args.provinsi:
            continue
        gelar_depan = (p.get("gelar_depan") or "").strip()
        gelar_belakang = (p.get("gelar_belakang") or "").strip()
        full_name = " ".join(filter(None, [gelar_depan, p["nama_lengkap"].strip(), gelar_belakang]))
        officials.append({
            "pejabat_id": p["id"],
            "nama":       full_name,
            "jabatan":    (j.get("posisi") or "").strip(),
            "provinsi":   prov,
        })

    skip_count = sum(1 for o in officials if o["pejabat_id"] in existing_ids)
    work = [o for o in officials if o["pejabat_id"] not in existing_ids]

    print(f"Model: {model}  |  base: {base_url}")
    print(f"Officials: {len(officials)} total, {skip_count} skipped (resume), {len(work)} to screen")
    if args.dry_run:
        print("DRY RUN — no DB writes")
    print()

    found_total = 0
    error_total = 0

    with httpx.Client(timeout=30) as db_client:
        for i, o in enumerate(work, 1):
            label = f"[{i}/{len(work)}] {o['nama']} ({o['jabatan']}, {o['provinsi']})"
            print(label, end=" ... ", flush=True)

            result = kimi_search(base_url, model, api_key, o["nama"], o["jabatan"], o["provinsi"])

            if "error" in result:
                print(f"ERROR: {result['error']}")
                error_total += 1
                if log_path:
                    with open(log_path, "a", encoding="utf-8") as lf:
                        lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")
                time.sleep(2)
                continue

            has_record = result.get("has_record", False)
            keyakinan  = result.get("keyakinan", "rendah")

            if log_path:
                with open(log_path, "a", encoding="utf-8") as lf:
                    lf.write(json.dumps({"pejabat_id": o["pejabat_id"], "nama": o["nama"], **result}, ensure_ascii=False) + "\n")

            # Require explicit formal status — skip "disebut-sebut" mentions without charge
            if not has_record or not result.get("status"):
                label = "bersih" if not has_record else "tidak terbukti (no status)"
                print(f"{label} ({keyakinan})")
                upsert_screened(db_client, o["pejabat_id"], "bersih", keyakinan, args.dry_run)
                time.sleep(2)
                continue

            # Build kasus row
            kasus_row = {
                "pejabat_id": o["pejabat_id"],
                "status":     result.get("status"),
                "jenis":      result.get("jenis"),
                "lembaga":    result.get("lembaga"),
                "tahun":      result.get("tahun"),
                "ringkasan":  result.get("ringkasan"),
                "url_sumber": result.get("url_sumber"),
            }
            # Strip None values
            kasus_row = {k: v for k, v in kasus_row.items() if v is not None}

            ok = insert_kasus(db_client, kasus_row, args.dry_run)
            upsert_screened(db_client, o["pejabat_id"], "found", keyakinan, args.dry_run)
            marker = "FOUND" + (" (dry)" if args.dry_run else "")
            lbg    = result.get("lembaga") or "-"
            status = result.get("status") or "-"
            tahun  = result.get("tahun") or "-"
            ring   = (result.get("ringkasan") or "")[:80]
            print(f"{marker}  [{keyakinan}]  {lbg} {status} {tahun}")
            if ring:
                print(f"    {ring}")
            if ok:
                found_total += 1

            time.sleep(3)  # slightly longer pause after writes

    print(f"\nDone. {found_total} kasus inserted, {error_total} errors, {len(work) - found_total - error_total} bersih.")
    if args.dry_run:
        print("(dry-run — nothing written to DB)")
    if log_path:
        print(f"Full log: {log_path}")


if __name__ == "__main__":
    main()
