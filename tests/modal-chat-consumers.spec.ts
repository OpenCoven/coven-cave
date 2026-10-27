import { expect, test, type Page } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";
import { shellSessions } from "./fixtures/modal-shell-data";

const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;
const session = { ...shellSessions[0], title: "Modal chat workflow review" };
const marker = "Synthetic chat answer for modal workflow review.";
const edit = { id: "fixture-edit", name: "Edit", input: JSON.stringify({ file_path: "/fixture/external/review.md", old_string: "Prior project notes.\n".repeat(30), new_string: "Preserve authored decisions and unresolved dependencies.\n".repeat(30) }), status: "ok", durationMs: 1100, textOffset: 0 };

async function openChat(page: Page, theme: typeof themes[number]) {
  if (process.env.CAVE_HYDRATION_DIAGNOSTICS === "1") await page.route("**/_next/static/chunks/*.js", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const body = source.replace(/onRecoverableError:([\w$]+)\.onRecoverableError/g, "onRecoverableError:(error,info)=>{window.fixtureHydrationInfo=info;return $1.onRecoverableError(error,info)}");
    await route.fulfill({ response, body });
  });
  const preferences = createDefaultPreferences(true);
  preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "fixture-review");
    localStorage.setItem("cave:familiar:fixture-review:last-surface", "chat");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.fulfill({ status: 409, json: { ok: false, error: "Fixture does not save changes." } });
    if (path === "/api/preferences") return route.fulfill({ json: { ok: true, preferences } });
    if (path === "/api/theme") return route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } });
    if (path === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ id: "fixture-project", name: "Project review", root: session.project_root, access: "write" }] } });
    if (path === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", role: "Review plans and preserve authored decisions", harness: "codex", status: "active" }] } });
    if (path === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [session] } });
    if (path.startsWith("/api/chat/conversation/")) return route.fulfill({ json: { ok: true, conversation: { turns: [{ id: "fixture-user", role: "user", text: "Review the project plan without changing files.", createdAt: session.created_at }, { id: "fixture-answer", role: "assistant", text: marker, tools: [edit], createdAt: session.updated_at }] }, context: {} } });
    return route.fallback();
  });
  await page.goto("/?mode=chat");
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  await page.getByText(session.title, { exact: true }).first().click();
  await expect(page.locator(".cave-artifact-content").last()).toContainText(marker, { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
}

for (const width of [1440, 390]) {
  test.describe(`${width}px Chat modal workflows`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390, serviceWorkers: "block" });
    for (const theme of themes) for (const kind of ["debug", "edit-review"]) {
      test(`${theme.theme}/${theme.mode} ${kind} preserves its Chat entry point`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        let phase = "startup";
        page.on("pageerror", error => { errors.push(error.stack ?? error.message); testInfo.annotations.push({ type: "pageerror", description: `${phase}: ${error.message}` }); });
        await openChat(page, theme);
        phase = "modal";
        let opener;
        if (kind === "debug") {
          if (width === 390) {
            await page.getByLabel("Open chat context", { exact: true }).click();
            opener = page.getByRole("button", { name: "Debug session", exact: true });
            await opener.click();
          } else {
            opener = page.getByRole("button", { name: "Session options", exact: true });
            await opener.click();
            await page.getByRole("menuitem", { name: "Debug session", exact: true }).click();
          }
        } else {
          opener = page.locator(".cave-edit-card__review");
          await expect(opener).toBeVisible({ timeout: 10_000 });
          await opener.click();
        }
        const dialog = page.getByRole("dialog");
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toBeVisible();
        await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(width === 390 ? 844 : 1000);
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        for (let step = 0; step < 6; step++) {
          await page.keyboard.press("Tab");
          expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath(`chat-${kind}.png`), animations: "disabled" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
        await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(page.locator(".cave-artifact-content").last()).toContainText(marker);
        if (process.env.CAVE_HYDRATION_DIAGNOSTICS === "1") await testInfo.attach("hydration-info", { contentType: "application/json", body: JSON.stringify(await page.evaluate(() => (window as unknown as { fixtureHydrationInfo: unknown }).fixtureHydrationInfo) ?? null) });
        expect(errors).toEqual([]);
      });
    }
  });
}
