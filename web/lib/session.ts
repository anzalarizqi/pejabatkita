// Stateless admin session token: `<issuedAtMs>.<hmacHex>`, signed with an HMAC
// key. The cookie is NOT the password (security audit PK-H1) and carries a
// server-checkable expiry. Pure Web Crypto so the SAME code runs in both the
// Edge runtime (proxy.ts) and the Node runtime (route handlers / login).

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Dedicated secret if provided, else fall back to ADMIN_PASSWORD so no new env
// var is required. Rotating either value invalidates all existing sessions.
function sessionKey(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

async function sign(data: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return toHex(sig)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Issue a fresh signed session token. Empty string if no key is configured. */
export async function issueSessionToken(): Promise<string> {
  const key = sessionKey()
  if (!key) return ''
  const issued = Date.now().toString()
  return `${issued}.${await sign(issued, key)}`
}

/** Validate a session token: well-formed, unexpired, and correctly signed. */
export async function verifySessionToken(token: string): Promise<boolean> {
  const key = sessionKey()
  if (!key || !token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const issued = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const issuedMs = Number(issued)
  if (!Number.isFinite(issuedMs)) return false
  if (Date.now() - issuedMs > SESSION_TTL_MS) return false
  const expected = await sign(issued, key)
  return constantTimeEqual(sig, expected)
}
