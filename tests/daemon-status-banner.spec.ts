import { expect, test, type Page } from "@playwright/test";

// #5530: an unreachable daemon used to put Node's socket error in the global
// banner verbatim ("Daemon status unavailable — connect EINVAL <path> - Local
// (undefined:undefined)") and Rituals stacked a second warning with the same
// text. The banner now reads plainly, keeps the raw error behind "Details",
// and Rituals leaves the outage to that one banner. Daemon-less: the status
// route and the Rituals load are mocked.

const RAW =
  "connect EINVAL /var/folders/xx/T/cave-e2e-scratch-3f9a/a/very/long/socket/path/coven.sock - Local (undefined:undefined)";

async function openRituals(page: Page, daemon: "unreachable" | "online") {
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({
      json:
        daemon === "unreachable"
          ? { running: false, availability: "unreachable", reason: RAW, target: { mode: "local" } }
          : { running: true, availability: "online", target: { mode: "local" } },
    }),
  );
  // Exactly the Schedules list; /api/inbox/prefs and /api/inbox/stream are
  // separate resources this test doesn't exercise.
  await page.route((url) => url.pathname === "/api/inbox", (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: `daemon request failed: ${RAW}` } }),
  );
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  // Resolves once Rituals' own load has been answered, so the assertions below
  // judge the settled surface rather than a load still in flight.
  const ritualsLoadServed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/inbox");
  await page.goto("/");
  await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "calendar" } })),
    );
    await expect(page.getByRole("region", { name: /^Rituals/ })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  await ritualsLoadServed;
  // Rituals' own chrome is rendered, so its load result has somewhere to show.
  await expect(page.getByRole("tablist", { name: "Rituals sections" })).toBeVisible({ timeout: 30_000 });
}

test.describe("daemon status banner", () => {
  // Two cold surface loads under `next dev` (the shell, then the Rituals chunk).
  test.describe.configure({ timeout: 120_000 });

  test("an unreachable daemon gets one plain banner with the raw error behind Details", async ({ page }) => {
    await openRituals(page, "unreachable");

    const banner = page.locator(".shell-banner").filter({ hasText: "Can’t reach the Coven daemon" });
    await expect(banner).toHaveCount(1);
    await expect(banner.locator(".shell-banner__title")).toHaveText("Can’t reach the Coven daemon");
    await expect(banner.getByRole("button", { name: "Retry" })).toBeVisible();

    // The raw socket error is not visible anywhere until Details is opened.
    await expect(page.getByText("connect EINVAL", { exact: false }).filter({ visible: true })).toHaveCount(0);
    // Rituals' own load failure is the same outage: no second warning. The
    // load has been answered (openRituals), and Rituals has rendered its
    // settled state, so this absence is not a race.
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("alert").filter({ hasText: "daemon request failed" })).toHaveCount(0);

    await banner.getByText("Details", { exact: true }).click();
    const detail = banner.locator(".shell-banner__detail code");
    await expect(detail).toBeVisible();
    await expect(detail).toHaveText(RAW);
    await expect(page.getByText("connect EINVAL", { exact: false }).filter({ visible: true })).toHaveCount(1);
  });

  test("Rituals still reports its own load failure when the daemon banner is not up", async ({ page }) => {
    await openRituals(page, "online");

    await expect(page.locator(".shell-banner").filter({ hasText: "Coven daemon" })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "daemon request failed" })).toBeVisible({ timeout: 15_000 });
  });
});
