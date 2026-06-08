# Koruptor per Partai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Koruptor per Partai" panel to `/keranjang-koruptor` that counts, per political party, how many distinct pejabat have a verified corruption case — attributed to the party they belonged to at the time of that case — with the current tracked-member total shown as context.

**Architecture:** A new nullable `kasus.partai` column is snapshotted at screen/verify time (party-at-time-of-case). A pure aggregator groups verified cases by normalized party into distinct-pejabat counts (with a "belum dikaitkan" bucket for untagged cases) and joins a denominator from current `jabatan.partai`. A server component renders the ranked panel using native `<details>` for expand/collapse — no client JS.

**Tech Stack:** Next.js 16 (RSC, server components), Supabase/postgrest, TypeScript, Python 3.11 (backfill script), `tsx` via `npx` for the one pure-logic unit test.

**Spec:** `docs/superpowers/specs/2026-06-08-koruptor-per-partai-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/017_kasus_partai.sql` | Add nullable `kasus.partai` |
| `web/lib/partaiKoruptor.ts` | Pure aggregator + its types (no DB) |
| `web/lib/partaiKoruptor.test.ts` | Unit test for the aggregator |
| `web/lib/queries.ts` | `listPartaiKoruptor()` — fetch + call aggregator |
| `web/app/api/admin/export-kasus-csv/route.ts` | Add `partai` column to export CSV |
| `web/app/api/admin/import-kasus-csv/route.ts` | Read + normalize `partai` on insert |
| `web/app/admin/rekam-bersih/page.tsx` | Add `partai` line to screening prompt |
| `web/app/keranjang-koruptor/PartaiKoruptorPanel.tsx` | Server component — ranked panel |
| `web/app/keranjang-koruptor/page.tsx` | Fetch panel data, pass to shell |
| `web/app/keranjang-koruptor/KeranjangShell.tsx` | Render panel slot + extend disclaimer |
| `scripts/backfill_kasus_partai.py` | One-off export→fill→import for existing verified cases |

---

## Task 1: Migration — add `kasus.partai`

**Files:**
- Create: `supabase/migrations/017_kasus_partai.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Snapshot of the party a pejabat belonged to AT THE TIME of a corruption case
-- (party-at-time-of-case attribution). Nullable: untagged cases fall into the
-- "belum dikaitkan" bucket in the read layer, never silently dropped.
ALTER TABLE kasus ADD COLUMN IF NOT EXISTS partai varchar;
```

- [ ] **Step 2: Apply the migration**

Apply through the project's normal path (Supabase SQL editor, or `supabase db push` if the CLI is linked). Paste the file contents and run.

- [ ] **Step 3: Verify the column exists**

Run (from repo root, venv active):

```bash
python -c "import os; from dotenv import load_dotenv; load_dotenv('.env'); from supabase import create_client; sb=create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']); print(sb.table('kasus').select('pejabat_id, partai').limit(1).execute().data)"
```

Expected: prints a list (possibly `[{'pejabat_id': '...', 'partai': None}]`) with **no** "column kasus.partai does not exist" error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/017_kasus_partai.sql
git commit -m "feat(db): add kasus.partai for party-at-time-of-case attribution"
```

---

## Task 2: Pure aggregator + unit test (TDD)

This is the core logic and the only piece with a real unit test. Write the test first.

**Files:**
- Create: `web/lib/partaiKoruptor.ts`
- Test: `web/lib/partaiKoruptor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/partaiKoruptor.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregatePartaiKoruptor } from './partaiKoruptor'
import type { KasusForPartai, KoruptorInfo, JabatanForPartai } from './partaiKoruptor'

const info = (id: string, nama: string): KoruptorInfo => ({
  pejabat_id: id, nama, posisi: 'Bupati', status: 'tersangka',
})

test('counts distinct pejabat per normalized party, ranked desc', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP',         tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'b', partai: 'PDI-P',        tanggal_kasus: '2025-02-01' }, // alias → PDIP
    { pejabat_id: 'c', partai: 'Gerindra',     tanggal_kasus: '2025-03-01' },
  ]
  const koruptor = [info('a', 'A'), info('b', 'B'), info('c', 'C')]
  const jabatan: JabatanForPartai[] = []
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  assert.equal(res.belumDikaitkanCount, 0)
  assert.equal(res.rows.length, 2)
  assert.equal(res.rows[0].partai, 'PDIP')
  assert.equal(res.rows[0].koruptorCount, 2)        // a + b, alias-merged
  assert.equal(res.rows[1].partai, 'Gerindra')
  assert.equal(res.rows[1].koruptorCount, 1)
})

test('untagged cases go to belumDikaitkan, not any party', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'd', partai: null,   tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'e', partai: '',     tanggal_kasus: '2025-01-01' },
  ]
  const koruptor = [info('a', 'A'), info('d', 'D'), info('e', 'E')]
  const res = aggregatePartaiKoruptor(cases, koruptor, [])

  assert.equal(res.belumDikaitkanCount, 2)
  assert.equal(res.rows.length, 1)
  assert.equal(res.rows[0].koruptorCount, 1)
})

test('party-switcher: numerator party != current jabatan party', () => {
  // pejabat 'a' was PDIP at time of case, now sits in a Golkar seat
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
  ]
  const koruptor = [info('a', 'A')]
  const jabatan: JabatanForPartai[] = [
    { pejabat_id: 'a', partai: 'Golkar', status: 'aktif' },
    { pejabat_id: 'z', partai: 'Golkar', status: 'aktif' }, // clean Golkar incumbent
  ]
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  // koruptor counted under PDIP (party at case), not Golkar
  assert.equal(res.rows.length, 1)
  assert.equal(res.rows[0].partai, 'PDIP')
  assert.equal(res.rows[0].koruptorCount, 1)
  // PDIP terdata is 0 (no active PDIP seats in this fixture); the switcher
  // contributes to Golkar's terdata, but Golkar has no koruptor so no row
  assert.equal(res.rows[0].terdataCount, 0)
})

test('multiple cases for one pejabat count the person once; terdata dedupes seats', () => {
  const cases: KasusForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-01-01' },
    { pejabat_id: 'a', partai: 'PDIP', tanggal_kasus: '2025-06-01' },
  ]
  const koruptor = [info('a', 'A')]
  const jabatan: JabatanForPartai[] = [
    { pejabat_id: 'a', partai: 'PDIP', status: 'aktif' },
    { pejabat_id: 'a', partai: 'PDIP', status: 'aktif' }, // same person, two seats
    { pejabat_id: 'q', partai: 'PDIP', status: 'nonaktif' }, // inactive — excluded
  ]
  const res = aggregatePartaiKoruptor(cases, koruptor, jabatan)

  assert.equal(res.rows[0].koruptorCount, 1)
  assert.equal(res.rows[0].terdataCount, 1) // 'a' once; 'q' excluded (nonaktif)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx --yes tsx --test lib/partaiKoruptor.test.ts`
Expected: FAIL — `Cannot find module './partaiKoruptor.ts'` (file not created yet).

- [ ] **Step 3: Write the aggregator**

Create `web/lib/partaiKoruptor.ts`:

```ts
import { normalizePartai } from './partai'

export interface KasusForPartai {
  pejabat_id: string
  partai: string | null
  tanggal_kasus: string | null
}

export interface KoruptorInfo {
  pejabat_id: string
  nama: string
  posisi: string | null
  status: 'tersangka' | 'terdakwa' | 'terpidana'
}

export interface JabatanForPartai {
  pejabat_id: string
  partai: string | null
  status: string | null // 'aktif' | 'nonaktif'
}

export interface PartaiKoruptorRow {
  partai: string
  koruptorCount: number
  koruptorList: KoruptorInfo[]
  terdataCount: number
}

export interface PartaiKoruptorResult {
  rows: PartaiKoruptorRow[]
  belumDikaitkanCount: number
}

// Normalize a raw partai cell to its canonical name, or '' if empty/unparseable-as-empty.
function canon(raw: string | null): string {
  const [value] = normalizePartai(raw)
  return value // '' when raw is null/empty; otherwise canonical or trimmed original
}

export function aggregatePartaiKoruptor(
  cases: KasusForPartai[],
  koruptorInfo: KoruptorInfo[],
  activeJabatan: JabatanForPartai[],
): PartaiKoruptorResult {
  const infoById = new Map(koruptorInfo.map(k => [k.pejabat_id, k]))

  // 1. Group cases by pejabat, pick the attributed party = most-recent case that has a party.
  const casesByPejabat = new Map<string, KasusForPartai[]>()
  for (const c of cases) {
    const arr = casesByPejabat.get(c.pejabat_id) ?? []
    arr.push(c)
    casesByPejabat.set(c.pejabat_id, arr)
  }

  const partyToKoruptor = new Map<string, KoruptorInfo[]>()
  let belumDikaitkanCount = 0

  for (const [pejabatId, pejabatCases] of casesByPejabat) {
    const info = infoById.get(pejabatId)
    if (!info) continue // can't display someone we have no name for

    // most recent first; null tanggal sorts last
    const sorted = [...pejabatCases].sort((a, b) =>
      (b.tanggal_kasus ?? '').localeCompare(a.tanggal_kasus ?? ''))
    const attributed = sorted.map(c => canon(c.partai)).find(v => v !== '') ?? ''

    if (!attributed) {
      belumDikaitkanCount++
      continue
    }
    const list = partyToKoruptor.get(attributed) ?? []
    list.push(info)
    partyToKoruptor.set(attributed, list)
  }

  // 2. Denominator: distinct active-jabatan pejabat per canonical party.
  const partyToTerdata = new Map<string, Set<string>>()
  for (const j of activeJabatan) {
    if (j.status !== 'aktif') continue
    const p = canon(j.partai)
    if (!p) continue
    const set = partyToTerdata.get(p) ?? new Set<string>()
    set.add(j.pejabat_id)
    partyToTerdata.set(p, set)
  }

  // 3. Build rows for parties that have ≥1 koruptor; sort by count desc, then name asc.
  const rows: PartaiKoruptorRow[] = [...partyToKoruptor.entries()]
    .map(([partai, koruptorList]) => ({
      partai,
      koruptorCount: koruptorList.length,
      koruptorList,
      terdataCount: partyToTerdata.get(partai)?.size ?? 0,
    }))
    .sort((a, b) => b.koruptorCount - a.koruptorCount || a.partai.localeCompare(b.partai, 'id'))

  return { rows, belumDikaitkanCount }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx --yes tsx --test lib/partaiKoruptor.test.ts`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add web/lib/partaiKoruptor.ts web/lib/partaiKoruptor.test.ts
git commit -m "feat(web): pure aggregator for koruptor-per-partai counts"
```

---

## Task 3: `listPartaiKoruptor()` query

**Files:**
- Modify: `web/lib/queries.ts` (add new exported function; reuses existing `PRABOWO_START`, `fetchAll`, `createServerSupabase`)

- [ ] **Step 1: Add the query function**

Append to `web/lib/queries.ts` (after `listKeranjangKoruptor`). It reuses the module-level `PRABOWO_START` constant and `fetchAll` helper already used by `listKeranjangKoruptor`:

```ts
import {
  aggregatePartaiKoruptor,
  type KasusForPartai,
  type KoruptorInfo,
  type JabatanForPartai,
  type PartaiKoruptorResult,
} from './partaiKoruptor'

export async function listPartaiKoruptor(): Promise<PartaiKoruptorResult> {
  const supabase = await createServerSupabase()

  const { data: kasusRows } = await supabase
    .from('kasus')
    .select('pejabat_id, partai, tanggal_kasus, status')
    .eq('verified', true)
    .gte('tanggal_kasus', PRABOWO_START)
  const cases = (kasusRows ?? []) as Array<KasusForPartai & { status: KoruptorInfo['status'] }>
  if (!cases.length) return { rows: [], belumDikaitkanCount: 0 }

  const [pejabatRows, jabatanRows] = await Promise.all([
    fetchAll<{ id: string; nama_lengkap: string; gelar_depan: string | null; gelar_belakang: string | null }>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang'),
    fetchAll<{ pejabat_id: string; posisi: string | null; partai: string | null; status: string | null }>(
      supabase, 'jabatan', 'pejabat_id, posisi, partai, status'),
  ])

  const pejabatMap = new Map(pejabatRows.map(p => [p.id, p]))

  // First jabatan posisi per pejabat (matches listKeranjangKoruptor's convention)
  const firstPosisi = new Map<string, string | null>()
  for (const j of jabatanRows) {
    if (!firstPosisi.has(j.pejabat_id)) firstPosisi.set(j.pejabat_id, j.posisi)
  }

  // One KoruptorInfo per pejabat that has a verified case
  const koruptorInfo: KoruptorInfo[] = []
  const seen = new Set<string>()
  for (const c of cases) {
    if (seen.has(c.pejabat_id)) continue
    seen.add(c.pejabat_id)
    const p = pejabatMap.get(c.pejabat_id)
    if (!p) continue
    const nama = [(p.gelar_depan ?? '').trim(), p.nama_lengkap.trim(), (p.gelar_belakang ?? '').trim()]
      .filter(Boolean).join(' ')
    koruptorInfo.push({ pejabat_id: c.pejabat_id, nama, posisi: firstPosisi.get(c.pejabat_id) ?? null, status: c.status })
  }

  const activeJabatan: JabatanForPartai[] = jabatanRows.map(j => ({
    pejabat_id: j.pejabat_id, partai: j.partai, status: j.status,
  }))

  return aggregatePartaiKoruptor(cases, koruptorInfo, activeJabatan)
}
```

- [ ] **Step 2: Verify it typechecks / builds**

Run: `cd web && npm run build`
Expected: build completes with no TypeScript errors referencing `queries.ts` or `partaiKoruptor.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/lib/queries.ts
git commit -m "feat(web): listPartaiKoruptor query"
```

---

## Task 4: Capture `partai` in the screening CSV loop

**Files:**
- Modify: `web/app/api/admin/export-kasus-csv/route.ts` (add column to `CSV_HEADER` + every `csvRow([...])` placeholder list)
- Modify: `web/app/api/admin/import-kasus-csv/route.ts` (read + normalize on insert)
- Modify: `web/app/admin/rekam-bersih/page.tsx` (prompt line)

- [ ] **Step 1: Add `partai` to the export header and rows**

In `web/app/api/admin/export-kasus-csv/route.ts`:

Change the header constant (line 8) to append `,partai`:

```ts
const CSV_HEADER = 'pejabat_id,nama,jabatan,provinsi,kasus_found,status,jenis,lembaga,tahun,tanggal_kasus,ringkasan,url_sumber,keyakinan,partai'
```

The two data-row builders each pass a 13-element array to `csvRow(...)`; add one trailing `''` so they have 14 to match the header. In `handlePusatExport` (was line 134):

```ts
    lines.push(csvRow([c.id, c.nama, c.posisi, 'Pusat', '', '', '', '', '', '', '', '', '', '']))
```

In the province `GET` path (was line 239):

```ts
    lines.push(csvRow([id, nama, jabatan, provinsi, '', '', '', '', '', '', '', '', '', '']))
```

- [ ] **Step 2: Read + normalize `partai` on import**

In `web/app/api/admin/import-kasus-csv/route.ts`, add an import at the top:

```ts
import { normalizePartai } from '@/lib/partai'
```

Inside the `isTruthy(kasus_found)` branch, after `const tanggal_kasus = ...` (was line 132) and before `const kasusRow: ... = { pejabat_id, status }`, add:

```ts
      const partaiRaw = (row['partai'] ?? '').trim()
      const partai = partaiRaw ? normalizePartai(partaiRaw)[0] : null
```

Then after the existing `if (tanggal_kasus) kasusRow.tanggal_kasus = tanggal_kasus` line (was line 138), add:

```ts
      if (partai) kasusRow.partai = partai
```

- [ ] **Step 3: Add `partai` guidance to the screening prompt**

In `web/app/admin/rekam-bersih/page.tsx`, find the canned screening prompt string (the `PROMPT_TEXT` / instructions block listing the CSV columns to fill) and add one bullet describing the `partai` column. Use this exact line:

```
- partai — keanggotaan/partai pengusung pejabat SAAT kasus ini terjadi, singkatan resmi (PDIP, Golkar, Gerindra, PKB, NasDem, PPP, PKS, Demokrat, PAN, PSI, Perindo, Hanura, PBB) atau "Independen". Kosongkan jika tidak yakin.
```

(If the prompt enumerates output columns elsewhere, mirror the placement used by `tanggal_kasus`.)

- [ ] **Step 4: Verify build**

Run: `cd web && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/admin/export-kasus-csv/route.ts web/app/api/admin/import-kasus-csv/route.ts web/app/admin/rekam-bersih/page.tsx
git commit -m "feat(web): capture kasus.partai in screening CSV loop"
```

---

## Task 5: Backfill existing verified cases

**Files:**
- Create: `scripts/backfill_kasus_partai.py`

Note: `export-kasus-csv` excludes pejabat already in `kasus`, so it cannot re-emit verified cases — this dedicated script is required. Output must stay ASCII (Windows cp1252 stdout — see project CLAUDE.md).

- [ ] **Step 1: Write the script**

Create `scripts/backfill_kasus_partai.py`:

```python
"""
One-off backfill for kasus.partai (party-at-time-of-case) on existing verified cases.

Workflow mirrors the enrichment/rekam-bersih loop:
    python scripts/backfill_kasus_partai.py --export   # -> scripts/kasus_partai_backfill.csv
    # fill the `partai` column (AI/manual), then:
    python scripts/backfill_kasus_partai.py --import scripts/kasus_partai_backfill.csv

Only rows where partai is currently null are exported. Import updates kasus.partai
by pejabat_id, normalizing through the shared canonical map.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
load_dotenv(ROOT / ".env")

from _partai import normalize_partai  # noqa: E402

OUT_FILE = ROOT / "scripts" / "kasus_partai_backfill.csv"


def get_supabase():
    from supabase import create_client
    return create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def do_export(sb) -> None:
    kasus = sb.table("kasus").select(
        "pejabat_id, partai, tanggal_kasus, ringkasan, url_sumber"
    ).eq("verified", True).is_("partai", "null").execute().data or []

    if not kasus:
        print("Nothing to backfill: all verified cases already have partai.")
        return

    pej_ids = [k["pejabat_id"] for k in kasus]
    pejabat = sb.table("pejabat").select(
        "id, nama_lengkap, gelar_depan, gelar_belakang"
    ).in_("id", pej_ids).execute().data or []
    name_by_id = {p["id"]: p for p in pejabat}

    with open(OUT_FILE, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["pejabat_id", "nama", "tanggal_kasus", "ringkasan", "url_sumber", "partai"])
        for k in kasus:
            p = name_by_id.get(k["pejabat_id"], {})
            nama = " ".join(x for x in [
                (p.get("gelar_depan") or "").strip(),
                (p.get("nama_lengkap") or "").strip(),
                (p.get("gelar_belakang") or "").strip(),
            ] if x)
            w.writerow([
                k["pejabat_id"], nama, k.get("tanggal_kasus") or "",
                (k.get("ringkasan") or "")[:200], k.get("url_sumber") or "", "",
            ])
    print("Exported %d cases to %s" % (len(kasus), OUT_FILE))


def do_import(sb, path: str) -> None:
    updated = 0
    skipped = 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pid = (row.get("pejabat_id") or "").strip()
            raw = (row.get("partai") or "").strip()
            if not pid or not raw:
                skipped += 1
                continue
            value, _known = normalize_partai(raw)
            if not value:
                skipped += 1
                continue
            sb.table("kasus").update({"partai": value}).eq("pejabat_id", pid).execute()
            updated += 1
    print("Updated %d cases; skipped %d (no pejabat_id or blank partai)." % (updated, skipped))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--import", dest="import_path", metavar="CSV")
    args = ap.parse_args()

    sb = get_supabase()
    if args.export:
        do_export(sb)
    elif args.import_path:
        do_import(sb, args.import_path)
    else:
        ap.error("specify --export or --import <file>")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Export the cases needing a party**

Run: `python scripts/backfill_kasus_partai.py --export`
Expected: prints `Exported N cases to scripts\kasus_partai_backfill.csv` (N ≈ the verified-case count, ~20).

- [ ] **Step 3: Fill the `partai` column**

Open `scripts/kasus_partai_backfill.csv`. For each row, fill `partai` with the official's party **at the time of that case** (party they were a member of for the office the case relates to), using the official abbreviation or `Independen`; leave blank if genuinely unknown. The `ringkasan`/`url_sumber` columns give context. (This is the same human/AI fill pattern as the enrichment loop — small N, can be done in one pass.)

- [ ] **Step 4: Import the filled file**

Run: `python scripts/backfill_kasus_partai.py --import scripts/kasus_partai_backfill.csv`
Expected: prints `Updated M cases; skipped K ...` with M = number of rows you filled.

- [ ] **Step 5: Spot-check in the DB**

Run:

```bash
python -c "import os; from dotenv import load_dotenv; load_dotenv('.env'); from supabase import create_client; sb=create_client(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY']); rows=sb.table('kasus').select('pejabat_id, partai').eq('verified', True).execute().data; print('with partai:', sum(1 for r in rows if r['partai']), '/ total verified:', len(rows))"
```

Expected: `with partai: M / total verified: N` — M matches Step 4.

- [ ] **Step 6: Commit the script (not the CSV)**

```bash
git add scripts/backfill_kasus_partai.py
git commit -m "feat(scripts): one-off backfill for kasus.partai"
```

(The filled CSV is local working data; leave it untracked like the other `scripts/*.csv` exports.)

---

## Task 6: `PartaiKoruptorPanel` UI + wire into the page

**Files:**
- Create: `web/app/keranjang-koruptor/PartaiKoruptorPanel.tsx`
- Modify: `web/app/keranjang-koruptor/page.tsx`
- Modify: `web/app/keranjang-koruptor/KeranjangShell.tsx`

- [ ] **Step 1: Create the panel (server component, native `<details>`)**

Create `web/app/keranjang-koruptor/PartaiKoruptorPanel.tsx`:

```tsx
import Link from 'next/link'
import type { PartaiKoruptorResult } from '@/lib/partaiKoruptor'

export default function PartaiKoruptorPanel({ data }: { data: PartaiKoruptorResult }) {
  if (!data.rows.length && !data.belumDikaitkanCount) return null
  const maxCount = data.rows.reduce((m, r) => Math.max(m, r.koruptorCount), 0) || 1

  return (
    <section className="pk-panel" aria-label="Koruptor per partai">
      <style>{styles}</style>
      <div className="pk-head">
        <h2 className="pk-title">Koruptor per Partai</h2>
        <span className="pk-note">jumlah pejabat dengan kasus terverifikasi · partai saat kasus</span>
      </div>

      <ul className="pk-list" role="list">
        {data.rows.map((r) => (
          <li key={r.partai} className="pk-row">
            <details>
              <summary className="pk-summary">
                <span className="pk-partai">{r.partai}</span>
                <span className="pk-bar-wrap">
                  <span className="pk-bar" style={{ width: `${(r.koruptorCount / maxCount) * 100}%` }} />
                </span>
                <span className="pk-count">
                  {r.koruptorCount} koruptor
                  <span className="pk-terdata"> · dari {r.terdataCount} pejabat terdata</span>
                </span>
              </summary>
              <ul className="pk-people" role="list">
                {r.koruptorList.map((k) => (
                  <li key={k.pejabat_id} className="pk-person">
                    <Link href={`/${k.pejabat_id}`} className="pk-person-name">{k.nama}</Link>
                    <span className="pk-person-meta">
                      {[k.posisi, k.status].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      {data.belumDikaitkanCount > 0 && (
        <p className="pk-belum">Belum dikaitkan ke partai: {data.belumDikaitkanCount} pejabat</p>
      )}
    </section>
  )
}

const styles = `
.pk-panel {
  max-width: 900px;
  width: 100%;
  margin: 0 auto;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e2dccb;
  font-family: 'DM Mono', monospace;
  box-sizing: border-box;
}
.pk-head { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.pk-title { font-family: 'Fraunces', serif; font-size: 1.25rem; font-weight: 400; margin: 0; color: #0f1117; }
.pk-note { font-size: .68rem; letter-spacing: .06em; color: #8a857c; }
.pk-list { list-style: none; margin: 0; padding: 0; }
.pk-row { border-top: 1px dashed #e2dccb; }
.pk-row:first-child { border-top: none; }
.pk-summary {
  display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: .75rem;
  padding: .55rem 0; cursor: pointer; list-style: none;
}
.pk-summary::-webkit-details-marker { display: none; }
.pk-partai { font-size: .82rem; color: #0f1117; }
.pk-bar-wrap { background: #ece7dc; height: 8px; border-radius: 2px; overflow: hidden; }
.pk-bar { display: block; height: 100%; background: #c0392b; }
.pk-count { font-size: .72rem; color: #0f1117; white-space: nowrap; }
.pk-terdata { color: #8a857c; }
.pk-people { list-style: none; margin: 0 0 .5rem; padding: 0 0 .25rem 110px; }
.pk-person { display: flex; gap: .6rem; align-items: baseline; padding: .2rem 0; }
.pk-person-name { font-family: 'Fraunces', serif; font-size: .92rem; color: #0f1117; text-decoration: none; border-bottom: 1px solid transparent; }
.pk-person-name:hover { color: #c0392b; border-bottom-color: #c0392b; }
.pk-person-meta { font-size: .68rem; color: #8a857c; letter-spacing: .04em; }
.pk-belum { font-size: .7rem; color: #8a857c; margin: .75rem 0 0; }
@media (max-width: 640px) {
  .pk-summary { grid-template-columns: 90px 1fr; }
  .pk-count { grid-column: 2; }
  .pk-bar-wrap { display: none; }
  .pk-people { padding-left: 0; }
}
`
```

- [ ] **Step 2: Fetch the data and pass it into the shell**

Edit `web/app/keranjang-koruptor/page.tsx` to fetch both datasets and pass the panel as a prop:

```tsx
import { listKeranjangKoruptor, listPartaiKoruptor } from '@/lib/queries'
import KeranjangShell from './KeranjangShell'
import PartaiKoruptorPanel from './PartaiKoruptorPanel'

export const revalidate = 300
export const metadata = {
  title: 'Keranjang Koruptor — Pejabat Ditangkap Era Prabowo',
  description: 'Daftar pejabat yang ditetapkan tersangka korupsi sejak 20 Oktober 2024.',
}

export default async function KeranjangKoruptorPage() {
  const [rows, partai] = await Promise.all([listKeranjangKoruptor(), listPartaiKoruptor()])
  return <KeranjangShell rows={rows} panel={<PartaiKoruptorPanel data={partai} />} />
}
```

- [ ] **Step 3: Render the panel slot + extend the disclaimer in the shell**

In `web/app/keranjang-koruptor/KeranjangShell.tsx`:

1. Add a `ReactNode` type import to the existing react import (was line 3, `import { useState, useMemo } from 'react'`):

```tsx
import { useState, useMemo, type ReactNode } from 'react'
```

2. Extend the `Props` interface (was line 31-33) to accept the panel node:

```tsx
interface Props {
  rows: KeranjangKoruptorRow[]
  panel?: ReactNode
}
```

3. Update the component signature (was line 35):

```tsx
export default function KeranjangShell({ rows, panel }: Props) {
```

4. Render the panel between the `</header>` and `<main className="kk-main">` (was line ~129):

```tsx
      </header>

      {panel}

      {/* ── Card list ──────────────────────────────────────────────── */}
      <main className="kk-main">
```

5. Extend the disclaimer paragraph (was line 196-200) by adding one sentence before the closing `</p>`:

```tsx
        <p>
          Status hukum mencerminkan tahap yang dilaporkan saat data dikumpulkan.{' '}
          <strong>Tersangka dan terdakwa belum tentu bersalah — asas praduga tak bersalah berlaku.</strong>{' '}
          Data bersumber dari pemberitaan publik terverifikasi (KPK, ICW, media nasional).{' '}
          Hitungan per partai mencerminkan keanggotaan pejabat <strong>saat kasus terjadi</strong>, hanya kasus terverifikasi; &ldquo;pejabat terdata&rdquo; adalah pejabat yang partainya sudah tercatat, bukan seluruh anggota partai.
        </p>
```

- [ ] **Step 4: Build**

Run: `cd web && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/app/keranjang-koruptor/PartaiKoruptorPanel.tsx web/app/keranjang-koruptor/page.tsx web/app/keranjang-koruptor/KeranjangShell.tsx
git commit -m "feat(web): Koruptor per Partai panel on keranjang-koruptor"
```

---

## Task 7: Browser verification + reconciliation

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `cd web && npm run dev`
Open `http://localhost:3000/keranjang-koruptor`.

- [ ] **Step 2: Visual + behavior check**

Confirm:
- The "Koruptor per Partai" panel renders above the case list, parties ranked by count descending.
- Each row shows `N koruptor · dari M pejabat terdata` and a red bar scaled to the count.
- Clicking a row (`<details>`) expands the named officials; each name links to `/<pejabat_id>` and the profile loads.
- The extended disclaimer line about party attribution is present in the footer.

- [ ] **Step 3: Reconciliation check**

Confirm the counts are internally consistent: the sum of all `koruptorCount` values in the panel **plus** the "Belum dikaitkan ke partai: K pejabat" number **equals** the number of distinct pejabat in the case list below (the page counter shows total cases; for reconciliation count distinct names, since one pejabat may have multiple case rows).

Expected: `Σ koruptorCount + belumDikaitkan == distinct pejabat with verified cases`.

- [ ] **Step 4: Note any data gaps (not a code bug)**

If many cases land in "Belum dikaitkan", that's a backfill-coverage gap (Task 5), not a defect — fill more rows and re-import. If a party shows `dari 0 pejabat terdata`, that's a partai-enrichment coverage gap on `jabatan`, also expected until enrichment progresses.

---

## Self-Review Notes

- **Spec coverage:** §1 data model → Task 1; §2 capture → Task 4; §3 backfill → Task 5; §4 query → Tasks 2+3; §5 UI → Task 6; §6 copy → Task 6 step 3; §7 testing → Task 2 (unit) + Task 7 (browser/reconcile). All covered.
- **Deviation from spec:** types live in `web/lib/partaiKoruptor.ts` (colocated with the pure fn) rather than `web/lib/types.ts` — better cohesion, single source of truth; `queries.ts` imports them.
- **Test infra:** no committed dependency added; the one unit test runs via `npx --yes tsx --test`, consistent with the repo having no JS test runner and the TS query layer otherwise being browser-verified.
