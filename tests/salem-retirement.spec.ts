import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { setup } from "./chat-context-fixture";

const historyKey = "cave:ask-salem:thread:v1";

for (const entry of ["primary", "split", "event"] as const) {
  test(`retired Salem ${entry} entry preserves raw history and never dispatches`, async ({ page }, testInfo) => {
    const raw = "{legacy:保留\r\n" + "oversized malformed history\r\n".repeat(40_000);
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/salem") || path === "/api/chat/send") requests.push(path);
    });
    const mode = entry === "split" ? "light" : "dark";
    const theme = entry === "event" ? "tide" : "coven";
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ key, raw, mode, theme }) => {
      // Seed once so reloads cannot hide an accidental write by the application.
      if (!sessionStorage.getItem("salem-retirement-seeded")) {
        localStorage.setItem(key, raw);
        localStorage.setItem("coven-mode", mode);
        localStorage.setItem("coven-theme", theme);
        sessionStorage.setItem("salem-retirement-seeded", "1");
      }
    }, { key: historyKey, raw, mode, theme });
    await setup(page);
    if (entry === "split") await page.setViewportSize({ width: 390, height: 800 });
    const openSavedEntry = async () => {
      await page.goto(entry === "primary" ? "/?mode=salem" : "/?mode=chat&split=salem");
      if (entry === "split") {
        await page.getByRole("tablist", { name: "Open pages" })
          .getByRole("tab", { name: "Ask Salem retired" }).click();
      }
    };
    if (entry === "event") {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:salem-open")));
    } else {
      await openSavedEntry();
    }
    const notice = page.getByRole("region", { name: "Retired Ask Salem" });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice.getByText("Ask Salem has been retired", { exact: true })).toBeVisible();
    await expect(notice.locator("form, textarea, input, select")).toHaveCount(0);
    const button = notice.getByRole("button", { name: "Export saved Salem history" });
    await button.focus();
    await expect(button).toBeFocused();
    const downloading = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("cave-salem-history.json");
    expect(await download.failure()).toBeNull();
    const file = await download.path();
    expect(file).not.toBeNull();
    expect(await readFile(file!)).toEqual(Buffer.from(raw, "utf8"));
    expect(await page.evaluate((key) => localStorage.getItem(key), historyKey)).toBe(raw);
    await expect(notice.getByText("Saved history export requested.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`salem-${entry}-${mode}-${theme}.png`) });
    if (entry !== "event") {
      // Workspace consumes mode/split URL parameters after opening them. Reload
      // checks retained storage; revisiting the saved address checks compatibility.
      await page.reload();
      expect(await page.evaluate((key) => localStorage.getItem(key), historyKey)).toBe(raw);
      await openSavedEntry();
      await expect(notice).toBeVisible();
    }
    expect(requests).toEqual([]);
  });
}

test("compiled legacy Salem APIs refuse malformed requests without caching", async ({ request }) => {
  for (const [path, methods] of [
    ["/api/salem", ["GET", "POST"]],
    ["/api/salem/pathfinder", ["GET", "POST"]],
    ["/api/salem/pathfinder/feedback", ["POST"]],
  ] as const) {
    for (const method of methods) {
      const response = await request.fetch(path, {
        method,
        ...(method === "POST" ? { data: "{malformed", headers: { "content-type": "application/json" } } : {}),
      });
      expect(response.status()).toBe(410);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({
        ok: false, code: "salem-retired", error: "Ask Salem has been retired from Cave.",
      });
    }
  }
});
