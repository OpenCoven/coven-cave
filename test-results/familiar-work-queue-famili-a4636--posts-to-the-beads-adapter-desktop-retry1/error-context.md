# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: familiar-work-queue.spec.ts >> familiar work queue (PR control tower) >> claiming a no-open-PR bead posts to the beads adapter
- Location: tests/familiar-work-queue.spec.ts:118:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.fwq')
Expected: visible
Timeout: 2000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 2000ms
  - waiting for locator('.fwq')


Call Log:
- Test timeout of 60000ms exceeded
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to main content":
      - /url: "#shell-main-content"
    - generic [ref=e3]:
      - button "Expand navigation" [ref=e4] [cursor=pointer]:
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
          - 'button "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats" [ref=e25] [cursor=pointer]':
            - img [ref=e26]
          - button "View tasks — 2 open" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
            - generic [ref=e31]: "2"
          - button "View schedules — 11 need attention" [ref=e32] [cursor=pointer]:
            - img [ref=e33]
            - generic [ref=e35]: "11"
    - generic [ref=e37]:
      - complementary "Sidebar" [ref=e40]:
        - navigation [ref=e41]:
          - 'button "Switch familiar — current: Kitty" [ref=e44] [cursor=pointer]':
            - img [ref=e46]
          - button "New chat" [ref=e49] [cursor=pointer]:
            - img [ref=e50]
          - generic [ref=e52]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e53] [cursor=pointer]:
              - img [ref=e54]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e56] [cursor=pointer]:
              - img [ref=e57]
            - button "2" [ref=e59] [cursor=pointer]:
              - img [ref=e60]
              - generic [ref=e62]: "2"
            - button "11" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
              - generic [ref=e66]: "11"
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e67] [cursor=pointer]:
              - img [ref=e68]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e70] [cursor=pointer]:
              - img [ref=e71]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e73] [cursor=pointer]:
              - img [ref=e74]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e76] [cursor=pointer]:
              - img [ref=e77]
          - generic [ref=e79]:
            - link "Dashboard" [ref=e80] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e82]
            - button "Settings" [ref=e84] [cursor=pointer]:
              - img [ref=e86]
      - separator
      - main [ref=e90]:
        - status [ref=e92]:
          - generic [ref=e93]: Daemon offline — existing sessions visible but new tasks may not start.
          - button "Start daemon" [ref=e94] [cursor=pointer]
          - button "Dismiss" [ref=e95] [cursor=pointer]:
            - img [ref=e96]
        - heading "Queue" [level=1] [ref=e99]
  - status [ref=e108]
  - alert [ref=e109]
  - alert [ref=e110]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // Familiar Work Queue (cave-hlv.4) — the beads + PR control tower surface.
  4   | // Drives the mode entirely off mocked /api/beads (ready beads) and
  5   | // /api/beads/prs (the bridge's classified open + merged PRs). The surface owns
  6   | // no PR truth of its own, so mocking those two endpoints fully determines the
  7   | // lanes. Daemon-less (COVEN_CAVE_E2E=1); navigation is via the cave:navigate-mode
  8   | // event since Work Queue is a quiet, shortcut-less destination.
  9   | 
  10  | const READY_BEADS = [
  11  |   { id: "cave-aa1", title: "Harden the sync path", priority: 1, status: "open", issue_type: "feature", labels: ["familiar:kitty", "surface:github"], updated_at: null, comment_count: 0 },
  12  |   { id: "cave-bb2", title: "iOS profile avatar", priority: 2, status: "open", issue_type: "feature", labels: ["familiar:nova", "surface:ios"], updated_at: null, comment_count: 0 },
  13  |   // cave-open is the post-merge-cleanup bead (merged PR #90). comment_count: 0
  14  |   // means no recorded verification yet → Close is gated until a handoff note.
  15  |   { id: "cave-open", title: "Merged but unclosed", priority: 2, status: "open", issue_type: "feature", labels: ["familiar:kitty"], updated_at: null, comment_count: 0 },
  16  |   { id: "cave-epic", title: "An epic container", priority: 1, status: "open", issue_type: "epic", labels: ["familiar:nova"], updated_at: null, comment_count: 0 },
  17  | ];
  18  | 
  19  | const NOW = Date.now();
  20  | const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
  21  | 
  22  | // These are already-classified bridge summaries (the endpoint runs the classifier).
  23  | const OPEN_PRS = [
  24  |   { number: 101, title: "Fix the flaky sync", url: "https://gh/pull/101", lane: "checks-failing", beadIds: ["cave-aa1"], checkStatus: "failing", reviewDecision: "UNKNOWN", mergeStateStatus: "BLOCKED", headRefName: "fix/cave-aa1", updatedAt: iso(40) },
  25  |   { number: 102, title: "Ship the widget", url: "https://gh/pull/102", lane: "ready-to-merge", beadIds: ["cave-cc9"], checkStatus: "passing", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", headRefName: "feat/cave-cc9", updatedAt: iso(2) },
  26  |   { number: 103, title: "Unlinked spike", url: "https://gh/pull/103", lane: "needs-review", beadIds: [], checkStatus: "passing", reviewDecision: "UNKNOWN", mergeStateStatus: "CLEAN", headRefName: "spike/x", updatedAt: iso(3) },
  27  | ];
  28  | 
  29  | const MERGED_PRS = [
  30  |   { number: 90, title: "Landed change", url: "https://gh/pull/90", beadIds: ["cave-open"], mergedAt: iso(1) },
  31  | ];
  32  | 
  33  | async function gotoWorkQueue(page: Page) {
  34  |   await page.addInitScript(() => {
  35  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  36  |     window.localStorage.setItem("cave:active-familiar", "kitty");
  37  |   });
  38  |   await page.route("**/api/familiars**", (route) =>
  39  |     route.fulfill({
  40  |       json: {
  41  |         ok: true,
  42  |         familiars: [
  43  |           { id: "kitty", display_name: "Kitty", role: "Builder", status: "active", icon: "ph:sparkle-fill" },
  44  |           { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  45  |         ],
  46  |       },
  47  |     }),
  48  |   );
  49  |   await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  50  |   // Regex matchers (not globs): glob `?` matches any char, so `/api/beads?…`
  51  |   // would also catch `/api/beads/prs`. These are unambiguous — /prs vs the
  52  |   // ?-queried ready list.
  53  |   await page.route(/\/api\/beads\/prs/, (route) =>
  54  |     route.fulfill({ json: { ok: true, open: OPEN_PRS, merged: MERGED_PRS } }),
  55  |   );
  56  |   await page.route(/\/api\/beads\?/, (route) => route.fulfill({ json: { ok: true, data: READY_BEADS } }));
  57  | 
  58  |   await page.goto("/");
  59  |   // The shell must be mounted before the mode-switch listener exists; dispatch
  60  |   // once the nav is present, then re-fire until the surface appears so a slow
  61  |   // hydration (cold `next dev` compile) can't lose the event to a race.
  62  |   await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  63  |   await expect(async () => {
  64  |     await page.evaluate(() =>
  65  |       window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })),
  66  |     );
  67  |     await expect(page.locator(".fwq")).toBeVisible({ timeout: 2_000 });
> 68  |   }).toPass({ timeout: 30_000 });
      |      ^ Error: expect(locator).toBeVisible() failed
  69  | }
  70  | 
  71  | test.describe("familiar work queue (PR control tower)", () => {
  72  |   test("renders lanes from the beads + PR bridge and exposes cleanup/claim actions", async ({ page }) => {
  73  |     await gotoWorkQueue(page);
  74  |     const fwq = page.locator(".fwq");
  75  | 
  76  |     // Header actionable count: 101(fail) + 102(ready) + 103(review) + cave-bb2(no-PR) + 90(cleanup) = 5 actionable.
  77  |     await expect(fwq.getByText(/5 actionable/)).toBeVisible();
  78  |     // Freshness readout is truthful from the first load.
  79  |     await expect(fwq.getByText(/updated just now/)).toBeVisible();
  80  | 
  81  |     // Every acceptance lane the mock populates renders, in fix→land→review→bead order.
  82  |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toBeVisible();
  83  |     await expect(fwq.getByRole("region", { name: "Needs review" })).toBeVisible();
  84  |     await expect(fwq.getByRole("region", { name: "Ready to merge" })).toBeVisible();
  85  |     await expect(fwq.getByRole("region", { name: "No open PR" })).toBeVisible();
  86  |     await expect(fwq.getByRole("region", { name: "Post-merge cleanup" })).toBeVisible();
  87  | 
  88  |     // PR + bead identity surfaces truthfully. Scope #101 to its lane: a stale PR
  89  |     // also appears in the "Needs attention" strip, so a bare getByText matches
  90  |     // two elements and trips Playwright's strict mode.
  91  |     await expect(
  92  |       fwq.getByRole("region", { name: "Checks failing" }).getByText("#101"),
  93  |     ).toBeVisible();
  94  |     await expect(fwq.getByText("cave-aa1", { exact: true })).toBeVisible();
  95  |     // Stale PR (40h) is flagged.
  96  |     await expect(fwq.getByText("stale", { exact: true }).first()).toBeVisible();
  97  | 
  98  |     // The epic is excluded from the queue (containers aren't work).
  99  |     await expect(fwq.getByText("An epic container")).toHaveCount(0);
  100 | 
  101 |     // Familiar rollup chips (label-derived) act as filters.
  102 |     const kittyChip = fwq.getByRole("button", { name: /Kitty/ });
  103 |     await expect(kittyChip).toBeVisible();
  104 |     await expect(fwq.getByRole("button", { name: /Nova/ })).toBeVisible();
  105 | 
  106 |     // Cleanup lane offers "Close bead"; no-open-PR lane offers "Claim".
  107 |     const cleanup = fwq.getByRole("region", { name: "Post-merge cleanup" });
  108 |     await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeVisible();
  109 |     const noPr = fwq.getByRole("region", { name: "No open PR" });
  110 |     await expect(noPr.getByRole("button", { name: "Claim" })).toBeVisible();
  111 | 
  112 |     // Filtering by Nova drops Kitty-owned lanes (checks-failing was Kitty's).
  113 |     await page.getByRole("button", { name: /Nova/ }).click();
  114 |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toHaveCount(0);
  115 |     await expect(fwq.getByRole("region", { name: "No open PR" })).toBeVisible(); // cave-bb2 is Nova's
  116 |   });
  117 | 
  118 |   test("claiming a no-open-PR bead posts to the beads adapter", async ({ page }) => {
  119 |     let claimBody: unknown = null;
  120 |     await page.route("**/api/beads", async (route) => {
  121 |       // POST claim/close land here (the GET ready list uses the ?-suffixed matcher).
  122 |       if (route.request().method() === "POST") {
  123 |         claimBody = route.request().postDataJSON();
  124 |         await route.fulfill({ json: { ok: true, data: { id: "cave-bb2", status: "in_progress" } } });
  125 |         return;
  126 |       }
  127 |       await route.fulfill({ json: { ok: true, data: READY_BEADS } });
  128 |     });
  129 |     await gotoWorkQueue(page);
  130 | 
  131 |     const noPr = page.locator(".fwq").getByRole("region", { name: "No open PR" });
  132 |     await noPr.getByRole("button", { name: "Claim" }).click();
  133 |     await expect.poll(() => claimBody).toEqual({ action: "claim", id: "cave-bb2" });
  134 |   });
  135 | 
  136 |   test("cleanup Close is gated on a handoff note; adding one posts a comment and unlocks it", async ({ page }) => {
  137 |     let commentBody: unknown = null;
  138 |     await page.route("**/api/beads", async (route) => {
  139 |       if (route.request().method() === "POST") {
  140 |         commentBody = route.request().postDataJSON();
  141 |         await route.fulfill({ json: { ok: true, data: { id: "cave-open" } } });
  142 |         return;
  143 |       }
  144 |       await route.fulfill({ json: { ok: true, data: READY_BEADS } });
  145 |     });
  146 |     await gotoWorkQueue(page);
  147 | 
  148 |     const cleanup = page.locator(".fwq").getByRole("region", { name: "Post-merge cleanup" });
  149 |     // No evidence yet → Close is disabled and the reason is spelled out.
  150 |     await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeDisabled();
  151 |     await expect(cleanup.getByText(/Add a handoff note to record verification/)).toBeVisible();
  152 | 
  153 |     // Record a handoff note through the inline composer. Focus lands in the
  154 |     // textarea on open; Escape closes and hands focus back to the toggle
  155 |     // (keeping the draft); submit does the same once the note posts.
  156 |     const noteToggle = cleanup.getByRole("button", { name: /Add a handoff note to cave-open/ });
  157 |     await noteToggle.click();
  158 |     const noteBox = cleanup.getByRole("textbox", { name: /Handoff note for cave-open/ });
  159 |     await expect(noteBox).toBeFocused();
  160 |     await noteBox.press("Escape");
  161 |     await expect(noteBox).toHaveCount(0);
  162 |     await expect(noteToggle).toBeFocused();
  163 |     await noteToggle.click();
  164 |     await cleanup.getByRole("textbox", { name: /Handoff note for cave-open/ }).fill("Verified: lanes render, close gated.");
  165 |     await cleanup.getByRole("button", { name: "Add note" }).click();
  166 |     await expect(noteToggle).toBeFocused();
  167 | 
  168 |     // The note posts as a comment on the bead…
```