import { useState, useEffect } from "react"
import { useNavigate, useLocation, Navigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { getSiteUrl } from "@/lib/site-url"
import { onAuthComplete } from "@/lib/auth-channel"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/auth-layout"
import { NovaLogo } from "@/components/nova-logo"
import { Button } from "@/components/ui/button"
import { addToast } from "@/lib/toast"

export function CheckEmailPage() {
  const { user, workspace, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const email = (location.state as { email?: string })?.email
  const [resending, setResending] = useState(false)
  const [authCompletedInOtherTab, setAuthCompletedInOtherTab] = useState(false)

  useEffect(() => {
    return onAuthComplete(() => setAuthCompletedInOtherTab(true))
  }, [])

  if (authLoading) return null

  // Auth completed in the callback tab — show "continue there" message
  if (authCompletedInOtherTab && user) {
    return (
      <AuthLayout>
        <div className="flex w-full flex-col items-center gap-8">
          <NovaLogo />
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.75px] text-foreground">
              You're logged in
            </h1>
          </div>
        </div>
        <div className="flex w-full flex-col items-center gap-5">
          <p className="text-sm text-muted-foreground text-center">
            You've been logged in successfully. You can continue in the tab
            that opened from your email.
          </p>
          <p className="text-sm text-muted-foreground text-center">
            Or{" "}
            <a
              href="/requests"
              className="font-medium text-foreground hover:underline"
            >
              open the dashboard here
            </a>
          </p>
        </div>
      </AuthLayout>
    )
  }

  // Already logged in (direct navigation, not cross-tab) — redirect as before
  if (user && workspace) return <Navigate to="/requests" replace />
  if (!email) return <Navigate to="/login" replace />

  async function handleResend() {
    setResending(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email!,
        options: { emailRedirectTo: `${getSiteUrl()}/auth/callback` },
      })
      if (error) throw error
      addToast({ title: "Email resent", description: `A new link was sent to ${email}.` })
    } catch (err) {
      console.error("Failed to resend OTP:", err)
      addToast({ title: "Couldn't resend email", description: "Try again in a moment." })
    } finally {
      setResending(false)
    }
  }

  return (
    <AuthLayout>
      {/* Card Header — logo + text, gap-8 */}
      <div className="flex w-full flex-col items-center gap-8">
        <NovaLogo />
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.75px] text-foreground whitespace-nowrap">
            Log in to Nova
          </h1>
        </div>
      </div>

      {/* Body + action */}
      <div className="flex w-full flex-col items-center gap-5">
        <p className="text-sm text-muted-foreground text-center">
          We've sent a magic login link to{" "}
          <span className="font-medium text-foreground">{email}.</span>{" "}
          Open the email and click the link to access your account.
        </p>

        <p className="text-sm text-muted-foreground">
          Didn't get it?{" "}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="font-medium text-foreground hover:underline disabled:opacity-50"
          >
            {resending ? "Resending…" : "Resend"}
          </button>
        </p>

        <Button variant="secondary" className="w-full" onClick={() => navigate("/login")}>
          Go back
        </Button>
      </div>
    </AuthLayout>
  )
}