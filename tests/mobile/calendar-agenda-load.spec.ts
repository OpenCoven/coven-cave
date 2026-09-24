import { expect, test } from "@playwright/test";

// Design language §10: a failed request never renders as a convincing empty
// collection (#5527). The phone calendar opens on the agenda, which used to
// read "Nothing scheduled upcoming." when reminders had simply failed to load.
// Lives under tests/mobile/ so the pixel-5 and iphone-13 projects run it.

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, "the phone calendar opens on the agenda");
});

test("a failed reminders read says so, and Retry recovers to the honest empty state", async ({ page }) => {
  let inboxReads = 0;
  // `/` decides on the server whether to render onboarding, from this cookie.
  const host = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1").hostname;
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: host, path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active" }] },
    }),
  );
  // A non-200 stream fails the EventSource for good, so no snapshot arrives.
  await page.route("**/api/inbox/stream**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.route(/\/api\/inbox(\?.*)?$/, (route) => {
    inboxReads += 1;
    return route.fulfill({ json: { ok: true, items: [] } });
  });

  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "calendar" } }));
      // Wait for the agenda itself: unrelated alerts exist on every surface.
      return document.getElementById("calendar-view-panel") !== null;
    },
    undefined,
    { timeout: 30_000 },
  );

  const failure = page.getByRole("alert").filter({ hasText: "Couldn't load reminders." });
  await expect(failure).toBeVisible();
  await expect(page.getByText("Nothing upcoming.")).toHaveCount(0);

  const readsBeforeRetry = inboxReads;
  await page.getByRole("button", { name: "Retry loading reminders" }).click();
  await expect(page.getByText("Nothing upcoming.")).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(inboxReads, "Retry re-reads reminders").toBeGreaterThan(readsBeforeRetry);
});
