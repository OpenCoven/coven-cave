import { test, expect, type Page } from "@playwright/test";
test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });
const mk = (id: string, title: string, status: string) => ({ id, title, notes: "", status, priority: "medium", familiarId: null, sessionId: null, cwd: null, projectId: null, links: [], github: [], labels: [], createdAt: "2026-06-13T12:00:00Z", updatedAt: "2026-06-13T12:00:00Z", lifecycle: "queued", lifecycleAt: "2026-06-13T12:00:00Z", retryCount: 0, maxRetries: 3, steps: [] });
test("touch long-press drag moves a card between columns", async ({ page }) => {
  const patches: any[] = [];
  await page.route("**/api/familiars**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, familiars: [] }) }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [] }) }));
  await page.route("**/api/escalations**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 0 }) }));
  await page.route("**/api/board/*", async (r) => { patches.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, card: mk("c1","Drag me","inbox") }) }); });
  await page.route("**/api/board", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cards: [mk("c1", "Drag me", "backlog")] }) }));
  // Dismiss the onboarding overlay (covers the shell on a fresh CI profile).
  await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  await page.goto("/"); await page.waitForSelector(".shell-frame", { timeout: 60000 });
  await page.locator(".sidebar-nav-scroll").getByRole("button", { name: /^Board\b/ }).click();
  await page.waitForSelector(".board-kanban-card", { timeout: 60000 });

  const card = page.locator(".board-kanban-card").first();
  const inbox = page.locator('[data-kanban-column="inbox"]');
  const cb = await card.boundingBox(); const tb = await inbox.boundingBox();
  const from = { x: cb!.x + cb!.width / 2, y: cb!.y + 20 };
  const to = { x: tb!.x + tb!.width / 2, y: tb!.y + 120 };

  await page.evaluate(({ from }) => {
    const el = document.elementFromPoint(from.x, from.y)!.closest("[data-card-id]")!;
    el.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: from.x, clientY: from.y, bubbles: true, cancelable: true }));
  }, { from });
  await page.waitForTimeout(420); // let the 350ms long-press fire
  await expect(page.locator(".board-kanban-touch-ghost")).toBeVisible();
  for (const pt of [ { x: (from.x+to.x)/2, y: (from.y+to.y)/2 }, to, to ]) {
    await page.evaluate((pt) => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true })), pt);
    await page.waitForTimeout(40);
  }
  await page.screenshot({ path: "/tmp/board-touch-drag.png" });
  await page.evaluate((pt) => window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true })), to);
  await page.waitForTimeout(100);
  console.log("PATCHES:", JSON.stringify(patches));
  expect(patches.some((p) => p.status === "inbox"), "card should be moved to inbox via touch drag").toBeTruthy();
});
