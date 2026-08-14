import { expect, test, type Page } from "@playwright/test";

// Code surface mobile drill-in (cave-k0ua, extended cave-k3a9u): on a narrow
// Room the session rail IS the landing screen — no auto-pick of the newest
// session — and choosing a session replaces the list with the full-width
// workbench, returned from via the "Back to sessions" affordance.
//
// The full flow is Sessions -> Terminal -> Context, per the approved design.
// The third step never existed: the Room tried to stack itself with a CSS
// media query that react-resizable-panels overrides with an inline
// flex-direction, so at 390px it rendered two columns whose minimums alone
// (320px terminal + 300px dock) already exceed the screen. This spec is the
// end-to-end proof that the replacement actually renders.
//
// Lives under tests/mobile/ because Playwright's mobile projects
// (pixel-5 / iphone-13) only match specs there (see playwright.config.ts
// testMatch); guarded mobile-only so the desktop project self-skips (the
// desktop three-pane path is covered in tests/code-surface.spec.ts).
// Daemon-less: onboarding dismissed, APIs mocked, flag ON via webServer env.

const ISO = "2026-06-12T10:00:00.000Z";

const SESSION = {
  id: "s-repo",
  title: "Refactor auth flow",
  project_root: "/repo/alpha",
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

async function base(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", familiarType: "coding", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/changes**", (route) =>
    route.fulfill({ json: { ok: true, repo: true, repoRoot: "/repo/alpha", files: [] } }),
  );
}

test.describe("code surface mobile drill-in", () => {
  test("list first (no auto-pick), tap → workbench, Back → list", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only (desktop path in tests/code-surface.spec.ts)");
    await base(page);
    await page.goto("/?mode=code");

    // Landing: the session list owns the screen; nothing was auto-selected,
    // so the workbench (and its Back bar) is absent.
    const rail = page.getByRole("navigation", { name: "Coding sessions" });
    await expect(rail).toBeVisible({ timeout: 30_000 });
    const railRow = rail.getByText("Refactor auth flow");
    await expect(railRow).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to sessions" })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Workbench step" })).toHaveCount(0);

    // Drill in: the workbench replaces the list, landing on SOURCE — this is a
    // reading surface, and the file you opened is what you came for
    // (cave-0rcku; the previous room landed on the terminal because the
    // terminal was a column).
    await railRow.click();
    const header = page.getByTestId("code-workbench-header");
    await expect(header.getByRole("button", { name: /Refactor auth flow/ })).toBeVisible({ timeout: 15_000 });
    await expect(railRow).toBeHidden();

    const steps = page.getByRole("tablist", { name: "Workbench step" });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    // Only one column shows at this width — three would each be ~130px.
    await expect(page.getByTestId("code-workbench-tree")).toHaveCount(0);
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);

    // THE COMMITMENT: the shell is a drawer, not a step, so narrowing the room
    // never takes it away. Its bar is present on every step.
    const drawerBar = page.getByRole("button", { name: /the terminal drawer/ });
    await expect(drawerBar).toBeVisible();

    // Files and Review are reached explicitly, and each replaces the source.
    await steps.getByRole("tab", { name: "Files" }).click();
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible();
    await expect(drawerBar).toBeVisible();

    await steps.getByRole("tab", { name: "Review" }).click();
    const reviewRail = page.getByTestId("code-review-rail");
    await expect(reviewRail).toBeVisible();
    // A rail closed while the room was wide must not survive into this step:
    // it would be a 28px sliver with no control to recover it. The narrow step
    // always renders it open, so the hide control is what shows here.
    await expect(page.getByRole("button", { name: "Show the review rail" })).toHaveCount(0);
    await expect(drawerBar).toBeVisible();

    // Hiding the rail on a narrow room steps back to the source rather than
    // leaving the step empty.
    await page.getByRole("button", { name: "Hide the review rail" }).click();
    await expect(steps.getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");

    // Back: the list returns and stays (no auto-pick re-selects the session).
    await page.getByRole("button", { name: "Back to sessions" }).click();
    await expect(railRow).toBeVisible();
    await expect(steps).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(steps).toHaveCount(0);
  });
});
