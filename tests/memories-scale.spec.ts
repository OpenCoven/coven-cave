import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

// Renderer acceptance with deterministic API payloads. These measurements do
// not measure filesystem scans, daemon throughput, or native macOS behavior.
test.use({ contextOptions: { reducedMotion: "reduce" } });

const DOCUMENT_COUNT = 1500;
const entries = Array.from({ length: DOCUMENT_COUNT }, (_, index) => {
  const familiarId = index % 2 === 0 ? "nova" : "sage";
  const relPath = `scale-document-${String(index).padStart(4, "0")}.md`;
  return {
    fullPath: `/fixture/${familiarId}/${relPath}`, relPath, familiarId,
    rootLabel: "Coven memory", sourceKindLabel: "Coven native memory",
    modified: "2026-10-20T15:36:18.614Z",
  };
});
const nodes = entries.map((entry) => ({
  id: `memory:${entry.fullPath}`, kind: "memory", title: entry.relPath,
  ref: { kind: "memory", path: entry.fullPath }, degree: 4, scanned: true,
}));
// Two same-owner ring links per document: 3000 edges overall, 1500 in each
// familiar scope, including links from the final documents back to the start.
const edges = nodes.flatMap((node, index) => [2, 4].map((offset) => ({
  id: `${index}-${offset}`, source: node.id,
  target: nodes[(index + offset) % DOCUMENT_COUNT].id, type: "link",
})));

test("large Memories corpus remains searchable and traversable without query rescans", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const requests = { memoryInventory: 0, graphInventory: 0, fileReads: 0 };
  const graphRequests: Array<{ scope: string[]; nodes: number; edges: number }> = [];
  const observations: Array<{ operation: string; elapsedMs: number; requests: typeof requests }> = [];
  const graphDiagnostics: Record<string, unknown> = {};
  const domRows: Array<{ scope: string; rows: number }> = [];
  const measure = async (operation: string, action: () => Promise<void>) => {
    const start = performance.now();
    await action();
    observations.push({ operation, elapsedMs: Math.round((performance.now() - start) * 100) / 100, requests: { ...requests } });
  };

  await page.addInitScript(() => localStorage.setItem("cave:onboarding:dismissed", "1"));
  // Milestone notifications are unrelated to corpus rendering. Their toast
  // can cover the graph toolbar and add its dismissal timeout to click timing.
  await page.route("**/api/milestones**", (route) => route.fulfill({ json: { ok: true, awarded: [], keys: [] } }));
  await page.route("**/api/inbox/stream**", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: {
    ok: true, familiars: ["nova", "sage"].map((id) => ({ id, display_name: id === "nova" ? "Nova" : "Sage", status: "active" })),
  } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/knowledge", (route) => route.fulfill({ json: { ok: true, entries: [] } }));
  await page.route("**/api/knowledge/collections", (route) => route.fulfill({ json: { ok: true, collections: [] } }));
  await page.route("**/api/journal**", (route) => route.fulfill({ json: { ok: true, days: [] } }));
  await page.route("**/api/memory", (route) => {
    requests.memoryInventory++;
    return route.fulfill({ json: { ok: true, entries } });
  });
  await page.route("**/api/memory/file**", (route) => {
    requests.fileReads++;
    const path = new URL(route.request().url()).searchParams.get("path");
    return route.fulfill({ json: { ok: true, text: `# ${path?.split("/").pop()}\nScale fixture body for ${path}.`, mtimeMs: 1 } });
  });
  await page.route("**/api/grimoire/graph**", (route) => {
    requests.graphInventory++;
    const scope = new URL(route.request().url()).searchParams.getAll("familiarId");
    const scopedNodes = nodes.filter((_, index) => !scope.length || scope.includes(entries[index].familiarId));
    const ids = new Set(scopedNodes.map((node) => node.id));
    const scopedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    graphRequests.push({ scope, nodes: scopedNodes.length, edges: scopedEdges.length });
    return route.fulfill({ json: {
      ok: true, nodes: scopedNodes, edges: scopedEdges,
      meta: { knowledge: { scanned: 0 }, memory: { scanned: scopedNodes.length, total: scopedNodes.length, scoped: scope.length > 0 }, journal: { scanned: 0, total: 0 } },
    } });
  });

  try {
    await measure("library.initial-load", async () => {
      await page.goto("/?mode=grimoire", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".gl-root").getByRole("heading", { name: "Continue", exact: true })).toBeVisible();
      await expect.poll(() => requests.memoryInventory).toBeGreaterThan(0);
      await expect.poll(() => requests.graphInventory).toBeGreaterThan(0);
    });
    const librarySearch = page.getByRole("searchbox", { name: "Search memories", exact: true });
    for (const entry of entries.slice(-2)) {
      await measure(`library.search.${entry.familiarId}.end-of-corpus`, async () => {
        await librarySearch.fill(entry.relPath);
        await expect(page.locator(".gl-root").getByRole("button").filter({ hasText: entry.relPath })).toBeVisible();
      });
    }
    await librarySearch.fill("");
    const explorer = page.locator(".grimoire-graph-explorer");
    const profiler = process.env.CAVE_MEMORY_PROFILE === "1" ? await page.context().newCDPSession(page) : null;
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
      await profiler.send("Performance.enable");
      graphDiagnostics.before = await profiler.send("Performance.getMetrics");
    }
    graphDiagnostics.startTime = await page.evaluate(() => performance.now());
    await measure("relations.initial-load.all", async () => {
      await measure("relations.initial-load.relations-click", async () => {
        await page.getByRole("button", { name: "Relations", exact: true }).click();
      });
      await measure("relations.initial-load.explore-visible", async () => {
        await expect(page.getByRole("button", { name: "Explore", exact: true })).toBeVisible();
      });
      await measure("relations.initial-load.explore-click", async () => {
        await page.getByRole("button", { name: "Explore", exact: true }).click();
      });
      await measure("relations.initial-load.rows-visible", async () => {
        await expect(explorer.locator(".grimoire-graph-node")).toHaveCount(40);
      });
    });
    graphDiagnostics.endTime = await page.evaluate(() => performance.now());
    graphDiagnostics.resources = await page.evaluate((startTime) => performance.getEntriesByType("resource").filter((entry) => entry.startTime >= startTime).map((entry) => entry.toJSON()), graphDiagnostics.startTime as number);
    if (profiler) {
      graphDiagnostics.after = await profiler.send("Performance.getMetrics");
      const { profile } = await profiler.send("Profiler.stop");
      await testInfo.attach("memories-initial-graph-cpu-profile", { contentType: "application/json", body: Buffer.from(JSON.stringify(profile)) });
      await profiler.detach();
    }
    domRows.push({ scope: "all.initial", rows: await explorer.locator(".grimoire-graph-node").count() });
    await explorer.getByRole("button", { name: "Show more documents", exact: true }).click();
    await expect(explorer.locator(".grimoire-graph-node")).toHaveCount(80);
    domRows.push({ scope: "all.expanded", rows: await explorer.locator(".grimoire-graph-node").count() });

    for (const [index, displayName] of [[1498, "Nova"], [1499, "Sage"]] as const) {
      const entry = entries[index];
      const neighbor = entries[(index + 2) % DOCUMENT_COUNT];
      const beforeScope = requests.graphInventory;
      await measure(`relations.scope.${entry.familiarId}`, async () => {
        await page.getByRole("button", { name: "Filter memories by familiar", exact: true }).click();
        await page.getByRole("menuitemradio", { name: displayName, exact: true }).click();
        await expect.poll(() => requests.graphInventory).toBe(beforeScope + 1);
        await expect(page.getByRole("button", { name: "Explore", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Explore", exact: true }).click();
        await expect(explorer.locator(".grimoire-graph-node")).toHaveCount(40);
      });
      expect(graphRequests.at(-1)).toEqual({ scope: [entry.familiarId], nodes: 750, edges: 1500 });
      domRows.push({ scope: entry.familiarId, rows: await explorer.locator(".grimoire-graph-node").count() });
      const beforeSearch = { ...requests };
      const graphSearch = page.getByRole("searchbox", { name: "Highlight graph nodes" });
      await measure(`relations.search.${entry.familiarId}.per-keystroke`, async () => {
        // Real keyboard events expose query-dependent fetch loops that fill()
        // (a single change event) can miss.
        await graphSearch.pressSequentially(entry.relPath);
        await expect(explorer.locator(".grimoire-graph-node")).toHaveCount(1);
        await expect(explorer).toContainText(entry.relPath);
      });
      expect(requests.graphInventory).toBe(beforeSearch.graphInventory);
      expect(requests.memoryInventory).toBe(beforeSearch.memoryInventory);
      await measure(`relations.traverse.${entry.familiarId}`, async () => {
        await explorer.locator(".grimoire-graph-node").filter({ hasText: entry.relPath }).click();
        await expect(page.getByRole("region", { name: `Selected: ${entry.relPath}`, exact: true })).toBeVisible();
        await explorer.locator(".grimoire-graph-node").filter({ hasText: neighbor.relPath }).click();
        await expect(page.getByRole("region", { name: `Selected: ${neighbor.relPath}`, exact: true })).toBeVisible();
        await explorer.getByRole("button", { name: "Back", exact: true }).click();
        await expect(page.getByRole("region", { name: `Selected: ${entry.relPath}`, exact: true })).toBeVisible();
      });
      await measure(`relations.open-and-return.${entry.familiarId}`, async () => {
        await explorer.getByRole("button", { name: "Open", exact: true }).click();
        await expect(page.locator(".grimoire-reader")).toContainText(`Scale fixture body for ${entry.fullPath}.`);
        await page.getByRole("button", { name: "Relations", exact: true }).click();
        await expect(page.getByRole("region", { name: `Selected: ${entry.relPath}`, exact: true })).toBeVisible();
      });
      expect(requests.graphInventory).toBe(beforeSearch.graphInventory);
      expect(requests.memoryInventory).toBe(beforeSearch.memoryInventory);
    }
    expect(graphRequests[0]).toEqual({ scope: [], nodes: 1500, edges: 3000 });
  } finally {
    const measurementPath = testInfo.outputPath("memories-scale-renderer-measurements.json");
    await writeFile(measurementPath, JSON.stringify({
      benchmark: "Mocked API renderer acceptance; not backend scan throughput or native acceptance",
      timing: "Wall-clock action-to-visible-result including Playwright automation; diagnostic only, no speed threshold",
      corpus: { documents: DOCUMENT_COUNT, edges: edges.length, familiarScopes: ["nova", "sage"] },
      viewport: page.viewportSize(), browser: testInfo.project.name,
      observations, requests, graphRequests, domRows, graphDiagnostics,
    }, null, 2));
    await testInfo.attach("memories-scale-renderer-measurements", {
      contentType: "application/json",
      path: measurementPath,
    });
  }
});
