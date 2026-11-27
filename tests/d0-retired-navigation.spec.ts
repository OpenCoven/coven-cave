import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createOnboardingBootstrapState, ONBOARDING_BOOTSTRAP_BOUNDARIES } from "../src/lib/onboarding-bootstrap";

const RAW_HISTORY = '  [{"role":"user","text":"Preserve this legacy history ✓","at":1,"legacy":true}]\n';
const HISTORY_KEY = "cave:ask-salem:thread:v1";
const ISO = "2026-11-04T10:00:00.000Z";

async function prepare(page: Page) {
  const salemRequests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/salem")) salemRequests.push(request.url()); });
  await page.addInitScript(({ key, raw }) => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:shell:nav-open", "0");
    localStorage.setItem("cave:shell:nav-open:source", "user");
    localStorage.setItem(key, raw);
  }, { key: HISTORY_KEY, raw: RAW_HISTORY });
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.context().routeWebSocket((url) => url.pathname !== "/_next/hmr", (socket) => socket.close());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    // Retired endpoints use the actual production handlers below the normal
    // HTTP access gate. Other reads stay inside this synthetic browser fixture.
    if (path.startsWith("/api/salem")) return route.continue();
    const bootstrap = createOnboardingBootstrapState(true);
    const project = { id: "retirement-project", name: "Retained project", root: "/repo", access: "write", createdAt: ISO, updatedAt: ISO };
    let payload: object = { ok: true };
    if (path === "/api/onboarding/bootstrap") payload = { ...bootstrap, ok: true, complete: true, needsSetup: false, status: "complete", stages: bootstrap.stages.map((stage) => ({ ...stage, status: "complete" })), boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES };
    else if (path === "/api/onboarding/status") payload = { ok: true, complete: true, steps: {}, tools: [] };
    else if (path === "/api/familiars") payload = { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:moon" }] };
    else if (path === "/api/projects") payload = { ok: true, projects: [project] };
    else if (path === "/api/queue/project") payload = { ok: true, projectId: project.id, project };
    else if (path === "/api/daemon/connection") payload = { ok: true, running: true, connected: true, target: { mode: "local" } };
    else if (path === "/api/sessions/list") payload = { ok: true, sessions: [] };
    else if (path === "/api/search") payload = { ok: true, results: [] };
    await route.fulfill({ json: payload });
  });
  return { salemRequests, errors };
}

for (const width of [1440, 390]) {
  test(`D0 saved Salem destination is inert and exports original history at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { salemRequests, errors } = await prepare(page);
    await page.goto("/?mode=salem", { waitUntil: "domcontentloaded" });
    const retired = page.getByRole("region", { name: "Retired Ask Salem", exact: true });
    await expect(retired.getByText("Ask Salem has been retired", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(retired.locator("input,textarea,form,select")).toHaveCount(0);
    const exporting = page.waitForEvent("download");
    await retired.getByRole("button", { name: "Export saved Salem history", exact: true }).click();
    const download = await exporting;
    expect(download.suggestedFilename()).toBe("cave-salem-history.json");
    expect(await readFile((await download.path())!, "utf8")).toBe(RAW_HISTORY);
    expect(await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY)).toBe(RAW_HISTORY);
    await expect(retired.getByText("Saved history export requested.", { exact: true })).toHaveAttribute("role", "status");
    await page.screenshot({ path: info.outputPath(`retired-history-${width}.png`), animations: "disabled" });
    expect(salemRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const entry of ["saved split", "legacy event"] as const) {
  test(`D0 ${entry} keeps Home available beside the inert retirement notice`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { salemRequests, errors } = await prepare(page);
    await page.goto(entry === "saved split" ? "/?mode=home&split=salem" : "/?mode=home", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".home-overview").getByRole("heading", { name: "Overview", exact: true })).toBeVisible({ timeout: 45_000 });
    // A painted lazy heading can precede the shell's passive effects. The
    // accepted scope read establishes readiness before delivering an event.
    await expect(page.locator(".home-overview")).toHaveAttribute("data-observation", "current");
    if (entry === "legacy event") {
      const cdp = await page.context().newCDPSession(page);
      const target = await cdp.send("Runtime.evaluate", { expression: "window" });
      const listeners = await cdp.send("DOMDebugger.getEventListeners", { objectId: target.result.objectId! });
      const legacy = listeners.listeners.filter((listener) => listener.type === "cave:salem-open");
      expect(legacy.length).toBeGreaterThan(0);
      await info.attach("legacy-event-listeners", { body: JSON.stringify(legacy, null, 2), contentType: "application/json" });
      await page.evaluate(() => window.dispatchEvent(new Event("cave:salem-open")));
    }
    const retired = page.getByRole("region", { name: "Retired Ask Salem", exact: true });
    await expect(retired).toBeVisible();
    await expect(retired.locator("textarea,input,form,select")).toHaveCount(0);
    await expect(page.locator(".home-overview").getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), HISTORY_KEY)).toBe(RAW_HISTORY);
    await page.screenshot({ path: info.outputPath(`retired-${entry.replace(" ", "-")}.png`), animations: "disabled" });
    expect(salemRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("D0 command palette offers no retired assistant answering or destination", async ({ page }) => {
  const { salemRequests, errors } = await prepare(page);
  await page.goto("/?mode=home", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".home-overview")).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await palette.getByRole("combobox", { name: "Search and jump to anything", exact: true }).fill("Ask Salem");
  // A generic Create task row may quote the query; it is not an assistant.
  await expect(palette.getByRole("option").filter({ hasText: /^Ask Salem/i })).toHaveCount(0);
  await expect(palette.getByRole("button", { name: /^Ask Salem/i })).toHaveCount(0);
  await expect(palette.getByRole("button", { name: /^Create task: Ask Salem/ })).toBeVisible();
  expect(salemRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("D0 retired HTTP entry points name their refusal under the real production access gate", async ({ page }) => {
  for (const [method, path] of [["GET", "/api/salem"], ["POST", "/api/salem"], ["GET", "/api/salem/pathfinder"], ["POST", "/api/salem/pathfinder"], ["POST", "/api/salem/pathfinder/feedback"]] as const) {
    const response = await page.request.fetch(path, { method, ...(method === "POST" ? { data: { message: "This must remain retired" } } : {}) });
    expect(response.status(), `${method} ${path}`).toBe(410);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, code: "salem-retired", error: "Ask Salem has been retired from Cave." });
  }
});
