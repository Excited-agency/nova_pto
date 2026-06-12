import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import { AdminRoute } from "@/components/admin-route"
import { renderWithProviders, makeUser, makeProfile, makeWorkspace } from "@/test/utils/render"

function DummyAdmin() {
  return <div data-testid="admin-content">Admin Content</div>
}

describe("AdminRoute", () => {
  const authBase = {
    user: makeUser(),
    loading: false,
    workspace: makeWorkspace(),
  }

  it("renders children when profile.role is 'admin'", () => {
    renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      { auth: { ...authBase, profile: makeProfile({ role: "admin" }) } }
    )
    expect(screen.getByTestId("admin-content")).toBeInTheDocument()
  })

  it("renders children when profile.role is 'owner'", () => {
    renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      { auth: { ...authBase, profile: makeProfile({ role: "owner" }) } }
    )
    expect(screen.getByTestId("admin-content")).toBeInTheDocument()
  })

  it("redirects to /access-restricted when profile.role is 'user'", () => {
    renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      { auth: { ...authBase, profile: makeProfile({ role: "user" }) } }
    )
    expect(screen.queryByTestId("admin-content")).toBeNull()
  })

  it("redirects to /access-restricted when profile is null", () => {
    renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      { auth: { ...authBase, profile: null } }
    )
    expect(screen.queryByTestId("admin-content")).toBeNull()
  })

  it("does not render admin content for 'user' role even if workspace is set", () => {
    renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      {
        auth: {
          ...authBase,
          profile: makeProfile({ role: "user", status: "active" }),
        },
      }
    )
    expect(screen.queryByTestId("admin-content")).toBeNull()
  })

  it("shows a loading spinner while auth is resolving — does not redirect prematurely", () => {
    const { container } = renderWithProviders(
      <AdminRoute><DummyAdmin /></AdminRoute>,
      { auth: { user: makeUser(), loading: true, workspace: null, profile: null } }
    )
    expect(screen.queryByTestId("admin-content")).toBeNull()
    expect(container.querySelector(".animate-spin")).toBeInTheDocument()
  })
})
