import { expect, test } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";
import { shellMigrationStatus } from "./fixtures/modal-shell-data";

const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

for (const width of [1440, 390]) test.describe(`${width}px migration review`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) test(`${theme.theme}/${theme.mode} shell entry preserves pending work and requires the current confirmation`, async ({ page }, testInfo) => {
    const preferences = createDefaultPreferences(true);
    preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
    await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
    await page.addInitScript(() => {
      localStorage.setItem("cave:onboarding:dismissed", "1");
      localStorage.setItem("cave:active-familiar", "fixture-review");
    });
    let status = structuredClone(shellMigrationStatus);
    const requests: Array<{ legacy: string; action: string; confirm?: string }> = [];
    let releaseFailure!: () => void;
    const pendingFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/cave-home-migration") {
        if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, status } });
        const body = route.request().postDataJSON();
        requests.push(body);
        if (requests.length === 1) {
          await pendingFailure;
          return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic migration unavailable. Retry after reviewing both copies." } });
        }
        if (requests.length <= 4) {
          const renewed = requests.length >= 3;
          return route.fulfill({ json: { ok: true, status, result: { confirmationRequired: [{ legacy: body.legacy, action: body.action, keptBytes: 4096, discardedBytes: renewed ? 12288 : 8192, discardToken: renewed ? "fixture-copy-2" : "fixture-copy-1", summary: renewed ? "The legacy copy changed. Review the new 12 KB copy before confirming." : "The legacy copy is larger. Review the 8 KB copy before confirming." }] } } });
        }
        status = { ...status, details: status.details.filter(detail => detail.legacy !== body.legacy), conflicts: status.details.filter(detail => detail.legacy !== body.legacy).map(detail => detail.legacy) };
        return route.fulfill({ json: { ok: true, status, result: { resolved: [body.legacy] } } });
      }
      if (route.request().method() !== "GET") return route.fulfill({ status: 409, json: { ok: false, error: "No other fixture writes are supported." } });
      if (path === "/api/preferences") return route.fulfill({ json: { ok: true, preferences } });
      if (path === "/api/theme") return route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } });
      if (path === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ id: "fixture-project", name: "Project review", root: "/fixture/project", access: "write" }] } });
      if (path === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", harness: "codex", status: "active" }] } });
      if (path === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [] } });
      return route.fallback();
    });
    await page.goto("/?mode=chat");
    const opener = page.getByRole("button", { name: "Review files", exact: true });
    await expect(opener).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
    await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Review Cave data migration", exact: true });
    await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
    const file = dialog.locator("article").filter({ has: page.locator("strong", { hasText: /^review-state-1\.json$/ }) });
    const choose = file.getByRole("button", { name: "Keep current", exact: true });
    await choose.click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).last()).toBeDisabled();
    await expect(file.getByRole("button", { name: "Recover legacy", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    releaseFailure();
    await expect(dialog.getByRole("status")).toContainText("Synthetic migration unavailable.");
    await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
    await expect(file).toContainText("Both synthetic copies are preserved.");
    await page.screenshot({ path: testInfo.outputPath("migration-failed.png"), animations: "disabled" });
    await choose.click();
    const confirmation = file.getByRole("alert");
    const confirm = confirmation.getByRole("button", { name: "Discard larger copy anyway", exact: true });
    await expect(confirmation).toContainText("Review the 8 KB copy");
    await expect(confirmation).toBeInViewport({ ratio: 1 });
    await confirm.click();
    await expect(confirmation).toContainText("Review the new 12 KB copy");
    await expect(confirmation).toBeInViewport({ ratio: 1 });
    expect(requests[2]).toEqual({ legacy: "review-state-1.json", action: "keep-canonical", confirm: "fixture-copy-1" });
    await page.screenshot({ path: testInfo.outputPath("migration-renewed-confirmation.png"), animations: "disabled" });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0); expect(requests).toHaveLength(3);
    await choose.click(); await expect(confirmation).toContainText("Review the new 12 KB copy");
    await confirm.click(); await expect(file).toHaveCount(0);
    expect(requests[4]).toEqual({ legacy: "review-state-1.json", action: "keep-canonical", confirm: "fixture-copy-2" });
    expect(requests[0]).toEqual(requests[1]); expect(requests[1]).toEqual(requests[3]);
    await expect(dialog.getByRole("status")).toContainText("Keep current complete.");
    await expect(dialog.locator("article")).toHaveCount(5);
    await dialog.getByRole("button", { name: "Open backup folder", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Backups are stored at /fixture/recovery");
    await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await dialog.locator(".ui-modal-close").focus();
    for (const key of ["Tab", "Shift+Tab"]) { await page.keyboard.press(key); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
    await page.screenshot({ path: testInfo.outputPath("migration-resolved.png"), animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await opener.click(); await expect(dialog.locator("article")).toHaveCount(5);
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
  });
});
