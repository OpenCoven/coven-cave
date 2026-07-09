# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile/foundations.spec.ts >> mobile foundations >> viewport meta sets viewport-fit=cover
- Location: tests/mobile/foundations.spec.ts:27:7

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
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | // Starter mobile spec. Loads the home route on the pixel-5 and
  4   | // iphone-13 viewport projects and asserts the phase 1 foundations:
  5   | //
  6   | //   - viewport meta is set to viewport-fit=cover so env() returns
  7   | //     non-zero on iOS
  8   | //   - the layout doesn't trigger horizontal scrolling at 360px
  9   | //   - desktop app chrome is headerless and does not create window scroll
  10  | //     on the primary shell surfaces
  11  | //   - the top-bar mobile-toggle is visible (since mobile viewports
  12  | //     still need drawer controls)
  13  | //
  14  | // Surface-specific specs (chat composer, board card-stack, calendar
  15  | // agenda, hover-tap) belong in their own files; this one is the
  16  | // "did the foundation land at all" canary.
  17  | 
  18  | test.describe("mobile foundations", () => {
  19  |   test.beforeEach(async ({ page }) => {
  20  |     // On a fresh profile (CI) the onboarding overlay covers the app and
  21  |     // intercepts clicks on the sidebar/shell — dismiss it before each test.
  22  |     await page.addInitScript(() => {
  23  |       window.localStorage.setItem("cave:onboarding:dismissed", "1");
  24  |     });
  25  |   });
  26  | 
  27  |   test("viewport meta sets viewport-fit=cover", async ({ page }) => {
> 28  |     await page.goto("/");
      |                ^ Error: page.goto: Test timeout of 60000ms exceeded.
  29  |     const viewport = await page
  30  |       .locator('meta[name="viewport"]')
  31  |       .getAttribute("content");
  32  |     expect(viewport, "viewport meta must include viewport-fit=cover").toMatch(
  33  |       /viewport-fit=cover/,
  34  |     );
  35  |   });
  36  | 
  37  |   test("home route fits 360px without horizontal scroll", async ({ page }) => {
  38  |     await page.setViewportSize({ width: 360, height: 720 });
  39  |     await page.goto("/");
  40  |     const overflow = await page.evaluate(() => {
  41  |       return (
  42  |         document.documentElement.scrollWidth -
  43  |         document.documentElement.clientWidth
  44  |       );
  45  |     });
  46  |     expect(overflow, "no horizontal overflow at 360px viewport").toBeLessThanOrEqual(0);
  47  |   });
  48  | 
  49  |   test("chat and tasks surfaces fit 360px without horizontal scroll", async ({ page }) => {
  50  |     await page.setViewportSize({ width: 360, height: 720 });
  51  |     await page.goto("/");
  52  |     await page.waitForSelector(".shell-frame");
  53  | 
  54  |     // Re-dispatch navigate-mode inside the poll: on a cold mobile load the
  55  |     // Workspace listener can attach AFTER .shell-frame appears, so a single
  56  |     // early dispatch is silently dropped and the check would measure Home.
  57  |     const targets: Array<[string, string]> = [
  58  |       ["chat", ".chat-surface"],
  59  |       ["board", ".board-shell"],
  60  |     ];
  61  |     for (const [surface, selector] of targets) {
  62  |       await page.waitForFunction(
  63  |         ({ mode, sel }) => {
  64  |           window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
  65  |           return document.querySelector(sel) !== null;
  66  |         },
  67  |         { mode: surface, sel: selector },
  68  |         // Generous: the dev webServer compiles the chat/board chunks on first
  69  |         // hit, which can take >15s under CI's parallel project load.
  70  |         { timeout: 25000 },
  71  |       );
  72  |       await page.waitForTimeout(200);
  73  |       const overflow = await page.evaluate(() => {
  74  |         return (
  75  |           document.documentElement.scrollWidth -
  76  |           document.documentElement.clientWidth
  77  |         );
  78  |       });
  79  |       expect(overflow, `no horizontal overflow on ${surface} at 360px viewport`).toBeLessThanOrEqual(0);
  80  |     }
  81  |   });
  82  | 
  83  |   test("home route does not create window-level vertical scroll", async ({ page }) => {
  84  |     await page.setViewportSize({ width: 1280, height: 720 });
  85  |     await page.goto("/");
  86  |     await page.waitForSelector(".shell-frame");
  87  | 
  88  |     const metrics = await page.evaluate(() => {
  89  |       const frame = document.querySelector(".shell-frame");
  90  |       const frameRect = frame?.getBoundingClientRect();
  91  |       return {
  92  |         documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  93  |         bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
  94  |         frameBottom: frameRect?.bottom ?? 0,
  95  |         viewportHeight: window.innerHeight,
  96  |       };
  97  |     });
  98  | 
  99  |     expect(metrics.documentOverflow, "document should not be vertically scrollable").toBeLessThanOrEqual(1);
  100 |     expect(metrics.bodyOverflow, "body should not be vertically scrollable").toBeLessThanOrEqual(1);
  101 |     expect(metrics.frameBottom, "app frame should fit the viewport").toBeLessThanOrEqual(metrics.viewportHeight + 1);
  102 |   });
  103 | 
  104 |   test("desktop shell is headerless and non-scrollable across primary surfaces", async ({ page }) => {
  105 |     // Guard against render crashes on any surface. The chrome/layout assertions
  106 |     // below all PASS when a surface infinite-loops or throws, because React
  107 |     // tears the app down to its error boundary — and a centered "couldn't load"
  108 |     // view has a hidden top bar, no overflow, and fits the viewport. So without
  109 |     // this, a surface can be fully broken and the test stays green (exactly how
  110 |     // the #2162 CodeSidebar `useSyncExternalStore` infinite loop reached main).
  111 |     // Catch both uncaught exceptions and the fatal React render-error class
  112 |     // (which an error boundary swallows into a console.error rather than a
  113 |     // pageerror). Benign console noise (failed daemon-less fetches) is ignored.
  114 |     const pageErrors: string[] = [];
  115 |     const fatalConsole: string[] = [];
  116 |     const FATAL_RENDER = /maximum update depth|too many re-?renders|minified react error|getsnapshot should be cached|rendered (more|fewer) hooks|hooks can only be called/i;
  117 |     page.on("pageerror", (err) => pageErrors.push(err.message));
  118 |     page.on("console", (msg) => {
  119 |       if (msg.type() === "error" && FATAL_RENDER.test(msg.text())) fatalConsole.push(msg.text());
  120 |     });
  121 | 
  122 |     await page.setViewportSize({ width: 1280, height: 720 });
  123 |     await page.goto("/");
  124 |     await page.waitForSelector(".shell-frame");
  125 | 
  126 |     // Drive by mode id via the navigate-mode event rather than clicking nav
  127 |     // rows: most of these surfaces are now opt-in add-ons (hidden from the nav by
  128 |     // default), but they still render when navigated — so this stays a true
```