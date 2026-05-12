# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/settings/danger-zone.spec.ts >> Danger zone — delete workspace >> confirming delete removes workspace and redirects to /login
- Location: e2e/tests/settings/danger-zone.spec.ts:54:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic:
  - generic:
    - generic:
      - complementary:
        - generic:
          - generic:
            - button:
              - img
              - generic:
                - generic: E2E WS 1778526005395-e22sto
        - generic:
          - generic:
            - button:
              - img
              - generic: Requests
          - generic:
            - button:
              - img
              - generic: Employees
          - generic:
            - button:
              - img
              - generic: Calendar
          - generic:
            - button:
              - img
              - generic: Time-off setup
          - generic:
            - button:
              - img
              - generic: Settings
        - generic:
          - generic:
            - generic: AT
          - generic:
            - generic: Admin Test
            - generic: e2e-1778526005395-e22sto@test.invalid
          - button:
            - img
      - main:
        - generic:
          - generic:
            - button:
              - img
            - generic: Settings
          - generic:
            - generic:
              - generic:
                - heading [level=1]: Settings
                - paragraph: Personalize how Nova looks for your entire team
              - generic:
                - heading [level=2]: General
                - generic:
                  - generic: Workspace name
                  - textbox:
                    - /placeholder: Your workspace
                    - text: E2E WS 1778526005395-e22sto
                - generic:
                  - generic: Workspace logo
                  - generic:
                    - generic:
                      - generic: E
                    - generic:
                      - generic:
                        - button:
                          - generic:
                            - img
                            - text: Upload logo
                        - button [disabled]:
                          - generic: Remove
                      - paragraph: PNG or JPG, up to 2 MB
              - generic:
                - heading [level=2]: Personal details
                - generic:
                  - generic:
                    - generic: First name
                    - textbox:
                      - /placeholder: First name
                      - text: Admin
                  - generic:
                    - generic: Last name
                    - textbox:
                      - /placeholder: Last name
                      - text: Test
                - generic:
                  - generic: Your photo
                  - generic:
                    - generic:
                      - generic: AT
                    - generic:
                      - generic:
                        - button:
                          - generic:
                            - img
                            - text: Upload photo
                        - button [disabled]:
                          - generic: Remove
                      - paragraph: PNG or JPG, up to 2 MB
              - generic:
                - generic:
                  - heading [level=2]: Departments
                  - button:
                    - generic:
                      - img
                      - text: Add department
              - generic:
                - heading [level=2]: Danger Zone
                - generic:
                  - generic:
                    - paragraph: Delete this workspace
                    - paragraph: Permanently delete this workspace and all its data. This action cannot be undone.
                  - button [expanded]:
                    - generic: Delete workspace
              - generic:
                - button [disabled]:
                  - generic: Cancel
                - generic:
                  - button [disabled]:
                    - generic: Save changes
    - generic:
      - generic:
        - img
      - button:
        - img
  - alertdialog "Delete workspace" [active] [ref=e2]:
    - generic [ref=e3]:
      - heading "Delete workspace" [level=2] [ref=e4]
      - paragraph [ref=e5]: This will permanently delete the workspace “E2E WS 1778526005395-e22sto”, all employees, time-off requests, categories, and settings. All team members will be signed out and removed. This action cannot be undone.
    - generic [ref=e6]:
      - generic [ref=e7]: Type E2E WS 1778526005395-e22sto to confirm
      - textbox "E2E WS 1778526005395-e22sto" [ref=e8]
    - generic [ref=e9]:
      - button "Cancel" [ref=e10] [cursor=pointer]:
        - generic [ref=e11]: Cancel
      - button "Delete workspace" [ref=e12] [cursor=pointer]:
        - generic [ref=e13]: Delete workspace
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test"
  2   | import { createTestUser, seedSession, deleteAuthUser, adminClient } from "../../fixtures/auth"
  3   | 
  4   | test.describe("Danger zone — delete workspace", () => {
  5   |   test("delete button is disabled until correct workspace name is typed", async ({ page }) => {
  6   |     const adminUser = await createTestUser("admin")
  7   | 
  8   |     try {
  9   |       await seedSession(page, adminUser)
  10  |       await page.goto("/settings")
  11  |       await page.waitForLoadState("networkidle")
  12  |       await page.waitForTimeout(500)
  13  | 
  14  |       // Click the trigger to open the delete dialog
  15  |       const triggerBtn = page.getByRole("button", { name: /delete workspace/i })
  16  |       if ((await triggerBtn.count()) === 0) {
  17  |         // UI not implemented yet — skip gracefully
  18  |         return
  19  |       }
  20  | 
  21  |       await triggerBtn.scrollIntoViewIfNeeded()
  22  |       await triggerBtn.click()
  23  |       await page.waitForTimeout(300)
  24  | 
  25  |       // The dialog should be open now. The confirm button inside the dialog is disabled initially.
  26  |       // There are now TWO "Delete workspace" buttons: trigger (hidden) + dialog button
  27  |       const dialogDeleteBtn = page.getByRole("button", { name: /delete workspace/i }).last()
  28  |       await expect(dialogDeleteBtn).toBeDisabled()
  29  | 
  30  |       // Get actual workspace name from DB
  31  |       const { data: ws } = await adminClient
  32  |         .from("workspaces")
  33  |         .select("name")
  34  |         .eq("id", adminUser.workspaceId)
  35  |         .single()
  36  | 
  37  |       // Confirmation input placeholder equals the workspace name
  38  |       const confirmInput = page.getByPlaceholder(ws!.name)
  39  | 
  40  |       // Type wrong name — button stays disabled
  41  |       await confirmInput.fill("Wrong Name")
  42  |       await expect(dialogDeleteBtn).toBeDisabled()
  43  | 
  44  |       // Type correct name — button should become enabled
  45  |       await confirmInput.clear()
  46  |       await confirmInput.fill(ws!.name)
  47  |       await expect(dialogDeleteBtn).toBeEnabled()
  48  |     } finally {
  49  |       await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
  50  |       await deleteAuthUser(adminUser.userId)
  51  |     }
  52  |   })
  53  | 
  54  |   test("confirming delete removes workspace and redirects to /login", async ({ page }) => {
  55  |     const adminUser = await createTestUser("admin")
  56  | 
  57  |     const { data: ws } = await adminClient
  58  |       .from("workspaces")
  59  |       .select("name")
  60  |       .eq("id", adminUser.workspaceId)
  61  |       .single()
  62  | 
  63  |     await seedSession(page, adminUser)
  64  |     await page.goto("/settings")
  65  |     await page.waitForLoadState("networkidle")
  66  |     await page.waitForTimeout(500)
  67  | 
  68  |     const triggerBtn = page.getByRole("button", { name: /delete workspace/i })
  69  |     if ((await triggerBtn.count()) === 0) {
  70  |       // Danger zone UI not implemented — skip gracefully
  71  |       await adminClient.from("workspaces").delete().eq("id", adminUser.workspaceId)
  72  |       await deleteAuthUser(adminUser.userId)
  73  |       return
  74  |     }
  75  | 
  76  |     await triggerBtn.scrollIntoViewIfNeeded()
  77  |     await triggerBtn.click()
  78  |     await page.waitForTimeout(300)
  79  | 
  80  |     // Fill in the confirmation input inside the dialog
  81  |     const confirmInput = page.getByPlaceholder(ws!.name)
  82  |     await confirmInput.fill(ws!.name)
  83  | 
  84  |     // Click the confirm delete button (last "Delete workspace" button in dialog)
  85  |     const dialogDeleteBtn = page.getByRole("button", { name: /delete workspace/i }).last()
  86  |     await dialogDeleteBtn.click()
  87  | 
  88  |     // Wait for redirect after deletion
> 89  |     await page.waitForURL(/\/login/, { timeout: 15_000 })
      |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  90  |     await expect(page).toHaveURL(/\/login/)
  91  | 
  92  |     // Verify workspace is gone from DB
  93  |     const { data: deleted } = await adminClient
  94  |       .from("workspaces")
  95  |       .select("id")
  96  |       .eq("id", adminUser.workspaceId)
  97  |       .maybeSingle()
  98  |     expect(deleted).toBeNull()
  99  | 
  100 |     await deleteAuthUser(adminUser.userId)
  101 |   })
  102 | })
  103 | 
```