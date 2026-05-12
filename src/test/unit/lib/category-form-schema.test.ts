import { describe, it, expect } from "vitest"
import { categoryFormSchema, categoryFormDefaults } from "@/lib/category-form-schema"

function valid(overrides = {}) {
  return { ...categoryFormDefaults, name: "Vacation", amount_value: 20, granting_frequency: "yearly" as const, ...overrides }
}

describe("categoryFormSchema — basic validation", () => {
  it("passes with minimal valid fixed accrual", () => {
    const result = categoryFormSchema.safeParse(valid())
    expect(result.success).toBe(true)
  })

  it("fails when name is empty", () => {
    const result = categoryFormSchema.safeParse(valid({ name: "" }))
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message)
      expect(messages).toContain("Category name is required")
    }
  })

  it("fails when amount_value missing for 'fixed' method", () => {
    const result = categoryFormSchema.safeParse(valid({ amount_value: null }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("amount_value")
  })

  it("passes when accrual_method is 'unlimited' without amount_value", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "unlimited",
      amount_value: null,
      granting_frequency: null,
    }))
    expect(result.success).toBe(true)
  })
})

describe("categoryFormSchema — fixed accrual", () => {
  it("fails when granting_frequency is missing for 'fixed' method", () => {
    const result = categoryFormSchema.safeParse(valid({ granting_frequency: null }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("granting_frequency")
  })

  it("passes with all required fixed fields", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "fixed",
      amount_value: 15,
      granting_frequency: "yearly",
    }))
    expect(result.success).toBe(true)
  })
})

describe("categoryFormSchema — periodic accrual", () => {
  it("fails when granting_frequency missing for 'periodic'", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "periodic",
      granting_frequency: null,
      accrual_day: "1",
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("granting_frequency")
  })

  it("fails when accrual_day missing for 'periodic'", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "periodic",
      granting_frequency: "monthly",
      accrual_day: null,
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("accrual_day")
  })

  it("passes with all required periodic fields", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "periodic",
      amount_value: 2,
      granting_frequency: "monthly",
      accrual_day: "1",
    }))
    expect(result.success).toBe(true)
  })
})

describe("categoryFormSchema — anniversary accrual", () => {
  it("fails when anniversary_years is missing", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "anniversary",
      amount_value: 5,
      granting_frequency: null,
      anniversary_years: null,
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("anniversary_years")
  })

  it("fails when anniversary_years is non-integer (float)", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "anniversary",
      amount_value: 5,
      granting_frequency: null,
      anniversary_years: 1.5,
    }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain("whole number")
  })

  it("passes with integer anniversary_years", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "anniversary",
      amount_value: 5,
      granting_frequency: null,
      anniversary_years: 2,
    }))
    expect(result.success).toBe(true)
  })
})

describe("categoryFormSchema — new hire waiting period", () => {
  it("fails when waiting_period_value missing and rule is 'waiting_period'", () => {
    const result = categoryFormSchema.safeParse(valid({
      new_hire_rule: "waiting_period",
      waiting_period_value: null,
      waiting_period_unit: "month",
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("waiting_period_value")
  })

  it("fails when waiting_period_unit missing", () => {
    const result = categoryFormSchema.safeParse(valid({
      new_hire_rule: "waiting_period",
      waiting_period_value: 3,
      waiting_period_unit: null,
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("waiting_period_unit")
  })

  it("passes with waiting_period rule fully filled", () => {
    const result = categoryFormSchema.safeParse(valid({
      new_hire_rule: "waiting_period",
      waiting_period_value: 3,
      waiting_period_unit: "month",
    }))
    expect(result.success).toBe(true)
  })

  it("passes with immediate rule without waiting period fields", () => {
    const result = categoryFormSchema.safeParse(valid({
      new_hire_rule: "immediate",
      waiting_period_value: null,
      waiting_period_unit: null,
    }))
    expect(result.success).toBe(true)
  })
})

describe("categoryFormSchema — carryover", () => {
  it("fails when carryover_limit_enabled=true for 'fixed' method without carryover_max_days", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "fixed",
      carryover_limit_enabled: true,
      carryover_max_days: null,
    }))
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map(e => e.path.join("."))
    expect(paths).toContain("carryover_max_days")
  })

  it("passes when carryover_limit_enabled=true for 'unlimited' (no max required)", () => {
    const result = categoryFormSchema.safeParse(valid({
      accrual_method: "unlimited",
      amount_value: null,
      granting_frequency: null,
      carryover_limit_enabled: true,
      carryover_max_days: null,
    }))
    expect(result.success).toBe(true)
  })

  it("passes when carryover_limit_enabled=false without max_days", () => {
    const result = categoryFormSchema.safeParse(valid({
      carryover_limit_enabled: false,
      carryover_max_days: null,
    }))
    expect(result.success).toBe(true)
  })

  it("passes when carryover_limit_enabled=true with carryover_max_days provided", () => {
    const result = categoryFormSchema.safeParse(valid({
      carryover_limit_enabled: true,
      carryover_max_days: 5,
    }))
    expect(result.success).toBe(true)
  })
})
