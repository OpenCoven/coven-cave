import { expect, test, type Page } from "@playwright/test";

// Behavioral coverage for the Marketplace "Build" tab — the skill-authoring
// surface (cave-qasi). Daemon-less: onboarding dismissed, list fetches
// stubbed, and the write endpoint mocked so the spec asserts the exact body
// the form posts and the success-panel flow (View in Skills / Build another).

async function gotoBuildTab(page: Page) {
  await page.route("**/api/marketplace", (r) => r.fulfill({ json: { ok: true, plugins: [] } }));
  await page.route("**/api/skills/directory**", (r) => r.fulfill({ json: { ok: true, entries: [] } }));
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.goto("/?mode=marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible({ timeout: 30_000 });
  await page.locator("#marketplace-tab-build").click();
  await expect(page.locator("#marketplace-panel-build")).toBeVisible();
}

test.describe("marketplace skill builder", () => {
  test("authors a skill: form → preview → save → success panel → Skills tab", async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null;
    await page.route("**/api/skills/build", async (route) => {
      postedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          ok: true,
          slug: "release-notes-writer",
          path: "/tmp/e2e/.coven/skills/release-notes-writer/SKILL.md",
          dir: "/tmp/e2e/.coven/skills/release-notes-writer",
        },
      });
    });
    await gotoBuildTab(page);

    const form = page.getByRole("form", { name: "New skill" });
    const save = form.getByRole("button", { name: "Save skill" });
    await expect(save).toBeDisabled();

    await form.getByLabel("Name").fill("Release Notes Writer");
    await form.getByLabel("Description").fill("Draft release notes from merged PRs.");
    await form.getByLabel(/Tags/).fill("release, notes");
    await form.getByRole("button", { name: "Insert starter template" }).click();

    // The live preview shows the exact composed SKILL.md (frontmatter + slug path).
    const preview = page.locator('section[aria-label="SKILL.md preview"] pre');
    await expect(preview).toContainText("name: Release Notes Writer");
    await expect(preview).toContainText("description: Draft release notes from merged PRs.");
    await expect(preview).toContainText("- release");
    await expect(form).toContainText("~/.coven/skills/release-notes-writer/SKILL.md");

    await expect(save).toBeEnabled();
    await save.click();

    // Success panel with the written path, then jump to the Skills tab.
    await expect(page.getByRole("region", { name: "Skill saved" })).toBeVisible();
    await expect(page.getByText("/tmp/e2e/.coven/skills/release-notes-writer/SKILL.md")).toBeVisible();
    expect(postedBody).toMatchObject({
      name: "Release Notes Writer",
      description: "Draft release notes from merged PRs.",
      root: "coven",
      tags: ["release", "notes"],
    });
    expect(String((postedBody as unknown as Record<string, unknown>).instructions)).toContain("## When to use");

    await page.getByRole("button", { name: "View in Skills" }).click();
    await expect(page.locator("#marketplace-panel-skills")).toBeVisible();
  });

  test("a duplicate skill id surfaces the 409 as an alert and keeps the form", async ({ page }) => {
    await page.route("**/api/skills/build", (route) =>
      route.fulfill({
        status: 409,
        json: { ok: false, code: "exists", error: 'a skill with id "release-notes-writer" already exists' },
      }),
    );
    await gotoBuildTab(page);

    const form = page.getByRole("form", { name: "New skill" });
    await form.getByLabel("Name").fill("Release Notes Writer");
    await form.getByLabel("Description").fill("Draft release notes.");
    await form.getByRole("button", { name: "Insert starter template" }).click();
    await form.getByRole("button", { name: "Save skill" }).click();

    await expect(page.locator("#marketplace-panel-build").getByRole("alert")).toContainText("already exists");
    // The form (and the user's work) survives the failure.
    await expect(form.getByLabel("Name")).toHaveValue("Release Notes Writer");
  });
});
