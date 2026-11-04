import { expect, test } from "@playwright/test";

test("native recovery stays actionable through cooldown and clears only on readiness", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    const w = window as unknown as Record<string, unknown>;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let next = 0;
    let status = { phase: "ready", progress: 100, message: "CovenCave is ready", canRetry: false, canCancel: false };
    let retries = 0;
    function emit(phase: string) {
      status = phase === "ready" ? { phase, progress: 100, message: "CovenCave is ready", canRetry: false, canCancel: false }
        : phase === "failed" ? { phase, progress: 0, message: "The local service could not restart. Diagnostic text " + "wrapped detail ".repeat(30), canRetry: true, canCancel: false }
        : { phase, progress: 70, message: "Starting local services", canRetry: false, canCancel: true };
      for (const [id, entry] of listeners) if (entry.event === "sidecar-startup-progress") callbacks.get(entry.handler)?.({ event: entry.event, id, payload: status });
    }
    w.__sidecarFixture = { emit, retries: () => retries, listening: () => [...listeners.values()].some(e => e.event === "sidecar-startup-progress") };
    w.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: "windows", arch: "x86_64", family: "windows", version: "11" };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => listeners.delete(id) };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
      transformCallback: (callback: (event: unknown) => void) => { const id = ++next; callbacks.set(id, callback); return id; },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: (path: string) => path,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === "plugin:event|listen") { const id = ++next; listeners.set(id, { event: String(args.event), handler: Number(args.handler) }); return id; }
        if (command === "plugin:event|unlisten") { listeners.delete(Number(args.eventId)); return; }
        if (command === "sidecar_startup_status") return status;
        if (command === "retry_sidecar_startup") { retries++; emit("starting"); return; }
        if (command === "plugin:updater|check") return null;
        throw new Error("Unavailable in controlled sidecar fixture: " + command);
      },
    };
  });
  await page.goto("/settings#about");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sidecarFixture: { listening(): boolean } }).__sidecarFixture.listening())).toBe(true);
  const banner = page.locator(".shell-banner").filter({ hasText: "Local services stopped" });
  await expect(banner).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __sidecarFixture: { emit(phase: string): void } }).__sidecarFixture.emit("failed"));
  await expect(banner).toBeVisible();
  // Cooldown produces no further event; retain the authoritative failure/Retry.
  for (const [width, theme, mode] of [[960, "coven", "dark"], [1100, "coven", "light"], [1100, "tide", "dark"]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(({ theme, mode }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, { theme, mode });
    const closeNavigation = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    const backdrop = page.locator('.mobile-drawer-backdrop[data-drawer-slot="nav"]');
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: 5, y: 5 } });
    const retry = banner.getByRole("button", { name: "Retry", exact: true });
    await retry.focus(); await expect(retry).toBeFocused();
    expect(await banner.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const titleBox = await banner.locator(".shell-banner__title").boundingBox();
    expect(titleBox?.x).toBeGreaterThanOrEqual(0);
    await expect.poll(() => banner.locator(".shell-banner__title").evaluate(el => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === el || (hit !== null && el.contains(hit));
    })).toBe(true);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`sidecar-${width}-${theme}-${mode}.png`) });
  }
  await banner.getByRole("button", { name: "Retry", exact: true }).press("Enter");
  await expect(page.locator(".shell-banner").filter({ hasText: "Starting local services" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sidecarFixture: { retries(): number } }).__sidecarFixture.retries())).toBe(1);
  await page.evaluate(() => (window as unknown as { __sidecarFixture: { emit(phase: string): void } }).__sidecarFixture.emit("ready"));
  await expect(page.locator(".shell-banner").filter({ hasText: /Local services stopped|Starting local services/ })).toHaveCount(0);
});
