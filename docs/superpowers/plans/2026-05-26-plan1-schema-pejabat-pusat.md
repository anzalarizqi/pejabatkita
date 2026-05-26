# Schema + Pejabat Pusat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `level` column to `pejabat`, create shared `kasus`/`hotspot_events`/`settings` tables, seed a national wilayah row, build a `scrape_kabinet.py` script, and wire a Daerah/Pusat toggle on the homepage.

**Architecture:** Single migration adds all new tables (shared foundation for Plans 2 and 3). A Python script scrapes the Prabowo cabinet from Wikipedia and upserts rows with `level='pusat'` into `pejabat` + `jabatan` (pointing to a seeded `wilayah` row with `level='nasional'`). The homepage `PreviewShell` gets a Daerah/Pusat client-side toggle; Pusat view renders a `KabinetGrid` component. Use `frontend-design` skill before implementing `KabinetGrid.tsx` and the toggle UI.

**Tech Stack:** PostgreSQL (Supabase), Python 3.11 + httpx, Next.js 16.2 + React 19, TypeScript

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/007_pusat_korupsi_hotspot.sql` | All new tables + `pejabat.level` column |
| Create | `scripts/scrape_kabinet.py` | Scrape Prabowo cabinet → upsert pejabat+jabatan |
| Modify | `web/lib/types.ts` | Add `KasusRow`, `HotspotEvent`, `SettingRow` types |
| Modify | `web/lib/queries.ts` | Add `listPejabatPusat()` |
| Create | `web/app/_components/KabinetGrid.tsx` | Pusat view grid (use frontend-design skill) |
| Modify | `web/app/_components/HomeShell.tsx` | Add Daerah/Pusat toggle to `PreviewShell` |

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/007_pusat_korupsi_hotspot.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/007_pusat_korupsi_hotspot.sql

-- 1. pejabat.level
ALTER TABLE pejabat ADD COLUMN IF NOT EXISTS level VARCHAR NOT NULL DEFAULT 'daerah';
CREATE INDEX IF NOT EXISTS idx_pejabat_level ON pejabat(level);

-- 2. Seed the national wilayah (safe to run multiple times)
INSERT INTO wilayah (kode_bps, nama, level, parent_id)
VALUES ('00', 'Indonesia', 'nasional', NULL)
ON CONFLICT (kode_bps) DO NOTHING;

-- 3. kasus table
CREATE TABLE IF NOT EXISTS kasus (
    kasus_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pejabat_id  UUID NOT NULL REFERENCES pejabat(id) ON DELETE CASCADE,
    jenis       TEXT,
    lembaga     TEXT,
    status      TEXT NOT NULL CHECK (status IN ('tersangka','terdakwa','terpidana')),
    tahun       INT,
    ringkasan   TEXT,
    url_sumber  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kasus_pejabat_id ON kasus(pejabat_id);

-- 4. hotspot_events table
CREATE TABLE IF NOT EXISTS hotspot_events (
    event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    judul        TEXT NOT NULL,
    ringkasan    TEXT,
    kategori     TEXT,
    lokasi_nama  TEXT,
    wilayah_id   UUID REFERENCES wilayah(id),
    pejabat_id   UUID REFERENCES pejabat(id),
    url_sumber   TEXT,
    sumber_nama  TEXT,
    crawled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_manual    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_hotspot_wilayah_id ON hotspot_events(wilayah_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_crawled_at ON hotspot_events(crawled_at);

-- 5. settings table
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT
);
INSERT INTO settings (key, value) VALUES
    ('llm_provider', 'zhipu'),
    ('llm_model', 'glm-4.5-air'),
    ('hotspot_keywords', '[]')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply the migration**

Run in Supabase dashboard SQL editor (or `supabase db push` if CLI is configured).

Verify in SQL editor:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'pejabat' AND column_name = 'level';
SELECT table_name FROM information_schema.tables WHERE table_name IN ('kasus','hotspot_events','settings');
SELECT nama FROM wilayah WHERE level = 'nasional';
```
Expected: 1 row each, `Indonesia` name for nasional wilayah.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/007_pusat_korupsi_hotspot.sql
git commit -m "feat: add schema for pejabat.level, kasus, hotspot_events, settings"
```

---

### Task 2: Add new types to `types.ts`

**Files:**
- Modify: `web/lib/types.ts`

- [ ] **Step 1: Add the new types** (append to end of file)

```typescript
// ─── Pusat / Korupsi / Hotspot types ──────────────────────────────────────────

export type PejabatLevel = 'daerah' | 'pusat'
export type KasusStatus = 'tersangka' | 'terdakwa' | 'terpidana'

export interface KasusRow {
  kasus_id: string
  pejabat_id: string
  jenis: string | null
  lembaga: string | null
  status: KasusStatus
  tahun: number | null
  ringkasan: string | null
  url_sumber: string | null
  created_at: string
}

export interface HotspotEvent {
  event_id: string
  judul: string
  ringkasan: string | null
  kategori: string | null
  lokasi_nama: string | null
  wilayah_id: string | null
  pejabat_id: string | null
  url_sumber: string | null
  sumber_nama: string | null
  crawled_at: string
  is_manual: boolean
}

export interface SettingRow {
  key: string
  value: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/lib/types.ts
git commit -m "feat: add KasusRow, HotspotEvent, SettingRow types"
```

---

### Task 3: `listPejabatPusat` query

**Files:**
- Modify: `web/lib/queries.ts`

- [ ] **Step 1: Add the interface and function** (append after `listPejabat`)

```typescript
// ─── Pejabat Pusat (kabinet) ──────────────────────────────────────────────────

export interface PejabatPusatCard {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  posisi: string | null
  partai: string | null
  foto_url: string | null
  has_kasus: boolean
}

export async function listPejabatPusat(): Promise<PejabatPusatCard[]> {
  const supabase = await createServerSupabase()

  const [pejabatRows, jabatanRows, kasusRows] = await Promise.all([
    fetchAll<Pick<PejabatRow, 'id' | 'nama_lengkap' | 'gelar_depan' | 'gelar_belakang' | 'metadata'>>(
      supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, metadata',
    ).then((rows) => rows.filter((p) => (p as PejabatRow & { level?: string }).level === 'pusat')),
    fetchAll<Pick<JabatanRow, 'pejabat_id' | 'posisi' | 'partai'>>(
      supabase, 'jabatan', 'pejabat_id, posisi, partai',
    ),
    supabase.from('kasus').select('pejabat_id').then(({ data }) => data ?? []),
  ])

  const kasusSet = new Set((kasusRows as Array<{ pejabat_id: string }>).map((k) => k.pejabat_id))
  const jabByPejabat = new Map<string, Pick<JabatanRow, 'pejabat_id' | 'posisi' | 'partai'>>()
  for (const j of jabatanRows) {
    if (!jabByPejabat.has(j.pejabat_id)) jabByPejabat.set(j.pejabat_id, j)
  }

  return pejabatRows.map((p) => {
    const j = jabByPejabat.get(p.id)
    const meta = (p.metadata ?? {}) as { foto_url?: string }
    return {
      id: p.id,
      nama_lengkap: p.nama_lengkap,
      gelar_depan: p.gelar_depan,
      gelar_belakang: p.gelar_belakang,
      posisi: j?.posisi ?? null,
      partai: j?.partai ?? null,
      foto_url: meta.foto_url ?? null,
      has_kasus: kasusSet.has(p.id),
    }
  })
}
```

Note: the `.filter((p) => p.level === 'pusat')` works because the select includes all columns via `fetchAll` but TypeScript doesn't know about `level` yet. To fix this, add `level` to the `PejabatRow` interface in `types.ts`:

```typescript
// In types.ts, update PejabatRow:
export interface PejabatRow {
  id: string
  nama_lengkap: string
  gelar_depan: string | null
  gelar_belakang: string | null
  biodata: Biodata
  pendidikan: Pendidikan[]
  metadata: PejabatMetadata
  last_updated: string
  level: PejabatLevel  // add this line
}
```

Then update the fetchAll call in `listPejabatPusat` to include `level`:
```typescript
supabase, 'pejabat', 'id, nama_lengkap, gelar_depan, gelar_belakang, metadata, level',
```
And change filter to:
```typescript
.then((rows) => rows.filter((p) => p.level === 'pusat')),
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add web/lib/queries.ts web/lib/types.ts
git commit -m "feat: add listPejabatPusat query"
```

---

### Task 4: `KabinetGrid` component

**Files:**
- Create: `web/app/_components/KabinetGrid.tsx`

- [ ] **Step 1: Invoke `frontend-design` skill**

Before writing this component, invoke the `frontend-design` skill. The component displays ~50 national officials in a grid layout matching the existing newspaper aesthetic (Fraunces serif + DM Mono, `--ink`/`--paper`/`--accent` CSS vars). Each card shows: name, jabatan/ministry, partai badge (if available), and a red "ADA CATATAN" badge if `has_kasus=true`.

- [ ] **Step 2: Create the component** (implement per frontend-design skill output, matching this interface)

```typescript
// web/app/_components/KabinetGrid.tsx
'use client'

import Link from 'next/link'
import type { PejabatPusatCard } from '@/lib/queries'

interface Props {
  officials: PejabatPusatCard[]
}

export default function KabinetGrid({ officials }: Props) {
  // Group by ministry prefix from posisi field
  // Render grid: Presiden + Wapres first, then menteri alphabetically
  // Each card: name, posisi, partai pill, has_kasus badge
  // Link to /${official.id} profile page
  // Use existing CSS vars: --ink, --paper, --paper-2, --accent, --rule, --muted
  // Font: Fraunces for names, DM Mono for labels/badges
  // ... (implement per frontend-design skill)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add web/app/_components/KabinetGrid.tsx
git commit -m "feat: add KabinetGrid component for pusat officials"
```

---

### Task 5: Homepage Daerah/Pusat toggle

**Files:**
- Modify: `web/app/_components/HomeShell.tsx`
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Invoke `frontend-design` skill**

Before modifying `PreviewShell`, invoke the `frontend-design` skill. The toggle is a pill/tab pair `[ Daerah ] [ Pusat ]` placed above the existing map stage. When `Pusat` is selected, the map stage is replaced by `KabinetGrid`. The toggle must match the existing `.pv-mode-tab` aesthetic.

- [ ] **Step 2: Update `page.tsx` to fetch pusat data**

```typescript
// web/app/page.tsx — add listPejabatPusat to the parallel fetches
import { listProvinceCounts, getSiteStats, listLeaderRoster, listPejabatPusat } from '@/lib/queries'

export default async function HomePage() {
  const [provinces, stats, leaders, pusatOfficials] = await Promise.all([
    listProvinceCounts(),
    getSiteStats(),
    listLeaderRoster(),
    listPejabatPusat(),
  ])
  return <PreviewShell provinces={provinces} stats={stats} leaders={leaders} pusatOfficials={pusatOfficials} />
}
```

- [ ] **Step 3: Update `PreviewShell` props and add toggle state**

In `HomeShell.tsx`:

```typescript
// Add to Props interface:
interface Props {
  provinces: ProvinceCount[]
  stats: SiteStats
  leaders: LeaderRow[]
  pusatOfficials: PejabatPusatCard[]  // add this
}

// Add view state inside PreviewShell:
type ViewMode = 'daerah' | 'pusat'
const [viewMode, setViewMode] = useState<ViewMode>('daerah')
```

- [ ] **Step 4: Add toggle + conditional render in JSX**

Replace the `<section className="pv-stage">` contents (implement per frontend-design skill output):

```typescript
// Inside pv-stage, before StatStrip:
<ViewToggle viewMode={viewMode} setViewMode={setViewMode} />

// Conditionally render map or kabinet:
{viewMode === 'daerah' ? (
  <>
    <StatStrip ... />
    <ModeToggle ... />
    <div className="pv-stage-map">...</div>
    <MapLegend ... />
    <FeatureStrip />
  </>
) : (
  <KabinetGrid officials={pusatOfficials} />
)}
```

The `ViewToggle` sub-component follows the same pill pattern as `ModeToggle`:

```typescript
function ViewToggle({ viewMode, setViewMode }: { viewMode: ViewMode; setViewMode: (v: ViewMode) => void }) {
  return (
    <div className="pv-view-row">
      <div className="pv-mode-tabs" role="tablist">
        {(['daerah', 'pusat'] as ViewMode[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={viewMode === v}
            className={`pv-mode-tab ${viewMode === v ? 'pv-mode-tab-active' : ''}`}
            onClick={() => setViewMode(v)}
            suppressHydrationWarning
          >
            {v === 'daerah' ? 'Daerah' : 'Pusat · Kabinet'}
          </button>
        ))}
      </div>
    </div>
  )
}
```

Add CSS for `.pv-view-row` in the `styles` const (mirrors `.pv-mode-row`):
```css
.pv-view-row {
  display: flex; align-items: center; gap: 14px;
  padding: 0 12px 4px;
  flex-shrink: 0;
  border-bottom: 1px dashed var(--rule);
  margin-bottom: 4px;
}
```

- [ ] **Step 5: Verify TypeScript compiles and dev server runs**

```bash
cd web && npx tsc --noEmit
```

Then run dev server and confirm:
- Homepage loads with "Daerah" tab active (existing map)
- Clicking "Pusat · Kabinet" shows `KabinetGrid` (empty until scrape script runs)
- Clicking back to "Daerah" restores the map

- [ ] **Step 6: Commit**

```bash
git add web/app/_components/HomeShell.tsx web/app/page.tsx
git commit -m "feat: add Daerah/Pusat toggle on homepage, wire KabinetGrid"
```

---

### Task 6: `scrape_kabinet.py`

**Files:**
- Create: `scripts/scrape_kabinet.py`

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""
Scrape Prabowo cabinet from Wikipedia and upsert into Supabase.
Re-runnable: upserts by (nama_lengkap, posisi) pair.
Usage: python scripts/scrape_kabinet.py [--dry-run]
"""
import argparse
import json
import os
import re
import sys
from urllib.parse import urljoin

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
WIKIPEDIA_URL = "https://id.wikipedia.org/wiki/Kabinet_Merah_Putih"

HEADERS = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}


def fetch_wikipedia() -> list[dict]:
    """Fetch and parse the Kabinet Merah Putih Wikipedia page via Jina reader."""
    jina_url = f"https://r.jina.ai/{WIKIPEDIA_URL}"
    resp = httpx.get(jina_url, timeout=30, headers={"Accept": "application/json"})
    resp.raise_for_status()
    data = resp.json()
    content = data.get("data", {}).get("content", "")
    return parse_cabinet_text(content)


def parse_cabinet_text(text: str) -> list[dict]:
    """
    Extract (nama, posisi) pairs from Jina markdown of Wikipedia cabinet page.
    Wikipedia tables render as markdown rows: | Nama | Posisi | Partai | ...
    """
    officials = []
    # Match table rows with at least 3 columns (skip header rows)
    pattern = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|", re.MULTILINE)
    for m in pattern.finditer(text):
        nama_raw, posisi_raw, partai_raw = m.group(1), m.group(2), m.group(3)
        # Skip header rows (contain "Nama" or "No" or "---")
        if re.search(r"^(Nama|No\.?|---|Jabatan|Posisi)\s*$", nama_raw, re.I):
            continue
        # Strip markdown links [text](url) → text
        nama = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", nama_raw).strip()
        posisi = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", posisi_raw).strip()
        partai = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", partai_raw).strip()
        if nama and posisi and len(nama) > 3:
            officials.append({"nama_lengkap": nama, "posisi": posisi, "partai": partai or None})
    return officials


def get_nasional_wilayah_id(client: httpx.Client) -> str:
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/wilayah",
        params={"level": "eq.nasional", "select": "id"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise RuntimeError("Nasional wilayah not found. Run migration 007 first.")
    return rows[0]["id"]


def get_existing_pusat(client: httpx.Client) -> dict[str, str]:
    """Returns {nama_lengkap: pejabat_id} for all existing pusat pejabat."""
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        params={"level": "eq.pusat", "select": "id,nama_lengkap"},
        headers=HEADERS,
    )
    resp.raise_for_status()
    return {row["nama_lengkap"]: row["id"] for row in resp.json()}


def upsert_pejabat(client: httpx.Client, nama: str) -> str:
    """Insert pejabat if not exists, return id."""
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/pejabat",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"nama_lengkap": nama, "level": "pusat", "biodata": {}, "pendidikan": [], "metadata": {}},
    )
    if resp.status_code == 409:  # conflict — already exists
        get_resp = client.get(
            f"{SUPABASE_URL}/rest/v1/pejabat",
            params={"nama_lengkap": f"eq.{nama}", "level": "eq.pusat", "select": "id"},
            headers=HEADERS,
        )
        return get_resp.json()[0]["id"]
    resp.raise_for_status()
    return resp.json()[0]["id"]


def upsert_jabatan(client: httpx.Client, pejabat_id: str, posisi: str, partai: str | None, wilayah_id: str):
    resp = client.post(
        f"{SUPABASE_URL}/rest/v1/jabatan",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
        json={
            "pejabat_id": pejabat_id,
            "wilayah_id": wilayah_id,
            "posisi": posisi,
            "partai": partai,
            "status": "aktif",
        },
    )
    if resp.status_code not in (200, 201):
        print(f"  WARN: jabatan upsert {resp.status_code}: {resp.text[:120]}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("Fetching Wikipedia cabinet page via Jina...")
    officials = fetch_wikipedia()
    print(f"  Parsed {len(officials)} officials")

    if not officials:
        print("ERROR: No officials parsed. Check Wikipedia page structure.", file=sys.stderr)
        sys.exit(1)

    with httpx.Client(timeout=30) as client:
        existing = get_existing_pusat(client)
        wilayah_id = get_nasional_wilayah_id(client)
        print(f"  Existing pusat pejabat: {len(existing)}")
        print(f"  Nasional wilayah id: {wilayah_id}")

        added, updated, skipped = 0, 0, 0
        for off in officials:
            nama = off["nama_lengkap"]
            posisi = off["posisi"]
            partai = off["partai"]

            if args.dry_run:
                status = "UPDATE" if nama in existing else "NEW"
                print(f"  [DRY-RUN] {status}: {nama} — {posisi}")
                continue

            if nama in existing:
                pejabat_id = existing[nama]
                upsert_jabatan(client, pejabat_id, posisi, partai, wilayah_id)
                updated += 1
            else:
                pejabat_id = upsert_pejabat(client, nama)
                upsert_jabatan(client, pejabat_id, posisi, partai, wilayah_id)
                added += 1

        if not args.dry_run:
            # Detect removals
            scraped_names = {o["nama_lengkap"] for o in officials}
            removed = [n for n in existing if n not in scraped_names]
            if removed:
                print(f"\nRemovals detected (not auto-deleted — review manually):")
                for n in removed:
                    print(f"  - {n}")

            print(f"\nDone: {added} added, {updated} updated, {skipped} skipped")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test dry-run**

```bash
python scripts/scrape_kabinet.py --dry-run
```
Expected: prints `[DRY-RUN] NEW: <nama> — <posisi>` for ~50 officials.

- [ ] **Step 3: Run live import**

```bash
python scripts/scrape_kabinet.py
```
Expected: `Done: N added, 0 updated, 0 skipped`

Verify in Supabase:
```sql
SELECT COUNT(*) FROM pejabat WHERE level = 'pusat';
-- Expected: ~50
SELECT p.nama_lengkap, j.posisi, j.partai FROM pejabat p
JOIN jabatan j ON j.pejabat_id = p.id
WHERE p.level = 'pusat' ORDER BY p.nama_lengkap LIMIT 10;
```

- [ ] **Step 4: Confirm KabinetGrid renders on homepage**

Start dev server (`cd web && npm run dev`), open homepage, click "Pusat · Kabinet". Expect ~50 official cards.

- [ ] **Step 5: Commit**

```bash
git add scripts/scrape_kabinet.py
git commit -m "feat: scrape_kabinet.py — upsert Prabowo cabinet into pejabat(level=pusat)"
```
