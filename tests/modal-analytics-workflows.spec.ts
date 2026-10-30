import { expect, test, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

// Real analytics consumers with synthetic observations and acknowledged chat handoffs only.
let script: string, css: string, stylesheets: string;
const themes = [{ theme: "coven", mode: "dark" }, { theme: "coven", mode: "light" }, { theme: "tide", mode: "dark" }] as const;

test.beforeAll(async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  stylesheets = ((await response.text()).match(/<link\b[^>]*>/g) ?? []).filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(stylesheets).not.toBe("");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {LiveRegionProvider} from "./src/components/ui/live-region";
      import {PopulatedAnalyticsFixture} from "./tests/fixtures/modal-analytics-populated";
      function Fixture(){return <LiveRegionProvider><PopulatedAnalyticsFixture/></LiveRegionProvider>}
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json", outfile: "/tmp/coven-modal-analytics.js",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
});

async function open(page: Page, theme: typeof themes[number]) {
  await page.route("**/api/**", route => route.abort("blockedbyclient"));
  await page.route("http://127.0.0.1:36202/", route => route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme.theme}" data-mode="${theme.mode}"><head>${stylesheets}<style>${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto("/");
  await page.evaluate(() => {
    window.addEventListener("cave:agents-new-right-chat", event => {
      const requests = JSON.parse(sessionStorage.getItem("fixture-handoffs") ?? "[]");
      requests.push((event as CustomEvent).detail);
      sessionStorage.setItem("fixture-handoffs", JSON.stringify(requests));
      if (document.documentElement.dataset.fixtureAck === "yes") event.preventDefault();
    });
  });
  await page.addScriptTag({ content: script });
}

async function layout(page: Page, dialog: Locator, width: number, height: number) {
  await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await dialog.locator(".ui-modal-close").focus();
  for (const key of ["Tab", "Shift+Tab"]) { await page.keyboard.press(key); expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true); }
}

for (const width of [1440, 390]) test.describe(`${width}px populated analytics`, () => {
  const height = width === 390 ? 844 : 1000;
  test.use({ viewport: { width, height }, hasTouch: width === 390, serviceWorkers: "block" });
  for (const theme of themes) {
    test(`${theme.theme}/${theme.mode} repair dates distinguish unknown time and source trace retries preserve evidence`, async ({ page }, testInfo) => {
      await open(page, theme);
      let calls = 0;
      const queries: string[] = [];
      await page.route("**/api/sessions/fixture-session-0/events?*", route => {
        queries.push(new URL(route.request().url()).search);
        calls += 1;
        return route.fulfill(calls === 1 || calls === 3
          ? { status: 503, json: { ok: false, error: "Synthetic trace unavailable. Try again." } }
          : { json: { ok: true, events: [{ seq: 1, id: "fixture-event", session_id: "fixture-session-0", kind: "tool.completed", created_at: "2026-10-22T12:05:00.000Z", payload_json: JSON.stringify({ summary: "Synthetic tool retry accepted", attempt: 2 }) }] } });
      });
      const opener = page.getByTitle("Open the full request board", { exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("group", { name: "Sort requests by" }).getByRole("button", { name: "Newest", exact: true }).click();
      const cards = dialog.locator(".fa-heal-card");
      await expect(cards.first()).toContainText("Fixture tool unavailable");
      await cards.filter({ hasText: "Describe the bounded purpose" }).getByTitle("Open request details", { exact: true }).click();
      const raised = dialog.locator(".fa-modal-facts > span").filter({ hasText: "Raised" });
      await expect(raised.locator("b")).toHaveText("Not recorded");
      await expect(raised.locator("time")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("analytics-undated-repair.png"), animations: "disabled" });
      await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
      await opener.click();
      await cards.filter({ hasText: "Fixture tool unavailable" }).getByTitle("Open request details", { exact: true }).click();
      await expect(raised.locator("time")).toHaveAttribute("datetime", "2026-10-22T12:00:00.000Z");
      await dialog.getByRole("button", { name: "Trace thread", exact: true }).click();
      await expect(dialog).toHaveCount(1);
      await expect(dialog.getByRole("alert")).toHaveText("Synthetic trace unavailable. Try again.");
      await expect(dialog.getByText("No events recorded for this session.", { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("analytics-trace-error.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "Refresh session trace", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(dialog.getByRole("list", { name: "Session trace, 1 events", exact: true })).toContainText("Synthetic tool retry accepted");
      await dialog.getByText("Payload", { exact: true }).click();
      await expect(dialog.locator("pre")).toContainText('"attempt": 2');
      await dialog.getByRole("button", { name: "Refresh session trace", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Synthetic trace unavailable. Try again.");
      await expect(dialog.getByRole("list", { name: "Session trace, 1 events", exact: true })).toContainText("Synthetic tool retry accepted");
      await expect(dialog.locator("pre")).toContainText('"attempt": 2');
      await page.screenshot({ path: testInfo.outputPath("analytics-trace-retained-error.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "Refresh session trace", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(dialog.getByRole("list", { name: "Session trace, 1 events", exact: true })).toBeVisible();
      expect(queries).toEqual(["?afterSeq=0&limit=200", "?afterSeq=0&limit=200", "?afterSeq=1&limit=200", "?afterSeq=1&limit=200"]);
      await layout(page, dialog, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-trace-populated.png"), animations: "disabled" });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    });

    test(`${theme.theme}/${theme.mode} runtime windows and nested trace preserve the evidence panel`, async ({ page }, testInfo) => {
      await open(page, theme);
      let runtimeTraceCalls = 0;
      await page.route("**/api/sessions/fixture-runtime-0/events?*", route => {
        runtimeTraceCalls += 1;
        if (runtimeTraceCalls === 3) return route.fulfill({ status: 404, json: { ok: false, error: "no_event_timeline" } });
        return route.fulfill({ json: { ok: true, events: runtimeTraceCalls === 1 ? [{ seq: 1, id: "runtime-event", session_id: "fixture-runtime-0", kind: "session.completed", created_at: new Date().toISOString(), payload_json: JSON.stringify({ summary: "Synthetic runtime completion" }) }] : [] } });
      });
      const opener = page.locator(".fa-foot__btn").filter({ hasText: "Runtime performance" });
      await expect(opener).toContainText("4 attempts");
      await opener.click(); await page.getByRole("button", { name: "Open full view", exact: true }).click();
      const runtime = page.getByRole("dialog", { name: "Runtime performance", exact: true });
      await expect(runtime.locator(".fa-runtime-attempt")).toHaveCount(4);
      const stats = runtime.locator(".fa-foot-panel__stats");
      // Cancellation is excluded from the success denominator: 2 of 3 completed/error outcomes.
      await expect(stats).toContainText("67%");
      await expect(stats).toContainText("1 failed · 1 cancelled");
      await expect(stats).toContainText("cost unreported");
      await expect(runtime).toContainText("Model unreported");
      await expect(runtime).toContainText("version unreported");
      await expect(runtime.locator(".fa-runtime-coverage li").filter({ hasText: "Token usage" })).toContainText("2 of 4");
      await layout(page, runtime, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-runtime-populated.png"), animations: "disabled" });
      const traceOpener = runtime.getByRole("button", { name: "Open trace", exact: true }).first();
      await traceOpener.click();
      const trace = page.getByRole("dialog").filter({ has: page.locator(".trace") });
      await expect(trace.getByRole("list", { name: "Session trace, 1 events", exact: true })).toContainText("Synthetic runtime completion");
      await layout(page, trace, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-runtime-nested-trace.png"), animations: "disabled" });
      await page.keyboard.press("Escape"); await expect(trace).toHaveCount(0); await expect(runtime).toBeVisible(); await expect(traceOpener).toBeFocused();
      await page.keyboard.press("Escape"); await expect(runtime).toHaveCount(0); await expect(opener).toBeFocused();
      await page.getByRole("group", { name: "Time window", exact: true }).getByRole("button", { name: "7D", exact: true }).click();
      await expect(opener).toContainText("3 attempts");
      await opener.click(); await page.getByRole("button", { name: "Open full view", exact: true }).click();
      await expect(runtime.locator(".fa-runtime-attempt")).toHaveCount(3);
      await expect(stats).toContainText("50%");
      await expect(runtime.locator(".fa-runtime-coverage li").filter({ hasText: "Token usage" })).toContainText("1 of 3");
      await layout(page, runtime, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-runtime-seven-days.png"), animations: "disabled" });
      await traceOpener.click();
      await expect(trace.getByText("No events recorded for this session.", { exact: true })).toBeVisible();
      await expect(trace.getByRole("alert")).toHaveCount(0);
      await page.keyboard.press("Escape"); await expect(traceOpener).toBeFocused();
      await traceOpener.click();
      await expect(trace.getByText("No event log for this session.", { exact: true })).toBeVisible();
      await expect(trace.getByRole("alert")).toHaveCount(0);
      await trace.getByRole("button", { name: "Refresh session trace", exact: true }).click();
      await expect(trace.getByText("No events recorded for this session.", { exact: true })).toBeVisible();
      expect(runtimeTraceCalls).toBe(4);
      await page.keyboard.press("Escape"); await expect(traceOpener).toBeFocused();
      await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    });

    test(`${theme.theme}/${theme.mode} measured trust and signals retain evidence and return focus`, async ({ page }, testInfo) => {
      await open(page, theme);
      const trust = page.getByTitle("How this score is computed", { exact: true });
      await trust.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Weighted equation");
      await expect(dialog).toContainText("Averaged across 3 thread self-reports.");
      await expect(dialog.locator(".fa-trust-modal__equation b")).toContainText("= 70");
      await layout(page, dialog, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-trust-populated.png"), animations: "disabled" });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trust).toBeFocused();
      const signals = page.locator(".fa-foot__btn").filter({ hasText: "Thread signals" });
      await signals.click(); await page.getByRole("button", { name: "Open full view", exact: true }).click();
      await expect(dialog).toContainText("3 reports"); await expect(dialog).toContainText("review");
      await layout(page, dialog, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-signals-populated.png"), animations: "disabled" });
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(signals).toBeFocused();
    });

    test(`${theme.theme}/${theme.mode} contract selection keeps a failed handoff visible and retryable`, async ({ page }, testInfo) => {
      await open(page, theme);
      const opener = page.getByRole("button", { name: "Expand the contract panel", exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Contract compliance", exact: true });
      await dialog.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished)); });
      const purpose = dialog.getByRole("button", { name: "Defined Purpose FAIL", exact: true });
      await purpose.click(); await expect(purpose).toHaveAttribute("aria-expanded", "true");
      await expect(dialog.locator(".fa-contract-panel__detail")).toContainText("FAILING");
      const identity = dialog.getByRole("button", { name: "Named Identity PASS", exact: true });
      await identity.click(); await expect(identity).toHaveAttribute("aria-expanded", "true");
      await expect(dialog.locator(".fa-contract-panel__detail")).toContainText("SATISFIED");
      await purpose.click();
      const review = dialog.getByRole("button", { name: "Review and resolve", exact: true });
      await review.click();
      await expect(dialog.getByRole("alert")).toHaveText("The Chat panel is not ready. Try again.");
      await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("analytics-contract-error.png"), animations: "disabled" });
      await page.evaluate(() => { document.documentElement.dataset.fixtureAck = "yes"; });
      await review.click(); await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(purpose).toHaveAttribute("aria-expanded", "true");
      const requests = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-handoffs") ?? "[]"));
      expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
      expect(requests[0]).toMatchObject({ familiarId: "fixture-analytics", destination: "right-panel", origin: "chat" });
      expect(requests[0].initialPrompt).toContain("Describe the bounded purpose and preserve human approval.");
      await layout(page, dialog, width, height);
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    });

    test(`${theme.theme}/${theme.mode} repair board filters and action handoffs preserve a return target`, async ({ page }, testInfo) => {
      await open(page, theme);
      const opener = page.getByTitle("Open the full request board", { exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog");
      const cards = dialog.locator(".fa-heal-card");
      await expect(cards.first()).toBeVisible(); const total = await cards.count(); expect(total).toBeGreaterThan(0);
      const groups = dialog.getByRole("group", { name: "Group requests by" });
      await groups.getByRole("button", { name: "Source", exact: true }).click();
      await expect(groups.getByRole("button", { name: "Source", exact: true })).toHaveAttribute("aria-pressed", "true");
      await dialog.getByRole("group", { name: "Sort requests by" }).getByRole("button", { name: "A–Z", exact: true }).click();
      await dialog.getByRole("button", { name: /^Critical \d/ }).click();
      await expect(dialog.locator(".fa-heal-card--crit").first()).toBeVisible();
      await expect(dialog.locator(".fa-heal-card:not(.fa-heal-card--crit)")).toHaveCount(0);
      await dialog.getByRole("button", { name: /^All \d/ }).click(); await expect(cards).toHaveCount(total);
      await layout(page, dialog, width, height);
      await page.screenshot({ path: testInfo.outputPath("analytics-board-populated.png"), animations: "disabled" });
      await cards.filter({ hasText: "Describe the bounded purpose" }).getByTitle("Open request details", { exact: true }).click();
      await expect(dialog).toHaveCount(1);
      const fix = dialog.getByRole("button", { name: "Open a fix thread", exact: true });
      await fix.click(); await expect(dialog.getByRole("alert")).toHaveText("The Chat panel is not ready. Try again.");
      await expect(dialog.getByRole("alert")).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("analytics-action-error.png"), animations: "disabled" });
      await page.evaluate(() => { document.documentElement.dataset.fixtureAck = "yes"; });
      await fix.click(); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      const requests = await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-handoffs") ?? "[]"));
      expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
      expect(requests[0].initialPrompt).toContain("Describe the bounded purpose and preserve human approval.");
    });
  }
});

