# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-task-chip-nav.spec.ts >> task chip navigates to the board card inspector, not the chat list
- Location: tests/chat-task-chip-nav.spec.ts:99:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Card inspector' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('dialog', { name: 'Card inspector' })

```

```yaml
- link "Skip to main content":
  - /url: "#shell-main-content"
- button "Collapse navigation to icons" [expanded]
- group "History":
  - button "Go back"
  - button "Go forward"
- navigation "Chat with familiars and view tasks":
  - search:
    - searchbox "Search anything or ask Salem, the docs familiar"
    - text: CtrlK
  - button "Quick chat"
  - 'button "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats"'
  - button "View tasks — 1 open": "1"
  - button "View schedules — 11 need attention": "11"
- complementary "Sidebar":
  - navigation:
    - 'button "Switch familiar — current: Nova"': Nova
    - button "New chat"
    - button "Home"
    - button "Chat"
    - button "Tasks 1"
    - button "Schedules 11"
    - button "Journal"
    - button "Grimoire"
    - button "Marketplace"
    - button "GitHub"
    - button "Recent" [expanded]
    - list:
      - listitem:
        - 'button "running session Task: Review Version Control in Cave coven-cave openclaw-local Jun 12"':
          - img "running session"
          - text: "Task: Review Version Control in Cave coven-cave openclaw-local Jun 12"
    - link "Dashboard":
      - /url: /dashboard
    - button "Settings"
    - text: v0.0.171
- separator
- main:
  - status:
    - text: Daemon offline — existing sessions visible but new tasks may not start.
    - button "Start daemon"
    - button "Dismiss"
  - heading "Tasks" [level=1]
- status
- alert
- alert
```

# Test source

```ts
  19  |   model: "openclaw-local",
  20  |   runtime: "local:/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  21  |   exit_code: null,
  22  |   archived_at: null,
  23  |   created_at: ISO,
  24  |   updated_at: ISO,
  25  | };
  26  | 
  27  | const CARD = {
  28  |   id: CARD_ID,
  29  |   title: "Review Version Control in Cave",
  30  |   notes: "Audit the changes panel.",
  31  |   status: "backlog",
  32  |   priority: "medium",
  33  |   familiarId: "nova",
  34  |   sessionId: "s-task",
  35  |   cwd: "/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
  36  |   links: [],
  37  |   github: [],
  38  |   labels: [],
  39  |   createdAt: ISO,
  40  |   updatedAt: ISO,
  41  |   lifecycle: "queued",
  42  |   lifecycleAt: ISO,
  43  |   retryCount: 0,
  44  |   maxRetries: 2,
  45  |   steps: [],
  46  | };
  47  | 
  48  | const CONTEXT = {
  49  |   task: {
  50  |     id: CARD_ID,
  51  |     title: CARD.title,
  52  |     status: CARD.status,
  53  |     priority: CARD.priority,
  54  |     lifecycle: CARD.lifecycle,
  55  |     labels: [],
  56  |     cwd: CARD.cwd,
  57  |     notes: CARD.notes,
  58  |   },
  59  |   github: [],
  60  | };
  61  | 
  62  | async function setup(page: Page) {
  63  |   await page.addInitScript(() => {
  64  |     window.localStorage.setItem("cave:active-familiar", "nova");
  65  |     window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
  66  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  67  |     // Nav is minimized-by-default; keep it expanded here so the chat layout keeps
  68  |     // its full width (see cave:shell:min-applied — the sidebar-minimize flag).
  69  |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
  70  |     window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  71  |   });
  72  |   await page.route("**/api/familiars**", (route) =>
  73  |     route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  74  |   );
  75  |   await page.route("**/api/sessions/list**", (route) =>
  76  |     route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  77  |   );
  78  |   await page.route("**/api/chat/conversation/**", (route) =>
  79  |     route.fulfill({
  80  |       json: {
  81  |         ok: true,
  82  |         conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: ISO }] },
  83  |         context: CONTEXT,
  84  |       },
  85  |     }),
  86  |   );
  87  |   await page.route("**/api/board**", (route) => {
  88  |     if (route.request().method() === "GET") {
  89  |       return route.fulfill({ json: { ok: true, cards: [CARD] } });
  90  |     }
  91  |     return route.continue();
  92  |   });
  93  |   await page.goto("/");
  94  |   await page.waitForTimeout(500);
  95  |   await page.keyboard.press("Meta+2");
  96  |   await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  97  | }
  98  | 
  99  | test("task chip navigates to the board card inspector, not the chat list", async ({ page }) => {
  100 |   await setup(page);
  101 | 
  102 |   // Open the task chat from the chat-mode sidebar (session navigator).
  103 |   const sidebar = page.locator(".chat-sidebar");
  104 |   await sidebar.getByText("Review Version Control in Cave", { exact: false }).first().click();
  105 | 
  106 |   // The linked-task chip appears in the chat header. Its accessible name is
  107 |   // the chip's own text content ("Task … backlog medium"), which the status/
  108 |   // priority suffix distinguishes from the sidebar's session button.
  109 |   const chip = page.getByRole("button", { name: /Review Version Control in Cave backlog medium/ });
  110 |   await expect(chip).toBeVisible({ timeout: 30_000 });
  111 | 
  112 |   // Click it → leaves the chat surface and opens the board card inspector.
  113 |   // Regression guard: writing `#card-<id>` used to synchronously fire the
  114 |   // workspace popstate handler, which bounced back to the chat list (mode was
  115 |   // still "chat" before the intent's setMode("board") committed) — stranding
  116 |   // the user on the list instead of the task.
  117 |   await chip.click();
  118 | 
> 119 |   await expect(page.getByRole("dialog", { name: "Card inspector" })).toBeVisible({ timeout: 10_000 });
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  120 |   await expect(page.locator(".chat-surface")).toHaveCount(0);
  121 | });
  122 | 
```