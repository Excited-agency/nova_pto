import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { createElement } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  useRejectRequestMutation,
  useApproveRequestMutation,
} from "@/hooks/use-time-off-requests"
import { employeeBalanceKeys, balanceAdjustmentLogKeys, timeOffRequestKeys, myRequestKeys } from "@/lib/query-keys"

vi.mock("@/lib/time-off-request-service", () => ({
  rejectTimeOffRequest: vi.fn().mockResolvedValue(undefined),
  approveTimeOffRequest: vi.fn().mockResolvedValue(undefined),
  fetchTimeOffRequests: vi.fn().mockResolvedValue([]),
  fetchMyTimeOffRequests: vi.fn().mockResolvedValue([]),
  fetchEmployeeBalance: vi.fn().mockResolvedValue(null),
  fetchEmployeeBalances: vi.fn().mockResolvedValue([]),
  fetchBalanceAdjustmentLog: vi.fn().mockResolvedValue([]),
  bulkUpdateEmployeeBalances: vi.fn().mockResolvedValue(undefined),
  createTimeOffRecord: vi.fn().mockResolvedValue(undefined),
  updateTimeOffRequestStatus: vi.fn().mockResolvedValue(undefined),
  fetchActiveEmployeesForCombobox: vi.fn().mockResolvedValue([]),
  submitTimeOffRequest: vi.fn().mockResolvedValue(undefined),
  withdrawTimeOffRequest: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    workspace: { id: "ws-1" },
    profile: { id: "profile-1", role: "admin" as const, workspace_id: "ws-1" },
    session: null,
    user: null,
    loading: false,
  }),
}))

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return { qc, invalidateSpy, wrapper }
}

// ─── reject mutation ──────────────────────────────────────────────────────────

describe("useRejectRequestMutation cache invalidation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("invalidates timeOffRequestKeys", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useRejectRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", reason: "nope", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(timeOffRequestKeys.all("ws-1")))
  })

  it("invalidates myRequestKeys for the employee", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useRejectRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", reason: "nope", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(myRequestKeys.all("emp-1")))
  })

  it("invalidates employeeBalanceKeys after reject (symmetric with approve)", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useRejectRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", reason: "nope", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(employeeBalanceKeys.allForEmployee("ws-1", "emp-1")))
  })

  it("invalidates balanceAdjustmentLogKeys after reject (symmetric with approve)", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useRejectRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", reason: "nope", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(balanceAdjustmentLogKeys.allForEmployee("ws-1", "emp-1")))
  })
})

// ─── approve mutation ─────────────────────────────────────────────────────────

describe("useApproveRequestMutation cache invalidation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("invalidates timeOffRequestKeys", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useApproveRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(timeOffRequestKeys.all("ws-1")))
  })

  it("invalidates employeeBalanceKeys after approve", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useApproveRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(employeeBalanceKeys.allForEmployee("ws-1", "emp-1")))
  })

  it("invalidates balanceAdjustmentLogKeys after approve", async () => {
    const { invalidateSpy, wrapper } = makeWrapper()
    const { result } = renderHook(() => useApproveRequestMutation(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ requestId: "req-1", profileId: "emp-1" })
    })

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    expect(keys).toContain(JSON.stringify(balanceAdjustmentLogKeys.allForEmployee("ws-1", "emp-1")))
  })
})

// ─── symmetry assertion ───────────────────────────────────────────────────────

describe("reject and approve invalidation symmetry", () => {
  it("reject invalidates the same keys as approve", async () => {
    const rejectWrapper = makeWrapper()
    const approveWrapper = makeWrapper()

    const { result: rejectHook } = renderHook(() => useRejectRequestMutation(), { wrapper: rejectWrapper.wrapper })
    const { result: approveHook } = renderHook(() => useApproveRequestMutation(), { wrapper: approveWrapper.wrapper })

    await act(async () => {
      await rejectHook.current.mutateAsync({ requestId: "r1", reason: "x", profileId: "emp-1" })
    })
    await act(async () => {
      await approveHook.current.mutateAsync({ requestId: "r1", profileId: "emp-1" })
    })

    const rejectKeys = new Set(
      rejectWrapper.invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    )
    const approveKeys = new Set(
      approveWrapper.invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))
    )

    const expectedSharedKeys = [
      timeOffRequestKeys.all("ws-1"),
      employeeBalanceKeys.allForEmployee("ws-1", "emp-1"),
      balanceAdjustmentLogKeys.allForEmployee("ws-1", "emp-1"),
    ]

    for (const key of expectedSharedKeys) {
      const serialized = JSON.stringify(key)
      expect(rejectKeys, `reject should invalidate ${serialized}`).toContain(serialized)
      expect(approveKeys, `approve should invalidate ${serialized}`).toContain(serialized)
    }
  })
})
