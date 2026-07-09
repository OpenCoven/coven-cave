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
TimeoutError: page.waitForSelector: Timeout 60000ms exceeded.
Call log:
  - waiting for locator('.board-kanban-card') to be visible

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to main content":
      - /url: "#shell-main-content"
    - generic [ref=e3]:
      - button "Collapse navigation to icons" [expanded] [ref=e4] [cursor=pointer]:
        - img [ref=e5]
      - group "History" [ref=e7]:
        - button "Go back" [ref=e8] [cursor=pointer]:
          - img [ref=e9]
        - button "Go forward" [ref=e11] [cursor=pointer]:
          - img [ref=e12]
      - navigation "Chat with familiars and view tasks" [ref=e15]:
        - search [ref=e16]:
          - img [ref=e17]
          - searchbox "Search anything or ask Salem, the docs familiar" [ref=e19]
          - generic [ref=e20]: CtrlK
        - generic [ref=e21]:
          - button "Quick chat" [ref=e22] [cursor=pointer]:
            - img [ref=e23]
          - button "Select a familiar to enhance tasks" [disabled] [ref=e25] [cursor=pointer]:
            - img [ref=e26]
          - button "View tasks — 1 open" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
            - generic [ref=e31]: "1"
          - button "View schedules — 11 need attention" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e35]: "11"
    - generic [ref=e37]:
      - complementary "Sidebar" [ref=e40]:
        - navigation [ref=e41]:
          - 'button "Switch familiar — scope: all familiars" [ref=e44] [cursor=pointer]':
            - img [ref=e45]
            - generic [ref=e47]: All familiars
            - img [ref=e48]
          - button "New chat" [ref=e51] [cursor=pointer]:
            - img [ref=e52]
            - generic [ref=e54]: New chat
          - generic [ref=e55]:
            - button "Home" [ref=e56] [cursor=pointer]:
              - img [ref=e57]
              - generic [ref=e59]: Home
            - button "Chat" [ref=e60] [cursor=pointer]:
              - img [ref=e61]
              - generic [ref=e63]: Chat
            - button "Tasks 1" [ref=e64] [cursor=pointer]:
              - img [ref=e65]
              - generic [ref=e67]: Tasks
              - generic [ref=e68]: "1"
            - button "Schedules 11" [ref=e69] [cursor=pointer]:
              - img [ref=e70]
              - generic [ref=e72]: Schedules
              - generic [ref=e73]: "11"
            - button "Journal" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
              - generic [ref=e77]: Journal
            - button "Grimoire" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
              - generic [ref=e81]: Grimoire
            - button "Marketplace" [ref=e82] [cursor=pointer]:
              - img [ref=e83]
              - generic [ref=e85]: Marketplace
            - button "GitHub" [ref=e86] [cursor=pointer]:
              - img [ref=e87]
              - generic [ref=e89]: GitHub
          - generic [ref=e90]:
            - link "Dashboard" [ref=e91] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e93]
            - button "Settings" [ref=e95] [cursor=pointer]:
              - img [ref=e97]
          - generic "CovenCave v0.0.171" [ref=e99]: v0.0.171
      - separator
      - main [ref=e102]:
        - status [ref=e104]:
          - generic [ref=e105]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e106] [cursor=pointer]
          - button "Dismiss" [ref=e107] [cursor=pointer]:
            - img [ref=e108]
        - heading "Tasks" [level=1] [ref=e111]
  - status [ref=e120]
  - alert [ref=e121]
  - alert [ref=e122]
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
  19 |   await page.goto("/"); await page.waitForSelector(".shell-frame", { timeout: 60000 });
  20 |   // The app boots into Chat (cave-hsa6), where the sidebar is the thread list —
  21 |   // reach Tasks via its ⌘3 shortcut instead of a mode-list row.
  22 |   await page.keyboard.press("Meta+3");
> 23 |   await page.waitForSelector(".board-kanban-card", { timeout: 60000 });
     |              ^ TimeoutError: page.waitForSelector: Timeout 60000ms exceeded.
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