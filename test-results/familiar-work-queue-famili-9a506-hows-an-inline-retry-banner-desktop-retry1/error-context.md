# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: familiar-work-queue.spec.ts >> familiar work queue (PR control tower) >> failed refresh keeps earlier data and shows an inline retry banner
- Location: tests/familiar-work-queue.spec.ts:228:7

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
          - button "View tasks" [ref=e28] [cursor=pointer]:
            - img [ref=e29]
          - button "View schedules" [ref=e31] [cursor=pointer]:
            - img [ref=e32]
    - generic [ref=e35]:
      - complementary "Sidebar" [ref=e38]:
        - navigation [ref=e39]:
          - 'button "Switch familiar — current: Kitty" [ref=e42] [cursor=pointer]':
            - img [ref=e44]
          - button "New chat" [ref=e47] [cursor=pointer]:
            - img [ref=e48]
          - generic [ref=e50]:
            - button "Home — Overview and quick actions (⌘1) · drag into the page to split" [ref=e51] [cursor=pointer]:
              - img [ref=e52]
            - button "Chat — Talk with your familiars — 1:1 or a Group tab for a whole coven (⌘2) · drag into the page to split" [ref=e54] [cursor=pointer]:
              - img [ref=e55]
            - button "Tasks — Track tasks across projects (⌘3) · drag into the page to split" [ref=e57] [cursor=pointer]:
              - img [ref=e58]
            - button "Schedules — Calendar and crons in one place (⌘4) · drag into the page to split" [ref=e60] [cursor=pointer]:
              - img [ref=e61]
            - button "Journal — Your familiars' daily reflections — a tab in the Grimoire" [ref=e63] [cursor=pointer]:
              - img [ref=e64]
            - button "Grimoire — Edit memory, knowledge, and journal markdown as living documents · drag into the page to split" [ref=e66] [cursor=pointer]:
              - img [ref=e67]
            - button "Marketplace — Browse the store and manage your familiars' roles, skills, and capabilities · drag into the page to split" [ref=e69] [cursor=pointer]:
              - img [ref=e70]
            - button "GitHub — Issues and PRs assigned to you · drag into the page to split" [ref=e72] [cursor=pointer]:
              - img [ref=e73]
          - generic [ref=e75]:
            - link "Dashboard" [ref=e76] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e78]
            - button "Settings" [ref=e80] [cursor=pointer]:
              - img [ref=e82]
      - separator
      - main [ref=e86]:
        - heading "Queue" [level=1] [ref=e88]
  - status [ref=e97]
  - alert [ref=e98]
  - alert [ref=e99]
```

# Test source

```ts
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
  169 |     await expect.poll(() => commentBody).toEqual({
  170 |       action: "comment",
  171 |       id: "cave-open",
  172 |       comment: "Verified: lanes render, close gated.",
  173 |     });
  174 |     // …and Close unlocks (optimistic, without waiting for a re-read).
  175 |     await expect(cleanup.getByRole("button", { name: "Close bead" })).toBeEnabled();
  176 |   });
  177 | 
  178 |   test("Attention strip surfaces stale and unlinked open PRs", async ({ page }) => {
  179 |     await gotoWorkQueue(page);
  180 |     const strip = page.locator(".fwq").getByRole("region", { name: "PRs needing attention" });
  181 |     await expect(strip).toBeVisible();
  182 | 
  183 |     // #101 is 40h old (stale, linked); #103 has no bead (unlinked, fresh).
  184 |     const stale = strip.locator(".fwq-attention-item", { hasText: "#101" });
  185 |     await expect(stale.getByText("stale", { exact: true })).toBeVisible();
  186 |     const unlinked = strip.locator(".fwq-attention-item", { hasText: "#103" });
  187 |     await expect(unlinked.getByText("no bead", { exact: true })).toBeVisible();
  188 | 
  189 |     // A clean, linked, fresh PR (#102) is NOT flagged.
  190 |     await expect(strip.locator(".fwq-attention-item", { hasText: "#102" })).toHaveCount(0);
  191 |     // Each row can jump to the PR.
  192 |     await expect(stale.getByRole("button", { name: "Open PR" })).toBeVisible();
  193 |   });
  194 | 
  195 |   test("beads adapter failure degrades to PRs-only with a visible notice", async ({ page }) => {
  196 |     await page.addInitScript(() => {
  197 |       window.localStorage.setItem("cave:onboarding:dismissed", "1");
  198 |       window.localStorage.setItem("cave:active-familiar", "kitty");
  199 |     });
  200 |     await page.route("**/api/familiars**", (r) =>
  201 |       r.fulfill({ json: { ok: true, familiars: [{ id: "kitty", display_name: "Kitty", role: "B", status: "active", icon: "ph:sparkle-fill" }] } }),
  202 |     );
  203 |     await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  204 |     await page.route(/\/api\/beads\/prs/, (r) => r.fulfill({ json: { ok: true, open: OPEN_PRS, merged: MERGED_PRS } }));
  205 |     // The beads adapter is down (bd missing / not a beads workspace).
  206 |     await page.route(/\/api\/beads\?/, (r) => r.fulfill({ status: 500, json: { ok: false, error: "bd unavailable" } }));
  207 | 
  208 |     await page.goto("/");
  209 |     await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  210 |     await expect(async () => {
  211 |       await page.evaluate(() =>
  212 |         window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })),
  213 |       );
  214 |       await expect(page.locator(".fwq")).toBeVisible({ timeout: 2_000 });
  215 |     }).toPass({ timeout: 30_000 });
  216 | 
  217 |     const fwq = page.locator(".fwq");
  218 |     // The degradation is SAID, not silent.
  219 |     await expect(fwq.getByText(/Beads adapter unavailable/)).toBeVisible();
  220 |     // PR lanes still render from the bridge…
  221 |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toBeVisible();
  222 |     await expect(fwq.getByRole("region", { name: "Needs review" })).toBeVisible();
  223 |     // …but the bead-driven lanes are gone (no ready set to derive them from).
  224 |     await expect(fwq.getByRole("region", { name: "No open PR" })).toHaveCount(0);
  225 |     await expect(fwq.getByRole("region", { name: "Post-merge cleanup" })).toHaveCount(0);
  226 |   });
  227 | 
  228 |   test("failed refresh keeps earlier data and shows an inline retry banner", async ({ page }) => {
  229 |     // Flip-switch rather than a call counter: dev-mode StrictMode double-mount
  230 |     // (and focus refreshes) make the number of initial loads unpredictable.
  231 |     let failPrs = false;
  232 |     await page.addInitScript(() => {
  233 |       window.localStorage.setItem("cave:onboarding:dismissed", "1");
  234 |       window.localStorage.setItem("cave:active-familiar", "kitty");
  235 |     });
  236 |     await page.route("**/api/familiars**", (r) =>
  237 |       r.fulfill({ json: { ok: true, familiars: [{ id: "kitty", display_name: "Kitty", role: "B", status: "active", icon: "ph:sparkle-fill" }] } }),
  238 |     );
  239 |     await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  240 |     await page.route(/\/api\/beads\/prs/, (r) => {
  241 |       if (failPrs) return r.fulfill({ status: 502, json: { ok: false, error: "gh exploded" } });
  242 |       return r.fulfill({ json: { ok: true, open: OPEN_PRS, merged: MERGED_PRS } });
  243 |     });
  244 |     await page.route(/\/api\/beads\?/, (r) => r.fulfill({ json: { ok: true, data: READY_BEADS } }));
  245 | 
  246 |     await page.goto("/");
  247 |     await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  248 |     await expect(async () => {
  249 |       await page.evaluate(() =>
  250 |         window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })),
  251 |       );
  252 |       await expect(page.locator(".fwq")).toBeVisible({ timeout: 2_000 });
> 253 |     }).toPass({ timeout: 30_000 });
      |        ^ Error: expect(locator).toBeVisible() failed
  254 | 
  255 |     const fwq = page.locator(".fwq");
  256 |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toBeVisible();
  257 | 
  258 |     failPrs = true;
  259 |     await fwq.getByRole("button", { name: "Refresh queue" }).click();
  260 |     const banner = fwq.getByRole("alert");
  261 |     await expect(banner).toContainText("Couldn't refresh the queue");
  262 |     await expect(banner.getByRole("button", { name: "Retry" })).toBeVisible();
  263 |     // Earlier data stays on screen — the failure does not blank the queue.
  264 |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toBeVisible();
  265 |     await expect(fwq.getByRole("region", { name: "Post-merge cleanup" })).toBeVisible();
  266 |   });
  267 | 
  268 |   test("PR bridge down at first load degrades to beads-only instead of a dead surface", async ({ page }) => {
  269 |     // gh missing/unauthenticated on a fresh open: the queue must still load
  270 |     // from the beads adapter (user-reported "ensure it loads").
  271 |     await page.addInitScript(() => {
  272 |       window.localStorage.setItem("cave:onboarding:dismissed", "1");
  273 |       window.localStorage.setItem("cave:active-familiar", "kitty");
  274 |     });
  275 |     await page.route("**/api/familiars**", (r) =>
  276 |       r.fulfill({ json: { ok: true, familiars: [{ id: "kitty", display_name: "Kitty", role: "B", status: "active", icon: "ph:sparkle-fill" }] } }),
  277 |     );
  278 |     await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  279 |     await page.route(/\/api\/beads\/prs/, (r) => r.fulfill({ status: 500, json: { ok: false, error: "gh unavailable" } }));
  280 |     await page.route(/\/api\/beads\?/, (r) => r.fulfill({ json: { ok: true, data: READY_BEADS } }));
  281 | 
  282 |     await page.goto("/");
  283 |     await page.getByRole("navigation").first().waitFor({ timeout: 30_000 });
  284 |     await expect(async () => {
  285 |       await page.evaluate(() =>
  286 |         window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })),
  287 |       );
  288 |       await expect(page.locator(".fwq")).toBeVisible({ timeout: 2_000 });
  289 |     }).toPass({ timeout: 30_000 });
  290 | 
  291 |     const fwq = page.locator(".fwq");
  292 |     // The degradation is SAID, not silent — and it is not the dead retry state.
  293 |     await expect(fwq.getByText(/GitHub PR bridge unavailable/)).toBeVisible();
  294 |     await expect(fwq.getByText("Couldn't load the queue")).toHaveCount(0);
  295 |     // Bead-driven lane renders from the ready set alone.
  296 |     await expect(fwq.getByRole("region", { name: "No open PR" })).toBeVisible();
  297 |     // PR-truth lanes are honestly absent.
  298 |     await expect(fwq.getByRole("region", { name: "Checks failing" })).toHaveCount(0);
  299 |   });
  300 | 
  301 |   test("Attention strip is absent when no PR is stale or unlinked", async ({ page }) => {
  302 |     // Every open PR is fresh and linked → nothing to flag.
  303 |     await page.addInitScript(() => {
  304 |       window.localStorage.setItem("cave:onboarding:dismissed", "1");
  305 |       window.localStorage.setItem("cave:active-familiar", "kitty");
  306 |     });
  307 |     await page.route("**/api/familiars**", (r) =>
  308 |       r.fulfill({ json: { ok: true, familiars: [{ id: "kitty", display_name: "Kitty", role: "B", status: "active", icon: "ph:sparkle-fill" }] } }),
  309 |     );
  310 |     await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  311 |     const freshPr = { number: 201, title: "All good", url: "https://gh/pull/201", lane: "ready-to-merge", beadIds: ["cave-aa1"], checkStatus: "passing", reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", headRefName: "feat/cave-aa1", updatedAt: new Date().toISOString() };
  312 |     await page.route(/\/api\/beads\/prs/, (r) => r.fulfill({ json: { ok: true, open: [freshPr], merged: [] } }));
  313 |     await page.route(/\/api\/beads\?/, (r) =>
  314 |       r.fulfill({ json: { ok: true, data: [{ id: "cave-aa1", title: "T", priority: 1, status: "open", issue_type: "feature", labels: ["familiar:kitty"] }] } }),
  315 |     );
  316 |     await page.goto("/");
  317 |     await page.waitForTimeout(500);
  318 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })));
  319 |     await page.waitForSelector(".fwq-lane", { timeout: 45_000 });
  320 |     await expect(page.locator(".fwq-attention")).toHaveCount(0);
  321 |   });
  322 | });
  323 | 
```