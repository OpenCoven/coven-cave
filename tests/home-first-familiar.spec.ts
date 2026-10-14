import { expect, test } from "@playwright/test";
import { seedFirstProjectGate } from "./fixtures/first-project-gate";

// Home before the first familiar or project exists (#5982). Daemon-less:
// every route is mocked, so these journeys run on CI's E2E path.
test.use({ serviceWorkers: "block" });

test.describe("home before the first familiar", () => {
  test.describe.configure({ timeout: 120_000 });

  test("zero familiars: Home offers Summon a familiar and opens the Summoning circle", async ({ page }) => {
    await page.context().addCookies([
      { name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" },
    ]);
    await page.addInitScript(() => {
      localStorage.setItem("cave:onboarding:dismissed", "1");
    });
    await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
    await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [] } }));
    await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
    await page.goto("/?mode=home");

    const summon = page.getByRole("button", { name: "Summon a familiar", exact: true });
    await expect(summon).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No familiars yet. Summon one to start a chat.")).toBeVisible();

    // Sending without a familiar asks for one rather than for a project.
    const composer = page.getByRole("textbox", { name: "Chat message" });
    await composer.fill("Hello there");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Summon a familiar before starting a chat.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create your first project" })).toHaveCount(0);
    await expect(summon).toBeFocused();

    await summon.click();
    await expect(page.getByRole("dialog", { name: "Summoning circle" })).toBeVisible({ timeout: 30_000 });
  });

  test("one familiar, none active, no project: sending opens the first-project gate", async ({ page }) => {
    await seedFirstProjectGate(page, { activeFamiliar: false });
    await page.goto("/?mode=home");

    const composer = page.getByRole("textbox", { name: "Chat message" });
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("dialog", { name: "Create your first project" })).toHaveCount(0);
    await composer.fill("Start something");
    await page.keyboard.press("Enter");

    const gate = page.getByRole("dialog", { name: "Create your first project" });
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Choose a project before starting a chat.")).toBeVisible();
  });
});
