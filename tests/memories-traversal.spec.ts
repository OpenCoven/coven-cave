import { test, expect, type Page } from "@playwright/test";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const entries = [
  { fullPath: "/fixture/nova/decisions.md", relPath: "decisions.md", familiarId: "nova", rootLabel: "Coven memory", sourceKindLabel: "Coven native memory", modified: "2026-10-20T15:36:18.614Z" },
  { fullPath: "/fixture/sage/notes.md", relPath: "notes.md", familiarId: "sage", rootLabel: "Coven memory", sourceKindLabel: "Coven native memory", modified: "2026-10-20T15:36:18.614Z" },
];
const nodes = [
  { id: `memory:${entries[0].fullPath}`, kind: "memory", title: "Release decisions", ref: { kind: "memory", path: entries[0].fullPath }, degree: 1, scanned: true },
  { id: "knowledge:guide", kind: "knowledge", title: "Deployment guide", ref: { kind: "knowledge", id: "guide" }, degree: 2, scanned: true },
  { id: `memory:${entries[1].fullPath}`, kind: "memory", title: "Sage notes", ref: { kind: "memory", path: entries[1].fullPath }, degree: 1, scanned: true },
];
async function setup(page: Page, failMemory = false, hash = "") {
  let failure = failMemory;
  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true, familiars: [{ id: "nova", display_name: "Nova", status: "active" }, { id: "sage", display_name: "Sage", status: "active" }],
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/knowledge", (route) => route.fulfill({ json: { ok: true, entries: [
    { id: "guide", title: "Deployment guide", body: "Use the verified release checklist.", tags: [], scope: "global", enabled: true },
  ] } }));
  await page.route("**/api/knowledge/collections", (route) => route.fulfill({ json: { ok: true, collections: [] } }));
  await page.route("**/api/memory", (route) => route.fulfill(failure
    ? { status: 503, json: { ok: false, error: "Memory service unavailable" } }
    : { json: { ok: true, entries } }));
  await page.route("**/api/memory/file**", (route) => route.fulfill({ json: {
    ok: true, text: "# Release decisions\nKeep the verified release checklist.", mtimeMs: 1,
  } }));
  await page.route("**/api/journal**", (route) => route.fulfill({ json: { ok: true, days: [] } }));
  await page.route("**/api/grimoire/graph**", (route) => route.fulfill({ json: {
    ok: true, nodes,
    edges: [
      { id: "a-b", source: nodes[0].id, target: nodes[1].id, type: "link" },
      { id: "c-b", source: nodes[2].id, target: nodes[1].id, type: "link" },
    ],
    meta: { knowledge: { scanned: 1 }, memory: { scanned: 2, total: 2, scoped: false }, journal: { scanned: 0, total: 0 } },
  } }));
  await page.goto(`/?mode=grimoire${hash}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".grimoire-view")).toBeVisible();
  return () => { failure = false; };
}

test("Relations preserves reader traversal and clears it when the familiar scope changes", async ({ page }, testInfo) => {
  await setup(page);
  await page.getByRole("button", { name: "Relations", exact: true }).click();
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.locator(".grimoire-graph-node").filter({ hasText: "Release decisions" }).click();
  await expect(page.getByRole("region", { name: "Selected: Release decisions" })).toBeVisible();
  await page.locator(".grimoire-graph-node").filter({ hasText: "Deployment guide" }).click({ modifiers: ["Meta"] });
  await expect(page.locator(".grimoire-reader")).toContainText("Use the verified release checklist.");
  await page.getByRole("button", { name: "Relations", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected: Deployment guide" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected: Release decisions" })).toBeVisible();
  // macOS reserves native Control-click for context menus; dispatch the Windows/Linux event shape.
  await page.locator(".grimoire-graph-node").filter({ hasText: "Deployment guide" }).dispatchEvent("click", { ctrlKey: true, button: 0 });
  await expect(page.locator(".grimoire-reader")).toContainText("Use the verified release checklist.");
  await page.getByRole("button", { name: "Relations", exact: true }).click();

  for (const [mode, theme] of [["dark", "coven"], ["light", "coven"], ["dark", "tide"]]) {
    await page.evaluate(({ mode, theme }) => {
      document.documentElement.dataset.mode = mode;
      document.documentElement.dataset.theme = theme;
    }, { mode, theme });
    await page.screenshot({ path: testInfo.outputPath(`relations-${mode}-${theme}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "Filter memories by familiar", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Sage", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected: Deployment guide" })).toHaveCount(0);
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(page.locator(".grimoire-graph-explorer")).not.toContainText("Release decisions");
  await page.setViewportSize({ width: 640, height: 900 });
  if (await page.locator(".shell-top-toggle--nav").getAttribute("aria-expanded") === "true") await page.keyboard.press("Meta+b");
  await expect(page.getByRole("button", { name: "Fit all", exact: true })).toBeVisible();
  const fits = await page.locator(".grimoire-view").evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(fits).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("relations-narrow.png"), animations: "disabled" });
});

test("Library failure offers a working retry instead of an empty collection", async ({ page }, testInfo) => {
  const recover = await setup(page, true);
  const home = page.locator(".gl-root");
  await expect(home).toContainText("Couldn't load memories");
  await expect(home).not.toContainText("No memories yet");
  await page.screenshot({ path: testInfo.outputPath("library-recovery.png") });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.locator(".grimoire-view").getByRole("alert")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  recover();
  await home.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(home.getByRole("heading", { name: "Continue", exact: true })).toBeVisible();
  await expect(home).not.toContainText("Memory service unavailable");
});


test("a restored stitch tab can recover from an inventory failure", async ({ page }) => {
  const recover = await setup(page, true, "#grimoire:knowledge:guide");
  const reader = page.locator(".grimoire-reader");
  await expect(reader).toContainText("Memory service unavailable");
  recover();
  await reader.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(reader).toContainText("Use the verified release checklist.");
});
