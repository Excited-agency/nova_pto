import { test, expect } from "@playwright/test"
import { createTestUser, seedSession, cleanupTestUser } from "../../fixtures/auth"

test.describe("Core Web Vitals", () => {
  let adminUser: Awaited<ReturnType<typeof createTestUser>>

  test.beforeAll(async () => {
    adminUser = await createTestUser("admin")
  })

  test.afterAll(async () => {
    await cleanupTestUser(adminUser)
  })

  test("LCP on /requests is under 2500ms", async ({ page }) => {
    await seedSession(page, adminUser)

    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number }
        ;(window as any).__LCP__ = last.startTime
      }).observe({ type: "largest-contentful-paint", buffered: true })
    })

    await page.goto("/requests")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500) // Allow LCP to settle

    const lcp = await page.evaluate(() => (window as any).__LCP__ ?? 0)
    console.log(`LCP /requests: ${lcp}ms`)
    expect(lcp).toBeLessThan(2500)
  })

  test("FCP on /employees is under 1800ms", async ({ page }) => {
    await seedSession(page, adminUser)

    await page.addInitScript(() => {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            ;(window as any).__FCP__ = entry.startTime
          }
        }
      }).observe({ type: "paint", buffered: true })
    })

    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(300)

    const fcp = await page.evaluate(() => (window as any).__FCP__ ?? 0)
    console.log(`FCP /employees: ${fcp}ms`)
    expect(fcp).toBeLessThan(1800)
  })

  test("CLS on /settings is under 0.1", async ({ page }) => {
    await seedSession(page, adminUser)

    await page.addInitScript(() => {
      let cls = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as any[]) {
          if (!entry.hadRecentInput) cls += entry.value
        }
        ;(window as any).__CLS__ = cls
      }).observe({ type: "layout-shift", buffered: true })
    })

    await page.goto("/settings")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    const cls = await page.evaluate(() => (window as any).__CLS__ ?? 0)
    console.log(`CLS /settings: ${cls}`)
    expect(cls).toBeLessThan(0.1)
  })

  test("page navigation completes within 2000ms for /employees", async ({ page }) => {
    await seedSession(page, adminUser)
    await page.goto("/requests")
    await page.waitForLoadState("networkidle")

    const start = Date.now()
    await page.goto("/employees")
    await page.waitForLoadState("networkidle")
    const elapsed = Date.now() - start

    console.log(`Navigation to /employees: ${elapsed}ms`)
    expect(elapsed).toBeLessThan(2000)
  })
})
