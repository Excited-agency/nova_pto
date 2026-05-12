import { describe, it, expect } from "vitest"
import { mapHeaders, splitFullName } from "@/lib/csv-header-mapping"

describe("mapHeaders — exact alias matching", () => {
  it("maps Email, First Name, Last Name correctly", () => {
    const { columnToField, unmappedHeaders } = mapHeaders(["Email", "First Name", "Last Name"])
    expect(columnToField.get("Email")).toBe("email")
    expect(columnToField.get("First Name")).toBe("first_name")
    expect(columnToField.get("Last Name")).toBe("last_name")
    expect(unmappedHeaders).toHaveLength(0)
  })

  it("is case-insensitive for exact matches", () => {
    const { columnToField } = mapHeaders(["EMAIL", "first name", "LAST NAME"])
    expect(columnToField.get("EMAIL")).toBe("email")
    expect(columnToField.get("first name")).toBe("first_name")
    expect(columnToField.get("LAST NAME")).toBe("last_name")
  })

  it("maps known aliases: 'work email', 'surname', 'dept'", () => {
    const { columnToField } = mapHeaders(["work email", "surname", "dept"])
    expect(columnToField.get("work email")).toBe("email")
    expect(columnToField.get("surname")).toBe("last_name")
    expect(columnToField.get("dept")).toBe("department")
  })

  it("maps hire_date aliases: 'Start Date', 'Join Date'", () => {
    const { columnToField } = mapHeaders(["Start Date", "Join Date"])
    // Only one can be mapped (first wins for same field)
    expect(columnToField.get("Start Date")).toBe("hire_date")
  })

  it("maps 'Full Name' to full_name", () => {
    const { columnToField } = mapHeaders(["Full Name", "Email"])
    expect(columnToField.get("Full Name")).toBe("full_name")
  })
})

describe("mapHeaders — substring fallback (Phase 2)", () => {
  it("maps via substring when no exact match exists", () => {
    const { columnToField } = mapHeaders(["Employee Email Address"])
    // "mail" substring matches email
    expect(columnToField.get("Employee Email Address")).toBe("email")
  })

  it("maps 'hire' substring to hire_date", () => {
    const { columnToField } = mapHeaders(["HireDate"])
    expect(columnToField.get("HireDate")).toBe("hire_date")
  })
})

describe("mapHeaders — unmapped headers", () => {
  it("puts unknown headers in unmappedHeaders", () => {
    const { unmappedHeaders } = mapHeaders(["employee_code", "badge_number"])
    expect(unmappedHeaders).toContain("employee_code")
    expect(unmappedHeaders).toContain("badge_number")
  })

  it("known headers do not appear in unmappedHeaders", () => {
    const { unmappedHeaders } = mapHeaders(["Email", "First Name", "unknown_col"])
    expect(unmappedHeaders).not.toContain("Email")
    expect(unmappedHeaders).not.toContain("First Name")
    expect(unmappedHeaders).toContain("unknown_col")
  })
})

describe("mapHeaders — duplicate prevention", () => {
  it("only maps first matching column when two headers match same field", () => {
    const { columnToField } = mapHeaders(["Email", "work email"])
    // Both could be "email" — first one wins
    const mappedCount = [...columnToField.values()].filter(v => v === "email").length
    expect(mappedCount).toBe(1)
    expect(columnToField.get("Email")).toBe("email")
  })
})

describe("splitFullName", () => {
  it("splits 'John Doe' into first=John last=Doe", () => {
    const result = splitFullName("John Doe")
    expect(result.first_name).toBe("John")
    expect(result.last_name).toBe("Doe")
  })

  it("handles single name (no space) → first only", () => {
    const result = splitFullName("Madonna")
    expect(result.first_name).toBe("Madonna")
    expect(result.last_name).toBe("")
  })

  it("handles multi-word last name: 'Mary Jane Watson'", () => {
    const result = splitFullName("Mary Jane Watson")
    expect(result.first_name).toBe("Mary")
    expect(result.last_name).toBe("Jane Watson")
  })

  it("trims whitespace", () => {
    const result = splitFullName("  John  Doe  ")
    expect(result.first_name).toBe("John")
    expect(result.last_name).toBe("Doe")
  })

  it("handles empty string", () => {
    const result = splitFullName("")
    expect(result.first_name).toBe("")
    expect(result.last_name).toBe("")
  })
})
