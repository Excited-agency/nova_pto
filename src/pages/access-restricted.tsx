import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { fetchWorkspaceAdminEmail } from "@/lib/settings-service"

export function AccessRestrictedPage() {
  const { signOut, profile } = useAuth()
  const navigate = useNavigate()
  const [adminEmail, setAdminEmail] = useState<string | null>(null)

  useEffect(() => {
    const workspaceId = profile?.workspace_id
    if (!workspaceId) return

    let cancelled = false

    fetchWorkspaceAdminEmail(workspaceId).then((email) => {
      if (!cancelled) setAdminEmail(email)
    })

    return () => {
      cancelled = true
    }
  }, [profile?.workspace_id])

  async function handleBackToLogin() {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="flex items-center justify-center size-12 rounded-xl bg-muted">
          <Lock className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-medium tracking-tight text-foreground">
          Access Restricted
        </h1>
        <p className="text-sm text-muted-foreground leading-5">
          Your account has been deactivated. Please contact your workspace administrator
          {adminEmail && (
            <>
              {" "}at <span className="font-medium text-foreground">{adminEmail}</span>
            </>
          )}
          .
        </p>
        <Button variant="secondary" onClick={handleBackToLogin}>
          Back to login
        </Button>
      </div>
    </div>
  )
}
