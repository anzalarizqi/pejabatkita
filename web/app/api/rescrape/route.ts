import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { isAdmin } from '@/lib/auth'

const execFileAsync = promisify(execFile)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KODE_RE = /^[0-9]{1,4}$/
const PROVINSI_RE = /^[A-Za-z .'-]{2,40}$/

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { pejabat_id?: string; provinsi?: string; kode_provinsi?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scraperPath = process.env.SCRAPER_PATH ?? path.join(process.cwd(), '..', 'scraper')

  // execFile (no shell) + input validation: arguments are passed to python as a
  // literal argv and can never be interpreted as shell syntax (PK-H2).
  let args: string[]
  if (body.pejabat_id) {
    if (!UUID_RE.test(body.pejabat_id)) {
      return NextResponse.json({ error: 'pejabat_id tidak valid' }, { status: 400 })
    }
    args = ['--pejabat-id', body.pejabat_id]
  } else if (body.kode_provinsi) {
    if (!KODE_RE.test(body.kode_provinsi)) {
      return NextResponse.json({ error: 'kode_provinsi tidak valid' }, { status: 400 })
    }
    args = ['--kode-provinsi', body.kode_provinsi]
  } else if (body.provinsi) {
    if (!PROVINSI_RE.test(body.provinsi)) {
      return NextResponse.json({ error: 'provinsi tidak valid' }, { status: 400 })
    }
    args = ['--provinsi', body.provinsi]
  } else {
    return NextResponse.json({ error: 'pejabat_id or provinsi required' }, { status: 400 })
  }

  try {
    const { stdout, stderr } = await execFileAsync('python', ['scraper.py', ...args], {
      cwd: scraperPath,
      timeout: 5 * 60 * 1000, // 5 minute timeout
      env: { ...process.env },
    })
    return NextResponse.json({ ok: true, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1000) })
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    return NextResponse.json(
      { error: 'Scraper failed', stderr: e.stderr?.slice(0, 1000) ?? String(err) },
      { status: 500 }
    )
  }
}
