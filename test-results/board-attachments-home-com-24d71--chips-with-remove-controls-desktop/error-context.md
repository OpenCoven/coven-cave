# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: board-attachments.spec.ts >> home composer files stage and display as chips with remove controls
- Location: tests/board-attachments.spec.ts:7:5

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
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | // Home-composer attachment staging, end to end (originally arc #2219→#2234,
  4  | // updated for consolidated toolbar where Task destination moved to board view).
  5  | // Daemon-less: only familiars/sessions/escalations routes are mocked.
  6  | 
  7  | test("home composer files stage and display as chips with remove controls", async ({ page }) => {
  8  |   await page.route("**/api/familiars**", (r) =>
  9  |     r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, familiars: [] }) }),
  10 |   );
  11 |   await page.route("**/api/sessions/list**", (r) =>
  12 |     r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, sessions: [] }) }),
  13 |   );
  14 |   await page.route("**/api/escalations**", (r) =>
  15 |     r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, count: 0 }) }),
  16 |   );
  17 |   await page.addInitScript(() => window.localStorage.setItem("cave:onboarding:dismissed", "1"));
  18 | 
> 19 |   await page.goto("/");
     |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  20 |   await page.waitForSelector(".shell-frame", { timeout: 60000 });
  21 |   // The app boots into Chat (cave-hsa6); this spec exercises the HOME composer,
  22 |   // so navigate there explicitly.
  23 |   await page.keyboard.press("Meta+1");
  24 |   await page.waitForSelector(".hc-textarea", { timeout: 60000 });
  25 | 
  26 |   // ── Stage two files ──────────────────────────────────────────────────────────
  27 |   await page.locator(".hc-file-input").setInputFiles([
  28 |     {
  29 |       name: "spec.md",
  30 |       mimeType: "text/markdown",
  31 |       buffer: Buffer.from("# Spec\n- do the thing\n"),
  32 |     },
  33 |     {
  34 |       name: "shot.png",
  35 |       mimeType: "image/png",
  36 |       buffer: Buffer.from("fake image bytes"),
  37 |     },
  38 |   ]);
  39 | 
  40 |   // Both chips appear
  41 |   await expect(page.locator(".hc-attachment-name")).toHaveText(["spec.md", "shot.png"]);
  42 | 
  43 |   // Count header reads "2/10 attached"
  44 |   await expect(page.locator(".hc-attachments-count")).toHaveText("2/10 attached");
  45 | 
  46 |   // ── Per-chip remove ──────────────────────────────────────────────────────────
  47 |   await page.getByRole("button", { name: "Remove spec.md" }).click();
  48 |   await expect(page.locator(".hc-attachment-name")).toHaveText(["shot.png"]);
  49 |   await expect(page.locator(".hc-attachments-count")).toHaveText("1/10 attached");
  50 | 
  51 |   // ── Clear all ────────────────────────────────────────────────────────────────
  52 |   await page.locator(".hc-attachments-clear").click();
  53 |   await expect(page.locator(".hc-attachments")).not.toBeVisible();
  54 | });
  55 | 
```