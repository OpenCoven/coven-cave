import { expect, test, type Page, type Route } from "@playwright/test";

const CRAFT_ID = "seekers-lens";

const directEffective = {
  skills: [],
  tools: [{ id: "shell", origin: "direct", originLabel: "Direct" }],
  mcpServers: [],
  plugins: [],
  workflows: [],
  prompts: [],
  capabilities: [],
};

const craftEffective = {
  ...directEffective,
  skills: [{ id: "brainstorming-research-ideas", origin: "craft", originLabel: "via Seeker's Lens", craftId: CRAFT_ID }],
  plugins: [{ id: CRAFT_ID, origin: "craft", originLabel: "via Seeker's Lens", craftId: CRAFT_ID }],
  capabilities: [{ id: "network.http", origin: "craft", originLabel: "via Seeker's Lens", craftId: CRAFT_ID }],
};

const plan = {
  id: CRAFT_ID,
  displayName: "Seeker's Lens",
  description: "Discovery and ideation.",
  version: "0.1.0",
  installTarget: `${CRAFT_ID}@opencoven-first-party`,
  commands: {
    marketplaceCheck: ["codex", "plugin", "marketplace", "list", "--json"],
    install: ["codex", "plugin", "add", `${CRAFT_ID}@opencoven-first-party`, "--json"],
    verify: ["codex", "plugin", "list", "--json"],
    uninstall: ["codex", "plugin", "remove", `${CRAFT_ID}@opencoven-first-party`, "--json"],
  },
  components: {
    required: [{ id: "fetch", displayName: "Fetch", version: "0.1.0", kind: "mcp", requiredConfig: [], requiresConfiguration: false, required: true }],
    optionalEnhancements: [{ id: "exa", displayName: "Exa", version: "0.1.0", kind: "mcp", requiredConfig: ["EXA_API_KEY"], requiresConfiguration: true, required: false }],
  },
  bundled: { skills: ["brainstorming-research-ideas"], prompts: ["open-a-research-space"], workflows: ["diverge-converge-refine"] },
  requiredCapabilities: ["network.http"],
  recommendedRoles: ["researcher"],
  provenance: {
    source: "https://github.com/orchestra-research/AI-Research-SKILLs",
    commit: "773a52944ba4747a18bd4ae9ade53fff041adcbc",
    license: "MIT",
    licensePath: "LICENSE",
  },
  runtime: {
    id: "codex",
    marketplace: "opencoven-first-party",
    scope: "user",
    disclosure: "Codex installs plugins at user scope. Equipping is not a security sandbox.",
  },
};

function craftPlugin(overrides: Record<string, unknown> = {}) {
  return {
    id: CRAFT_ID,
    displayName: "Seeker's Lens",
    description: "Discovery and ideation.",
    category: "Research Crafts",
    author: "OpenCoven",
    trust: "reference-local",
    policy: { installation: "AVAILABLE", authentication: "NONE" },
    capabilities: ["network.http"],
    keywords: ["research"],
    roleAffinity: [],
    kind: "craft",
    version: "0.1.0",
    installed: false,
    updateAvailable: false,
    requiresSetup: false,
    available: true,
    requiredConfig: [],
    configured: false,
    ...overrides,
  };
}

async function openCrafts(page: Page, plugin = craftPlugin()) {
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/marketplace", (route) => route.fulfill({ json: { ok: true, plugins: [plugin] } }));
  await page.route(`**/api/marketplace/crafts/plan?id=${CRAFT_ID}`, (route) => route.fulfill({ json: { ok: true, plan } }));
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/?mode=marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible({ timeout: 30_000 });
  await page.locator("#marketplace-tab-crafts").click();
  await expect(page.locator("#marketplace-panel-crafts")).toBeVisible();
}

test.describe("Craft Marketplace transactions", () => {
  test("preview → install → equip → inspect origins → detach → remove", async ({ page }) => {
    let equipped = false;
    const roleWrites: Array<{ attach: boolean }> = [];
    let installCalls = 0;
    let uninstallCalls = 0;

    await page.route("**/api/roles/crafts", async (route) => {
      const body = route.request().postDataJSON() as { attach: boolean };
      roleWrites.push(body);
      equipped = body.attach;
      await route.fulfill({ json: { ok: true, crafts: equipped ? [CRAFT_ID] : [] } });
    });
    await page.route(/\/api\/roles(?:\?.*)?$/, (route) => route.fulfill({
      json: {
        ok: true,
        roles: [{
          id: "researcher",
          name: "Researcher",
          familiar: "nova",
          crafts: equipped ? [CRAFT_ID] : [],
          effective: equipped ? craftEffective : directEffective,
        }],
      },
    }));
    await page.route("**/api/marketplace/crafts/install", async (route) => {
      installCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        json: {
          ok: true,
          installed: true,
          runtime: "codex",
          craftVersion: "0.1.0",
          installedAt: "2026-07-10T01:00:00.000Z",
          verifiedAt: "2026-07-10T01:00:00.000Z",
        },
      });
    });
    await page.route("**/api/marketplace/crafts/uninstall", async (route) => {
      uninstallCalls += 1;
      await route.fulfill({ json: { ok: true, installed: false, runtime: "codex", craftVersion: "0.1.0" } });
    });

    await openCrafts(page);
    const preview = page.getByRole("button", { name: "Preview" });
    await preview.focus();
    await preview.click();
    const dialog = page.getByRole("dialog", { name: "Seeker's Lens Craft details" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`codex plugin add ${CRAFT_ID}@opencoven-first-party --json`)).toBeVisible();
    await expect(dialog.getByText("EXA_API_KEY")).toBeVisible();
    await expect(dialog.getByText("not a security sandbox", { exact: false }).first()).toBeVisible();

    const install = dialog.getByRole("button", { name: "Install Craft" });
    await install.click();
    await expect(install).toHaveAttribute("aria-busy", "true");
    await expect(dialog.getByText("Installed and verified")).toBeVisible();
    expect(installCalls).toBe(1);

    const equip = dialog.getByRole("checkbox", { name: /Equip Seeker's Lens on Researcher/ });
    await equip.click();
    const equippedCheckbox = dialog.getByRole("checkbox", { name: /Detach Seeker's Lens from Researcher/ });
    await expect(equippedCheckbox).toBeChecked();
    await expect(dialog.getByText("via Seeker's Lens").first()).toBeVisible();
    await expect(dialog.getByText("Direct")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Detach from 1 Role first/ })).toBeDisabled();

    await equippedCheckbox.click();
    await expect(dialog.getByRole("checkbox", { name: /Equip Seeker's Lens on Researcher/ })).not.toBeChecked();
    await dialog.getByRole("button", { name: "Remove Craft" }).click();
    await expect(dialog.getByText("Not installed")).toBeVisible();
    expect(roleWrites.map((entry) => entry.attach)).toEqual([true, false]);
    expect(uninstallCalls).toBe(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(preview).toBeFocused();
  });

  test("legacy install offers repair and exposes a bounded detach-first error", async ({ page }) => {
    await page.route(/\/api\/roles(?:\?.*)?$/, (route) => route.fulfill({
      json: { ok: true, roles: [{ id: "researcher", name: "Researcher", familiar: "nova", crafts: [], effective: directEffective }] },
    }));
    await page.route("**/api/marketplace/crafts/install", (route: Route) => route.fulfill({
      status: 409,
      json: {
        ok: false,
        code: "marketplace_not_configured",
        error: "Configure the OpenCoven marketplace first.",
      },
    }));
    await page.route("**/api/marketplace/crafts/uninstall", (route: Route) => route.fulfill({
      status: 409,
      json: {
        ok: false,
        code: "craft_equipped",
        error: "Detach this Craft from every Role before removing it.",
        diagnostic: {
          affectedRoles: [{ id: "researcher", name: "Researcher", familiar: "nova" }],
          affectedRoleCount: 4,
          affectedRolesTruncated: true,
        },
      },
    }));

    await openCrafts(page, craftPlugin({
      installed: true,
      updateAvailable: true,
      installation: { version: "0.1.0", source: "catalog", installedAt: "2026-07-09T23:30:00.000Z" },
    }));
    await page.locator("#marketplace-panel-crafts").getByRole("button", { name: "Manage", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Seeker's Lens Craft details" });
    await expect(dialog.getByText("Update available")).toBeVisible();
    await dialog.getByRole("button", { name: "Update Craft" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Configure the OpenCoven marketplace first.");

    await dialog.getByRole("button", { name: "Remove Craft" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Researcher · nova");
    await expect(dialog.getByRole("alert")).toContainText("3 more affected Roles are not shown.");

    const close = dialog.getByRole("button", { name: "Close Craft details" });
    await close.focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  });
});

test.describe("Craft authoring: one progressive flow", () => {
  const roles = [
    {
      id: "researcher",
      name: "Researcher",
      description: "Deep research and citation",
      familiar: "nova",
      skills: ["deep-research"],
      tools: ["network.http"],
      mcpServers: ["fetch"],
      plugins: [],
      workflows: [],
      crafts: [],
      effective: {
        ...directEffective,
        skills: [{ id: "deep-research", origin: "direct", originLabel: "Direct" }],
        mcpServers: [{ id: "fetch", origin: "direct", originLabel: "Direct" }],
        capabilities: [{ id: "network.http", origin: "direct", originLabel: "Direct" }],
      },
    },
    {
      id: "scribe",
      name: "Scribe",
      description: "Writing and summaries",
      familiar: "nova",
      skills: ["summarize"],
      tools: [],
      mcpServers: [],
      plugins: [],
      workflows: [],
      crafts: [],
      effective: {
        ...directEffective,
        skills: [{ id: "summarize", origin: "direct", originLabel: "Direct" }],
        tools: [],
      },
    },
  ];

  test("describe-first default, pick-roles previews the real ledger before saving", async ({ page }) => {
    const draftPosts: Array<Record<string, unknown>> = [];
    await page.route(/\/api\/roles(?:\?.*)?$/, (route) => route.fulfill({ json: { ok: true, roles } }));
    await page.route("**/api/marketplace/crafts/drafts**", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        draftPosts.push(body);
        await route.fulfill({ json: { ok: true, draft: { id: "nova-researcher" } } });
        return;
      }
      await route.fulfill({ json: { ok: true, drafts: [] } });
    });

    await openCrafts(page);
    await page.getByRole("button", { name: "Create Craft" }).click();
    const drawer = page.getByRole("dialog", { name: "Create Craft" });
    await expect(drawer).toBeVisible();

    // Describe leads for first-time users.
    await expect(drawer.getByRole("tab", { name: "Describe it" })).toHaveAttribute("aria-selected", "true");
    await expect(drawer.getByRole("button", { name: "Draft with familiar" })).toBeDisabled();

    // Power path: pick roles → preview the REAL extraction ledger → save.
    await drawer.getByRole("tab", { name: "Pick roles" }).click();
    await expect(drawer.getByText("A Craft bundles roles from one familiar", { exact: false })).toBeVisible();
    await drawer.getByRole("checkbox").first().check();
    const previewButton = drawer.getByRole("button", { name: "Preview draft" });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();

    await expect(drawer.getByText("Nova Researcher", { exact: false }).first()).toBeVisible();
    const ledger = drawer.locator(".craft-draft-ledger");
    await expect(ledger.getByText("deep-research")).toBeVisible();
    await expect(ledger.getByText("fetch")).toBeVisible();

    // Adjust roles returns to selection with state intact.
    await drawer.getByRole("button", { name: "Adjust roles" }).click();
    await expect(drawer.getByRole("checkbox").first()).toBeChecked();
    await drawer.getByRole("button", { name: "Preview draft" }).click();

    // Optional rename rides the save; identity stays derived.
    await drawer.getByLabel("Name (optional)").fill("Research Loadout");
    await drawer.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => draftPosts.length).toBe(1);
    expect(draftPosts[0]).toMatchObject({
      familiar: "nova",
      roleIds: ["researcher"],
      displayName: "Research Loadout",
    });
  });

  test("a dispatched describe-build survives the drawer and lands on the Crafts tab", async ({ page }) => {
    let draftsCalls = 0;
    await page.route(/\/api\/roles(?:\?.*)?$/, (route) => route.fulfill({ json: { ok: true, roles } }));
    await page.route("**/api/marketplace/crafts/drafts**", async (route) => {
      draftsCalls += 1;
      // The familiar's draft "lands" on a later poll tick — the hub only
      // reads ids from this endpoint to detect arrival.
      await route.fulfill({ json: { ok: true, drafts: draftsCalls >= 2 ? [{ id: "nova-research-kit" }] : [] } });
    });
    // The persisted watch from a dispatch that happened before this page load
    // (docs/craft-ux.md F2): baseline snapshot is empty, so any draft id is an
    // arrival.
    await page.addInitScript(() => {
      window.sessionStorage.setItem(
        "cave:craft-create:awaiting",
        JSON.stringify({ baselineIds: [], dispatchedAt: new Date().toISOString(), goal: "research kit" }),
      );
    });

    await openCrafts(page);
    await expect(page.getByText("A familiar is drafting a Craft from your description", { exact: false })).toBeVisible();

    const arrived = await page.evaluate(async () => {
      // The 5s poll cadence is real time — nudge it by waiting for the watch
      // to clear, which is the arrival side-effect.
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        if (window.sessionStorage.getItem("cave:craft-create:awaiting") === null) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    });
    expect(arrived).toBe(true);
  });
});
