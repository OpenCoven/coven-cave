import { expect, test, type Page } from "@playwright/test";

// The retained path for a thread saved before Ask Salem's standalone surface
// was retired (#6399). Synthetic data, daemon-less.

const KEY = "cave:ask-salem:thread:v1";
const SAVED = [
  { role: "user", text: "What is a familiar?", at: 1_700_000_000_000 },
  { role: "salem", text: "A synthetic saved answer.", at: 1_700_000_001_000 },
];

async function open(page: Page, thread?: unknown) {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    if (value && !window.sessionStorage.getItem("seeded")) {
      window.sessionStorage.setItem("seeded", "1");
      window.localStorage.setItem(key as string, value as string);
    }
  }, [KEY, thread ? JSON.stringify(thread) : ""]);
  await page.goto("/?mode=salem");
}

test("a saved link opens the pre-existing thread, sends nothing, and exports it", async ({ page }) => {
  const salemRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/salem")) salemRequests.push(request.url());
  });
  await open(page, SAVED);
  await expect(page.getByRole("heading", { name: "Salem history", level: 2 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("What is a familiar?")).toBeVisible();
  await expect(page.getByText("A synthetic saved answer.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe("ask-salem-history.md");
  expect(salemRequests).toEqual([]);
});

test("deleting takes two steps and leaves a useful empty state", async ({ page }) => {
  await open(page, SAVED);
  await page.getByRole("button", { name: "Delete…" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), KEY)).not.toBeNull();
  await page.getByRole("button", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete history" }).click();
  await expect(page.getByText("No saved Salem answers")).toBeVisible();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), KEY)).toBeNull();
});

test("no history still offers contextual help, and the panel returns to history", async ({ page }) => {
  await page.route("**/api/salem", (route) => route.fulfill({ json: { reply: "ok" } }));
  await open(page);
  await page.getByRole("button", { name: "Ask Salem" }).click({ timeout: 30_000 });
  const panel = page.getByRole("region", { name: "Salem docs familiar" });
  await panel.getByRole("textbox", { name: "Search Salem docs" }).fill("How do grants work?");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("ok", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Open Salem history" }).click();
  await expect(page.getByText("No saved Salem answers")).toBeVisible();
});

test("contextual help opens on a phone-width window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await open(page);
  await page.getByRole("button", { name: "Ask Salem" }).click({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Salem docs familiar" })).toBeVisible();
});

test("the workspace split-pane event opens the asking panel beside the page", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No saved Salem answers")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:salem-open")));
  await expect(page.getByRole("region", { name: "Salem docs familiar" })).toBeVisible();
  await expect(page.getByText("No saved Salem answers")).toBeVisible();
});
