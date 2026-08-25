import type { Session, AuthError } from "@supabase/supabase-js"

import { supabase } from "@/lib/supabase"
import { getSiteUrl } from "@/lib/site-url"

/**
 * Auth-flow calls, kept out of the page components so every Supabase
 * access in the app goes through the service layer (see CLAUDE.md rule 9).
 */

/** Where Supabase sends the user back to after they click the emailed link. */
function authRedirectUrl(): string {
  return `${getSiteUrl()}/auth/callback`
}

/**
 * Sends a magic-link / OTP email. Throws on failure so callers can
 * surface the message.
 */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectUrl() },
  })

  if (error) throw error
}

/**
 * Exchanges a PKCE code for a session. Returns the error instead of throwing:
 * the callback page needs to inspect it and fall back to an existing session
 * when auto-detection already consumed the one-time code.
 */
export async function exchangeCodeForSession(
  code: string
): Promise<{ session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  return { session: data?.session ?? null, error }
}

/** Current session, or null when not signed in. */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}
