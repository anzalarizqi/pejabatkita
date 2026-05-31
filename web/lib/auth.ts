import { cookies } from 'next/headers'
import { verifySessionToken } from '@/lib/session'

/**
 * True when the request carries a valid admin session token cookie.
 * Use in EVERY admin API route — a truthy-only cookie check is not
 * authentication (security audit PK-C1 / PK-H1).
 */
export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get('admin_session')?.value ?? ''
  return verifySessionToken(token)
}
