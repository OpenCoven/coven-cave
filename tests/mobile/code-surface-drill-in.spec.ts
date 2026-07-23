import { expect, test, type Page } from "@playwright/test";

// Code surface mobile drill-in (cave-k0ua): below the md breakpoint the
// session rail IS the landing screen — no auto-pick of the newest session —
// and choosing a session replaces the list with the full-width workbench,
// returned from via the "Back to sessions" affordance.
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
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
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
    await expect(page.getByRole("tablist", { name: "Session workbench" })).toHaveCount(0);

    // Drill in: the workbench replaces the list.
    await railRow.click();
    await expect(page.getByRole("heading", { name: "Refactor auth flow" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tablist", { name: "Session workbench" })).toBeVisible();
    await expect(railRow).toBeHidden();

    // Back: the list returns and stays (no auto-pick re-selects the session).
    await page.getByRole("button", { name: "Back to sessions" }).click();
    await expect(railRow).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Session workbench" })).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(page.getByRole("tablist", { name: "Session workbench" })).toHaveCount(0);
  });
});
