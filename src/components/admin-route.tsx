import { Navigate } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import type { ReactNode } from "react"

export function AdminRoute({ children }: { children: ReactNode }) {
  const { profile } = useAuth()

  if (profile?.role !== "admin") {
    return <Navigate to="/access-restricted" replace />
  }

  return children
}
