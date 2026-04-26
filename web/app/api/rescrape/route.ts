import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  const session = request.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { pejabat_id?: string; provinsi?: string; kode_provinsi?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const scraperPath = process.env.SCRAPER_PATH ?? path.join(process.cwd(), '..', 'scraper')

  let args = ''
  if (body.pejabat_id) {
    args = `--pejabat-id ${body.pejabat_id}`
  } else if (body.kode_provinsi) {
    args = `--kode-provinsi ${body.kode_provinsi}`
  } else if (body.provinsi) {
    args = `--provinsi "${body.provinsi}"`
  } else {
    return NextResponse.json({ error: 'pejabat_id or provinsi required' }, { status: 400 })
  }

  const cmd = `python scraper.py ${args}`

  try {
    const { stdout, stderr } = await execAsync(cmd, {
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
