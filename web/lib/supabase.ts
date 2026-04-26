import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Browser client — use in Client Components
export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseAnonKey)

// Server client — use in Server Components and API routes
// Pass useServiceRole=true for admin operations (bypasses RLS)
export const createServerSupabase = async (useServiceRole = false) => {
  const cookieStore = await cookies()
  return createServerClient(
    supabaseUrl,
    useServiceRole ? supabaseServiceKey : supabaseAnonKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
