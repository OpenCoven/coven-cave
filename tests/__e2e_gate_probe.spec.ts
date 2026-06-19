import { test, expect } from "@playwright/test";

// THROWAWAY PROBE — do not merge. Intentionally fails so we can confirm the
// required "E2E (Playwright)" status check blocks merges. The PR is closed,
// never merged, and this file never lands on main.
test("e2e gate probe — intentional failure", async () => {
  expect(1, "intentional failure to verify the e2e required-check gate").toBe(2);
});
