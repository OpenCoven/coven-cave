# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile/foundations.spec.ts >> mobile foundations >> chat and tasks surfaces fit 360px without horizontal scroll
- Location: tests/mobile/foundations.spec.ts:49:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 60000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to main content":
      - /url: "#shell-main-content"
    - banner [ref=e5]:
      - button "Open navigation (⌘B)" [ref=e7] [cursor=pointer]:
        - img [ref=e8]
      - search [ref=e10]:
        - img [ref=e11]
        - searchbox "Search anything or ask Salem, the docs familiar" [ref=e13]
      - generic [ref=e14]:
        - button "Quick chat" [ref=e15] [cursor=pointer]:
          - img [ref=e16]
        - generic [ref=e18]:
          - button "More actions" [ref=e19] [cursor=pointer]:
            - img [ref=e20]
          - generic: 99+
        - button "Notifications, 0 unread" [ref=e23]:
          - img [ref=e24]
        - button "Account / settings" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
    - generic [ref=e30]:
      - complementary "Sidebar" [ref=e32]:
        - navigation [ref=e33]:
          - 'button "Switch familiar — scope: all familiars" [ref=e36] [cursor=pointer]':
            - img [ref=e37]
            - generic [ref=e39]: All familiars
            - img [ref=e40]
          - button "New chat" [ref=e43] [cursor=pointer]:
            - img [ref=e44]
            - generic [ref=e46]: New chat
          - generic [ref=e47]:
            - button "Home" [ref=e48] [cursor=pointer]:
              - img [ref=e49]
              - generic [ref=e51]: Home
            - button "Chat" [ref=e52] [cursor=pointer]:
              - img [ref=e53]
              - generic [ref=e55]: Chat
            - button "Tasks 99+" [ref=e56] [cursor=pointer]:
              - img [ref=e57]
              - generic [ref=e59]: Tasks
              - generic [ref=e60]: 99+
            - button "Schedules 11" [ref=e61] [cursor=pointer]:
              - img [ref=e62]
              - generic [ref=e64]: Schedules
              - generic [ref=e65]: "11"
            - button "Journal" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
              - generic [ref=e69]: Journal
            - button "Grimoire" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
              - generic [ref=e73]: Grimoire
            - button "Marketplace" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
              - generic [ref=e77]: Marketplace
            - button "GitHub" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
              - generic [ref=e81]: GitHub
            - generic [ref=e82]:
              - button "Recent" [expanded] [ref=e83] [cursor=pointer]:
                - generic [ref=e84]: Recent
                - img [ref=e85]
              - list
          - generic [ref=e87]:
            - link "Dashboard" [ref=e88] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e90]
            - button "Settings" [ref=e92] [cursor=pointer]:
              - img [ref=e94]
          - generic "CovenCave v0.0.171" [ref=e96]: v0.0.171
      - separator
      - main [ref=e99]:
        - status [ref=e101]:
          - generic [ref=e102]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e103] [cursor=pointer]
          - button "Dismiss" [ref=e104] [cursor=pointer]:
            - img [ref=e105]
        - heading "Tasks" [level=1] [ref=e108]
    - tablist "Primary" [ref=e117]:
      - tab "Home" [ref=e118] [cursor=pointer]:
        - img [ref=e120]
        - generic [ref=e122]: Home
      - tab "Chat" [ref=e123] [cursor=pointer]:
        - img [ref=e125]
        - generic [ref=e127]: Chat
      - tab "Board" [selected] [ref=e128] [cursor=pointer]:
        - img [ref=e130]
        - generic [ref=e132]: Board
      - tab "Schedules" [ref=e134] [cursor=pointer]:
        - img [ref=e136]
        - generic [ref=e138]: Sched
  - status [ref=e139]
  - alert [ref=e140]
  - alert [ref=e141]
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
  28  |     await page.goto("/");
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
> 62  |       await page.waitForFunction(
      |                  ^ Error: page.waitForFunction: Test timeout of 60000ms exceeded.
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
  129 |     // cross-surface chrome check without depending on which rows are visible.
  130 |     const surfaces = ["home", "chat", "board", "calendar", "browser", "terminal"];
  131 | 
  132 |     for (const surface of surfaces) {
  133 |       await page.evaluate(
  134 |         (mode) => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } })),
  135 |         surface,
  136 |       );
  137 |       await page.waitForTimeout(200);
  138 | 
  139 |       await expect(page.locator(".top-bar"), `desktop top bar should stay hidden on ${surface}`).toBeHidden();
  140 | 
  141 |       const metrics = await page.evaluate(() => {
  142 |         const frame = document.querySelector(".shell-frame");
  143 |         const frameRect = frame?.getBoundingClientRect();
  144 |         return {
  145 |           documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  146 |           bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
  147 |           frameBottom: frameRect?.bottom ?? 0,
  148 |           viewportHeight: window.innerHeight,
  149 |         };
  150 |       });
  151 | 
  152 |       expect(metrics.documentOverflow, `${surface} should not create document vertical scroll`).toBeLessThanOrEqual(1);
  153 |       expect(metrics.bodyOverflow, `${surface} should not create body vertical scroll`).toBeLessThanOrEqual(1);
  154 |       expect(metrics.frameBottom, `${surface} app frame should fit the viewport`).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  155 |     }
  156 | 
  157 |     // No surface may crash the app. (These would be invisible to the layout
  158 |     // assertions above — see the note at the top of this test.)
  159 |     expect(pageErrors, `uncaught page errors while sweeping surfaces:\n${pageErrors.join("\n")}`).toEqual([]);
  160 |     expect(fatalConsole, `fatal React render errors while sweeping surfaces:\n${fatalConsole.join("\n")}`).toEqual([]);
  161 |   });
  162 | 
```