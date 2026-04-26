import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'
import { createHash } from 'crypto'

function hashIp(ip: string): string {
  return createHash('sha256')
    .update(ip + (process.env.ADMIN_PASSWORD ?? 'salt'))
    .digest('hex')
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    '0.0.0.0'
  )
}

export async function POST(request: NextRequest) {
  let body: { pejabat_id: string; reason: string; source_url?: string }
  try {
    body = await request.json()
    if (!body.pejabat_id || !body.reason?.trim()) throw new Error()
  } catch {
    return NextResponse.json({ error: 'pejabat_id and reason are required' }, { status: 400 })
  }

  if (body.reason.length > 500) {
    return NextResponse.json({ error: 'reason must be under 500 characters' }, { status: 400 })
  }

  const ip = getClientIp(request)
  const ipHash = hashIp(ip)

  const supabase = await createServerSupabase(true)

  // Rate-limit: max 1 flag per pejabat per IP per 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('flags')
    .select('id')
    .eq('pejabat_id', body.pejabat_id)
    .eq('reporter_ip_hash', ipHash)
    .gte('created_at', cutoff)
    .limit(1)

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: 'Anda sudah melaporkan pejabat ini dalam 24 jam terakhir.' },
      { status: 429 }
    )
  }

  const { error } = await supabase.from('flags').insert({
    pejabat_id: body.pejabat_id,
    type: 'public',
    reason: body.reason.trim(),
    source_url: body.source_url?.trim() || null,
    reporter_ip_hash: ipHash,
    status: 'pending',
  })

  if (error) {
    return NextResponse.json({ error: 'Gagal menyimpan laporan.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  // Admin: update flag status
  const session = request.cookies.get('admin_session')?.value
  if (session !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id: string; status: 'resolved' | 'dismissed' }
  try {
    body = await request.json()
    if (!body.id || !['resolved', 'dismissed'].includes(body.status)) throw new Error()
  } catch {
    return NextResponse.json({ error: 'id and valid status required' }, { status: 400 })
  }

  const supabase = await createServerSupabase(true)
  const { error } = await supabase
    .from('flags')
    .update({ status: body.status, resolved_at: new Date().toISOString() })
    .eq('id', body.id)

  if (error) {
    return NextResponse.json({ error: 'Gagal memperbarui flag.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
