# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: board-touch.spec.ts >> touch long-press drag moves a card between columns
- Location: tests/board-touch.spec.ts:4:5

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: Test timeout of 60000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:3100/", waiting until "load"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation "Chat with familiars and view tasks" [ref=e5]:
    - search [ref=e6]:
      - searchbox "Search anything or ask Salem, the docs familiar" [ref=e7]
      - generic [ref=e8]: ⌘K
    - generic [ref=e9]:
      - button "Quick chat" [ref=e10] [cursor=pointer]
      - button "Select a familiar to enhance tasks" [disabled] [ref=e11] [cursor=pointer]
      - button "View tasks" [ref=e12] [cursor=pointer]
      - button "View schedules" [ref=e13] [cursor=pointer]
  - status [ref=e16]
  - alert [ref=e17]
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test";
  2  | test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });
  3  | const mk = (id: string, title: string, status: string) => ({ id, title, notes: "", status, priority: "medium", familiarId: null, sessionId: null, cwd: null, projectId: null, links: [], github: [], labels: [], createdAt: "2026-06-13T12:00:00Z", updatedAt: "2026-06-13T12:00:00Z", lifecycle: "queued", lifecycleAt: "2026-06-13T12:00:00Z", retryCount: 0, maxRetries: 3, steps: [] });
  4  | test("touch long-press drag moves a card between columns", async ({ page }) => {
  5  |   const patches: any[] = [];
  6  |   await page.route("**/api/familiars**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, familiars: [] }) }));
  7  |   await page.route("**/api/sessions/list**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [] }) }));
  8  |   await page.route("**/api/escalations**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 0 }) }));
  9  |   await page.route("**/api/board/*", async (r) => { patches.push(JSON.parse(r.request().postData() || "{}")); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, card: mk("c1","Drag me","inbox") }) }); });
  10 |   await page.route("**/api/board", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cards: [mk("c1", "Drag me", "backlog")] }) }));
  11 |   // Dismiss the onboarding overlay (covers the shell on a fresh CI profile), and
  12 |   // keep the nav expanded (minimized-by-default would shift the board coordinates
  13 |   // this touch-drag test measures) by pre-seeding the sidebar-minimize flag.
  14 |   await page.addInitScript(() => {
  15 |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  16 |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
  17 |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  18 |   });
> 19 |   await page.goto("/"); await page.waitForSelector(".shell-frame", { timeout: 60000 });
     |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  20 |   // The app boots into Chat (cave-hsa6), where the sidebar is the thread list —
  21 |   // reach Tasks via its ⌘3 shortcut instead of a mode-list row.
  22 |   await page.keyboard.press("Meta+3");
  23 |   await page.waitForSelector(".board-kanban-card", { timeout: 60000 });
  24 | 
  25 |   const card = page.locator(".board-kanban-card").first();
  26 |   const inbox = page.locator('[data-kanban-column="inbox"]');
  27 |   const cb = await card.boundingBox(); const tb = await inbox.boundingBox();
  28 |   const from = { x: cb!.x + cb!.width / 2, y: cb!.y + 20 };
  29 |   const to = { x: tb!.x + tb!.width / 2, y: tb!.y + 120 };
  30 | 
  31 |   await page.evaluate(({ from }) => {
  32 |     const el = document.elementFromPoint(from.x, from.y)!.closest("[data-card-id]")!;
  33 |     el.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: from.x, clientY: from.y, bubbles: true, cancelable: true }));
  34 |   }, { from });
  35 |   await page.waitForTimeout(420); // let the 350ms long-press fire
  36 |   await expect(page.locator(".board-kanban-touch-ghost")).toBeVisible();
  37 |   for (const pt of [ { x: (from.x+to.x)/2, y: (from.y+to.y)/2 }, to, to ]) {
  38 |     await page.evaluate((pt) => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true })), pt);
  39 |     await page.waitForTimeout(40);
  40 |   }
  41 |   await page.screenshot({ path: "/tmp/board-touch-drag.png" });
  42 |   await page.evaluate((pt) => window.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true })), to);
  43 |   await page.waitForTimeout(100);
  44 |   console.log("PATCHES:", JSON.stringify(patches));
  45 |   expect(patches.some((p) => p.status === "inbox"), "card should be moved to inbox via touch drag").toBeTruthy();
  46 | });
  47 | 
```