import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function setup(page: import("@playwright/test").Page) {
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
  expect(counts).toEqual({ workspace: 1, sync: 1, config: 0 });
  await page.getByRole("switch", { name: "Scheduled sync", exact: true }).click();
  await expect(page.locator(".settings-overview")).toContainText("sync off");
  expect(counts.sync).toBe(1);
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
  let release = () => {};
  controls.gate(new Promise<void>(resolve => { release = resolve; }));
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("cave:backup-sync-refresh")));
    await expect.poll(() => controls.counts.sync).toBe(2);
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
  await page.getByRole("searchbox", { name: "Search settings" }).focus();
  await page.clock.fastForward(31_000);
  expect(counts).toEqual({ workspace: 1, sync: 1, config: 0 });
  await page.getByRole("switch", { name: "Scheduled sync", exact: true }).focus();
  await page.clock.fastForward(31_000);
  await expect.poll(() => counts.sync).toBe(2);
  expect(counts.workspace).toBe(2);
});

});
