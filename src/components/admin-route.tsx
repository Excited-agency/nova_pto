import { Navigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import type { ReactNode } from "react"

export function AdminRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
      </div>
    )
  }

  if (profile?.role !== "admin") {
    return <Navigate to="/access-restricted" replace />
  }

  return children
}
