import { createContext, useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from "react"
import type { User, Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { runFounderFlow } from "@/lib/founder-flow"
import { addToast } from "@/lib/toast"
import { AUTH_SAFETY_TIMEOUT } from "@/lib/constants"
import type { Profile } from "@/types/profile"
import type { Workspace } from "@/types/workspace"

export type { Profile } from "@/types/profile"
export type { Workspace } from "@/types/workspace"

interface AuthContextType {
  user: User | null
  session: Session | null
  workspace: Workspace | null
  profile: Profile | null
  loading: boolean
  authError: string | null
  signOut: () => Promise<void>
  refreshWorkspace: () => Promise<void>
  refreshProfile: () => Promise<void>
  retryAuth: () => void
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError!
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  // Ref to track whether workspace has been loaded (for safety timeout)
  const workspaceLoadedRef = useRef(false)

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
    setWorkspace(null)
    setAuthError(null)
    workspaceLoadedRef.current = false
  }, [])

  async function fetchProfileAndWorkspace(userId: string) {
    // Ensure we have a valid, non-expired session before making RLS-gated queries.
    // On page refresh, INITIAL_SESSION may fire with an expired JWT before the
    // automatic token refresh completes — proactively refresh it here.
    const { data: { session: activeSession } } = await supabase.auth.getSession()
    if (activeSession) {
      const expiresAt = activeSession.expires_at ?? 0
      if (expiresAt <= Math.floor(Date.now() / 1000)) {
        const { error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError) {
          throw new Error(`Session expired and refresh failed: ${refreshError.message}`)
        }
      }
    }

    const { data: initialProfileData, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
    let profileData = initialProfileData

    if (profileError) {
      throw new Error(`Failed to fetch profile: ${profileError.message}`)
    }

    // Recovery: profile missing (founder flow previously failed due to RLS bug)
    if (!profileData) {
      const currentUser = user ?? (await supabase.auth.getUser()).data.user
      if (currentUser) {
        let recoveryError: Error | undefined
        try {
          await runFounderFlow(currentUser.id, currentUser.email ?? "")
        } catch (err) {
          recoveryError = err instanceof Error ? err : new Error(String(err))
          console.error("[Auth] Founder flow recovery failed:", recoveryError)
        }
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle()
        profileData = data

        if (!profileData) {
          throw new Error(
            recoveryError
              ? `Profile not found. Recovery also failed: ${recoveryError.message}`
              : "Profile not found after recovery attempt"
          )
        }
      }
    }

    if (!profileData) {
      throw new Error("Profile not found after recovery attempt")
    }

    if (profileData.status === "deleted") {
      await signOut()
      return
    }

    setProfile(profileData)

    const { data: workspaceData, error: wsError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", profileData.workspace_id)
      .single()

    if (wsError) {
      throw new Error(`Failed to fetch workspace: ${wsError.message}`)
    }

    if (!workspaceData) {
      throw new Error("Workspace not found")
    }

    setWorkspace(workspaceData)
    workspaceLoadedRef.current = true
  }

  useEffect(() => {
    let cancelled = false
    let resolved = false

    const markResolved = () => {
      if (!resolved) {
        resolved = true
        if (!cancelled) setLoading(false)
      }
    }

    // Single listener — handles INITIAL_SESSION (replaces getSession())
    // and all subsequent auth events. Avoids navigator lock contention
    // caused by separate getSession() calls under React StrictMode.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return

        setSession(session)
        setUser(session?.user ?? null)

        // Token refresh only updates the JWT — profile and workspace are unchanged.
        // However, if the initial load failed (e.g. INITIAL_SESSION had an expired JWT),
        // use the refreshed token to retry loading profile/workspace.
        if (event === "TOKEN_REFRESHED") {
          if (!workspaceLoadedRef.current && session?.user) {
            withRetry(() => fetchProfileAndWorkspace(session.user.id))
              .then(() => {
                if (!cancelled) setAuthError(null)
                markResolved()
              })
              .catch((err) => {
                console.error("[Auth] Retry after token refresh failed:", err.message)
                if (!cancelled) {
                  setAuthError("Unable to load your account data. Please check your connection and try again.")
                  addToast({
                    title: "Connection issue",
                    description: "Couldn't refresh your session. Check your connection.",
                    variant: "error",
                  })
                }
                markResolved()
              })
          }
          return
        }

        if (session?.user) {
          // Cross-tab sign-in: re-enter loading state so auth pages
          // don't redirect before workspace/profile are loaded
          if (resolved && event === "SIGNED_IN") {
            if (workspaceLoadedRef.current) {
              // Token refreshed for already-authenticated user — skip re-fetch, no spinner
              return
            }
            if (!cancelled) setLoading(true)
          }

          // Founder flow is handled by the callback page (/auth/callback).
          // The recovery path in fetchProfileAndWorkspace handles edge cases.

          withRetry(() => fetchProfileAndWorkspace(session.user.id))
            .then(() => {
              if (!cancelled) {
                setAuthError(null)
                setLoading(false)
              }
              markResolved()
            })
            .catch((err) => {
              console.error("[Auth] All retries failed:", err.message)
              if (!cancelled) {
                setAuthError("Unable to load your account data. Please check your connection and try again.")
                setLoading(false)
              }
              markResolved()
            })
        } else {
          // Only clear state for explicit sign-out or initial "not logged in" state.
          // Transient null-session events must NOT wipe workspace — they cause all
          // TanStack Query hooks (enabled: !!workspace) to become disabled.
          if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
            if (workspaceLoadedRef.current) {
              if (event === "SIGNED_OUT") {
                // no toast — user triggered this, they already know
              }
              setProfile(null)
              setWorkspace(null)
              setAuthError(null)
              workspaceLoadedRef.current = false
            }
          }
          markResolved()
        }
      }
    )

    // Safety net: force loading off after timeout
    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        console.warn("[Auth] Safety timeout — forcing loading off")
        if (!workspaceLoadedRef.current) {
          setAuthError("Loading took too long. Please check your connection and try again.")
        }
        markResolved()
      }
    }, AUTH_SAFETY_TIMEOUT)

    return () => {
      cancelled = true
      subscription.unsubscribe()
      clearTimeout(safetyTimeout)
    }
  }, [])

  const retryAuth = useCallback(() => {
    const currentUser = user
    if (!currentUser) return
    setAuthError(null)
    setLoading(true)
    withRetry(() => fetchProfileAndWorkspace(currentUser.id))
      .then(() => {
        setAuthError(null)
      })
      .catch((err) => {
        console.error("[Auth] Manual retry failed:", err.message)
        setAuthError("Unable to load your account data. Please check your connection and try again.")
      })
      .finally(() => {
        setLoading(false)
      })
  }, [user])

  const refreshWorkspace = useCallback(async () => {
    const currentProfile = profile
    if (!currentProfile) return
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", currentProfile.workspace_id)
      .single()
    if (error) {
      console.error("[Auth] Failed to refresh workspace:", error.message, error)
      return
    }
    if (data) setWorkspace(data)
  }, [profile])

  const refreshProfile = useCallback(async () => {
    const currentUser = user
    if (!currentUser) return
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle()
    if (error) {
      console.error("[Auth] Failed to refresh profile:", error.message, error)
      return
    }
    if (data) setProfile(data)
  }, [user])

  const value = useMemo(
    () => ({ user, session, workspace, profile, loading, authError, signOut, refreshWorkspace, refreshProfile, retryAuth }),
    [user, session, workspace, profile, loading, authError, signOut, refreshWorkspace, refreshProfile, retryAuth]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

