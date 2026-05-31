import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { issueSessionToken } from '@/lib/session'

// Best-effort in-memory login throttle, keyed by client IP. Resets on cold start
// — adequate to blunt password brute-forcing for a single-admin panel (PK-H1).
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 7
const failures = new Map<string, { n: number; resetAt: number }>()

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0'
  )
}

function isLocked(ip: string): boolean {
  const rec = failures.get(ip)
  if (!rec) return false
  if (Date.now() > rec.resetAt) {
    failures.delete(ip)
    return false
  }
  return rec.n >= MAX_FAILURES
}

function recordFailure(ip: string): void {
  const now = Date.now()
  const rec = failures.get(ip)
  if (!rec || now > rec.resetAt) {
    failures.set(ip, { n: 1, resetAt: now + WINDOW_MS })
  } else {
    rec.n += 1
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request)
  if (isLocked(ip)) {
    return NextResponse.json(
      { error: 'Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.' },
      { status: 429 },
    )
  }

  let password = ''
  try {
    const body = (await request.json()) as { password?: string }
    password = body.password ?? ''
  } catch {
    // fall through to invalid-password handling
  }

  const expected = process.env.ADMIN_PASSWORD ?? ''
  if (!password || !expected || !safeEqual(password, expected)) {
    recordFailure(ip)
    return NextResponse.json({ error: 'Kata sandi salah.' }, { status: 401 })
  }

  failures.delete(ip)
  const response = NextResponse.json({ ok: true })
  response.cookies.set('admin_session', await issueSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
