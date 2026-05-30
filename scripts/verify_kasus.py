#!/usr/bin/env python3
"""
Verify kasus records using Kimi with thinking mode.
Fetches unverified rows from kasus table, cross-checks against official sources,
and marks each as verified=true (confirmed) or verified=false (rejected).

Usage:
  python scripts/verify_kasus.py              # all unverified rows
  python scripts/verify_kasus.py --dry-run    # print verdicts without writing
  python scripts/verify_kasus.py --all        # re-verify all rows (incl. already verified)
  python scripts/verify_kasus.py --report-suspicious-rejects
                                              # audit-only: list rejected rows whose
                                              # note suggests the kasus is actually real
                                              # (likely a field mismatch like wrong lembaga)

Cost: ~$0.03-0.05 per call (thinking mode) × number of kasus rows.
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

# ─── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SB_HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


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
Kamu adalah verifikator fakta antikorupsi Indonesia yang ketat. \
Tugasmu: verifikasi apakah seseorang BENAR-BENAR berstatus tersangka/terdakwa/terpidana \
dalam kasus korupsi — bukan sekadar dituduh, disebut, atau diisukan.

Standar verifikasi KETAT:
- Sumber valid: kpk.go.id, sipp.mahkamahagung.go.id, Kejagung, Kejati, \
  atau media besar (Tempo/Kompas/Detik) dengan kata kunci eksplisit "ditetapkan tersangka" / \
  "didakwa" / "divonis" / "terpidana".
- TOLAK jika: hanya dituduh oleh saksi lain, hanya disebut-sebut, \
  hanya terindikasi tapi tidak ditetapkan, atau kasusnya sudah SP3/bebas.
- TOLAK jika sumber tidak dapat diverifikasi atau URL tidak valid.

Kembalikan JSON murni saja:
{
  "verified": true | false,
  "confidence": "tinggi" | "sedang" | "rendah",
  "note": "<1-2 kalimat alasan keputusan>",
  "url_confirmed": "<URL sumber paling kuat yang mengkonfirmasi, atau null>"
}\
"""

USER_PROMPT_TEMPLATE = """\
Verifikasi kasus ini:
- Nama: {nama}
- Jabatan: {jabatan}
- Status diklaim: {status}
- Lembaga diklaim: {lembaga}
- Tahun diklaim: {tahun}
- Ringkasan: {ringkasan}

PENTING: Kamu memverifikasi {nama} yang menjabat sebagai {jabatan}, BUKAN orang lain \
yang kebetulan memiliki nama yang sama. Cari bukti konkret bahwa {nama} ({jabatan}) \
BENAR-BENAR ditetapkan sebagai {status} \
(bukan sekadar dituduh atau disebut) dalam kasus korupsi oleh {lembaga}.\
"""

# ─── Kimi verify call ─────────────────────────────────────────────────────────

def kimi_verify(
    base_url: str, model: str, api_key: str,
    nama: str, jabatan: str, status: str, lembaga: str, tahun: int | None, ringkasan: str | None,
    timeout: int = 180,
) -> dict:
    """Call Kimi with thinking + web search to verify a single kasus. Returns parsed JSON or {"error": ...}."""
    from datetime import date
    today = date.today().strftime("%-d %B %Y")  # e.g. "30 Mei 2026"
    prompt = USER_PROMPT_TEMPLATE.format(
        nama=nama,
        jabatan=jabatan or "pejabat",
        status=status or "tersangka",
        lembaga=lembaga or "KPK/Kejagung",
        tahun=tahun or "tidak diketahui",
        ringkasan=ringkasan or "-",
    )
    system = f"Hari ini tanggal {today}. Kasus yang terjadi sebelum tanggal ini adalah nyata dan valid untuk diverifikasi.\n\n{SYSTEM_PROMPT}"
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": prompt},
    ]
    tools = [{"type": "builtin_function", "function": {"name": "$web_search"}}]

    with httpx.Client(timeout=timeout) as client:
        for _ in range(8):  # thinking + web search may need more rounds
            try:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    json={
                        "model":    model,
                        "messages": messages,
                        "tools":    tools,
                        "thinking": {"type": "enabled", "budget_tokens": 3000},
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
                # Kimi thinking mode requires reasoning_content preserved in history
                msg_to_append = dict(message)
                if "reasoning_content" not in msg_to_append:
                    msg_to_append["reasoning_content"] = ""
                messages.append(msg_to_append)
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
                    # Retry: ask for JSON only
                    messages.append(message)
                    messages.append({
                        "role": "user",
                        "content": "Kembalikan HANYA JSON murni sesuai format, tanpa teks lain.",
                    })

    return {"error": "max rounds exceeded"}

# ─── Supabase helpers ─────────────────────────────────────────────────────────

def fetch_all(client: httpx.Client, table: str, select: str, filters: dict | None = None) -> list[dict]:
    rows, offset = [], 0
    params: dict = {"select": select, "limit": 1000, "offset": offset}
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


def update_kasus(client: httpx.Client, kasus_id: str, patch: dict, dry_run: bool) -> bool:
    if dry_run:
        return True
    resp = client.patch(
        f"{SUPABASE_URL}/rest/v1/kasus",
        params={"kasus_id": f"eq.{kasus_id}"},
        json=patch,
        headers={**SB_HEADERS, "Prefer": "return=minimal"},
    )
    if resp.status_code in (200, 204):
        return True
    print(f"    DB ERROR {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False

# ─── Suspicious-rejects audit ─────────────────────────────────────────────────

# Words that, when found in verified_note of a rejected row, suggest the verifier
# actually confirmed the kasus but rejected on a field mismatch (lembaga/tahun/jabatan).
AFFIRMATIVE_KEYWORDS = (
    "terverifikasi", "terbukti", "terkonfirmasi",
    "secara resmi", "resmi ditetapkan",
    "confirmed", "divonis", "terpidana",
)


def report_suspicious_rejects() -> None:
    """List verified=false rows whose note contains affirmative language or a real URL."""
    with httpx.Client(timeout=30) as client:
        rejected = fetch_all(client, "kasus", "*", {"verified": "is.false"})
        pejabat_all = fetch_all(client, "pejabat", "id,nama_lengkap")
    name_map = {p["id"]: p["nama_lengkap"] for p in pejabat_all}

    suspicious = []
    for row in rejected:
        note = (row.get("verified_note") or "").lower()
        if any(kw in note for kw in AFFIRMATIVE_KEYWORDS):
            suspicious.append(row)

    print(f"Rejected rows: {len(rejected)}  |  Suspicious (note contains affirmative language): {len(suspicious)}\n")
    if not suspicious:
        print("Nothing to review.")
        return

    for row in suspicious:
        nama = name_map.get(row["pejabat_id"], row["pejabat_id"])
        print(f"[{row['kasus_id']}]  {nama}")
        print(f"  status={row.get('status')}  lembaga={row.get('lembaga')}  tahun={row.get('tahun')}")
        print(f"  note: {(row.get('verified_note') or '')[:300]}")
        print()
    print("If a row looks like a real kasus rejected on field mismatch, fix with:")
    print("  UPDATE kasus SET lembaga='...', verified=true, verified_note='...' WHERE kasus_id='...';")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print verdicts without writing to DB")
    parser.add_argument("--all",     action="store_true", help="Re-verify all rows, not just unverified")
    parser.add_argument("--report-suspicious-rejects", action="store_true",
                        help="Audit-only: list verified=false rows whose note suggests the kasus is real")
    args = parser.parse_args()

    if args.report_suspicious_rejects:
        report_suspicious_rejects()
        return

    base_url, model, api_key = _kimi_creds()
    if not api_key:
        print("ERROR: MOONSHOT_API_KEY not set in .env")
        sys.exit(1)

    with httpx.Client(timeout=60) as client:
        filters = {} if args.all else {"verified": "is.null"}
        kasus_rows = fetch_all(client, "kasus", "*", filters)

        # Fetch pejabat names + jabatan context (posisi + provinsi) to disambiguate common names
        pejabat_all  = fetch_all(client, "pejabat", "id,nama_lengkap,gelar_depan,gelar_belakang")
        jabatan_all  = fetch_all(client, "jabatan", "pejabat_id,posisi,wilayah_id")
        wilayah_all  = fetch_all(client, "wilayah", "id,nama,level,parent_id")

        pejabat_map: dict[str, str] = {}
        for p in pejabat_all:
            gelar_depan   = (p.get("gelar_depan") or "").strip()
            gelar_belakang = (p.get("gelar_belakang") or "").strip()
            pejabat_map[p["id"]] = " ".join(filter(None, [gelar_depan, p["nama_lengkap"].strip(), gelar_belakang]))

        wilayah_by_id = {w["id"]: w for w in wilayah_all}

        def province_of(wilayah_id: str) -> str:
            w = wilayah_by_id.get(wilayah_id)
            if not w:
                return ""
            if w["level"] == "provinsi":
                return w["nama"]
            parent = wilayah_by_id.get(w.get("parent_id") or "")
            return parent["nama"] if parent and parent["level"] == "provinsi" else ""

        # First jabatan per pejabat → "Wakil Bupati Sragen, Jawa Tengah"
        jabatan_map: dict[str, str] = {}
        for j in jabatan_all:
            pid = j["pejabat_id"]
            if pid in jabatan_map:
                continue
            prov = province_of(j["wilayah_id"])
            jabatan_map[pid] = ", ".join(filter(None, [j.get("posisi") or "", prov]))

    print(f"Model: {model} (thinking enabled)  |  base: {base_url}")
    print(f"Rows to verify: {len(kasus_rows)}")
    if args.dry_run:
        print("DRY RUN — no DB writes")
    print()

    confirmed = rejected = errors = 0

    with httpx.Client(timeout=30) as db_client:
        for i, row in enumerate(kasus_rows, 1):
            nama    = pejabat_map.get(row["pejabat_id"], row["pejabat_id"])
            jabatan = jabatan_map.get(row["pejabat_id"], "")
            status  = row.get("status") or "tersangka"
            lbg     = row.get("lembaga") or "KPK"
            tahun   = row.get("tahun")
            ring    = row.get("ringkasan")

            print(f"[{i}/{len(kasus_rows)}] {nama}  ({jabatan})  ({status}, {lbg}, {tahun})", end=" ... ", flush=True)

            result = kimi_verify(base_url, model, api_key, nama, jabatan, status, lbg, tahun, ring)

            if "error" in result:
                print(f"ERROR: {result['error']}")
                errors += 1
                time.sleep(3)
                continue

            verdict    = result.get("verified", False)
            confidence = result.get("confidence", "?")
            note       = result.get("note", "")
            url_conf   = result.get("url_confirmed")

            marker = "CONFIRMED" if verdict else "REJECTED"
            print(f"{marker}  [{confidence}]")
            if note:
                print(f"    {note[:120]}")
            if url_conf:
                print(f"    {url_conf[:100]}")

            patch = {
                "verified":      verdict,
                "verified_at":   "now()",
                "verified_note": note,
            }
            # If confirmed with a better source URL, update it
            if verdict and url_conf:
                patch["url_sumber"] = url_conf

            update_kasus(db_client, row["kasus_id"], patch, args.dry_run)

            if verdict:
                confirmed += 1
            else:
                rejected += 1

            time.sleep(4)  # thinking mode needs more breathing room

    print(f"\nDone. {confirmed} confirmed, {rejected} rejected, {errors} errors.")
    if rejected > 0:
        print("Rejected rows have verified=false and are hidden from public pages.")
    if args.dry_run:
        print("(dry-run — nothing written to DB)")


if __name__ == "__main__":
    main()
