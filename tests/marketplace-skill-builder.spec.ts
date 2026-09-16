import { expect, test, type Page } from "@playwright/test";

// Behavioral coverage for the Marketplace "Build" tab — the skill-authoring
// surface (cave-qasi). Daemon-less: onboarding dismissed, list fetches
// stubbed, and the write endpoint mocked so the spec asserts the exact body
// the form posts and the success-panel flow (View in Skills / Build another).

async function openMarketplace(page: Page, legacySkills = false) {
  await page.route("**/api/marketplace", (r) => r.fulfill({ json: { ok: true, plugins: [] } }));
  await page.route("**/api/skills/directory**", (r) => r.fulfill({ json: { ok: true, entries: legacySkills ? [{
    id: "local-release-notes", name: "Local release notes", description: "An owned skill.", installed: true,
    local: { path: "/tmp/e2e/release-notes/SKILL.md", scope: "coven" },
  }] : [] } }));
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  await page.addInitScript((legacy) => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    if (legacy && !window.localStorage.getItem("test:marketplace-seeded")) {
      window.localStorage.setItem("test:marketplace-seeded", "1");
      window.localStorage.setItem("cave:surface-preferences:v1", JSON.stringify({ version: 1, values: {
        "marketplace.section": "skills", "marketplace.kind": "mcp",
        "marketplace.status": "needs-setup", "marketplace.category": "Old category",
      } }));
    }
  }, legacySkills);
  await page.goto("/?mode=marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace" }).first()).toBeVisible({ timeout: 30_000 });
}

async function gotoBuildTab(page: Page) {
  await openMarketplace(page);
  await page.locator("#marketplace-tab-build").click();
  await expect(page.locator("#marketplace-panel-build")).toBeVisible();
}

test.describe("marketplace skill builder", () => {
  test("authors a skill: form → preview → save → success panel → owned Skills", async ({ page }) => {
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
    // The template gallery (cave-6ptj): inserting a kind fills the
    // instructions with a Tab-fillable body.
    await form.getByRole("group", { name: "Skill templates" }).getByRole("button", { name: "Procedure" }).click();

    // The live preview shows the exact composed SKILL.md (frontmatter + slug path).
    const preview = page.locator('section[aria-label="SKILL.md preview"] pre');
    await expect(preview).toContainText("name: Release Notes Writer");
    await expect(preview).toContainText("description: Draft release notes from merged PRs.");
    await expect(preview).toContainText("- release");
    await expect(form).toContainText("~/.coven/skills/release-notes-writer/SKILL.md");

    await expect(save).toBeEnabled();
    await save.click();

    // Success panel with the written path, then jump back to the skills view
    // (now Explore pre-filtered to the Skills type).
    await expect(page.getByRole("region", { name: "Skill saved" })).toBeVisible();
    await expect(page.getByText("/tmp/e2e/.coven/skills/release-notes-writer/SKILL.md")).toBeVisible();
    // The dry-run tester rides the success panel (cave-cyfc) — presence only;
    // probes need a codex runtime the e2e job doesn't have.
    await expect(page.getByTestId("skill-dry-run")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test trigger" })).toBeDisabled();
    expect(postedBody).toMatchObject({
      name: "Release Notes Writer",
      description: "Draft release notes from merged PRs.",
      root: "coven",
      tags: ["release", "notes"],
    });
    expect(String((postedBody as unknown as Record<string, unknown>).instructions)).toContain("## When to use");

    await page.getByRole("button", { name: "View in Skills" }).click();
    await expect(page.locator("#marketplace-panel-browse")).toBeVisible();
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
    await form.getByRole("group", { name: "Skill templates" }).getByRole("button", { name: "Procedure" }).click();
    await form.getByRole("button", { name: "Save skill" }).click();

    await expect(page.locator("#marketplace-panel-build").getByRole("alert")).toContainText("already exists");
    // The form (and the user's work) survives the failure.
    await expect(form.getByLabel("Name")).toHaveValue("Release Notes Writer");
  });
});

for (const width of [1280, 600]) {
  test(`retired Skills preference reaches owned inventory at ${width}px and stays navigable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await openMarketplace(page, true);
    await expect(page.locator("#marketplace-tab-skills")).toHaveCount(0);
    await expect(page.getByText("Skills worth summoning.", { exact: true })).toHaveCount(0);
    await expect(page.locator("#marketplace-tab-browse")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: /Local release notes/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cave:surface-preferences:v1")!).values)).toMatchObject({
      "marketplace.section": "browse", "marketplace.kind": "skill",
      "marketplace.status": "all", "marketplace.category": "All",
    });
    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.setAttribute("data-theme", theme);
        document.documentElement.setAttribute("data-mode", mode);
      }, { theme, mode });
      await expect(page.getByRole("button", { name: /Local release notes/ })).toBeVisible();
      await page.screenshot({ animations: "disabled", path: test.info().outputPath(`owned-skills-${width}-${theme}-${mode}.png`) });
    }
    const yours = page.locator("#marketplace-tab-browse");
    await yours.focus();
    await page.keyboard.press("End");
    await expect(page.locator("#marketplace-tab-build")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#marketplace-panel-build")).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cave:surface-preferences:v1")!).values["marketplace.section"])).toBe("build");
    // Re-enter the surface explicitly: the shell owns and clears entry URLs.
    await page.goto("/?mode=marketplace");
    await expect(page.locator("#marketplace-panel-build")).toBeVisible();
    await page.locator("#marketplace-tab-browse").click();
    await expect(page.getByRole("button", { name: /Local release notes/ })).toBeVisible();
  });
}
