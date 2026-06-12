import { lazy, Suspense, useEffect } from "react"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { SpeedInsights } from "@vercel/speed-insights/react"
import { AuthProvider } from "@/contexts/auth-context"
import { useAuth } from "@/hooks/use-auth"
import { ProtectedRoute } from "@/components/protected-route"
import { AdminRoute } from "@/components/admin-route"
import { DashboardLayout } from "@/components/layout/DashboardLayout"
import { ErrorBoundary } from "@/components/error-boundary"
import { supabase } from "@/lib/supabase"
import { Toaster } from "@/components/ui/toaster"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status
        if (status === 401 || status === 403 || status === 404) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 15_000),
    },
  },
})

function AuthQueryBridge() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        queryClient.clear()
      }
    })
    return () => subscription.unsubscribe()
  }, [queryClient])

  return null
}

const AuthCallbackPage = lazy(() => import("@/pages/auth-callback").then(m => ({ default: m.AuthCallbackPage })))
const LoginPage = lazy(() => import("@/pages/login").then(m => ({ default: m.LoginPage })))
const CheckEmailPage = lazy(() => import("@/pages/otp-verification").then(m => ({ default: m.CheckEmailPage })))
const RequestsPage = lazy(() => import("@/pages/requests").then(m => ({ default: m.RequestsPage })))
const EmployeesPage = lazy(() => import("@/pages/employees").then(m => ({ default: m.EmployeesPage })))
const AccessRestrictedPage = lazy(() => import("@/pages/access-restricted").then(m => ({ default: m.AccessRestrictedPage })))
const SettingsPage = lazy(() => import("@/pages/settings").then(m => ({ default: m.SettingsPage })))
const AddEmployeePage = lazy(() => import("@/pages/add-employee").then(m => ({ default: m.AddEmployeePage })))
const EmployeeDetailsPage = lazy(() => import("@/pages/employee-details").then(m => ({ default: m.EmployeeDetailsPage })))
const EditEmployeePage = lazy(() => import("@/pages/edit-employee").then(m => ({ default: m.EditEmployeePage })))
const TimeOffSetupPage = lazy(() => import("@/pages/time-off-setup").then(m => ({ default: m.TimeOffSetupPage })))
const AddCategoryPage = lazy(() => import("@/pages/add-category").then(m => ({ default: m.AddCategoryPage })))
const EditCategoryPage = lazy(() => import("@/pages/edit-category").then(m => ({ default: m.EditCategoryPage })))
const ImportPreviewPage = lazy(() => import("@/pages/import-preview").then(m => ({ default: m.ImportPreviewPage })))
const CalendarPage = lazy(() => import("@/pages/calendar").then(m => ({ default: m.CalendarPage })))
const EmployeeRequestsPage = lazy(() => import("@/pages/employee-requests").then(m => ({ default: m.EmployeeRequestsPage })))
const UserSettingsPage = lazy(() => import("@/pages/user-settings").then(m => ({ default: m.UserSettingsPage })))

function RequestsRoute() {
  const { profile } = useAuth()
  if (profile?.role !== "admin" && profile?.role !== "owner") return <EmployeeRequestsPage />
  return <RequestsPage />
}

function SettingsRoute() {
  const { profile } = useAuth()
  if (profile?.role !== "admin" && profile?.role !== "owner") return <UserSettingsPage />
  return <SettingsPage />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryBridge />
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" /></div>}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/check-email" element={<CheckEmailPage />} />
            <Route path="/access-restricted" element={<AccessRestrictedPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="requests" replace />} />
              <Route path="requests" element={<RequestsRoute />} />
              <Route path="employees" element={<AdminRoute><EmployeesPage /></AdminRoute>} />
              <Route path="employees/new" element={<AdminRoute><AddEmployeePage /></AdminRoute>} />
              <Route path="employees/import" element={<AdminRoute><ImportPreviewPage /></AdminRoute>} />
              <Route path="employees/:id" element={<AdminRoute><EmployeeDetailsPage /></AdminRoute>} />
              <Route path="employees/:id/edit" element={<AdminRoute><EditEmployeePage /></AdminRoute>} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="time-off-setup" element={<AdminRoute><TimeOffSetupPage /></AdminRoute>} />
              <Route path="time-off-setup/new" element={<AdminRoute><AddCategoryPage /></AdminRoute>} />
              <Route path="time-off-setup/:id/edit" element={<AdminRoute><EditCategoryPage /></AdminRoute>} />
              <Route path="settings" element={<SettingsRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/requests" replace />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
        <Toaster />
        <SpeedInsights />
      </AuthProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
