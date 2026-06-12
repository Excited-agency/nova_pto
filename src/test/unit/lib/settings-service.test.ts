import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabase } from "@/lib/supabase"
import { updateProfile } from "@/lib/settings-service"

describe("updateProfile — workspace isolation", () => {
  // Regression: prior version only filtered by .eq("id", profileId) without
  // .eq("workspace_id", workspaceId). An authenticated user from workspace A
  // could have modified profiles from workspace B.

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("includes workspace_id eq filter in the Supabase query", async () => {
    const eqMock = vi.fn().mockReturnThis()
    const updateMock = vi.fn(() => ({ eq: eqMock }))

    vi.mocked(supabase.from).mockReturnValue({
      update: updateMock,
      eq: eqMock,
    } as never)

    // Simulate the chained .eq() calls resolving at the end
    eqMock
      .mockReturnValueOnce({ eq: eqMock })  // first .eq("id", ...)
      .mockResolvedValueOnce({ data: null, error: null })  // second .eq("workspace_id", ...) resolves

    await updateProfile("profile-id-123", "workspace-id-456", { first_name: "Alice" })

    // Verify first eq is for id
    expect(eqMock).toHaveBeenCalledWith("id", "profile-id-123")
    // Verify second eq is for workspace_id — this is the security-critical filter
    expect(eqMock).toHaveBeenCalledWith("workspace_id", "workspace-id-456")
  })

  it("throws if Supabase returns an error", async () => {
    const eqMock = vi.fn().mockReturnThis()
    vi.mocked(supabase.from).mockReturnValue({
      update: vi.fn(() => ({ eq: eqMock })),
      eq: eqMock,
    } as never)

    eqMock
      .mockReturnValueOnce({ eq: eqMock })
      .mockResolvedValueOnce({ data: null, error: { message: "RLS violation" } })

    await expect(
      updateProfile("profile-id-123", "workspace-id-456", { first_name: "Alice" })
    ).rejects.toMatchObject({ message: "RLS violation" })
  })
})
