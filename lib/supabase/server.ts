import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookies can be read but not set
          }
        },
      },
    }
  )
}

/**
 * A client that genuinely bypasses row-level security.
 *
 * **It must not receive cookies, and that was a real bug.** This previously used
 * `createServerClient` with the request's cookie jar, exactly like `createClient`
 * above. `@supabase/ssr` then finds the signed-in user's session in those cookies and
 * sends *their* JWT as the `Authorization` header — the service role key is demoted to
 * the `apikey` header, which does not grant anything. So the "service" client ran as
 * the logged-in user and RLS applied to every call.
 *
 * The symptom was a storage upload failing with "new row violates row-level security
 * policy" on a bucket whose policies looked correct, because the request was never
 * arriving with the privileges the code assumed. Everywhere else it happened to work,
 * since the user was allowed to do the thing anyway — which is what let the bug sit
 * unnoticed.
 *
 * `createClient` from `@supabase/supabase-js`, with sessions disabled, has no session
 * to pick up and so cannot be downgraded this way.
 *
 * **This bypasses every RLS policy, so scope the query yourself.** Filter by `user_id`
 * explicitly; there is no policy left to catch a missing `.eq()`.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
