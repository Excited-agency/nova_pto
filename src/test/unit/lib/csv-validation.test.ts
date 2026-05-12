import { describe, it, expect } from "vitest"
import { processRows, rowHasErrors, rowHasWarnings } from "@/lib/csv-validation"
import { mapHeaders } from "@/lib/csv-header-mapping"

function makeMapping(headers: string[]) {
  return mapHeaders(headers)
}

function makeDeptMap(entries: [string, string][] = []) {
  return new Map<string, string>(entries)
}

function makeRaw(overrides: Record<string, string>) {
  return [overrides]
}

describe("processRows — email validation", () => {
  const mapping = makeMapping(["Email", "First Name", "Last Name"])
  const deptMap = makeDeptMap()

  it("errors when email is missing", () => {
    const { rows, validations } = processRows({
      rawRows: [{ Email: "", "First Name": "John", "Last Name": "Doe" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows).toHaveLength(1)
    expect(rowHasErrors(0, validations)).toBe(true)
    const issues = validations.get(0)!
    expect(issues.some(v => v.message === "Email is required")).toBe(true)
  })

  it("errors when email format is invalid", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "notanemail", "First Name": "John", "Last Name": "Doe" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rowHasErrors(0, validations)).toBe(true)
    expect(validations.get(0)!.some(v => v.message === "Invalid email format")).toBe(true)
  })

  it("valid email passes without error", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "john@example.com", "First Name": "John", "Last Name": "Doe" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rowHasErrors(0, validations)).toBe(false)
  })

  it("errors when email already exists in workspace", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "existing@example.com", "First Name": "Jane", "Last Name": "Doe" }],
      mapping,
      departmentNameToId: deptMap,
      existingEmails: new Set(["existing@example.com"]),
    })
    expect(rowHasErrors(0, validations)).toBe(true)
    expect(validations.get(0)!.some(v => v.message === "Already exists in workspace")).toBe(true)
  })

  it("email existence check is case-insensitive", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "EXISTING@EXAMPLE.COM", "First Name": "Jane", "Last Name": "Doe" }],
      mapping,
      departmentNameToId: deptMap,
      existingEmails: new Set(["existing@example.com"]),
    })
    expect(rowHasErrors(0, validations)).toBe(true)
  })

  it("marks second row as duplicate when same email appears twice", () => {
    const { validations } = processRows({
      rawRows: [
        { Email: "dup@example.com", "First Name": "John", "Last Name": "Doe" },
        { Email: "dup@example.com", "First Name": "Jane", "Last Name": "Smith" },
      ],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rowHasErrors(0, validations)).toBe(false)
    expect(rowHasErrors(1, validations)).toBe(true)
    expect(validations.get(1)!.some(v => v.message === "Duplicate of row 1")).toBe(true)
  })
})

describe("processRows — name validation", () => {
  const mapping = makeMapping(["Email"])
  const deptMap = makeDeptMap()

  it("warns when both first and last name are missing", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "a@b.com" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rowHasErrors(0, validations)).toBe(false)
    expect(rowHasWarnings(0, validations)).toBe(true)
    expect(validations.get(0)!.some(v => v.message === "Name is missing")).toBe(true)
  })

  it("no name warning when first_name is present", () => {
    const mappingWithName = makeMapping(["Email", "First Name"])
    const { validations } = processRows({
      rawRows: [{ Email: "a@b.com", "First Name": "John" }],
      mapping: mappingWithName,
      departmentNameToId: deptMap,
    })
    const nameIssues = validations.get(0)?.filter(v => v.message === "Name is missing") ?? []
    expect(nameIssues).toHaveLength(0)
  })
})

describe("processRows — department resolution", () => {
  const mapping = makeMapping(["Email", "First Name", "Department"])
  const deptMap = makeDeptMap([["engineering", "dept-123"], ["hr", "dept-456"]])

  it("resolves valid department name to id", () => {
    const { rows } = processRows({
      rawRows: [{ Email: "a@b.com", "First Name": "John", Department: "Engineering" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows[0].department_id).toBe("dept-123")
  })

  it("warns when department not found", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "a@b.com", "First Name": "John", Department: "Sales" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rowHasErrors(0, validations)).toBe(false)
    expect(rowHasWarnings(0, validations)).toBe(true)
    expect(validations.get(0)!.some(v => v.message === 'Department "Sales" not found')).toBe(true)
  })

  it("department matching is case-insensitive", () => {
    const { rows } = processRows({
      rawRows: [{ Email: "a@b.com", "First Name": "John", Department: "ENGINEERING" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows[0].department_id).toBe("dept-123")
  })
})

describe("processRows — hire date parsing", () => {
  const mapping = makeMapping(["Email", "Hire Date"])
  const deptMap = makeDeptMap()

  it("parses ISO format (YYYY-MM-DD) without warning", () => {
    const { rows, validations } = processRows({
      rawRows: [{ Email: "a@b.com", "Hire Date": "2026-03-15" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows[0].hire_date).toBe("2026-03-15")
    const dateIssues = validations.get(0)?.filter(v => v.field === "hire_date") ?? []
    expect(dateIssues).toHaveLength(0)
  })

  it("parses MM/DD/YYYY and adds ambiguity warning", () => {
    const { rows, validations } = processRows({
      rawRows: [{ Email: "a@b.com", "Hire Date": "03/04/2026" }],
      mapping,
      departmentNameToId: deptMap,
    })
    // Interpreted as March 4 (US format)
    expect(rows[0].hire_date).toBe("2026-03-04")
    const warning = validations.get(0)?.find(v => v.field === "hire_date")
    expect(warning?.severity).toBe("warning")
    expect(warning?.message).toContain("Interpreted as 2026-03-04")
  })

  it("parses DD.MM.YYYY (EU dot format) as day-month", () => {
    const { rows } = processRows({
      rawRows: [{ Email: "a@b.com", "Hire Date": "05.03.2026" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows[0].hire_date).toBe("2026-03-05")
  })

  it("warns when date cannot be parsed", () => {
    const { validations } = processRows({
      rawRows: [{ Email: "a@b.com", "Hire Date": "not-a-date" }],
      mapping,
      departmentNameToId: deptMap,
    })
    const warning = validations.get(0)?.find(v => v.field === "hire_date")
    expect(warning?.severity).toBe("warning")
    expect(warning?.message).toContain("Could not parse date format")
  })
})

describe("processRows — role normalization", () => {
  const mapping = makeMapping(["Email", "Role"])
  const deptMap = makeDeptMap()

  it("normalizes 'administrator' to 'admin' (with warning since it's non-exact alias)", () => {
    const { rows, validations } = processRows({
      rawRows: [{ Email: "a@b.com", Role: "administrator" }],
      mapping,
      departmentNameToId: deptMap,
    })
    // Role is correctly mapped to "admin"
    expect(rows[0].role).toBe("admin")
    // A warning is generated because "administrator" !== "admin" (normalizeRole changed the value)
    const roleWarnings = validations.get(0)?.filter(v => v.field === "role") ?? []
    expect(roleWarnings).toHaveLength(1)
    expect(roleWarnings[0].severity).toBe("warning")
  })

  it("normalizes unknown role to 'user' with warning", () => {
    const { rows, validations } = processRows({
      rawRows: [{ Email: "a@b.com", Role: "manager" }],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows[0].role).toBe("user")
    const warning = validations.get(0)?.find(v => v.field === "role")
    expect(warning?.severity).toBe("warning")
    expect(warning?.message).toContain("Unrecognized role")
  })

  it("defaults to 'user' when role column missing", () => {
    const mappingNoRole = makeMapping(["Email"])
    const { rows } = processRows({
      rawRows: [{ Email: "a@b.com" }],
      mapping: mappingNoRole,
      departmentNameToId: deptMap,
    })
    expect(rows[0].role).toBe("user")
  })
})

describe("processRows — empty rows", () => {
  const mapping = makeMapping(["Email", "First Name", "Last Name"])
  const deptMap = makeDeptMap()

  it("skips completely empty rows", () => {
    const { rows } = processRows({
      rawRows: [
        { Email: "a@b.com", "First Name": "John", "Last Name": "Doe" },
        { Email: "", "First Name": "", "Last Name": "" },
        { Email: "b@b.com", "First Name": "Jane", "Last Name": "Smith" },
      ],
      mapping,
      departmentNameToId: deptMap,
    })
    expect(rows).toHaveLength(2)
  })
})

describe("processRows — Full Name column", () => {
  it("splits Full Name into first and last", () => {
    const mapping = makeMapping(["Email", "Full Name"])
    const { rows } = processRows({
      rawRows: [{ Email: "a@b.com", "Full Name": "John Doe" }],
      mapping,
      departmentNameToId: makeDeptMap(),
    })
    expect(rows[0].first_name).toBe("John")
    expect(rows[0].last_name).toBe("Doe")
  })
})

describe("rowHasErrors / rowHasWarnings", () => {
  it("rowHasErrors returns false for unknown index", () => {
    expect(rowHasErrors(99, new Map())).toBe(false)
  })

  it("rowHasWarnings returns false when also has errors", () => {
    const validations = new Map([
      [0, [
        { rowIndex: 0, field: "email", message: "Invalid", severity: "error" as const },
        { rowIndex: 0, field: "name", message: "Missing name", severity: "warning" as const },
      ]],
    ])
    expect(rowHasWarnings(0, validations)).toBe(false)
  })

  it("rowHasWarnings returns true for warning-only row", () => {
    const validations = new Map([
      [0, [{ rowIndex: 0, field: "name", message: "Missing name", severity: "warning" as const }]],
    ])
    expect(rowHasWarnings(0, validations)).toBe(true)
  })
})
