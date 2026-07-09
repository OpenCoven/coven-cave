# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-sidebar-nav.spec.ts >> chat sidebar (session navigator) >> defaults to the Recent view; Organize menu switches to project folders
- Location: tests/chat-sidebar-nav.spec.ts:55:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: Test timeout of 60000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:3100/", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // Verifies the chat-mode left sidebar (ChatSidebar) — the desktop session
  4   | // navigator that swaps into the nav slot when you enter Chat (⌘2). Defaults
  5   | // to a time-bucketed "Recent chats" view (Today / Yesterday / Previous 7 days /
  6   | // Previous 30 days / Older). A ⋯ "Sidebar options" button opens an Organize
  7   | // menu (role=dialog) with menuitemradio items to switch to "By project" folder
  8   | // grouping. The sidebar owns thread navigation (no in-surface thread rail).
  9   | // Desktop only. /api/familiars + /api/sessions/list are mocked.
  10  | 
  11  | // Timestamps are relative to the test run so bucket labels are deterministic:
  12  | // s1 → Today, s2 → Yesterday, s3 → Previous 7 days, s4 → Older.
  13  | const NOW = Date.now();
  14  | const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
  15  | const SESSIONS = [
  16  |   { id: "s1", title: "Refactor auth flow", status: "running", origin: "chat", project_root: "/repo/alpha", updated_at: iso(0) },
  17  |   { id: "s2", title: "Fix eslint config", status: "completed", origin: "board", project_root: "/repo/alpha", updated_at: iso(1) },
  18  |   { id: "s3", title: "Write API docs", status: "completed", origin: "chat", project_root: "/repo/beta", updated_at: iso(4) },
  19  |   { id: "s4", title: "Wire deploy pipeline", status: "running", origin: "board", project_root: "/repo/beta", updated_at: iso(40) },
  20  | ].map((s) => ({
  21  |   ...s,
  22  |   harness: "codex",
  23  |   familiarId: "nova",
  24  |   exit_code: null,
  25  |   archived_at: null,
  26  |   created_at: s.updated_at,
  27  | }));
  28  | 
  29  | async function gotoChat(page: Page) {
  30  |   await page.addInitScript(() => {
  31  |     window.localStorage.setItem("cave:active-familiar", "nova");
  32  |     window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
  33  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  34  |     // The nav is minimized-by-default; pre-seed the applied-flag so it stays
  35  |     // expanded here — this suite drives the chat session navigator, which needs
  36  |     // the nav's full width (a rail-width nav narrows the multi-pane chat layout).
  37  |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
  38  |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  39  |   });
  40  |   await page.route("**/api/familiars**", (route) =>
  41  |     route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  42  |   );
  43  |   await page.route("**/api/sessions/list**", (route) =>
  44  |     route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  45  |   );
> 46  |   await page.goto("/");
      |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  47  |   // Switch to the Chat surface (⌘2) — default landing is Home.
  48  |   await page.waitForTimeout(500);
  49  |   await page.keyboard.press("Meta+2");
  50  |   await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  51  |   await page.waitForSelector(".chat-sidebar", { timeout: 30_000 });
  52  | }
  53  | 
  54  | test.describe("chat sidebar (session navigator)", () => {
  55  |   test("defaults to the Recent view; Organize menu switches to project folders", async ({ page }) => {
  56  |     await gotoChat(page);
  57  |     const sidebar = page.locator(".chat-sidebar");
  58  | 
  59  |     // Search control survives in both views.
  60  |     await expect(sidebar.getByRole("searchbox", { name: "Search projects and threads" })).toBeVisible();
  61  | 
  62  |     // Recent is the default: time-bucket headers, no project folder toggles.
  63  |     await expect(sidebar.getByText("Today", { exact: true })).toBeVisible();
  64  |     await expect(sidebar.getByText("Older", { exact: true })).toBeVisible();
  65  |     await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toHaveCount(0);
  66  |     for (const s of SESSIONS) {
  67  |       await expect(sidebar.getByText(s.title, { exact: false }).first()).toBeVisible();
  68  |     }
  69  |     // Bare row times — no "ago" suffix anywhere in the sidebar.
  70  |     await expect(sidebar.getByText(/\bago\b/)).toHaveCount(0);
  71  | 
  72  |     // Organize sidebar → By project restores the folder grouping.
  73  |     await sidebar.getByRole("button", { name: "Sidebar options" }).click();
  74  |     const menu = page.getByRole("dialog", { name: "Sidebar options" });
  75  |     await expect(menu.getByRole("menuitemradio", { name: "Recent chats" })).toHaveAttribute("aria-checked", "true");
  76  |     await menu.getByRole("menuitemradio", { name: "By project" }).click();
  77  |     await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
  78  |     await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) beta threads/ })).toBeVisible();
  79  | 
  80  |     // The organize choice persists across a reload.
  81  |     await page.reload();
  82  |     await page.keyboard.press("Meta+2");
  83  |     await page.waitForSelector(".chat-sidebar", { timeout: 30_000 });
  84  |     await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
  85  |     await expect(sidebar.getByText("Today", { exact: true })).toHaveCount(0);
  86  |   });
  87  | 
  88  |   test("search filters threads to matches, with an empty state", async ({ page }) => {
  89  |     await gotoChat(page);
  90  |     const sidebar = page.locator(".chat-sidebar");
  91  |     const search = sidebar.getByRole("searchbox", { name: "Search projects and threads" });
  92  | 
  93  |     await search.fill("deploy");
  94  |     await expect(sidebar.getByText("Wire deploy pipeline").first()).toBeVisible();
  95  |     // Non-matching threads (and their folders) drop out of the filtered view.
  96  |     await expect(sidebar.getByText("Refactor auth flow")).toHaveCount(0);
  97  | 
  98  |     await search.fill("no-such-session-xyz");
  99  |     await expect(sidebar.getByText("No threads match your search")).toBeVisible();
  100 |   });
  101 | });
  102 | 
```