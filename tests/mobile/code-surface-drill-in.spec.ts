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
    await expect(page.getByRole("tablist", { name: "Session context" })).toHaveCount(0);

    // Drill in (step 2): the workbench replaces the list, landing on the
    // TERMINAL — the shell is the Room's priority surface. The dock is mounted
    // but hidden, so its tablist must not be visible.
    await railRow.click();
    await expect(page.getByRole("heading", { name: "Refactor auth flow" })).toBeVisible({ timeout: 15_000 });
    await expect(railRow).toBeHidden();
    const dockTabs = page.getByRole("tablist", { name: "Session context" });
    await expect(dockTabs).toBeHidden();

    // Step 3: Context is reached explicitly and the terminal steps aside.
    const contextButton = page.getByRole("button", { name: "Show context" });
    await expect(contextButton).toBeVisible();
    await contextButton.click();
    await expect(dockTabs).toBeVisible();

    // ...and the dock's own Back returns to the terminal. Collapse/expand are
    // meaningless at full width, so Back is the only action offered here.
    await expect(page.getByRole("button", { name: "Collapse context" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to terminal" }).click();
    await expect(dockTabs).toBeHidden();
    await expect(contextButton).toBeVisible();

    // Back: the list returns and stays (no auto-pick re-selects the session).
    await page.getByRole("button", { name: "Back to sessions" }).click();
    await expect(railRow).toBeVisible();
    await expect(dockTabs).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(dockTabs).toHaveCount(0);
  });
});
