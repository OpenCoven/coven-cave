import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

type ReadProbe = { path: string; signal: AbortSignal | null | undefined; completed: boolean };
type ProbedWindow = Window & { generalReads: ReadProbe[] };

async function setup(page: import("@playwright/test").Page) {
  // next dev replays mount effects in Strict Mode. Observe cancellation so the
  // initial-read assertion stays exact in both development and production.
  await page.addInitScript(() => {
    const target = window as ProbedWindow;
    target.generalReads = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url, window.location.href).pathname;
      if (["/api/config/workspace-path", "/api/backup/sync"].includes(path)) {
        const read = { path, signal: init?.signal ?? (input instanceof Request ? input.signal : null), completed: false };
        target.generalReads.push(read);
        return originalFetch(input, init).then(response => {
          // Later refreshes abort even settled controllers. Keep completed reads
          // counted so that a redundant successful refresh cannot hide itself.
          read.completed = !read.signal?.aborted;
          return response;
        });
      }
      return originalFetch(input, init);
    };
  });
  const counts = { workspace: 0, sync: 0, config: 0 };
  let overview = {
    ok: true,
    config: { enabled: true, directory: "/saved", retainCount: 7, intervalHours: 24, onQuitPush: true },
    status: { lastAttemptAt: null, lastSuccessAt: null, lastSuccessFile: null, lastError: null, lastReason: null, retainedCount: null },
    defaultDirectory: "/default", effectiveDirectory: "/saved", passphraseSet: true, due: false,
  };
  let failRead = false;
  let readGate: Promise<void> | null = null;
  await page.route("**/api/config", route => { counts.config++; return route.fulfill({ json: { ok: true, config: {} } }); });
  await page.route("**/api/config/workspace-path", route => {
    counts.workspace++;
    return route.fulfill({ json: { ok: true, workspacePath: "/test/workspaces", envPin: null } });
  });
  await page.route("**/api/backup/sync", async route => {
    if (route.request().method() === "PUT") {
      overview = { ...overview, config: { ...overview.config, ...route.request().postDataJSON() } };
      await route.fulfill({ json: overview });
      return;
    }
    counts.sync++;
    const body = JSON.stringify(overview);
    if (readGate) await readGate;
    await route.fulfill({ status: failRead ? 503 : 200, contentType: "application/json", body: failRead ? '{"ok":false}' : body }).catch(() => {});
  });
  await page.goto("/settings#general");
  await expect(page.getByRole("switch", { name: "Scheduled sync", exact: true })).toBeChecked();
  await expect(page.locator(".settings-overview")).toContainText("/test/workspaces");
  return { counts, fail: () => { failRead = true; }, gate: (promise: Promise<void>) => { readGate = promise; } };
}

test("General shares initial reads and immediately reflects a saved sync setting", async ({ page }) => {
  const { counts } = await setup(page);
  const liveReads = await page.evaluate(() => (window as ProbedWindow).generalReads
    .filter(read => read.completed || !read.signal?.aborted).map(read => read.path).sort());
  expect(liveReads).toEqual(["/api/backup/sync", "/api/config/workspace-path"]);
  expect(counts.config).toBe(0);
  const initialReads = { ...counts };
  await page.getByRole("switch", { name: "Scheduled sync", exact: true }).click();
  await expect(page.locator(".settings-overview")).toContainText("sync off");
  expect(counts).toEqual(initialReads);
});

test("a failed background refresh keeps the unsaved destination visible", async ({ page }) => {
  const controls = await setup(page);
  const destination = page.getByRole("textbox", { name: "Backup destination folder" });
  await destination.fill("/unsaved-draft");
  controls.fail();
  await page.evaluate(() => window.dispatchEvent(new Event("cave:backup-sync-refresh")));
  await expect(page.getByText("Scheduled sync details couldn't refresh", { exact: true })).toBeVisible();
  await expect(destination).toHaveValue("/unsaved-draft");
});

test("an older backup read cannot undo a successful toggle", async ({ page }) => {
  const controls = await setup(page);
  const initialSyncReads = controls.counts.sync;
  let release = () => {};
  controls.gate(new Promise<void>(resolve => { release = resolve; }));
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("cave:backup-sync-refresh")));
    await expect.poll(() => controls.counts.sync).toBe(initialSyncReads + 1);
    await page.getByRole("switch", { name: "Scheduled sync", exact: true }).click();
    await expect(page.locator(".settings-overview")).toContainText("sync off");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("switch", { name: "Scheduled sync", exact: true })).not.toBeChecked();
    await expect(page.locator(".settings-overview")).toContainText("sync off");
  } finally { release(); }
});

test.describe("touch input polling", () => {
  test.use({ hasTouch: true });

test("General polling pauses during input and resumes with one read per resource", async ({ page }) => {
  await page.clock.install();
  const { counts } = await setup(page);
  const initialReads = { ...counts };
  await page.getByRole("searchbox", { name: "Search settings" }).focus();
  await page.clock.fastForward(31_000);
  expect(counts).toEqual(initialReads);
  await page.getByRole("switch", { name: "Scheduled sync", exact: true }).focus();
  await page.clock.fastForward(31_000);
  await expect.poll(() => counts).toEqual({ ...initialReads, sync: initialReads.sync + 1, workspace: initialReads.workspace + 1 });
});

});
