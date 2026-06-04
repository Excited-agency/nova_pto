import { useState } from "react"
import { useNavigate, Navigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { getSiteUrl } from "@/lib/site-url"
import { useAuth } from "@/hooks/use-auth"
import { AuthLayout } from "@/components/auth-layout"
import { NovaLogo } from "@/components/nova-logo"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function LoginPage() {
  const { user, workspace, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  if (loading) return null
  if (user && workspace) return <Navigate to="/requests" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${getSiteUrl()}/auth/callback` },
    })
    setSubmitting(false)
    if (error) { setError(error.message); return }
    navigate("/check-email", { state: { email } })
  }

  return (
    <AuthLayout>
      {/* Card Header — logo + text, gap-8 between them (Figma) */}
      <div className="flex w-full flex-col items-center gap-8">
        <NovaLogo />
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.75px] text-foreground whitespace-nowrap">
            Log in to Nova
          </h1>
          <p className="text-base leading-6 tracking-[-0.32px] text-muted-foreground">
            Simple leave management for teams.
          </p>
        </div>
      </div>

      {/* Form — input + button, gap-5 between them (Figma) */}
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
        <Input
          type="email"
          placeholder="example@mail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p className="text-sm text-destructive -mt-2">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting} loading={submitting}>
          Continue with email
        </Button>
      </form>


    </AuthLayout>
  )
}