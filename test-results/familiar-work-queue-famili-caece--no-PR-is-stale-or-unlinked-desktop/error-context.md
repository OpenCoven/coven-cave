# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: familiar-work-queue.spec.ts >> familiar work queue (PR control tower) >> Attention strip is absent when no PR is stale or unlinked
- Location: tests/familiar-work-queue.spec.ts:301:7

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
  253 |     }).toPass({ timeout: 30_000 });
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
> 316 |     await page.goto("/");
      |                ^ Error: page.goto: Test timeout of 60000ms exceeded.
  317 |     await page.waitForTimeout(500);
  318 |     await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "familiar-work-queue" } })));
  319 |     await page.waitForSelector(".fwq-lane", { timeout: 45_000 });
  320 |     await expect(page.locator(".fwq-attention")).toHaveCount(0);
  321 |   });
  322 | });
  323 | 
```