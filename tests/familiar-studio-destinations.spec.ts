import { expect, test, type Page } from "@playwright/test";

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
