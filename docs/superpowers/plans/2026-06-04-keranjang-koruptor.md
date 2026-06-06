# Keranjang Koruptor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `/keranjang-koruptor` page listing every official in our DB arrested for corruption during the Prabowo era (≥ 2024-10-20), backed by a new `tanggal_kasus` date column wired through the screening flow, plus a one-off data op for the 3 BGN arrests + the Dadan→Nanik succession.

**Architecture:** Add a nullable `tanggal_kasus DATE` to `kasus`; thread it through the CSV export/import routes, the AI prompt, and both Python writers (`import_kasus.py`, `screen_kasus_llm.py`). The Keranjang page is a server page + client shell mirroring `/pulse`, reading a new `listKeranjangKoruptor()` query (verified + date ≥ cutoff). Succession uses the existing `jabatan` status/`selesai_jabatan` mechanics via a parameterized one-off script.

**Tech Stack:** Postgres/Supabase (PostgREST), Next.js 16 (App Router) + React 19, TypeScript, Python 3.11 (httpx).

> ⚠️ **Next.js note:** `web/AGENTS.md` warns this Next.js has breaking changes vs training data. Before writing any route/page code, read the relevant guide in `web/node_modules/next/dist/docs/`. `params`/`searchParams` are Promises — `await` them.

> ⚠️ **No fabrication:** Task 9 (BGN) needs real post-cutoff facts (names, dates, sources, Nanik's Plt/definitif status). These are runtime inputs the user supplies — do NOT invent them.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/016_kasus_tanggal.sql` | Add `tanggal_kasus` column + index | Create |
| `web/lib/types.ts` | `KasusRow.tanggal_kasus`; new `KeranjangKoruptorRow` | Modify |
| `web/lib/queries.ts` | `getKasusByPejabat` ordering; new `listKeranjangKoruptor()` | Modify |
| `web/app/api/admin/export-kasus-csv/route.ts` | Add `tanggal_kasus` CSV column | Modify |
| `web/app/api/admin/import-kasus-csv/route.ts` | Parse + persist `tanggal_kasus` | Modify |
| `web/app/admin/rekam-bersih/page.tsx` | Add `tanggal_kasus` to the AI prompt | Modify |
| `scripts/import_kasus.py` | Parse + persist `tanggal_kasus` (CLI) | Modify |
| `scripts/screen_kasus_llm.py` | Add `tanggal_kasus` to prompt JSON + insert row | Modify |
| `scripts/seed_bgn.py` | One-off: BGN pejabat+jabatan+kasus+succession | Create |
| `web/app/keranjang-koruptor/page.tsx` | Server page (data fetch) | Create |
| `web/app/keranjang-koruptor/KeranjangShell.tsx` | Client UI (frontend-design) | Create |
| `web/app/_components/HomeShell.tsx` | Add nav link to Keranjang | Modify |
| `CLAUDE.md` | Record succession-refresh backlog item | Modify |

---

## Task 1: Migration — `tanggal_kasus` column

**Files:**
- Create: `supabase/migrations/016_kasus_tanggal.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/016_kasus_tanggal.sql
-- Precise case date (penetapan tersangka / OTT). Nullable: older cases may only
-- have a year. Enables the Prabowo-era filter (>= 2024-10-20) for Keranjang Koruptor.
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS tanggal_kasus DATE;
CREATE INDEX IF NOT EXISTS idx_kasus_tanggal ON kasus(tanggal_kasus);
```

- [ ] **Step 2: Apply it**

Apply via the Supabase SQL editor (paste the file) or `supabase db push`. (Matches how migrations 013–015 were applied.)

- [ ] **Step 3: Verify the column exists**

Run from repo root (uses `.env`):
```bash
python -c "import os,httpx; from dotenv import load_dotenv; load_dotenv(); u=os.environ.get('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL']; k=os.environ['SUPABASE_SERVICE_ROLE_KEY']; r=httpx.get(f'{u}/rest/v1/kasus',params={'select':'kasus_id,tanggal_kasus','limit':'1'},headers={'apikey':k,'Authorization':f'Bearer {k}'}); print(r.status_code, r.text[:200])"
```
Expected: `200` and JSON containing `tanggal_kasus` (value may be `null`). A `42703`/`column ... does not exist` error means the migration was not applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_kasus_tanggal.sql
git commit -m "feat(db): add kasus.tanggal_kasus for Prabowo-era filtering"
```

---

## Task 2: Type + read-ordering for `tanggal_kasus`

**Files:**
- Modify: `web/lib/types.ts:182-195` (`KasusRow`)
- Modify: `web/lib/queries.ts:640-649` (`getKasusByPejabat`)

- [ ] **Step 1: Add the field to `KasusRow`**

In `web/lib/types.ts`, inside `interface KasusRow`, add after the `tahun` line:
```ts
  tahun: number | null
  tanggal_kasus: string | null
```

- [ ] **Step 2: Order profile cases by precise date first**

In `web/lib/queries.ts`, replace the `.order('tahun', ...)` line in `getKasusByPejabat`:
```ts
    .eq('verified', true)
    .order('tanggal_kasus', { ascending: false, nullsFirst: false })
    .order('tahun', { ascending: false })
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors referencing `tanggal_kasus`, `KasusRow`, or `queries.ts`.

- [ ] **Step 4: Commit**

```bash
git add web/lib/types.ts web/lib/queries.ts
git commit -m "feat(web): KasusRow.tanggal_kasus + date-first ordering in getKasusByPejabat"
```

---

## Task 3: CSV export route — add `tanggal_kasus` column

**Files:**
- Modify: `web/app/api/admin/export-kasus-csv/route.ts:8` (header), `:134` and `:239` (placeholder rows)

- [ ] **Step 1: Add the column to the header**

Replace line 8:
```ts
const CSV_HEADER = 'pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,tanggal_kasus,ringkasan,url_sumber,keyakinan'
```

- [ ] **Step 2: Add one empty field to the Pusat row builder**

In `handlePusatExport`, the `csvRow([...])` call currently has 8 trailing `''`. Add one more so the row has 13 fields (matching the new header):
```ts
    lines.push(csvRow([c.id, c.nama, c.posisi, 'Pusat', '', '', '', '', '', '', '', '', '']))
```

- [ ] **Step 3: Add one empty field to the province row builder**

In the `GET` province path, update the `csvRow([...])` call the same way:
```ts
    lines.push(csvRow([id, nama, jabatan, provinsi, '', '', '', '', '', '', '', '', '']))
```

- [ ] **Step 4: Verify column count is consistent**

Run: `cd web && npx tsc --noEmit` (expect clean). Then confirm both `csvRow([...])` arrays now contain 13 entries and the header has 13 comma-separated names (count by eye: `pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,tanggal_kasus,ringkasan,url_sumber,keyakinan`).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/admin/export-kasus-csv/route.ts
git commit -m "feat(web): add tanggal_kasus column to kasus CSV export"
```

---

## Task 4: CSV import route — parse + persist `tanggal_kasus`

**Files:**
- Modify: `web/app/api/admin/import-kasus-csv/route.ts:124-136`

- [ ] **Step 1: Add a date validator near the top of the file**

After the `UUID_RE` constant (line 7), add:
```ts
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
```

- [ ] **Step 2: Parse and attach `tanggal_kasus` in the `kasus_found=1` branch**

In the `isTruthy(kasus_found)` block, after the `url_sumber` line, add the parse; then attach it to `kasusRow` after the `tahun` attach:
```ts
      const url_sumber = (row['url_sumber'] ?? '').trim() || null
      const tanggalRaw = (row['tanggal_kasus'] ?? '').trim()
      const tanggal_kasus = ISO_DATE_RE.test(tanggalRaw) ? tanggalRaw : null

      const kasusRow: Record<string, unknown> = { pejabat_id, status }
      if (jenis && VALID_JENIS.has(jenis)) kasusRow.jenis = jenis
      if (lembaga) kasusRow.lembaga = lembaga
      if (tahun !== null && !isNaN(tahun)) kasusRow.tahun = tahun
      if (tanggal_kasus) kasusRow.tanggal_kasus = tanggal_kasus
      if (ringkasan) kasusRow.ringkasan = ringkasan
      if (url_sumber) kasusRow.url_sumber = url_sumber
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/admin/import-kasus-csv/route.ts
git commit -m "feat(web): persist tanggal_kasus on kasus CSV import (ISO-validated)"
```

---

## Task 5: AI prompt — request the precise date

**Files:**
- Modify: `web/app/admin/rekam-bersih/page.tsx:346-363` (`PROMPT_TEXT`)

- [ ] **Step 1: Add a `tanggal_kasus` bullet after the `tahun` bullet**

In `PROMPT_TEXT`, change the `tahun` line block to include the new field:
```
- tahun: tahun penetapan tersangka/vonis (angka saja)
- tanggal_kasus: tanggal penetapan tersangka/OTT dalam format YYYY-MM-DD (kosongkan jika hanya tahun yang diketahui)
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/rekam-bersih/page.tsx
git commit -m "feat(web): ask AI for tanggal_kasus in rekam-bersih prompt"
```

---

## Task 6: CLI `import_kasus.py` — parse `tanggal_kasus`

**Files:**
- Modify: `scripts/import_kasus.py:1-10` (docstring), `:103-112` (row build)

- [ ] **Step 1: Update the docstring column list**

Change the `Input CSV columns:` line to include `tanggal_kasus`:
```python
Input CSV columns: pejabat_id, jenis, lembaga, status, tahun, tanggal_kasus, ringkasan, url_sumber
```

- [ ] **Step 2: Parse and attach the date in the row builder**

Replace the `kasus_row = {...}` block (lines 103-112):
```python
            tahun_raw = (row.get("tahun") or "").strip()
            import re
            tanggal_raw = (row.get("tanggal_kasus") or "").strip()
            tanggal_kasus = tanggal_raw if re.fullmatch(r"\d{4}-\d{2}-\d{2}", tanggal_raw) else None
            kasus_row = {
                "pejabat_id": pejabat_id,
                "jenis": (row.get("jenis") or "").strip() or None,
                "lembaga": (row.get("lembaga") or "").strip() or None,
                "status": status,
                "tahun": int(tahun_raw) if tahun_raw.isdigit() else None,
                "tanggal_kasus": tanggal_kasus,
                "ringkasan": (row.get("ringkasan") or "").strip() or None,
                "url_sumber": (row.get("url_sumber") or "").strip() or None,
            }
```
(Move `import re` to the top-of-file imports if you prefer — either works.)

- [ ] **Step 3: Verify with a dry run**

Create a one-row test CSV and dry-run it:
```bash
python -c "open('scripts/_t.csv','w',encoding='utf-8').write('pejabat_id,status,tahun,tanggal_kasus\n00000000-0000-0000-0000-000000000000,tersangka,2025,2025-03-10\n')"
python scripts/import_kasus.py scripts/_t.csv --dry-run
```
Expected: prints `[DRY-RUN] Row 1: 00000000-... — tersangka` with no parse error. Then delete: `python -c "import os;os.remove('scripts/_t.csv')"`

- [ ] **Step 4: Commit**

```bash
git add scripts/import_kasus.py
git commit -m "feat(scripts): parse tanggal_kasus in import_kasus.py"
```

---

## Task 7: `screen_kasus_llm.py` — capture the date

**Files:**
- Modify: `scripts/screen_kasus_llm.py` JSON-schema prompt (~line 78) and `kasus_row` build (~line 426-436)

- [ ] **Step 1: Add `tanggal_kasus` to the JSON schema in the prompt**

In the prompt's JSON example, add the field next to `tahun`:
```python
  "tahun": <integer> | null,
  "tanggal_kasus": "<YYYY-MM-DD>" | null,
```
Also add an instruction line in the same prompt (near the rules) so the model fills it:
```
- tanggal_kasus: tanggal penetapan tersangka/OTT (format YYYY-MM-DD), null jika tidak diketahui.
```

- [ ] **Step 2: Attach it to the insert row**

In the `kasus_row = {...}` build (~line 426), add after the `tahun` entry:
```python
        "tahun":      result.get("tahun"),
        "tanggal_kasus": result.get("tanggal_kasus"),
```
(The existing `kasus_row = {k: v for k, v in kasus_row.items() if v is not None}` line already drops it when null — no further change needed.)

- [ ] **Step 3: Verify with a dry run on one official**

Run: `python scripts/screen_kasus_llm.py --provinsi "DKI Jakarta" --dry-run`
Expected: runs without a `KeyError`/JSON error; printed rows are unaffected. (Network/LLM cost applies; keep it to one province.)

- [ ] **Step 4: Commit**

```bash
git add scripts/screen_kasus_llm.py
git commit -m "feat(scripts): capture tanggal_kasus in screen_kasus_llm.py"
```

---

## Task 8: Backfill `tanggal_kasus` for existing Prabowo-era verified cases

**Files:** none (data operation)

- [ ] **Step 1: List verified cases that might be Prabowo-era**

Run:
```bash
python -c "import os,httpx,json; from dotenv import load_dotenv; load_dotenv(); u=os.environ.get('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL']; k=os.environ['SUPABASE_SERVICE_ROLE_KEY']; h={'apikey':k,'Authorization':f'Bearer {k}'}; r=httpx.get(f'{u}/rest/v1/kasus',params={'select':'kasus_id,pejabat_id,tahun,tanggal_kasus,ringkasan,url_sumber','verified':'eq.true','order':'tahun.desc'},headers=h); print(json.dumps(r.json(),indent=2,ensure_ascii=False))"
```
Expected: the ~18 verified cases. Identify each whose case occurred on/after 2024-10-20 (read `url_sumber` / `ringkasan`).

- [ ] **Step 2: Set `tanggal_kasus` for each era-relevant case**

For each Prabowo-era case, PATCH its date (repeat per `kasus_id`, fill the real date from the source):
```bash
python -c "import os,httpx; from dotenv import load_dotenv; load_dotenv(); u=os.environ.get('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL']; k=os.environ['SUPABASE_SERVICE_ROLE_KEY']; h={'apikey':k,'Authorization':f'Bearer {k}','Content-Type':'application/json','Prefer':'return=minimal'}; KASUS_ID='PASTE-KASUS-ID'; DATE='YYYY-MM-DD'; r=httpx.patch(f'{u}/rest/v1/kasus',params={'kasus_id':f'eq.{KASUS_ID}'},json={'tanggal_kasus':DATE},headers=h); print(r.status_code,r.text[:200])"
```
Expected: `204`. (Pre-Prabowo verified cases stay null — they are excluded from Keranjang by design.)

- [ ] **Step 3: Verify the era set**

Run:
```bash
python -c "import os,httpx; from dotenv import load_dotenv; load_dotenv(); u=os.environ.get('SUPABASE_URL') or os.environ['NEXT_PUBLIC_SUPABASE_URL']; k=os.environ['SUPABASE_SERVICE_ROLE_KEY']; h={'apikey':k,'Authorization':f'Bearer {k}','Prefer':'count=exact'}; r=httpx.get(f'{u}/rest/v1/kasus',params={'select':'kasus_id','verified':'eq.true','tanggal_kasus':'gte.2024-10-20'},headers={**h,'Range':'0-0'}); print('era verified cases:', r.headers.get('content-range'))"
```
Expected: a `content-range` like `0-N/<count>` — `<count>` = number of officials that will appear in Keranjang (before Task 9).

- [ ] **Step 4: No commit** (data-only). Note the count in the PR/session log.

---

## Task 9: BGN data op — 3 arrests + Dadan→Nanik succession

**Files:**
- Create: `scripts/seed_bgn.py`

> Requires user-supplied facts. Fill the `BGN` and `SUCCESSION` data blocks from real news sources before running. The arresting body, exact dates, summaries, source URLs, and whether Nanik is Plt or definitif are NOT invented here.

- [ ] **Step 1: Write the parameterized one-off script**

```python
#!/usr/bin/env python3
"""
One-off: seed the 3 arrested BGN officials (pejabat + jabatan + verified kasus +
kasus_screened) and apply the Kepala BGN succession (deactivate Dadan, add Nanik).

FILL the DATA blocks below from real news sources, then:
    python scripts/seed_bgn.py --dry-run
    python scripts/seed_bgn.py
"""
import argparse
import os
import sys
import httpx
from dotenv import load_dotenv
from pathlib import Path

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")
U = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
K = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}"}
HJ = {**H, "Content-Type": "application/json"}

# ── FILL FROM NEWS ───────────────────────────────────────────────────────────
# Each arrested official. tanggal_kasus / lembaga / ringkasan / url_sumber are real.
BGN = [
    {"nama": "Dadan Hindayana", "posisi": "Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
    {"nama": "Sonjaya", "posisi": "Wakil Kepala Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
    {"nama": "Lodewyk Pusung", "posisi": "Pejabat Badan Gizi Nasional",
     "status_jabatan": "nonaktif", "selesai_jabatan": "YYYY-MM-DD",
     "kasus": {"status": "tersangka", "jenis": "korupsi", "lembaga": "KPK",
               "tahun": 2026, "tanggal_kasus": "YYYY-MM-DD",
               "ringkasan": "...", "url_sumber": "https://..."}},
]
# Replacement for Kepala BGN. status = "penjabat" if Plt else "aktif".
SUCCESSION = {"nama": "Nanik S. Deyang", "posisi": "Kepala Badan Gizi Nasional",
              "status": "aktif", "mulai_jabatan": "YYYY-MM-DD"}
# ─────────────────────────────────────────────────────────────────────────────


def get_indonesia_wilayah_id(c):
    r = c.get(f"{U}/rest/v1/wilayah", params={"kode_bps": "eq.00", "select": "id"}, headers=H)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        sys.exit("ERROR: nasional wilayah (kode_bps='00') not found — run migration 007.")
    return rows[0]["id"]


def find_pejabat(c, nama):
    r = c.get(f"{U}/rest/v1/pejabat", params={"nama_lengkap": f"ilike.{nama}", "select": "id"}, headers=H)
    r.raise_for_status()
    rows = r.json()
    return rows[0]["id"] if len(rows) == 1 else None


def insert(c, table, row, dry):
    if dry:
        print(f"  [DRY] INSERT {table}: {row}")
        return "DRY-ID"
    r = c.post(f"{U}/rest/v1/{table}", json=row, headers={**HJ, "Prefer": "return=representation"})
    if r.status_code not in (200, 201):
        sys.exit(f"ERROR {table} {r.status_code}: {r.text[:300]}")
    return r.json()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run

    with httpx.Client(timeout=30) as c:
        wid = get_indonesia_wilayah_id(c)

        for off in BGN:
            pid = find_pejabat(c, off["nama"])
            if pid is None:
                p = insert(c, "pejabat", {"nama_lengkap": off["nama"], "level": "pusat"}, dry)
                pid = p["id"] if isinstance(p, dict) else "DRY-ID"
                print(f"+ pejabat {off['nama']} -> {pid}")
            else:
                print(f"= pejabat {off['nama']} exists -> {pid}")

            insert(c, "jabatan", {
                "pejabat_id": pid, "wilayah_id": wid, "posisi": off["posisi"],
                "status": off["status_jabatan"], "selesai_jabatan": off["selesai_jabatan"],
            }, dry)

            kr = {"pejabat_id": pid, "verified": True, **off["kasus"]}
            insert(c, "kasus", kr, dry)

            if not dry:
                c.post(f"{U}/rest/v1/kasus_screened",
                       json={"pejabat_id": pid, "last_result": "found", "last_keyakinan": "tinggi"},
                       headers={**HJ, "Prefer": "resolution=merge-duplicates"})
            print(f"  kasus + screened recorded for {off['nama']}")

        # Succession: add the replacement
        spid = find_pejabat(c, SUCCESSION["nama"])
        if spid is None:
            sp = insert(c, "pejabat", {"nama_lengkap": SUCCESSION["nama"], "level": "pusat"}, dry)
            spid = sp["id"] if isinstance(sp, dict) else "DRY-ID"
        insert(c, "jabatan", {
            "pejabat_id": spid, "wilayah_id": wid, "posisi": SUCCESSION["posisi"],
            "status": SUCCESSION["status"], "mulai_jabatan": SUCCESSION["mulai_jabatan"],
        }, dry)
        print(f"+ succession: {SUCCESSION['nama']} -> {SUCCESSION['posisi']} ({SUCCESSION['status']})")

    print("\nDone." + (" (dry-run, no writes)" if dry else ""))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Fill the DATA blocks** with real facts (names already known; dates/lembaga/ringkasan/url_sumber/Nanik status from news). Replace every `YYYY-MM-DD`, `...`, and placeholder URL.

- [ ] **Step 3: Dry-run**

Run: `python scripts/seed_bgn.py --dry-run`
Expected: prints planned inserts for 3 officials (pejabat?/jabatan/kasus) + the succession, no errors, no writes.

- [ ] **Step 4: Execute**

Run: `python scripts/seed_bgn.py`
Expected: `+ pejabat ...`, `kasus + screened recorded ...` ×3, `+ succession: Nanik ...`, `Done.`

- [ ] **Step 5: Verify the 3 are now in the era set**

Re-run the Task 8 Step 3 count — it should increase by 3.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed_bgn.py
git commit -m "feat(scripts): one-off BGN arrests seed + Dadan->Nanik succession"
```

---

## Task 10: `listKeranjangKoruptor()` query

**Files:**
- Modify: `web/lib/types.ts` (add `KeranjangKoruptorRow`)
- Modify: `web/lib/queries.ts` (add the query; reuse existing `fetchAll`/`createServerSupabase`)

- [ ] **Step 1: Add the row interface to `types.ts`**

After `KasusRow` (end of the block, ~line 195):
```ts
export interface KeranjangKoruptorRow {
  pejabat_id: string
  nama: string
  posisi: string | null
  level: PejabatLevel
  wilayah_nama: string | null
  jenis: string | null
  lembaga: string | null
  status: KasusStatus
  tanggal_kasus: string
  ringkasan: string | null
  url_sumber: string | null
}
```

- [ ] **Step 2: Add the query to `queries.ts`**

Append (it uses the same `fetchAll` helper and `createServerSupabase` already imported in this file; verify those imports exist at the top before relying on them):
```ts
const PRABOWO_START = '2024-10-20'

export async function listKeranjangKoruptor(): Promise<KeranjangKoruptorRow[]> {
  const supabase = await createServerSupabase()

  const { data: kasusRows } = await supabase
    .from('kasus')
    .select('pejabat_id, jenis, lembaga, status, tanggal_kasus, ringkasan, url_sumber')
    .eq('verified', true)
    .gte('tanggal_kasus', PRABOWO_START)
    .order('tanggal_kasus', { ascending: false })
  const cases = (kasusRows ?? []) as Array<Pick<KasusRow,
    'pejabat_id' | 'jenis' | 'lembaga' | 'status' | 'tanggal_kasus' | 'ringkasan' | 'url_sumber'>>
  if (!cases.length) return []

  const pejabatIds = [...new Set(cases.map(k => k.pejabat_id))]

  const [pejabatRows, jabatanRows, wilayahRows] = await Promise.all([
    fetchAll<{ id: string; nama_lengkap: string; gelar_depan: string | null; gelar_belakang: string | null; level: string | null }>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, level'),
    fetchAll<{ pejabat_id: string; posisi: string | null; wilayah_id: string }>(
      supabase, 'jabatan', 'pejabat_id, posisi, wilayah_id'),
    fetchAll<{ id: string; nama: string }>(supabase, 'wilayah', 'id, nama'),
  ])

  const pejabatMap = new Map(pejabatRows.map(p => [p.id, p]))
  const wilayahMap = new Map(wilayahRows.map(w => [w.id, w.nama]))

  // First jabatan per pejabat (matches the export route's "first jabatan" convention).
  // For an arrested official this is the seat they were charged in — including a
  // now-'nonaktif' one (e.g. Dadan's Kepala BGN), which is exactly what we want to show.
  const posByPejabat = new Map<string, { posisi: string | null; wilayah_id: string }>()
  for (const j of jabatanRows) {
    if (!posByPejabat.has(j.pejabat_id)) {
      posByPejabat.set(j.pejabat_id, { posisi: j.posisi, wilayah_id: j.wilayah_id })
    }
  }

  return cases
    .filter(k => pejabatMap.has(k.pejabat_id))
    .map(k => {
      const p = pejabatMap.get(k.pejabat_id)!
      const job = posByPejabat.get(k.pejabat_id)
      const nama = [(p.gelar_depan ?? '').trim(), p.nama_lengkap.trim(), (p.gelar_belakang ?? '').trim()]
        .filter(Boolean).join(' ')
      return {
        pejabat_id: k.pejabat_id,
        nama,
        posisi: job?.posisi ?? null,
        level: (p.level === 'pusat' ? 'pusat' : 'daerah') as PejabatLevel,
        wilayah_nama: job ? (wilayahMap.get(job.wilayah_id) ?? null) : null,
        jenis: k.jenis,
        lembaga: k.lembaga,
        status: k.status,
        tanggal_kasus: k.tanggal_kasus as string,
        ringkasan: k.ringkasan,
        url_sumber: k.url_sumber,
      }
    })
}
```

- [ ] **Step 3: Ensure imports + typecheck**

Confirm `KeranjangKoruptorRow` and `PejabatLevel` are imported in `queries.ts` (extend the existing `import type { ... } from './types'` line). Then run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/lib/types.ts web/lib/queries.ts
git commit -m "feat(web): listKeranjangKoruptor query (verified + Prabowo-era)"
```

---

## Task 11: Keranjang Koruptor page + shell + nav link

**Files:**
- Create: `web/app/keranjang-koruptor/page.tsx`
- Create: `web/app/keranjang-koruptor/KeranjangShell.tsx`
- Modify: `web/app/_components/HomeShell.tsx` (nav entry)

> Use the **frontend-design** skill for `KeranjangShell.tsx` to match the editorial style of `web/app/pulse/PulseShell.tsx` (Fraunces serif titles, DM Mono labels, cream `#f5f1e6` bg, red `#c0392b` accent). Build to the contract below.

- [ ] **Step 1: Write the server page**

`web/app/keranjang-koruptor/page.tsx`:
```tsx
import { listKeranjangKoruptor } from '@/lib/queries'
import KeranjangShell from './KeranjangShell'

export const revalidate = 300
export const metadata = {
  title: 'Keranjang Koruptor — Pejabat Ditangkap Era Prabowo',
  description: 'Daftar pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024.',
}

export default async function KeranjangKoruptorPage() {
  const rows = await listKeranjangKoruptor()
  return <KeranjangShell rows={rows} />
}
```

- [ ] **Step 2: Build the client shell to this contract**

`web/app/keranjang-koruptor/KeranjangShell.tsx` — `'use client'`, props `{ rows: KeranjangKoruptorRow[] }` (import the type from `@/lib/types`). Requirements:
- **Header**: nav links `← Beranda` (`/`) and `Direktori` (`/pejabat`) like PulseShell; title "Keranjang Koruptor"; subtitle naming the cutoff ("Pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024"); a counter `{rows.length} pejabat`.
- **Filters** (client-side `useState` over `rows`): status (`tersangka`/`terdakwa`/`terpidana` + "semua"), level (`pusat`/`daerah` + "semua"), and a free-text name search. Default view = all.
- **Sort**: `tanggal_kasus` descending (newest first) — `rows` already arrive sorted; keep that order after filtering.
- **Cards** (text-first, no images): `nama` (links to `/${pejabat_id}` via `next/link`), `posisi` + `wilayah_nama`, a status chip (`status` label capitalized — show "Tersangka", never "terbukti"), `lembaga`, formatted `tanggal_kasus` (e.g. `10 Mar 2025`), `ringkasan`, and a `url_sumber` "sumber ↗" link (`target="_blank" rel="noopener noreferrer"`) when present.
- **Disclaimer footer** (required): a short note that status reflects legal stage at time of reporting, "tersangka/terdakwa belum tentu bersalah — asas praduga tak bersalah berlaku", and data is sourced from verified public reporting.
- **Empty state**: if `rows.length === 0`, show "Belum ada data" copy.

- [ ] **Step 3: Add the homepage nav entry**

Find where the homepage links to `/pulse`:
```bash
cd web && grep -rn "/pulse\|Denyut" app/_components/HomeShell.tsx
```
Add an adjacent link to `/keranjang-koruptor` labeled "Keranjang Koruptor" in the same nav/menu element, matching the existing link's markup/classes. (If no `/pulse` link exists in HomeShell, add both the Keranjang link next to wherever the "Denyut" tab/nav is rendered.)

- [ ] **Step 4: Build and verify**

Run: `cd web && npm run build`
Expected: build succeeds; `/keranjang-koruptor` appears in the route list with no type errors.

- [ ] **Step 5: Browser-verify (matches Denyut verification practice)**

Start dev (`cd web && npm run dev`), then with Playwright MCP: navigate to `http://localhost:3000/keranjang-koruptor`, confirm the BGN trio appears, filters narrow the list, status chips read "Tersangka", cards link to profiles, and the disclaimer renders. Capture a screenshot. Also load `/` and confirm the new nav link works.

- [ ] **Step 6: Commit**

```bash
git add web/app/keranjang-koruptor/ web/app/_components/HomeShell.tsx
git commit -m "feat(web): Keranjang Koruptor page + homepage nav link"
```

---

## Task 12: Record succession-refresh tool on the backlog

**Files:**
- Modify: `CLAUDE.md` ("Next Session Should Start With" → active priorities)

- [ ] **Step 1: Add the backlog item**

Under the active priorities list, add:
```markdown
**N. AI succession-refresh admin tool (from Keranjang Koruptor session).**
- Generalize the /admin/rekam-bersih export→AI-fill→import loop to detect successions.
- Clustered dropdown (province / Pusat batches) → export current office-holders →
  Kimi/Gemini/Claude checks "apakah ada pejabat baru di posisi ini?" → import updates
  (deactivate old jabatan via status='nonaktif' + selesai_jabatan, insert replacement).
- Triggered by the BGN Dadan→Nanik case, which was handled manually via scripts/seed_bgn.py.
```

- [ ] **Step 2: Update "Next Session Should Start With"** with a one-line summary of what shipped (Keranjang Koruptor + tanggal_kasus + BGN seed).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record AI succession-refresh tool on backlog"
```

---

## Self-Review notes

- **Spec coverage:** §1 data model → T1; §2 BGN op → T9; §3 re-screening wiring → T3–T7 (export, import, prompt, CLI, screener); §4 page → T10–T11; §5 backlog → T12; backfill (spec build-order #2) → T8. All covered.
- **Type consistency:** `KasusRow.tanggal_kasus: string | null` (T2) and `KeranjangKoruptorRow.tanggal_kasus: string` (T10, non-null because filtered `>= cutoff`). `listKeranjangKoruptor` (T10) is the exact name imported in T11. CSV header column count 13 used consistently in T3/T4.
- **Membership rule** identical everywhere: `verified = true AND tanggal_kasus >= '2024-10-20'`.
```