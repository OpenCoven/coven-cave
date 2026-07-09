# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-boot-landing.spec.ts >> chat boot landing >> landing offers a task-resume pill, hides Voice pre-session, and hints at / commands
- Location: tests/chat-boot-landing.spec.ts:114:7

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
  20  |   familiars: [
  21  |     { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  22  |   ],
  23  | };
  24  | 
  25  | const SESSION_S1 = {
  26  |   id: "s1",
  27  |   title: "Refactor auth flow",
  28  |   status: "completed",
  29  |   origin: "chat",
  30  |   harness: "codex",
  31  |   familiarId: "nova",
  32  |   project_root: "/repo/alpha",
  33  |   exit_code: null,
  34  |   archived_at: null,
  35  |   created_at: iso(2),
  36  |   updated_at: iso(2),
  37  | };
  38  | 
  39  | // Unassigned inbox card — fair game for this familiar's resume pills.
  40  | const BOARD = {
  41  |   ok: true,
  42  |   cards: [
  43  |     {
  44  |       id: "c1",
  45  |       title: "Fix login flow",
  46  |       status: "inbox",
  47  |       priority: "medium",
  48  |       familiarId: null,
  49  |       projectId: null,
  50  |       cwd: null,
  51  |       createdAt: iso(6),
  52  |       updatedAt: iso(5),
  53  |     },
  54  |   ],
  55  | };
  56  | 
  57  | async function seed(page: Page) {
  58  |   await page.addInitScript(() => {
  59  |     window.localStorage.setItem("cave:active-familiar", "nova");
  60  |     window.localStorage.setItem("cave:onboarding:dismissed", "1");
  61  |   });
  62  |   await page.route("**/api/familiars**", (route) => route.fulfill({ json: FAMILIARS }));
  63  |   await page.route("**/api/board**", (route) => route.fulfill({ json: BOARD }));
  64  | }
  65  | 
  66  | test.describe("chat boot landing", () => {
  67  |   test("compose view paints before the sessions list resolves", async ({ page }) => {
  68  |     await seed(page);
  69  |     // Hold the sessions fetch hostage until the landing has painted — this
  70  |     // proves the boot-compose path is independent of it, with zero timing
  71  |     // flake (no fixed delays to outrun a cold-compile CI run).
  72  |     let sessionsFulfilled = false;
  73  |     let releaseSessions!: () => void;
  74  |     const sessionsGate = new Promise<void>((resolve) => {
  75  |       releaseSessions = resolve;
  76  |     });
  77  |     await page.route("**/api/sessions/list**", async (route) => {
  78  |       await sessionsGate;
  79  |       sessionsFulfilled = true;
  80  |       await route.fulfill({ json: { ok: true, sessions: [SESSION_S1] } });
  81  |     });
  82  | 
  83  |     await page.goto("/");
  84  |     await expect(page.locator(".cave-chat-empty")).toBeVisible({ timeout: 45_000 });
  85  |     expect(sessionsFulfilled).toBe(false);
  86  | 
  87  |     // Unblock the fetch and confirm the settled landing is intact.
  88  |     releaseSessions();
  89  |     await expect(page.locator(".cave-chat-empty-greeting")).toBeVisible();
  90  |   });
  91  | 
  92  |   test("a #chat deep link still shows the Opening-chat takeover until sessions settle", async ({ page }) => {
  93  |     await seed(page);
  94  |     let releaseSessions!: () => void;
  95  |     const sessionsGate = new Promise<void>((resolve) => {
  96  |       releaseSessions = resolve;
  97  |     });
  98  |     await page.route("**/api/sessions/list**", async (route) => {
  99  |       await sessionsGate;
  100 |       await route.fulfill({ json: { ok: true, sessions: [SESSION_S1] } });
  101 |     });
  102 | 
  103 |     await page.goto("/#chat-s1");
  104 |     // The takeover owns the boot while the deep link is unresolved — the
  105 |     // loosened compose gate must not flash a compose view over it.
  106 |     const takeover = page.getByRole("status").filter({ hasText: "Opening chat…" });
  107 |     await expect(takeover).toBeVisible({ timeout: 45_000 });
  108 |     await expect(page.locator(".cave-chat-empty")).toHaveCount(0);
  109 | 
  110 |     releaseSessions();
  111 |     await expect(takeover).toHaveCount(0, { timeout: 15_000 });
  112 |   });
  113 | 
  114 |   test("landing offers a task-resume pill, hides Voice pre-session, and hints at / commands", async ({ page }) => {
  115 |     await seed(page);
  116 |     await page.route("**/api/sessions/list**", (route) =>
  117 |       route.fulfill({ json: { ok: true, sessions: [] } }),
  118 |     );
  119 | 
> 120 |     await page.goto("/");
      |                ^ Error: page.goto: Test timeout of 60000ms exceeded.
  121 |     const empty = page.locator(".cave-chat-empty");
  122 |     await expect(empty).toBeVisible({ timeout: 45_000 });
  123 | 
  124 |     // Board-aware pill: the unassigned inbox card surfaces as a task pill…
  125 |     const pill = empty.getByRole("button", { name: /Continue the task: Fix login flow/ });
  126 |     await expect(pill).toBeVisible();
  127 |     await expect(pill).toHaveClass(/cave-chat-empty-prompt--task/);
  128 | 
  129 |     // …that inserts into the composer, never auto-sends.
  130 |     await pill.click();
  131 |     const composer = page.getByPlaceholder(/Message Nova/);
  132 |     await expect(composer).toHaveValue(/Continue the task: Fix login flow/);
  133 |     await expect(empty).toBeVisible();
  134 | 
  135 |     // Voice needs a session; pre-session it is hidden, not disabled.
  136 |     await expect(page.getByRole("button", { name: "Voice" })).toHaveCount(0);
  137 | 
  138 |     // Dosed discoverability: the ready line mentions the slash entry point.
  139 |     await expect(empty.getByText("/ for commands", { exact: false })).toBeVisible();
  140 |   });
  141 | });
  142 | 
```