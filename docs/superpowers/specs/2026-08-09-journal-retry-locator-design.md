# Journal Retry Locator Design

## Goal

Keep the Journal error-state E2E test reliable when another visible surface also
offers an action named **Retry**.

## Design

The product behavior remains unchanged. The shell daemon-status banner and the
Journal entry error are independent states, and both correctly use the action
label **Retry**.

Change the failing assertion in `tests/journal.spec.ts` from a page-global
button lookup to an accessibility-scoped lookup:

```ts
page
  .getByRole("region", { name: "Journal entry" })
  .getByRole("button", { name: "Retry" })
```

The `Journal entry` region is the durable semantic boundary for the action the
test describes. Scoping to it avoids coupling the test to CSS classes while
remaining correct when shell banners, dialogs, or other independent surfaces
also expose a Retry action.

Do not suppress the daemon banner, rename either action, change Journal
behavior, or add product code.

## Verification

1. Reproduce the existing strict-locator failure before the change.
2. Run the focused test normally and with `CI=true`.
3. Run the complete `tests/journal.spec.ts` file.
4. Run `pnpm check:tests-wired`.
5. Run the complete Playwright E2E suite to confirm the original macOS failure
   is removed without affecting other projects.
