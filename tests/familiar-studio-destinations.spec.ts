import { expect, test, type Page } from "@playwright/test";

// Production's service worker can bypass route fixtures after a document handoff.
test.use({ serviceWorkers: "block" });

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  harness: "codex",
  status: "active",
  icon: "ph:sparkle-fill",
};

const CONTRACT = {
  ok: true,
  present: { soul: true, identity: true, ward: true, memory: true },
  report: { pass: true, violations: [] },
};

async function installFixtures(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:active-familiar", "nova");
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/familiars") {
      return route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } });
    }
    if (/^\/api\/familiars\/[^/]+\/contract$/.test(pathname)) {
      return route.fulfill({ json: CONTRACT });
    }
    if (pathname === "/api/sessions/list") {
      return route.fulfill({ json: { ok: true, sessions: [] } });
    }
    if (pathname === "/api/roles") {
      return route.fulfill({ json: { ok: true, roles: [] } });
    }
    if (pathname === "/api/skills/local") {
      return route.fulfill({ json: { ok: true, skills: [] } });
    }
    if (pathname === "/api/capabilities") {
      return route.fulfill({ json: { ok: true, harness_capabilities: [] } });
    }
    if (pathname === "/api/harnesses") {
      return route.fulfill({ json: { ok: true, harnesses: [] } });
    }
    return route.abort();
  });
}

function waitForChatDocumentHandoff(page: Page) {
  return page.waitForRequest(
    (request) => {
      if (request.resourceType() !== "document") return false;
      const url = new URL(request.url());
      return url.pathname === "/" && url.searchParams.get("mode") === "chat";
    },
    { timeout: 30_000 },
  );
}

async function expectFamiliarSettings(page: Page) {
  const chatSections = page.getByRole("tablist", { name: "Chat sections" });
  await expect(chatSections).toBeVisible({ timeout: 60_000 });
  await expect(chatSections.getByRole("tab", { name: "Familiar", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const familiarSections = page.getByRole("tablist", { name: "Familiar sections" });
  await expect(familiarSections).toBeVisible({ timeout: 60_000 });
  await expect(familiarSections.getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const settings = page.getByRole("region", { name: "Settings for Nova" });
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await expect(
    settings.getByRole("tab", { name: "Identity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return settings;
}

test("Familiar profile Edit in Studio reaches Chat Familiar Settings Identity", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/?mode=agents", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".familiars-view")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Open Nova", exact: true }).click();
  await page.getByRole("button", { name: "Nova options", exact: true }).click();
  const options = page.getByRole("dialog", { name: "Familiar options" });
  await expect(options).toBeVisible();

  const handoff = waitForChatDocumentHandoff(page);
  await options.getByRole("menuitem", { name: "Edit in Studio", exact: true }).click();
  const request = await handoff;
  expect(new URL(request.url()).pathname).toBe("/");
  expect(new URL(request.url()).searchParams.get("mode")).toBe("chat");

  await expectFamiliarSettings(page);
});

test("Familiar Identity Open Contract reaches the focused Grimoire section", async ({ page }) => {
  await installFixtures(page);
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 60_000 });

  const chatSections = page.getByRole("tablist", { name: "Chat sections" });
  await expect(chatSections).toBeVisible({ timeout: 60_000 });
  await chatSections.getByRole("tab", { name: "Familiar", exact: true }).click();
  const familiarSections = page.getByRole("tablist", { name: "Familiar sections" });
  await expect(familiarSections).toBeVisible({ timeout: 60_000 });
  await familiarSections.getByRole("tab", { name: "Identity", exact: true }).click();

  const contract = page.getByRole("region", { name: "Identity contract" });
  await expect(contract).toBeVisible({ timeout: 30_000 });
  await expect(contract).toContainText("SOUL.md", { timeout: 30_000 });

  const handoff = waitForChatDocumentHandoff(page);
  await contract.getByRole("button", { name: "Open contract →", exact: true }).click();
  const request = await handoff;
  expect(new URL(request.url()).pathname).toBe("/");
  expect(new URL(request.url()).searchParams.get("mode")).toBe("chat");

  const settings = await expectFamiliarSettings(page);
  const grimoire = settings.locator(".familiar-studio-grimoire");
  await expect(grimoire).toBeVisible({ timeout: 30_000 });
  await expect(grimoire).toBeFocused({ timeout: 30_000 });
  await expect(grimoire.getByRole("heading", { name: "Grimoire files" })).toBeVisible();
});

test("settings defers identity details and retains a draft through section history", async ({ page }) => {
  await installFixtures(page);
  let contracts = 0;
  let completedContracts = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/familiars/nova/contract") contracts += 1;
  });
  page.on("requestfinished", request => {
    if (new URL(request.url()).pathname === "/api/familiars/nova/contract") completedContracts += 1;
  });
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Familiar", exact: true }).click();
  await page.getByRole("tablist", { name: "Familiar sections" }).getByRole("tab", { name: "Settings", exact: true }).click();
  const settings = await expectFamiliarSettings(page);
  const name = settings.getByRole("textbox", { name: /^Display name/i });
  await expect(name).toBeVisible();
  expect(contracts).toBe(0);
  await expect(settings.getByRole("searchbox", { name: "Search cat, wand, sparkle…" })).toHaveCount(0);
  await name.fill("Draft name");
  await settings.getByRole("tab", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(settings.getByRole("tab", { name: "Identity", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(name).toHaveValue("Draft name");
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(settings.getByRole("tab", { name: "Chat", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(name).toHaveValue("Draft name");
  await page.screenshot({ path: test.info().outputPath("settings-desktop-dark.png"), animations: "disabled" });
  await settings.getByRole("button", { name: "Grimoire files", exact: true }).click();
  await expect(settings.locator(".familiar-studio-grimoire")).toContainText("4 of 4 found");
  // Development effect replay aborts the first attempt; only one completes.
  await expect.poll(() => completedContracts).toBe(1);
  const requestsAtFirstOpen = contracts;
  await settings.getByRole("button", { name: "Grimoire files", exact: true }).click();
  await expect(settings.locator(".familiar-studio-grimoire")).toBeHidden();
  await settings.getByRole("button", { name: "Grimoire files", exact: true }).click();
  await expect(settings.locator(".familiar-studio-grimoire")).toBeVisible();
  await expect(settings.locator(".familiar-studio-grimoire")).toContainText("4 of 4 found");
  expect(contracts).toBe(requestsAtFirstOpen);
  expect(completedContracts).toBe(1);
});


test("narrow settings keeps section selection and disclosure keyboard access visible", async ({ page }) => {
  await installFixtures(page);
  await page.addInitScript(() => window.localStorage.setItem("cave:glyph-overrides:v1", JSON.stringify({ nova: "ph:moon" })));
  await page.setViewportSize({ width: 760, height: 940 });
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await page.getByRole("tablist", { name: "Chat sections" }).getByRole("tab", { name: "Familiar", exact: true }).click();
  await page.getByRole("tablist", { name: "Familiar sections" }).getByRole("tab", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings for Nova" });
  const section = settings.getByRole("combobox", { name: "Settings section" });
  await expect(section).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Display name", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Nova in the Familiar Studio" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Runtime", exact: true })).toHaveCount(0);
  const appearance = settings.getByRole("button", { name: "Appearance", exact: true });
  await appearance.focus();
  await page.keyboard.press("Enter");
  await expect(appearance).toHaveAttribute("aria-expanded", "true");
  await expect(settings.locator('[data-glyph-button="true"]').first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(appearance).toHaveAttribute("aria-expanded", "false");
  await expect(appearance).toBeFocused();
  const name = settings.getByRole("textbox", { name: "Display name", exact: true });
  await name.fill("Draft text");
  await name.press("Meta+Backspace");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cave:glyph-overrides:v1") || "{}").nova)).toBe("ph:moon");
  await section.selectOption("chat");
  await expect(settings.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();
  await section.selectOption("identity");
  const bounds = await settings.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(761);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(section).toBeVisible();
  await settings.locator(".familiar-tab__settings-body").evaluate(element => { element.scrollTop = 0; });
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme, mode });
    await expect(settings.getByRole("textbox", { name: "Display name", exact: true })).toBeVisible();
    expect((await section.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Fractional tab widths can leave a subpixel edge at WebKit's scroll limit.
    await expect(page.getByRole("tablist", { name: "Familiar sections" }).getByRole("tab", { name: "Settings", exact: true })).toBeInViewport({ ratio: 0.99 });
    expect(await section.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    const narrow = await settings.boundingBox();
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(391);
    await page.screenshot({ path: test.info().outputPath(`settings-phone-${theme}-${mode}.png`), animations: "disabled" });
  }
  // Tabs use manual activation: resizing must not hide keyboard focus while
  // the user explores a destination that has not been selected yet.
  const familiarTabs = page.getByRole("tablist", { name: "Familiar sections" });
  await page.setViewportSize({ width: 760, height: 940 });
  await familiarTabs.getByRole("tab", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Home");
  const identityTab = familiarTabs.getByRole("tab", { name: "Identity", exact: true });
  await expect(identityTab).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(identityTab).toBeInViewport({ ratio: 0.99 });
  await expect(identityTab).toBeFocused();
  await expect(familiarTabs.getByRole("tab", { name: "Settings", exact: true })).toHaveAttribute("aria-selected", "true");
});
