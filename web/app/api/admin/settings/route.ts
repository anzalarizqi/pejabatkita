import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { createServerSupabase } from '@/lib/supabase'

async function checkAuth() {
  return isAdmin()
}

export async function GET() {
  if (!(await checkAuth())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = await createServerSupabase(true)
  const { data } = await supabase.from('settings').select('key, value')
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  return NextResponse.json(map)
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json()
  const supabase = await createServerSupabase(true)
  const allowed = ['llm_provider', 'llm_model', 'hotspot_keywords'] as const
  for (const key of allowed) {
    if (body[key] !== undefined) {
      await supabase.from('settings').upsert({ key, value: String(body[key]) })
    }
  }
  return NextResponse.json({ ok: true })
}
