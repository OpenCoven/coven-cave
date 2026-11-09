import { expect, test, type Page } from "@playwright/test";
import { setup, openThread, now } from "./chat-context-fixture";

const projects = ["alpha", "beta"].map((id) => ({ id, name: `Context ${id}`, root: `/context/${id}`, access: "write", createdAt: now, updatedAt: now }));
const familiars = [
  { id: "cody", display_name: "Cody", role: "Code Familiar", status: "active", icon: "ph:code", projectAccess: "write" },
  { id: "sage", display_name: "Sage", role: "Research Familiar", status: "active", icon: "ph:book-open", projectAccess: "read" },
];
const sessions = [
  { id: "context-a", familiarId: "cody", project_root: "/context/alpha", title: "Context thread A" },
  { id: "context-b", familiarId: "cody", project_root: "/context/beta", title: "Context thread B" },
  { id: "reader-history", familiarId: "sage", project_root: "/context/alpha", title: "Read-only historical chat" },
].map((session) => ({ ...session, status: "completed", origin: "chat", harness: "codex", exit_code: null, archived_at: null, created_at: now, updated_at: now, attention: { state: "none", since: null, reason: null } }));

async function fixture(page: Page) {
  await setup(page);
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects } }));
  const listRequests: URL[] = [];
  await page.route("**/api/sessions/list**", (route) => {
    listRequests.push(new URL(route.request().url()));
    return route.fulfill({ json: { ok: true, sessions } });
  });
  await page.reload();
  await page.getByRole("region", { name: "Navigation", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Filter chats: All chats", exact: true })).toBeVisible();
  await expect.poll(() => listRequests.some((url) => !url.searchParams.has("familiarId"))).toBe(true);
}

async function filterProject(page: Page, name: string) {
  await page.getByRole("button", { name: /^Filter chats:/ }).click();
  await page.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: name }).first().locator(".ui-popover-item").click();
}

test("All chats ignores saved ambient scope; Full-only choices preserve historical reads and draft identity", async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await expect(page.locator(".workspace-titlebar-context .workspace-context-switcher")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("all-chats.png") });

  await openThread(page, "B");
  const composer = page.getByTestId("chat-main").locator("textarea").first();
  await composer.fill("Draft belongs to B");
  const hash = await page.evaluate(() => location.hash);
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await filterProject(page, "Context alpha");
  await expect(page.getByRole("dialog", { name: "Filter chats", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Switch familiar/ }).click();
  await expect(page.getByRole("option", { name: /Cody/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Sage/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await expect(composer).toHaveValue("Draft belongs to B");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId("chat-main").locator('[data-turn-id="context-b-999"]')).toBeAttached();
  await expect(page.getByRole("region", { name: "Open chat outside these filters" })).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("project-filter-open-chat.png") });

  await page.getByRole("button", { name: /^Filter chats:/ }).click();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filter chats: All chats", exact: true })).toBeFocused();
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await expect(composer).toHaveValue("Draft belongs to B");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

for (const appearance of ["dark", "light", "tide"] as const) {
  test(`phone filter preserves the open draft, Full-only choices and keyboard dismissal (${appearance})`, async ({ page }) => {
    await fixture(page);
    await openThread(page, "B");
    const composer = page.getByTestId("chat-main").getByRole("textbox", { name: "Message", exact: true });
    await composer.fill("Phone draft belongs to B");
    const hash = await page.evaluate(() => location.hash);
    await page.evaluate((appearance) => {
      document.documentElement.setAttribute("data-mode", appearance === "light" ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", appearance === "tide" ? "tide" : "coven");
    }, appearance);
    await page.setViewportSize({ width: 390, height: 844 });
    const closeNavigation = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    await page.getByRole("button", { name: "Show chat list", exact: true }).click();
    await filterProject(page, "Context alpha");
    const panel = page.getByRole("dialog", { name: "Filter chats", exact: true });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath(`phone-filter-${appearance}.png`) });
    await page.getByRole("button", { name: /^Switch familiar/ }).click();
    await expect(page.getByRole("option", { name: /Cody/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Sage/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter chats: Context alpha", exact: true })).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Chat threads", exact: true }).getByRole("region", { name: "Open chat outside these filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Chat threads", exact: true })).toHaveCount(0);
    await expect(composer).toHaveValue("Phone draft belongs to B");
    await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe(hash);
    await page.screenshot({ path: test.info().outputPath(`phone-draft-${appearance}.png`) });
  });
}

test("familiar filtering spans projects and clearing it restores All chats", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: /^Filter chats:/ }).click();
  await page.getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("dialog", { name: "Familiars", exact: true }).getByRole("option").filter({ hasText: "Sage" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toHaveCount(0);
  await page.getByRole("button", { name: /^Filter chats:/ }).click();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toBeVisible();
});
