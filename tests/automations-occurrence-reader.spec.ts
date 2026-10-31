import { expect, test, type Page } from "@playwright/test";

// Full production-app browser coverage for #5217 / #6322. These synthetic
// daemon projections establish client behavior, not execution authority.
const routine = {
  id: "occurrence-reader-qa", name: "Occurrence reader QA", kind: "cron", status: "PAUSED",
  rrule: "RRULE:FREQ=DAILY;BYHOUR=9", scheduleHuman: "Daily at 09:00", prompt: "Read-only fixture.",
  model: null, reasoningEffort: null, executionEnvironment: null, skillPath: null,
  cwds: [], tags: [], familiars: [],
};
const record = { id: routine.id, kind: "present", state: "paused", revision: 1, timezone: "UTC" };

function occurrence(page: number, index: number) {
  const iso = `2026-10-${20 - page}T09:${String(index).padStart(2, "0")}:00.000Z`;
  return {
    id: `occ-reader-${page}-${index}`, automationRevision: 1, scheduledFor: iso, kind: "scheduled",
    state: ["succeeded", "skipped", "cancelled"][page], fenceGeneration: 1, leaseExpiresAt: null,
    reasonRecorded: false, createdAt: iso, updatedAt: iso,
  };
}

async function openReader(page: Page, options: { holdOlder?: boolean; lastPage?: boolean; holdRefresh?: boolean } = {}) {
  let releaseRead = () => {};
  let newestReads = 0;
  const olderReady = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.context().addCookies([{ name: "cave_onboarding_dismissed", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "");
    localStorage.setItem("cave:shell:right-chat-open", "0");
  });
  await page.route(/\/api\/inbox(\?.*)?$/, (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/codex-automations**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { ok: false } });
    return route.fulfill({ json: path.endsWith("/runs") ? { ok: true, runs: [] } : { ok: true, automations: [routine] } });
  });
  await page.route("**/api/codex-automation-last-runs**", (route) => route.fulfill({ json: { ok: true, runs: {} } }));
  await page.route("**/api/coven-automation-lifecycle**", (route) => route.fulfill({ json: { kind: "available", readAt: new Date().toISOString(), records: [record] } }));
  await page.route("**/api/coven-automation-occurrences**", (route) => route.fulfill({ json: { kind: "available", readAt: new Date().toISOString(), byAutomation: {}, truncated: [] } }));
  await page.route("**/api/coven-automations/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fulfill({ status: 405, json: { kind: "unavailable" } });
    if (url.pathname.endsWith("/lifecycle")) return route.fulfill({ json: {
      kind: "available", readAt: new Date().toISOString(), record,
      health: { nextDueAt: null, lastPlannedAt: null, lastStartedAt: null, lastSuccessAt: null, consecutiveFailures: 0, quarantined: false },
    } });
    if (url.pathname.endsWith("/occurrences")) {
      const cursor = url.searchParams.get("cursor");
      if (!cursor) newestReads += 1;
      if ((cursor && options.holdOlder) || (!cursor && newestReads > 1 && options.holdRefresh)) await olderReady;
      const number = cursor === "page-3" ? 2 : cursor === "page-2" ? 1 : 0;
      return route.fulfill({ json: {
        kind: "available", readAt: new Date().toISOString(),
        occurrences: Array.from({ length: 10 }, (_, index) => occurrence(number, index)),
        nextCursor: number === 2 || (number === 1 && options.lastPage) ? null : `page-${number + 2}`,
      } });
    }
    return route.fulfill({ json: { kind: "unsupported" } });
  });
  await page.goto("/?mode=inbox", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Scheduled jobs", exact: true }).click();
  await page.getByRole("button", { name: `Open ${routine.name} details`, exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: routine.name, exact: true });
  const section = dialog.locator("section").filter({ has: page.getByRole("heading", { name: "Occurrences and runs", exact: true }) });
  const rows = section.locator(":scope > div > ul > li");
  await expect(rows).toHaveCount(10);
  await expect(section.getByRole("button", { name: "Re-read now", exact: true })).toBeEnabled();
  return { dialog, section, rows, releaseRead };
}

test.describe("Occurrence reader", () => {
  test.setTimeout(120_000);

  test("keyboard pagination keeps one older page and preserves focus through the last page", async ({ page, browserName }) => {
    const { section, rows } = await openReader(page);
    const reread = section.getByRole("button", { name: "Re-read now", exact: true });
    const older = section.getByRole("button", { name: "Show older", exact: true });
    await reread.focus();
    // WebKit on macOS uses Option+Tab for native button navigation.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(older).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(20);
    await expect(section.getByRole("button", { name: /^Scheduled: Skipped/ })).toHaveCount(10);
    await expect(older).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(section.getByRole("button", { name: /^Scheduled: Cancelled/ })).toHaveCount(10);
    await expect(rows).toHaveCount(20);
    await expect(section.getByRole("button", { name: /^Scheduled: Skipped/ })).toHaveCount(0);
    await expect(older).toHaveCount(0);
    await expect(reread).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(10);
    await expect(reread).toBeFocused();
  });

  test("an older response preserves focus deliberately moved to a field", async ({ page }) => {
    const { dialog, section, rows, releaseRead } = await openReader(page, { holdOlder: true, lastPage: true });
    const older = section.getByRole("button", { name: "Show older", exact: true });
    try {
      await older.focus();
      await page.keyboard.press("Enter");
      await expect(section.getByRole("status")).toHaveText("Reading older occurrences…");
      const name = dialog.getByLabel("Name", { exact: true });
      await name.focus();
      releaseRead();
      await expect(rows).toHaveCount(20);
      await expect(older).toHaveCount(0);
      await expect(name).toBeFocused();
    } finally { releaseRead(); }
  });

  test("automatic refresh restores a focused read control", async ({ page }) => {
    const { section, releaseRead } = await openReader(page, { holdRefresh: true });
    const older = section.getByRole("button", { name: "Show older", exact: true });
    const reread = section.getByRole("button", { name: "Re-read now", exact: true });
    try {
      await older.focus();
      await expect(older).toBeFocused();
      // Wait for the real 30-second visible-panel poll; the response stays pending.
      await expect(reread).toBeDisabled({ timeout: 45_000 });
      releaseRead();
      await expect(reread).toBeEnabled();
      await expect(older).toBeFocused();
    } finally { releaseRead(); }
  });

  test("bounded rows and controls fit dark, light and non-default narrow panes", async ({ page, browserName }, testInfo) => {
    const { section, rows } = await openReader(page);
    await section.getByRole("button", { name: "Show older", exact: true }).click();
    await expect(rows).toHaveCount(20);
    for (const [theme, mode, width] of [["coven", "dark", 1280], ["coven", "light", 390], ["tide", "dark", 768]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = mode;
      }, { theme, mode });
      const reread = section.getByRole("button", { name: "Re-read now", exact: true });
      await reread.focus();
      // WebKit on macOS uses Option+Tab for native button navigation.
      await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
      const older = section.getByRole("button", { name: "Show older", exact: true });
      await expect(older).toBeFocused();
      const focus = await older.evaluate((element) => {
        const style = getComputedStyle(element);
        return { visible: element.matches(":focus-visible"), ring: parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none" };
      });
      expect(focus).toEqual({ visible: true, ring: true });
      const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(rows).toHaveCount(20);
      const image = testInfo.outputPath(`occurrence-reader-${browserName}-${theme}-${mode}-${width}.png`);
      await page.screenshot({ path: image, animations: "disabled" });
      await testInfo.attach(`reader-${theme}-${mode}-${width}`, { path: image, contentType: "image/png" });
    }
  });
});
