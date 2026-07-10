import { expect, test, type Page } from "@playwright/test";
import { build, type Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
let harnessBundle = "";
let settingsHarnessBundle = "";
const settingsCss = [
  readFileSync(path.join(repoRoot, "src/styles/dashboard.css"), "utf8"),
  readFileSync(path.join(repoRoot, "src/app/globals.css"), "utf8"),
].join("\n");

const dashboardCockpitStub: Plugin = {
  name: "dashboard-cockpit-fixture",
  setup(builder) {
    builder.onResolve(
      { filter: /^@\/components\/dashboard\/dashboard-cockpit$/ },
      () => ({ path: "dashboard-cockpit", namespace: "fixture" }),
    );
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      loader: "js",
      resolveDir: repoRoot,
      contents: `
        import { createElement } from "react";
        export function DashboardCockpit({ model }) {
          return createElement(
            "output",
            { "aria-label": "Rendered dashboard model" },
            model.date.toISOString(),
          );
        }
      `,
    }));
  },
};

const nextNavigationStub: Plugin = {
  name: "next-navigation-fixture",
  setup(builder) {
    builder.onResolve(
      { filter: /^next\/navigation$/ },
      () => ({ path: "next-navigation", namespace: "fixture-navigation" }),
    );
    builder.onLoad({ filter: /.*/, namespace: "fixture-navigation" }, () => ({
      loader: "js",
      contents: `
        export function useRouter() {
          return { back() {}, push() {}, replace() {}, refresh() {}, prefetch() {} };
        }
        export function usePathname() { return "/settings"; }
        export function useSearchParams() { return new URLSearchParams(); }
      `,
    }));
  },
};

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, "tests/fixtures/embedded-adapters-harness.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [dashboardCockpitStub],
  });
  harnessBundle = result.outputFiles[0]?.text ?? "";
  if (!harnessBundle) throw new Error("Embedded adapters harness bundle was empty");

  const settingsResult = await build({
    absWorkingDir: repoRoot,
    entryPoints: [path.join(repoRoot, "tests/fixtures/settings-embedded-harness.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    write: false,
    outdir: "embedded-adapters-fixture",
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [nextNavigationStub],
    loader: {
      ".css": "css",
      ".ttf": "dataurl",
      ".woff": "dataurl",
      ".woff2": "dataurl",
    },
  });
  settingsHarnessBundle = settingsResult.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  if (!settingsHarnessBundle) throw new Error("Settings embedded harness bundle was empty");
});

async function mountHarness(page: Page) {
  await page.setContent("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  await page.addScriptTag({ content: harnessBundle });
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T01:00:00.000Z");
}

async function mountSettingsHarness(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("http://embedded-adapters.test/", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html data-tauri-titlebar><body><div id=\"root\"></div></body></html>",
  }));
  await page.goto("http://embedded-adapters.test/");
  await page.addStyleTag({ content: settingsCss });
  await page.addScriptTag({ content: settingsHarnessBundle });
  await page.waitForTimeout(100);
  expect(pageErrors).toEqual([]);
  await expect(page.locator(".settings-shell")).toHaveCount(1);
}

test("keeps a present dashboard seed authoritative across A to B prop changes", async ({ page }) => {
  await mountHarness(page);
  await page.getByRole("button", { name: "Seed B" }).click();
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T02:00:00.000Z");
  await expect(page.getByLabel("Pending dashboard requests")).toHaveText("0");
});

test("lets a seed replace loading and ignores the stale deferred response", async ({ page }) => {
  await mountHarness(page);
  await page.getByRole("button", { name: "Unseed" }).click();
  await expect(page.getByRole("status", { name: "Dashboard is loading" })).toHaveCount(1);
  await expect(page.getByLabel("Pending dashboard requests")).toHaveText("1");

  await page.getByRole("button", { name: "Seed C" }).click();
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T03:00:00.000Z");
  await page.getByRole("button", { name: "Resolve oldest as Fetched D" }).click();
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T03:00:00.000Z");
});

test("resets a removed seed to loading and renders its fetched replacement", async ({ page }) => {
  await mountHarness(page);
  await page.getByRole("button", { name: "Unseed" }).click();
  await expect(page.getByRole("status", { name: "Dashboard is loading" })).toHaveCount(1);
  await expect(page.getByLabel("Pending dashboard requests")).toHaveText("1");

  await page.getByRole("button", { name: "Resolve oldest as Fetched D" }).click();
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T04:00:00.000Z");
});

test("preserves dashboard retry after an unseeded request fails", async ({ page }) => {
  await mountHarness(page);
  await page.getByRole("button", { name: "Unseed" }).click();
  await expect(page.getByLabel("Pending dashboard requests")).toHaveText("1");
  await page.getByRole("button", { name: "Reject oldest" }).click();
  await expect(page.getByText("Dashboard is unavailable")).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status", { name: "Dashboard is loading" })).toHaveCount(1);
  await expect(page.getByLabel("Pending dashboard requests")).toHaveText("1");
  await page.getByRole("button", { name: "Resolve oldest as Fetched D" }).click();
  await expect(page.getByLabel("Rendered dashboard model")).toHaveText("2026-07-10T04:00:00.000Z");
});

test("removes native drag chrome and titlebar inset only while Settings is embedded", async ({ page }) => {
  await mountSettingsHarness(page);
  const shell = page.locator(".settings-shell");
  const header = page.locator(".settings-shell__header");

  await expect(shell).toHaveClass(/settings-shell--embedded/);
  await expect(header).not.toHaveAttribute("data-tauri-drag-region");
  await expect(header).toHaveCSS("padding-left", "12px");

  await page.getByRole("button", { name: "Toggle settings embedding" }).click();
  await expect(shell).not.toHaveClass(/settings-shell--embedded/);
  await expect(header).toHaveAttribute("data-tauri-drag-region", "deep");
  await expect(header).toHaveCSS("padding-left", "78px");
});

test("handles embedded section arrows from its focused pane root but not a sibling pane", async ({ page }) => {
  await mountSettingsHarness(page);
  const settingsPane = page.getByRole("region", { name: "Settings pane" });
  const siblingControl = page.getByRole("button", { name: "Sibling pane control" });
  const general = page.getByRole("button", { name: "General", exact: true });

  await expect(general).toHaveAttribute("aria-current", "page");
  await siblingControl.focus();
  const siblingAllowedDefault = await siblingControl.evaluate((target) => target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  ));
  expect(siblingAllowedDefault).toBe(true);
  await expect(general).toHaveAttribute("aria-current", "page");

  await settingsPane.focus();
  await expect(settingsPane).toBeFocused();
  const settingsPreventedDefault = await settingsPane.evaluate((target) => target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  ));
  expect(settingsPreventedDefault).toBe(false);
});
