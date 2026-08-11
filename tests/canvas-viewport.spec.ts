import { expect, test, type Page } from "@playwright/test";

// Canvas editor viewport presets (cave-ztbo): the design interface renders a
// saved sketch at preset device sizes — Fill (responsive), Desktop 1280×800,
// Tablet 768×1024, Phone 390×844. A sized preset puts TRUE device CSS pixels
// on the sketch iframe (so the sketch's own media queries fire) and scales
// the frame down to fit the stage, devtools-device-toolbar style.
// Daemon-less — onboarding dismissed, /api/canvas mocked via page.route.

const ISO = "2026-06-12T10:00:00.000Z";

const SKETCH = {
  id: "sk-1",
  title: "Pricing page",
  prompt: "a pricing page",
  code: "<!doctype html><html><body><h1>Pricing</h1></body></html>",
  kind: "html",
  annotations: [],
  createdAt: ISO,
  updatedAt: ISO,
};

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/canvas**", (route) =>
    route.fulfill({ json: { ok: true, positions: {}, artifacts: [SKETCH] } }),
  );
  await page.goto("/?mode=chat");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.getByRole("button", { name: "Open sketch: Pricing page" }).click();
  await page.getByRole("button", { name: "Open in editor" }).click();
  await page.waitForSelector(".canvas-editor", { timeout: 15_000 });
}

test.describe("canvas editor viewport presets", () => {
  test("preset group renders; phone preset sizes the sketch iframe at true device pixels and captions the size", async ({ page }) => {
    await openEditor(page);

    // The preset group is in the header, Fill active by default — no fixed
    // frame size, no caption.
    const group = page.getByRole("group", { name: "Viewport size" });
    await expect(group.getByRole("button", { name: "Fill the stage" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".canvas-editor__viewport-size")).toHaveCount(0);
    const frame = page.locator(".canvas-editor__frame");
    await expect(frame).not.toHaveAttribute("style", /scale/);

    // Phone: the iframe gets the preset's device CSS pixels (390×844) and a
    // scale transform; the frame box carries the scaled footprint.
    await group.getByRole("button", { name: "Phone viewport — 390×844" }).click();
    await expect(group.getByRole("button", { name: "Phone viewport — 390×844" })).toHaveAttribute("aria-pressed", "true");
    await expect(frame).toHaveCSS("width", "390px");
    await expect(frame).toHaveAttribute("style", /transform: scale\(/);
    await expect(page.locator(".canvas-editor__viewport-size")).toContainText("390×844");
    // The device box is centered inside the (now chrome-less) shell.
    await expect(page.locator(".canvas-editor__frame-shell--viewport")).toHaveCount(1);

    // Desktop: 1280 wide — wider than the stage, so it must scale below 1
    // and the caption carries a zoom percentage.
    await group.getByRole("button", { name: "Desktop viewport — 1280×800" }).click();
    await expect(frame).toHaveCSS("width", "1280px");
    await expect(page.locator(".canvas-editor__viewport-size")).toContainText("%");

    // Back to Fill: fixed sizing and the caption go away; the sketch iframe
    // was never remounted (same element handle still attached).
    await group.getByRole("button", { name: "Fill the stage" }).click();
    await expect(frame).not.toHaveAttribute("style", /scale/);
    await expect(page.locator(".canvas-editor__viewport-size")).toHaveCount(0);
    await expect(page.locator(".canvas-editor__frame-shell--viewport")).toHaveCount(0);
  });
});
