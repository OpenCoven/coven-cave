import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";
import { activityCollectionFromSearch } from "../src/lib/github-activity";

const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;
const title = "Review the extended project plan and preserve unresolved dependencies";
const item = { kind: "issue", id: "modal-fixture-42", title, repo: "fixture/project", number: 42, url: "https://github.com/fixture/project/issues/42", state: "open", updatedAt: "2026-10-27T12:00:00Z" };
const detail = { ok: true, title, number: 42, state: "open", isPull: false, merged: false, draft: false, body: "## Review notes\n\nPreserve the original owner and every unresolved dependency.\n\n".repeat(12), author: { login: "fixture-owner", avatarUrl: null, url: null }, assignees: [], labels: [], createdAt: item.updatedAt, updatedAt: item.updatedAt, htmlUrl: item.url, comments: 0 };

async function boot(page: Page, theme: typeof themes[number]) {
  const errors: string[] = [], writes: string[] = [];
  let releaseSave: (() => void) | undefined;
  page.on("pageerror", error => errors.push(error.message));
  const preferences = createDefaultPreferences(true);
  preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "fixture-review");
    localStorage.setItem("cave:familiar-scope", JSON.stringify(["fixture-review"]));
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      writes.push(path);
      if (path === "/api/github/pat" && route.request().method() === "POST") {
        await new Promise<void>(resolve => { releaseSave = resolve; });
        return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic connection failure. Your draft is retained." } });
      }
      return route.fulfill({ status: 409, json: { ok: false, error: "Fixture rejects mutations." } });
    }
    if (path === "/api/preferences") return route.fulfill({ json: { ok: true, preferences } });
    if (path === "/api/theme") return route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } });
    if (path === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ id: "fixture-project", name: "Review project", root: "/fixture/project", access: "write" }] } });
    if (path === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", role: "Review plans", familiarType: "coding", harness: "codex", status: "active" }] } });
    if (path === "/api/roles") return route.fulfill({ json: { ok: true, roles: [] } });
    if (path === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [] } });
    if (path === "/api/board") return route.fulfill({ json: { ok: true, cards: [] } });
    if (path === "/api/github/pat") return route.fulfill({ json: { hasPat: false, login: "fixture-owner" } });
    if (path === "/api/github/activity") return route.fulfill({ json: { ok: true, authed: false, login: "fixture-owner", organizations: [], items: [item], rateLimit: null, collections: { authored: activityCollectionFromSearch({ shown: 0, total: 0, githubIncomplete: false }), reviewRequests: activityCollectionFromSearch({ shown: 0, total: 0, githubIncomplete: false }), assignedIssues: activityCollectionFromSearch({ shown: 1, total: 1, githubIncomplete: false }) } } });
    if (path === "/api/github/item") return route.fulfill({ json: detail });
    if (path === "/api/github/comments") return route.fulfill({ json: { ok: true, authed: false, canResolve: false, issueComments: [], reviewThreads: [], reviews: [] } });
    if (path === "/api/github/user") return route.fulfill({ json: { ok: true, login: "fixture-owner", name: "Fixture Owner", avatarUrl: null, htmlUrl: null, bio: "Reviewing long project plans and preserving the original decisions.", company: null, location: null, blog: null, twitter: null, type: "User", followers: 12, following: 8, publicRepos: 5, createdAt: item.updatedAt } });
    if (path.startsWith("/api/github/")) return route.fulfill({ status: 503, json: { ok: false, error: "This GitHub resource is outside the fixture." } });
    return route.fallback();
  });
  await page.goto("/?mode=github");
  await expect(page.getByRole("tablist", { name: "Code surface" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Connect GitHub PAT", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
  return { errors, writes, saveStarted: () => releaseSave !== undefined, finishSave: () => releaseSave?.() };
}

async function checkDialog(page: Page, dialog: Locator, width: number) {
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(width === 390 ? 844 : 1000);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
}

for (const width of [1440, 390]) test.describe(`${width}px GitHub modal workflows`, () => {
  test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) {
    test(`${theme.theme}/${theme.mode} connection preserves a pending and failed draft`, async ({ page }, testInfo) => {
      const state = await boot(page, theme);
      const opener = page.getByRole("button", { name: "Connect GitHub PAT", exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Connect GitHub", exact: true });
      const username = dialog.getByRole("textbox", { name: "GitHub username", exact: true });
      await expect(username).toBeFocused();
      await username.fill("fixture-draft");
      await checkDialog(page, dialog, width);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(state.saveStarted).toBe(true);
      try {
        await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await expect(username).toHaveValue("fixture-draft");
      } finally { state.finishSave(); }
      await expect(dialog).toContainText("Synthetic connection failure. Your draft is retained.");
      await expect(username).toHaveValue("fixture-draft");
      await page.screenshot({ path: testInfo.outputPath("github-connection-error.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(state.writes.filter(path => path.startsWith("/api/github/"))).toEqual(["/api/github/pat"]);
      expect(state.errors).toEqual([]);
    });

    test(`${theme.theme}/${theme.mode} item and profile return to their entry points`, async ({ page }, testInfo) => {
      const state = await boot(page, theme);
      const row = page.locator('[data-item-id="modal-fixture-42"]');
      await row.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (width === 1440) {
        await expect(page.locator(".gh-detail").first()).toContainText("Preserve the original owner");
        await page.getByRole("searchbox", { name: "Search GitHub items by title, repo, or number" }).focus();
        await expect(page.getByRole("searchbox", { name: "Search GitHub items by title, repo, or number" })).toBeFocused();
      }
      await row.dblclick();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await checkDialog(page, dialog, width);
      const author = dialog.getByRole("button", { name: "View @fixture-owner’s GitHub profile", exact: true }).first();
      await author.click();
      const profile = page.getByRole("dialog", { name: "GitHub profile for fixture-owner", exact: true });
      await checkDialog(page, profile, width);
      await expect(profile).toContainText("Fixture Owner");
      await page.screenshot({ path: testInfo.outputPath("github-profile.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(profile).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(author).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("github-item.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(row).toBeFocused();
      expect(state.writes.filter(path => path.startsWith("/api/github/"))).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }
});
