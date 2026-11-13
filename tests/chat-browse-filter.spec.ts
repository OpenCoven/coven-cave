import { expect, test, type Page } from "@playwright/test";
import { setup, openThread, now } from "./chat-context-fixture";
import { chatFilterAtAllChats, chatFilterTitleBar, openChatFilter } from "./fixtures/chat-filter";

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
  // The title bar renders before the lazily mounted Chat surface, so wait for
  // the surface's own rows, not just the filter control.
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cnav__thread-main").filter({ hasText: "Context thread A" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(chatFilterAtAllChats(page)).toBeVisible();
  await expect.poll(() => listRequests.some((url) => !url.searchParams.has("familiarId"))).toBe(true);
}

/** Leaves the narrow-width popover open, so callers can assert on it. */
async function filterProject(page: Page, name: string) {
  const filter = await openChatFilter(page);
  await filter.controls.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".cave-project-picker__row").filter({ hasText: name }).first().locator(".ui-popover-item").click();
  return filter;
}

test("Chat's filter sits in the title bar at desktop widths, starts at All chats, and keeps historical reads and draft identity", async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  // Same row and form as the shared selectors on every other page (#6478),
  // but at All chats: the saved ambient scope (Cody) is not applied (#6434).
  const titleBar = chatFilterTitleBar(page);
  await expect(titleBar.getByRole("button", { name: "Switch project: All projects", exact: true })).toBeVisible();
  await expect(titleBar.getByRole("button", { name: "Switch familiar — scope: all familiars", exact: true })).toBeVisible();
  // One copy per width: the header funnel is for windows below 1024px.
  await expect(page.getByRole("button", { name: /^Filter chats:/ })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath("all-chats.png") });

  await openThread(page, "B");
  const composer = page.getByTestId("chat-main").locator("textarea").first();
  await composer.fill("Draft belongs to B");
  const hash = await page.evaluate(() => location.hash);
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await filterProject(page, "Context alpha");
  await expect(titleBar.getByRole("button", { name: /^Switch project: Context alpha/ })).toBeVisible();
  await titleBar.getByRole("button", { name: /^Switch familiar/ }).click();
  await expect(page.getByRole("option", { name: /Cody/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Sage/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await expect(composer).toHaveValue("Draft belongs to B");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(page.getByTestId("chat-main").locator('[data-turn-id="context-b-999"]')).toBeAttached();
  await expect(page.getByRole("region", { name: "Open chat outside these filters" })).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("project-filter-open-chat.png") });

  // All projects clears the filter from the title bar.
  await titleBar.getByRole("button", { name: /^Switch project:/ }).click();
  await page.locator(".ui-popover-item").filter({ hasText: "All projects" }).first().click();
  await expect(titleBar.getByRole("button", { name: "Switch project: All projects", exact: true })).toBeVisible();
  await expect(page.getByTestId("chat-main").getByRole("button", { name: /^Project: Context beta/ })).toBeVisible();
  await expect(composer).toHaveValue("Draft belongs to B");
  expect(await page.evaluate(() => location.hash)).toBe(hash);
});

test("Chat's title-bar filter leaves the shared scope on other pages alone", async ({ page }) => {
  await fixture(page);
  await filterProject(page, "Context alpha");
  const titleBar = chatFilterTitleBar(page);
  await expect(titleBar.getByRole("button", { name: /^Switch project: Context alpha/ })).toBeVisible();

  const navigation = page.getByRole("region", { name: "Navigation", exact: true });
  await navigation.getByRole("button", { name: "Tasks", exact: true }).click();
  const shared = page.locator(".workspace-titlebar-context");
  await expect(titleBar).toHaveCount(0);
  await expect(shared.getByRole("button", { name: "Switch project: All projects", exact: true })).toBeVisible();
  await expect(shared.getByRole("button", { name: "Switch familiar — current: Cody", exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(titleBar.getByRole("button", { name: /^Switch project: Context alpha/ })).toBeVisible();
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

test("familiar filtering spans projects and All familiars restores All chats", async ({ page }) => {
  await fixture(page);
  const familiars = page.getByRole("dialog", { name: "Familiars", exact: true });
  const titleBar = chatFilterTitleBar(page);
  await titleBar.getByRole("button", { name: /^Switch familiar/ }).click();
  await familiars.getByRole("option").filter({ hasText: "Sage" }).click();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toHaveCount(0);
  await titleBar.getByRole("button", { name: /^Switch familiar/ }).click();
  await familiars.getByRole("option").filter({ hasText: "All familiars" }).click();
  await expect(page.locator('.chat-inner-rail .cnav__thread-title[title="Context thread B"]')).toBeVisible();
});

test("below 1024px the header filter still filters and Clear filters restores All chats", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(chatFilterTitleBar(page)).toBeHidden();
  const filter = await openChatFilter(page);
  await filter.controls.getByRole("button", { name: /^Switch familiar/ }).click();
  await page.getByRole("dialog", { name: "Familiars", exact: true }).getByRole("option").filter({ hasText: "Sage" }).click();
  await filter.close();
  await page.getByRole("button", { name: "Show chat list", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Chat threads", exact: true });
  await expect(sheet.locator('.cnav__thread-title[title="Read-only historical chat"]')).toBeVisible();
  await expect(sheet.locator('.cnav__thread-title[title="Context thread B"]')).toHaveCount(0);
  await sheet.getByRole("button", { name: /^Filter chats:/ }).click();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(sheet.locator('.cnav__thread-title[title="Context thread B"]')).toBeVisible();
});
