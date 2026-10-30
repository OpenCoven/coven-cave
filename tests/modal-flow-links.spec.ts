import { expect, test } from "@playwright/test";
import { createDefaultPreferences } from "../src/lib/preferences-schema";

const themes = [
  { theme: "coven", mode: "dark" },
  { theme: "coven", mode: "light" },
  { theme: "tide", mode: "dark" },
] as const;

// Exercise FlowExecutionLink through the app router, including an initially
// open modal during hydration. All domain data and rejected writes are synthetic.
for (const width of [1440, 390]) {
  test.describe(`${width}px Flow link dialogs`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, hasTouch: width === 390, serviceWorkers: "block" });
    for (const theme of themes) for (const kind of ["run", "unavailable"] as const) {
      test(`${theme.theme}/${theme.mode} ${kind} preserves navigation on dismissal`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        const writes: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const preferences = createDefaultPreferences(true);
        preferences.appearance.theme = { ...preferences.appearance.theme, id: theme.theme, modePreference: theme.mode, resolvedMode: theme.mode };
        await page.addInitScript(() => {
          localStorage.setItem("cave:onboarding:dismissed", "1");
          localStorage.setItem("cave:active-familiar", "fixture-review");
        });
        await page.route("**/api/**", route => {
          const path = new URL(route.request().url()).pathname;
          if (route.request().method() !== "GET") {
            writes.push(path);
            return route.fulfill({ status: 409, json: { ok: false, error: "Fixture does not save changes." } });
          }
          if (path === "/api/preferences") return route.fulfill({ json: { ok: true, preferences } });
          if (path === "/api/theme") return route.fulfill({ json: { ok: true, theme: { themeId: theme.theme, mode: theme.mode, modePreference: theme.mode, revision: preferences.revision, selectionRevision: preferences.appearance.theme.selectionRevision } } });
          if (path === "/api/familiars") return route.fulfill({ json: { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", role: "Review plans", harness: "codex", status: "active" }] } });
          // This journey starts after project setup; an empty registry opens
          // the independent required-project gate alongside the linked dialog.
          if (path === "/api/projects") return route.fulfill({ json: { ok: true, projects: [{ id: "fixture-project", name: "Review project", root: "/fixture/project", access: "write" }] } });
          if (path === "/api/sessions/list") return route.fulfill({ json: { ok: true, sessions: [] } });
          if (path === "/api/flows/runs") return route.fulfill({ json: { ok: true, runs: [{ id: "fixture-run", flowId: "fixture-flow", flowName: "Review the project plan and preserve unresolved dependencies", status: "failed", startedAt: "2026-10-24T09:00:00.000Z", source: "cave", steps: [] }] } });
          return route.fallback();
        });
        const target = kind === "run"
          ? "flowRun=fixture-run&flowFamiliar=fixture-review"
          : "researchMission=fixture-mission&flowFamiliar=fixture-missing";
        await page.goto(`/?mode=chat&${target}&keep=one#review`);
        const dialog = page.getByRole("dialog");
        await expect(dialog).toHaveCount(1);
        await expect(dialog).toContainText(kind === "run"
          ? "Review the project plan and preserve unresolved dependencies"
          : "Research familiar unavailable");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme.theme);
        await expect(page.locator("html")).toHaveAttribute("data-mode", theme.mode);
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
        await page.screenshot({ path: testInfo.outputPath(`flow-link-${kind}.png`), animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(page).toHaveURL(/keep=one/);
        await expect(page).toHaveURL(/#review$/);
        expect(new URL(page.url()).searchParams.has(kind === "run" ? "flowRun" : "researchMission")).toBe(false);
        expect(new URL(page.url()).searchParams.has("flowFamiliar")).toBe(false);
        expect(await page.locator("main").first().evaluate(element => element.closest("[inert]") === null)).toBe(true);
        expect(writes.filter(path => path.startsWith("/api/flows/") || path.startsWith("/api/research/"))).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}
