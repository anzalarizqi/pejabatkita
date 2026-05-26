# Rekam Jejak Korupsi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full corruption-record pipeline: import script for verified kasus CSV, profile page section showing records, and swap the "Rekam Bersih" map mode from `hash01` mock to real per-province kasus aggregation.

**Architecture:** `import_kasus.py` reads a CSV (`kasus_id, pejabat_id_or_name, jenis, lembaga, status, tahun, ringkasan, url_sumber`) and upserts into `kasus`. Profile page server component fetches kasus for the current pejabat and passes to a new `KasusSection` client component. The "Rekam Bersih" choropleth mode in `HomeShell.tsx` switches from `hash01` mock to a real per-province count query. Prerequisite: Plan 1 migration must be applied (kasus table exists).

**Tech Stack:** Python 3.11 + httpx, Next.js 16.2 + React 19, TypeScript, Supabase

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/import_kasus.py` | CSV → kasus table upsert |
| Modify | `web/lib/queries.ts` | Add `getKasusByPejabat`, `listProvinceKasusCounts` |
| Create | `web/app/_components/KasusSection.tsx` | Profile section for corruption records |
| Modify | `web/app/[pejabat-id]/page.tsx` | Fetch kasus and pass to ProfileClient |
| Modify | `web/app/[pejabat-id]/ProfileClient.tsx` | Render KasusSection |
| Modify | `web/app/_components/HomeShell.tsx` | Swap bersih mock → real kasus data |
| Modify | `web/app/page.tsx` | Pass kasus province counts to PreviewShell |

---

### Task 1: `import_kasus.py`

**Files:**
- Create: `scripts/import_kasus.py`

The CSV format expected (from the Gemini enrichment pass):
```
pejabat_id,jenis,lembaga,status,tahun,ringkasan,url_sumber
<uuid>,korupsi,KPK,tersangka,2023,"ringkasan singkat",https://...
```
Alternatively by name (when pejabat_id is unknown):
```
nama_lengkap,jenis,lembaga,status,tahun,ringkasan,url_sumber
H. Ahmad Yani,korupsi,KPK,tersangka,2023,"...",https://...
```

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""
Import verified kasus records from CSV into Supabase.
CSV must have either pejabat_id or nama_lengkap column.
Usage: python scripts/import_kasus.py <kasus.csv> [--dry-run]
"""
import argparse
import csv
import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}
VALID_STATUSES = {"tersangka", "terdakwa", "terpidana"}


def resolve_pejabat_id(client: httpx.Client, nama: str) -> str | None:
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        params={"nama_lengkap": f"ilike.{nama}", "select": "id,nama_lengkap"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    rows = resp.json()
    if len(rows) == 1:
        return rows[0]["id"]
    if len(rows) > 1:
        print(f"  AMBIGUOUS: {len(rows)} matches for '{nama}' — skipping", file=sys.stderr)
    else:
        print(f"  NOT FOUND: '{nama}' — skipping", file=sys.stderr)
    return None


def insert_kasus(client: httpx.Client, row: dict) -> bool:
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/kasus",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=row,
    )
    if resp.status_code in (200, 201):
        return True
    print(f"  ERROR {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file", help="Path to kasus CSV file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with open(args.csv_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Importing {len(rows)} rows from {args.csv_file}")
    has_id_col = "pejabat_id" in (rows[0].keys() if rows else [])

    ok, skipped, errors = 0, 0, 0
    with httpx.Client(timeout=30) as client:
        for i, row in enumerate(rows, 1):
            # Resolve pejabat_id
            if has_id_col and row.get("pejabat_id"):
                pejabat_id = row["pejabat_id"].strip()
            elif row.get("nama_lengkap"):
                pejabat_id = resolve_pejabat_id(client, row["nama_lengkap"].strip())
            else:
                print(f"  Row {i}: no pejabat_id or nama_lengkap — skipping", file=sys.stderr)
                skipped += 1
                continue

            if not pejabat_id:
                skipped += 1
                continue

            status = row.get("status", "").strip().lower()
            if status not in VALID_STATUSES:
                print(f"  Row {i}: invalid status '{status}' — skipping", file=sys.stderr)
                skipped += 1
                continue

            kasus_row = {
                "pejabat_id": pejabat_id,
                "jenis": row.get("jenis", "").strip() or None,
                "lembaga": row.get("lembaga", "").strip() or None,
                "status": status,
                "tahun": int(row["tahun"]) if row.get("tahun", "").strip().isdigit() else None,
                "ringkasan": row.get("ringkasan", "").strip() or None,
                "url_sumber": row.get("url_sumber", "").strip() or None,
            }

            if args.dry_run:
                print(f"  [DRY-RUN] Row {i}: pejabat_id={pejabat_id} status={status}")
                ok += 1
                continue

            if insert_kasus(client, kasus_row):
                ok += 1
            else:
                errors += 1

    print(f"\nDone: {ok} imported, {skipped} skipped, {errors} errors")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test dry-run with a sample CSV**

Create `scripts/sample_kasus.csv`:
```csv
nama_lengkap,jenis,lembaga,status,tahun,ringkasan,url_sumber
Budi Gunawan,korupsi,KPK,tersangka,2015,"Tersangka kasus suap penerimaan hadiah",https://kpk.go.id
```

Run:
```bash
python scripts/import_kasus.py scripts/sample_kasus.csv --dry-run
```
Expected: `[DRY-RUN] Row 1: pejabat_id=<uuid> status=tersangka` (or NOT FOUND if name isn't in DB).

- [ ] **Step 3: Commit**

```bash
git add scripts/import_kasus.py
git commit -m "feat: import_kasus.py — CSV → kasus table"
```

---

### Task 2: Kasus queries

**Files:**
- Modify: `web/lib/queries.ts`

- [ ] **Step 1: Add `getKasusByPejabat`** (append after `listPejabatPusat`)

```typescript
// ─── Kasus (corruption records) ──────────────────────────────────────────────

import type { KasusRow } from './types'

export async function getKasusByPejabat(pejabatId: string): Promise<KasusRow[]> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('kasus')
    .select('*')
    .eq('pejabat_id', pejabatId)
    .order('tahun', { ascending: false })
  return (data ?? []) as KasusRow[]
}
```

- [ ] **Step 2: Add `listProvinceKasusCounts`**

```typescript
export interface ProvinceKasusCount {
  provinsi_nama: string
  kasus_count: number
}

export async function listProvinceKasusCounts(): Promise<ProvinceKasusCount[]> {
  const supabase = await createServerSupabase()

  // kasus → pejabat → jabatan → wilayah → provinsi
  const [kasusRows, jabatanRows, wilayah] = await Promise.all([
    supabase.from('kasus').select('pejabat_id').then(({ data }) =>
      (data ?? []) as Array<{ pejabat_id: string }>
    ),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'wilayah_id'>>(
      supabase, 'jabatan', 'pejabat_id, wilayah_id',
    ),
    fetchAll<Wilayah>(supabase, 'wilayah', 'id, nama, level, parent_id'),
  ])

  const wilayahById = new Map<string, Wilayah>()
  for (const w of wilayah) wilayahById.set(w.id, w)

  const pejabatWithKasus = new Set(kasusRows.map((k) => k.pejabat_id))

  function provinceNamaOf(wilayahId: string): string | null {
    const w = wilayahById.get(wilayahId)
    if (!w) return null
    if (w.level === 'provinsi') return w.nama
    if (w.parent_id) return wilayahById.get(w.parent_id)?.nama ?? null
    return null
  }

  // Count distinct pejabat-with-kasus per province
  const counted = new Set<string>()
  const counts = new Map<string, number>()
  for (const j of jabatanRows) {
    if (!pejabatWithKasus.has(j.pejabat_id)) continue
    const prov = provinceNamaOf(j.wilayah_id)
    if (!prov) continue
    const key = `${j.pejabat_id}::${prov}`
    if (counted.has(key)) continue
    counted.add(key)
    counts.set(prov, (counts.get(prov) ?? 0) + 1)
  }

  return Array.from(counts.entries()).map(([provinsi_nama, kasus_count]) => ({
    provinsi_nama,
    kasus_count,
  }))
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/lib/queries.ts
git commit -m "feat: add getKasusByPejabat and listProvinceKasusCounts queries"
```

---

### Task 3: `KasusSection` component

**Files:**
- Create: `web/app/_components/KasusSection.tsx`

- [ ] **Step 1: Invoke `frontend-design` skill**

Before implementing, invoke `frontend-design` skill. The section should show:
- Empty state: green badge "Tidak ditemukan rekam jejak korupsi"
- Has records: collapsible list of kasus cards — each with: `status` badge (merah for tersangka, oranye for terdakwa, hitam for terpidana), `lembaga`, `tahun`, `jenis`, `ringkasan`, external source link
- Must match existing profile page aesthetic (Fraunces + DM Mono, existing CSS vars)

- [ ] **Step 2: Create the component**

```typescript
// web/app/_components/KasusSection.tsx
'use client'

import type { KasusRow } from '@/lib/types'

const STATUS_LABEL: Record<string, string> = {
  tersangka: 'TERSANGKA',
  terdakwa: 'TERDAKWA',
  terpidana: 'TERPIDANA',
}

interface Props {
  kasus: KasusRow[]
}

export default function KasusSection({ kasus }: Props) {
  // Implement per frontend-design skill output.
  // Empty state: green "bersih" badge.
  // Has records: one card per kasus, status badge colored by severity.
  // Each card: jenis, lembaga, tahun, ringkasan, url_sumber link.
  // Use existing profile page CSS vars (__ink, --paper, --accent, --rule, --muted).
  return null // replace with actual implementation
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/app/_components/KasusSection.tsx
git commit -m "feat: add KasusSection component for profile page"
```

---

### Task 4: Wire kasus into profile page

**Files:**
- Modify: `web/app/[pejabat-id]/page.tsx`
- Modify: `web/app/[pejabat-id]/ProfileClient.tsx`

- [ ] **Step 1: Update the server component to fetch kasus**

In `web/app/[pejabat-id]/page.tsx`, add the kasus fetch (parallel with existing fetches). The file uses Next.js 16 `params` as a Promise — follow the existing pattern:

```typescript
// Add to imports:
import { getKasusByPejabat } from '@/lib/queries'
import type { KasusRow } from '@/lib/types'

// Inside the page component, add to the parallel fetch:
const [pejabat, jabatan, kasus] = await Promise.all([
  // ... existing fetches ...
  getKasusByPejabat(id),
])

// Pass kasus to ProfileClient:
<ProfileClient pejabat={pejabat} jabatan={jabatan} kasus={kasus} provinsiNama={...} />
```

- [ ] **Step 2: Update `ProfileClient` props to accept kasus**

In `web/app/[pejabat-id]/ProfileClient.tsx`:

```typescript
// Update Props interface:
interface Props {
  pejabat: PejabatRow
  jabatan: (JabatanRow & { wilayah?: Pick<Wilayah, 'nama' | 'kode_bps'> })[]
  kasus: KasusRow[]  // add this
  provinsiNama: string | null
}

// Import:
import type { KasusRow } from '@/lib/types'
import KasusSection from '@/app/_components/KasusSection'

// Add KasusSection to JSX (after the existing biodata/jabatan sections):
<KasusSection kasus={kasus} />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Test in dev — profile with no kasus**

```bash
cd web && npm run dev
```
Open any profile page. Expect the Rekam Jejak section to show the "bersih" empty state.

- [ ] **Step 5: Commit**

```bash
git add web/app/[pejabat-id]/page.tsx web/app/[pejabat-id]/ProfileClient.tsx
git commit -m "feat: add KasusSection to profile page"
```

---

### Task 5: Swap "Rekam Bersih" map mode to real data

**Files:**
- Modify: `web/app/page.tsx`
- Modify: `web/app/_components/HomeShell.tsx`

- [ ] **Step 1: Fetch kasus counts in `page.tsx`**

```typescript
// Add to parallel fetch in page.tsx:
import { listProvinceKasusCounts } from '@/lib/queries'

const [provinces, stats, leaders, pusatOfficials, kasusCounts] = await Promise.all([
  listProvinceCounts(),
  getSiteStats(),
  listLeaderRoster(),
  listPejabatPusat(),
  listProvinceKasusCounts(),
])

// Pass to PreviewShell:
<PreviewShell
  provinces={provinces}
  stats={stats}
  leaders={leaders}
  pusatOfficials={pusatOfficials}
  kasusCounts={kasusCounts}
/>
```

- [ ] **Step 2: Update `PreviewShell` props and swap bersih mode**

In `HomeShell.tsx`:

```typescript
// Add to Props:
interface Props {
  // ...existing...
  kasusCounts: Array<{ provinsi_nama: string; kasus_count: number }>
}

// In PreviewShell, build a lookup map:
const kasusMap = useMemo(() => {
  const m = new Map<string, number>()
  for (const k of kasusCounts) m.set(k.provinsi_nama, k.kasus_count)
  return m
}, [kasusCounts])

// In mapColorBy useMemo, replace the 'bersih' branch:
if (mode === 'bersih') {
  return (name: string) => {
    const count = kasusMap.get(name) ?? 0
    const total = provinceMaps.count.get(name) ?? 1
    // ratio of officials with kasus: higher = redder
    return Math.min(1, count / Math.max(1, total))
  }
}

// In mapTooltip useMemo, replace the 'bersih' branch:
if (mode === 'bersih') {
  return (name: string) => {
    const count = kasusMap.get(name) ?? 0
    return `${count} pejabat dengan catatan korupsi`
  }
}
```

- [ ] **Step 3: Remove the `(ilustrasi)` label from the bersih legend**

In `MapLegend`:
```typescript
// Change:
bersih: { label: '% rekam bersih · ilustrasi', danger: 'ada catatan', safe: 'bersih' },
// To:
bersih: { label: 'pejabat dengan catatan korupsi', danger: 'banyak catatan', safe: 'bersih' },
```

Remove the `PRATINJAU` flag from the bersih mode tab in `COLOR_MODES`:
```typescript
{ key: 'bersih', label: 'Rekam Bersih', live: true, hint: 'pejabat dengan catatan korupsi' },
```

- [ ] **Step 4: Verify TypeScript compiles and map renders correctly**

```bash
cd web && npx tsc --noEmit && npm run dev
```
Open homepage, click "Rekam Bersih". Map should render with real data (all grey if kasus table is empty, or varying shades once data is imported).

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx web/app/_components/HomeShell.tsx
git commit -m "feat: swap Rekam Bersih map mode from hash01 mock to real kasus data"
```
