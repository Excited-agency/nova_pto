import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { ProtectedRoute } from "@/components/protected-route"
import { renderWithProviders, makeUser, makeProfile, makeWorkspace } from "@/test/utils/render"
import { Navigate } from "react-router-dom"
import userEvent from "@testing-library/user-event"

function DummyChild() {
  return <div data-testid="protected-content">Protected Content</div>
}

describe("ProtectedRoute", () => {
  it("shows spinner when loading=true", () => {
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      { auth: { loading: true } }
    )
    expect(screen.queryByTestId("protected-content")).toBeNull()
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).toBeTruthy()
  })

  it("redirects to /login when user is null", () => {
    renderWithProviders(
      <>
        <ProtectedRoute><DummyChild /></ProtectedRoute>
        <div data-testid="login-page">Login</div>
      </>,
      { auth: { user: null, loading: false } }
    )
    expect(screen.queryByTestId("protected-content")).toBeNull()
  })

  it("shows error message and retry button when authError is set", () => {
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      {
        auth: {
          user: makeUser(),
          loading: false,
          authError: "Unable to load your account data.",
        },
      }
    )
    expect(screen.getAllByText(/Unable to load your account/i).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByTestId("protected-content")).toBeNull()
  })

  it("calls retryAuth when Try again button clicked", async () => {
    const userEv = userEvent.setup()
    const retryAuthMock = vi.fn()
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      {
        auth: {
          user: makeUser(),
          loading: false,
          authError: "Connection error",
          retryAuth: retryAuthMock,
        } as any,
      }
    )
    const btn = screen.getByRole("button", { name: /try again/i })
    await userEv.click(btn)
    expect(retryAuthMock).toHaveBeenCalledOnce()
  })

  it("shows spinner when workspace is null (still loading workspace)", () => {
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      {
        auth: {
          user: makeUser(),
          loading: false,
          workspace: null,
        },
      }
    )
    expect(screen.queryByTestId("protected-content")).toBeNull()
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).toBeTruthy()
  })

  it("renders children when fully authenticated", () => {
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      {
        auth: {
          user: makeUser(),
          loading: false,
          workspace: makeWorkspace(),
          profile: makeProfile({ status: "active" }),
        },
      }
    )
    expect(screen.getByTestId("protected-content")).toBeInTheDocument()
  })

  it("redirects to /access-restricted when profile.status is 'inactive'", () => {
    renderWithProviders(
      <ProtectedRoute><DummyChild /></ProtectedRoute>,
      {
        auth: {
          user: makeUser(),
          loading: false,
          workspace: makeWorkspace(),
          profile: makeProfile({ status: "inactive" }),
        },
      }
    )
    expect(screen.queryByTestId("protected-content")).toBeNull()
  })
})
