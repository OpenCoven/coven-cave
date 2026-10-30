import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { researchPackageConfig } from "../scripts/research-package-config.mjs";

// Exercise the installed Library, native EventSource/fetch, and shared Modal with intercepted synthetic traffic.
let script: string;
let css: string;
let stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;


test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React from "react";
        import {createRoot} from "react-dom/client";
        import {LiveRegionProvider} from "./src/components/ui/live-region";
        import {ResearchTabLibrary} from "./node_modules/@opencoven/research/dist/components/role-surfaces/research-tab-library.js";
        createRoot(document.getElementById("root")).render(<LiveRegionProvider><ResearchTabLibrary research={{missions:[]}} onNavigate={()=>{}}/></LiveRegionProvider>);
      `,
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-library.js",
    alias: researchPackageConfig().aliases,
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

for (const width of [1440, 390]) test.describe(`${width}px Research Library documents`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) test(`${theme.theme}/${theme.mode} loading, failure, abort and reopen`, async ({ page }, testInfo) => {
    const errors: string[] = [], writes: string[] = [], failures: string[] = [];
    const pending: Array<() => void> = [];
    let reads = 0;
    const completedReads: number[] = [];
    const snapshot = { type: "snapshot", available: true, updatedAt: "2026-10-27T12:00:00Z", rows: [{ timestamp: "2026-10-27T12:00:00Z", kind: "research", iter: 1, slug: "Synthetic findings", score: 24, verdict: "ACCEPT", branch: "fixture", summary: "Synthetic synthesis", synthesisPath: "/fixture/synthesis.md", stagedSkillPath: null }] };
    page.on("pageerror", error => errors.push(error.message));
    page.on("requestfailed", request => { if (new URL(request.url()).pathname === "/api/research/autoloop/document") failures.push(request.failure()?.errorText ?? "unknown"); });
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET") { writes.push(url.pathname); return route.abort("blockedbyclient"); }
      if (url.pathname === "/api/research/autoloop/stream") return route.fulfill({ contentType: "text/event-stream", body: `retry: 60000\ndata: ${JSON.stringify(snapshot)}\n\n` });
      if (url.pathname === "/api/research/autoloop/document" && url.searchParams.get("path") === "/fixture/synthesis.md") {
        const attempt = ++reads;
        if (attempt === 1 || attempt === 3) await new Promise<void>(resolve => pending.push(resolve));
        if (attempt === 2) return route.fulfill({ status: 503, json: { error: "Synthetic unavailable document" } });
        await route.fulfill({ json: { content: attempt === 3 ? "# Stale response\n\nThis must never reopen the closed document." : `# Findings ${attempt}\n\n${"Preserve unresolved dependencies and original evidence.\n\n".repeat(24)}` } });
        completedReads.push(attempt);
        return;
      }
      return route.abort("blockedbyclient");
    });
    await page.route("**/__research-library", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto("/__research-library");
    await page.addScriptTag({ content: script });
    await page.locator("summary").filter({ hasText: "Autoresearch iterations" }).click();
    const opener = page.getByRole("button", { name: "Open Synthetic findings synthesis", exact: true });
    const dialog = page.getByRole("dialog");
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    try {
      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toHaveCount(1);
      await expect(dialog.getByRole("status")).toHaveText("Loading research document…");
      await expect.poll(() => pending.length).toBe(1);
      pending[0]();
      await expect(dialog.getByRole("heading", { name: "Findings 1", exact: true })).toBeVisible();
      await close.focus();
      for (const key of ["Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
      await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      await expect(close).toBeInViewport({ ratio: 1 });
      if (width === 390) {
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        const target = (await close.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath("library-document.png"), animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("alert")).toHaveText("Couldn't open this research document.");
      await close.click();
      await expect(opener).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("status")).toHaveText("Loading research document…");
      await expect.poll(() => pending.length).toBe(2);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect.poll(() => failures.length).toBe(1);
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("heading", { name: "Findings 4", exact: true })).toBeVisible();
      pending[1]();
      await expect.poll(() => completedReads.includes(3)).toBe(true);
      await expect(dialog.getByRole("heading", { name: "Findings 4", exact: true })).toBeVisible();
      await expect(dialog).not.toContainText("Stale response");
      await close.click();
      await expect(opener).toBeFocused();
      expect(reads).toBe(4);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    } finally { pending.forEach(resolve => resolve()); }
  });
});
