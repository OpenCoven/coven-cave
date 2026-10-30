import { expect, test } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";

const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

for (const width of [1440, 390]) test.describe(`${width}px memory inspector`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) for (const extension of ["md", "json"]) test(`${theme.theme}/${theme.mode} ${extension} fullscreen preserves the inline reader and reveal state`, async ({ page }, testInfo) => {
    const preferences = createDefaultPreferences(true);
    preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
    await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
    await page.addInitScript(() => {
      localStorage.setItem("cave:onboarding:dismissed", "1");
      localStorage.setItem("cave:active-familiar", "fixture-review");
    });
    const filePath = `/fixture/memory/review.${extension}`;
    const reads: string[] = [];
    let releaseReveal!: () => void;
    const revealGate = new Promise<void>(resolve => { releaseReveal = resolve; });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (route.request().method() !== "GET") return route.fulfill({ status: 409, json: { ok: false, error: "Read-only fixture." } });
      if (path === "/api/preferences") return route.fulfill({ json: { ok: true, preferences } });
      if (path === "/api/theme") return route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } });
      if (path === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ id: "fixture-project", name: "Project review", root: "/fixture/project", access: "write" }] } });
      if (path === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", harness: "codex", status: "active" }] } });
      if (path === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [] } });
      if (path === "/api/memory") return route.fulfill({ json: { ok: true, entries: [{ root: "/fixture/memory", rootLabel: "Review familiar", relPath: `review.${extension}`, fullPath: filePath, size: 4096, modified: "2026-10-27T12:00:00.000Z", familiarId: "fixture-review" }, { root: "/fixture/foreign", rootLabel: "Other familiar", relPath: "foreign.md", fullPath: "/fixture/foreign/foreign.md", size: 100, modified: "2026-10-27T12:00:00.000Z", familiarId: "fixture-other" }] } });
      if (path === "/api/memory/file") {
        reads.push(url.search);
        const reveal = url.searchParams.get("reveal") === "1";
        if (reveal) await revealGate;
        const marker = reveal ? "SYNTHETIC-REVEALED-VALUE" : "SYNTHETIC-REDACTED-VALUE";
        const text = extension === "md" ? `# Memory review\n\n${marker}\n\n${"Review dependencies and preserve authored decisions.\n\n".repeat(65)}Final evidence row.` : JSON.stringify({ marker, notes: Array.from({ length: 65 }, (_, index) => `Review dependency ${index + 1}`), final: "Final evidence row." }, null, 2);
        return route.fulfill({ json: { ok: true, path: filePath, revealed: reveal, text, redactions: { synthetic: 1 }, rawLength: text.length } });
      }
      return route.fallback();
    });
    await page.goto("/?mode=chat&split=memory&splitSide=right");
    if (width === 390) await page.locator(".split-host__mobile-switcher").getByRole("tab", { name: "Memory", exact: true }).click();
    const memory = page.getByRole("complementary", { name: "Familiar memory", exact: true });
    await expect(memory).toBeVisible({ timeout: 30_000 });
    await expect(memory.getByText("foreign.md", { exact: true })).toHaveCount(0);
    await memory.getByRole("button", { name: new RegExp(`^review\\.${extension}`) }).click();
    await expect(memory).toContainText("SYNTHETIC-REDACTED-VALUE");
    const reader = memory.locator(extension === "md" ? ".cave-md" : ".cave-syntax-block");
    await expect(reader).toBeVisible();
    const readerHandle = (await reader.elementHandle())!;
    const scroller = extension === "md" ? reader : reader.locator(".cave-code-wrap");
    const opener = memory.getByTitle("Open fullscreen", { exact: true });
    await opener.focus();
    const scroll = await scroller.evaluate(element => { element.scrollTop = 100; return element.scrollTop; });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `memory/review.${extension}`, exact: true });
    await expect(dialog).toBeVisible();
    expect(scroll).toBeGreaterThan(0);
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
    const bounds = (await dialog.boundingBox())!;
    expect(Math.abs(bounds.width - width)).toBeLessThan(1); expect(Math.abs(bounds.height - height)).toBeLessThan(1);
    const backgroundAlpha = await dialog.evaluate(element => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    expect(backgroundAlpha, "Fullscreen reading must not show background text through its surface").toBe(255);
    expect(reads).toHaveLength(1);
    await expect(dialog).toContainText("SYNTHETIC-REDACTED-VALUE");
    await expect(dialog).toContainText("1 secret redacted");
    await page.screenshot({ path: testInfo.outputPath("memory-fullscreen-redacted.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "Reveal secrets", exact: true }).click();
    await expect(dialog).toContainText("SYNTHETIC-REDACTED-VALUE");
    await expect(dialog).toContainText("1 secret redacted");
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(scroll);
    releaseReveal();
    await expect(dialog).toContainText("SYNTHETIC-REVEALED-VALUE");
    await expect(dialog).toContainText("1 secret revealed");
    expect(reads).toHaveLength(2); expect(new URLSearchParams(reads[1]).get("reveal")).toBe("1");
    await dialog.locator(".ui-modal-close").focus();
    for (const key of ["Tab", "Shift+Tab"]) { await page.keyboard.press(key); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
    await page.screenshot({ path: testInfo.outputPath("memory-fullscreen-revealed.png"), animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    expect(await readerHandle.evaluate(element => element.isConnected)).toBe(true);
    expect(await scroller.evaluate(element => element.scrollTop)).toBe(scroll);
    await expect(memory).toContainText("SYNTHETIC-REVEALED-VALUE");
    await opener.click(); await expect(dialog).toContainText("SYNTHETIC-REVEALED-VALUE"); expect(reads).toHaveLength(2);
    await dialog.getByRole("button", { name: "Hide secrets", exact: true }).click();
    await expect(dialog).toContainText("SYNTHETIC-REDACTED-VALUE"); expect(reads).toHaveLength(3);
    await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(opener).toBeFocused();
    await expect(memory).toContainText("SYNTHETIC-REDACTED-VALUE");
    await page.screenshot({ path: testInfo.outputPath("memory-inline-return.png"), animations: "disabled" });
  });
});
