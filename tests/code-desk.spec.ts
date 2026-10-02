import { expect, test, type Page } from "@playwright/test";

// The Coding Desk overhaul (#5705): six directions over the per-session
// workbench under Code → Review.
//
//   1. the desk fills its host (no dead space under the composer)
//   2. the identity strip — activity, branch, PR state, diffstat as chips
//   3. open-file tabs above the viewer
//   4. the context-aware follow-up dock
//   5. the resizable, remembered terminal drawer
//   6. review progress in the header and "Next unviewed"
//
// Daemon-less — onboarding dismissed, every endpoint mocked via page.route.
// Desktop only: the narrow drill-in is covered in tests/mobile/.

const OLD_ISO = "2026-06-12T10:00:00.000Z";
const NEW_ISO = "2026-06-12T12:00:00.000Z";
const WORK_ROOT = "/repo/alpha/.worktrees/feat-flux";

const mkSession = (over: Record<string, unknown>) => ({
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local",
  exit_code: null,
  archived_at: null,
  created_at: OLD_ISO,
  updated_at: OLD_ISO,
  ...over,
});

const NEWEST = mkSession({
  id: "s-new",
  title: "Wire the flux capacitor",
  project_root: "/repo/alpha",
  updated_at: NEW_ISO,
  familiarWorkspace: false,
  workBranch: "feat/flux",
  git: {
    branch: "feat/flux",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: WORK_ROOT,
    isWorktree: true,
  },
  pullRequest: { repo: "acme/alpha", number: 7, url: "https://github.com/acme/alpha/pull/7", state: "open" },
  diff: { additions: 12, deletions: 3 },
});
const OLDER = mkSession({
  id: "s-old",
  title: "Fix login retry",
  status: "idle",
  project_root: "/repo/alpha",
  familiarWorkspace: false,
  git: {
    branch: "main",
    repositoryUrl: "https://github.com/acme/alpha",
    worktreeRoot: "/repo/alpha/.worktrees/fix-login-retry",
    isWorktree: true,
  },
});

const CHANGED_FILES: { path: string; status: string; insertions: number; deletions: number; changeVersion?: string }[] = [
  { path: "src/flux.ts", status: "modified", insertions: 12, deletions: 3, changeVersion: "100:100:400" },
  { path: "src/retry.ts", status: "added", insertions: 5, deletions: 0, changeVersion: "100:100:90" },
];

type Sent = { prompt?: string; sessionId?: string };

/** The worktree the changes mock serves. A test can swap `current` to rewrite
 *  the worktree mid-run, or set it to "fail" to make the status call error. */
type ChangesFixture = { current: typeof CHANGED_FILES | "fail" };

async function base(
  page: Page,
  sessions: unknown[] = [NEWEST, OLDER],
  worktree: ChangesFixture = { current: CHANGED_FILES },
) {
  const sends: Sent[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          familiarType: "coding",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/daemon/status**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({
      json: {
        running: true,
        availability: "online",
        checkedAt: NEW_ISO,
        target: { mode: "local", label: "Local daemon", socket: "/tmp/coven.sock" },
      },
    }),
  );
  await page.route("**/api/onboarding/status**", (route) =>
    route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } }),
  );
  await page.route("**/api/onboarding/update**", (route) =>
    route.fulfill({ json: { ok: true, tools: [], checkedAt: NEW_ISO, stale: false } }),
  );
  await page.route("**/api/onboarding/install**", (route) => route.fulfill({ json: { npmBusy: false } }));
  await page.route("**/api/cave-home-migration**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: { pending: [], conflicts: [], migrated: true, details: [], backupRoot: "", journalPath: "" },
      },
    }),
  );
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  // One handler, three contracts: ?branches=1 (inspector), ?diff (a file's
  // unified diff), and the working-tree status everything else reads.
  await page.route("**/api/changes**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("branches") === "1") {
      route.fulfill({
        json: {
          ok: true,
          branches: [
            { name: "main", current: false, worktree: null },
            { name: "feat/flux", current: true, worktree: "feat-flux", worktreePath: WORK_ROOT },
          ],
        },
      });
      return;
    }
    if (url.searchParams.get("checkpoints") === "1") {
      route.fulfill({ json: { ok: true, checkpoints: [] } });
      return;
    }
    if (url.searchParams.has("path")) {
      const path = url.searchParams.get("path") ?? "file";
      route.fulfill({
        json: { ok: true, diff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n` },
      });
      return;
    }
    if (worktree.current === "fail") {
      route.fulfill({ status: 500, json: { ok: false, error: "git unavailable" } });
      return;
    }
    route.fulfill({ json: { ok: true, repo: true, repoRoot: WORK_ROOT, files: worktree.current } });
  });
  await page.route("**/api/project-tree**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        entries: [
          { name: "README.md", path: `${WORK_ROOT}/README.md`, isDir: false },
          { name: "flux.ts", path: `${WORK_ROOT}/src/flux.ts`, isDir: false },
        ],
      },
    }),
  );
  await page.route("**/api/project-file**", (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    route.fulfill({ json: { ok: true, kind: "text", content: `// ${name}\nexport const name = "${name}";\n`, size: 40 } });
  });
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON() as Sent);
    return route.fulfill({
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Ready." })}`, "",
        `data: ${JSON.stringify({ kind: "done", sessionId: "s-new" })}`, "", "",
      ].join("\n"),
    });
  });
  await page.route("**/api/chat/stop", (route) => route.fulfill({ json: { ok: true } }));
  return { sends };
}

async function openDesk(page: Page) {
  await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
  const desk = page.getByTestId("code-workbench");
  await expect(desk).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("code-workbench-tree")).toBeVisible({ timeout: 30_000 });
  return desk;
}

test.describe.configure({ mode: "serial" });

test.describe("Coding Desk overhaul (#5705)", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop-only — the narrow drill-in is covered in tests/mobile/");

  test("1. the desk fills its host, so the composer sits at the bottom edge with no dead space", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    await expect(page.getByTestId("code-composer")).toBeVisible();
    const gap = await desk.evaluate((el) => {
      const host = el.parentElement!.getBoundingClientRect();
      const own = el.getBoundingClientRect();
      const composer = el.querySelector('[data-testid="code-composer"]')!.getBoundingClientRect();
      return { hostToDesk: host.bottom - own.bottom, deskToComposer: own.bottom - composer.bottom };
    });
    expect(Math.abs(gap.hostToDesk)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap.deskToComposer)).toBeLessThanOrEqual(1);
  });

  test("2. the identity strip prints activity, branch, PR state and diffstat as words beside their tints", async ({ page }) => {
    await base(page);
    await openDesk(page);
    const activity = page.getByTestId("code-desk-activity");
    await expect(activity).toHaveText(/running/);
    await expect(activity).toHaveAttribute("data-tone", "success");

    const branch = page.getByTestId("code-desk-branch");
    await expect(branch).toContainText("feat/flux");
    await expect(branch).toContainText("worktree");

    const pr = page.getByTestId("code-desk-pr");
    await expect(pr).toContainText("#7");
    await expect(pr).toContainText("open");
    await expect(pr).toHaveAttribute("data-state", "open");
    await expect(pr).toHaveAttribute("href", "https://github.com/acme/alpha/pull/7");

    // The session list says +12 −3; the live worktree (src/flux.ts +12 −3,
    // src/retry.ts +5) says +17 −3. The header prints the live figure, the
    // same one the rail prints (#5718).
    const diffstat = page.getByTestId("code-desk-diffstat");
    await expect(diffstat).toContainText("+17");
    await expect(diffstat).toContainText("−3");

    // The retired facts row is gone, not hidden.
    await expect(page.locator(".code-room__facts")).toHaveCount(0);

    // An idle session with no PR: the word changes, the PR chip is absent.
    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    await expect(page.getByTestId("code-desk-activity")).toHaveAttribute("data-tone", "neutral");
    await expect(page.getByTestId("code-desk-pr")).toHaveCount(0);
    await expect(page.getByTestId("code-desk-branch")).toContainText("main");
  });

  test("3. open-file tabs keep every opened file, mark changed ones, close, and cycle by keyboard", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    const viewerName = desk.locator(".workspace-rail__preview-name");

    await expect(page.getByTestId("code-open-file-tabs")).toHaveCount(0);
    await tree.getByText("README.md", { exact: true }).click();
    const tabs = page.getByTestId("code-open-file-tabs");
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(viewerName).toHaveText("README.md");

    await tree.getByText("flux.ts", { exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    const fluxTab = tabs.getByRole("tab", { name: /flux\.ts/ });
    await expect(fluxTab).toHaveAttribute("aria-selected", "true");
    // The changed file carries the tree's porcelain letter, not just a tint.
    await expect(fluxTab.locator(".code-tabs__status")).toHaveText("M");
    await expect(tabs.getByRole("tab", { name: /README\.md/ }).locator(".code-tabs__status")).toHaveCount(0);
    await expect(viewerName).toHaveText("flux.ts");

    // Clicking a tab switches the viewer without touching the strip.
    await tabs.getByRole("tab", { name: /README\.md/ }).click();
    await expect(viewerName).toHaveText("README.md");
    await expect(tabs.getByRole("tab")).toHaveCount(2);

    // Alt+↓ / Alt+↑ cycle the open files (rebindable in the shortcuts dialog).
    await page.keyboard.press("Alt+ArrowDown");
    await expect(viewerName).toHaveText("flux.ts");
    await page.keyboard.press("Alt+ArrowDown");
    await expect(viewerName).toHaveText("README.md", { timeout: 5_000 });
    await page.keyboard.press("Alt+ArrowUp");
    await expect(viewerName).toHaveText("flux.ts");

    // The shortcuts dialog lists the new bindings.
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByText("Next open file")).toBeVisible();
    await expect(page.getByText("Previous open file")).toBeVisible();
    await page.keyboard.press("Escape");

    // Closing the active tab lands on its neighbour; closing the last empties the strip.
    await tabs.getByRole("button", { name: "Close flux.ts" }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(viewerName).toHaveText("README.md");
    await tabs.getByRole("button", { name: "Close README.md" }).click();
    await expect(page.getByTestId("code-open-file-tabs")).toHaveCount(0);
  });

  test("4. the follow-up dock attaches the open file, seeds from suggestions, and reports the reply", async ({ page }) => {
    const { sends } = await base(page);
    const desk = await openDesk(page);
    const composer = page.getByTestId("code-composer");
    const prompt = composer.getByRole("textbox", { name: "Follow-up" });
    await expect(prompt).toBeVisible();
    await expect(composer.getByText(/to send/)).toBeVisible();

    // No file open: only the session-level asks, in one uniform row.
    const suggestions = page.getByTestId("code-composer-suggestions");
    await expect(suggestions).toHaveAttribute("data-count", "3");
    await expect(suggestions.getByRole("button")).toHaveText(["Review my changes", "Summarize the PR", "Run the checks"]);
    await expect(page.getByTestId("code-composer-context")).toHaveCount(0);

    // Open a file: the chip appears attached and the file asks join, capped at four.
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    const chip = page.getByTestId("code-composer-context");
    await expect(chip).toContainText("flux.ts");
    await expect(chip).toContainText("attached");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(suggestions).toHaveAttribute("data-count", "4");
    await expect(suggestions.getByRole("button")).toHaveText([
      "Review my changes",
      "Explain this file",
      "Add tests for this file",
      "Summarize the PR",
    ]);

    // A pill seeds the prompt and focuses it — it never sends on its own.
    await suggestions.getByRole("button", { name: "Explain this file" }).click();
    await expect(prompt).toHaveValue(/flux\.ts/);
    await expect(prompt).toBeFocused();
    await expect(page.getByTestId("code-composer-suggestions")).toHaveCount(0);
    expect(sends).toHaveLength(0);

    // Send: the context leads the outgoing prompt; the card reports the reply.
    await composer.getByRole("button", { name: "Send" }).click();
    const reply = page.getByTestId("code-composer-reply");
    await expect(reply).toHaveAttribute("data-phase", "done");
    await expect(reply.getByRole("status")).toHaveText(/Replied/);
    await expect(reply).toContainText("Ready.");
    await expect(reply.getByRole("button", { name: "Full thread in Chat" })).toBeVisible();
    expect(sends).toHaveLength(1);
    expect(sends[0].sessionId).toBe("s-new");
    expect(sends[0].prompt).toMatch(/^Regarding `src\/flux\.ts`:\n\nExplain what flux\.ts does/);

    // Chip off: the ask goes bare. ⌘/Ctrl+Enter sends from the field.
    await chip.click();
    await expect(chip).toContainText("not attached");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await prompt.fill("Tighten the retry loop.");
    await prompt.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("code-composer-reply")).toHaveAttribute("data-phase", "done");
    await expect.poll(() => sends.length).toBe(2);
    expect(sends[1].prompt).toBe("Tighten the retry loop.");

    // The desk still fits with the reply card open.
    const overflow = await desk.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("5. the terminal drawer resizes by keyboard and pointer, and remembers its height across reloads", async ({ page }) => {
    // Tall enough that the column region allows the 460px preset (70% of it).
    await page.setViewportSize({ width: 1280, height: 1200 });
    await base(page);
    await openDesk(page);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    const grip = page.getByRole("separator", { name: "Resize the terminal drawer" });
    await expect(grip).toBeVisible();
    await expect(grip).toHaveAttribute("aria-valuenow", "260");
    const drawer = page.getByTestId("code-terminal-drawer");
    await expect(drawer).toHaveCSS("height", "260px");

    await grip.focus();
    await page.keyboard.press("ArrowUp");
    await expect(grip).toHaveAttribute("aria-valuenow", "276");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(grip).toHaveAttribute("aria-valuenow", "340");
    await expect(drawer).toHaveCSS("height", "340px");
    await page.keyboard.press("ArrowDown");
    await expect(grip).toHaveAttribute("aria-valuenow", "324");
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("cave.code.terminal-height"))).toBe("324");

    // Pointer drag: the drawer hangs from the bottom, so dragging up grows it.
    // The drawer animates its height, and the grip rides on its top edge, so
    // measure only once the previous step has settled — a box read mid-
    // transition puts the pointer where the grip used to be.
    await expect(drawer).toHaveCSS("height", "324px");
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 8 });
    await page.mouse.up();
    await expect(grip).toHaveAttribute("aria-valuenow", "364");

    // The preset toggle still exists and reads as a state.
    const taller = page.getByRole("button", { name: "Taller" });
    await expect(taller).toHaveAttribute("aria-pressed", "false");
    await taller.click();
    await expect(page.getByRole("button", { name: "Shorter" })).toHaveAttribute("aria-pressed", "true");
    await expect(grip).toHaveAttribute("aria-valuenow", "460");

    // Closing never costs height (#5729): the drawer used to re-clamp against
    // the body measured while open, and came back at 278 here.
    await page.getByRole("button", { name: "Close the terminal drawer" }).click();
    await expect(page.getByRole("button", { name: "Open the terminal drawer" })).toBeVisible();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(grip).toHaveAttribute("aria-valuenow", "460");
    await expect(page.getByRole("button", { name: "Shorter" })).toHaveAttribute("aria-pressed", "true");

    // Remembered on this device. (A plain reload lands on the workspace's
    // default mode — the ?mode= idiom strips itself — so re-enter the desk.)
    await openDesk(page);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.getByRole("separator", { name: "Resize the terminal drawer" })).toHaveAttribute("aria-valuenow", "460");

    // And clamped to the room: a short window cannot be swallowed by a tall drawer.
    await page.setViewportSize({ width: 1280, height: 520 });
    await expect
      .poll(async () => Number(await page.getByRole("separator", { name: "Resize the terminal drawer" }).getAttribute("aria-valuenow")))
      .toBeLessThan(460);
  });

  test("6. review progress lives in the header and Next unviewed walks the changed files", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    const progress = page.getByTestId("code-desk-progress");
    await expect(progress).toHaveText("0 of 2 viewed");
    const rail = page.getByTestId("code-review-rail");
    await expect(rail).toContainText("0 of 2 viewed");
    const next = rail.getByRole("button", { name: "Next unviewed" });
    await expect(next).toBeEnabled();
    const viewerName = desk.locator(".workspace-rail__preview-name");

    // Opens the file in the viewer AND expands its diff in the rail.
    await next.click();
    await expect(viewerName).toHaveText("flux.ts");
    await expect(page.getByTestId("code-open-file-tabs").getByRole("tab")).toHaveCount(1);
    await expect(rail.locator('button[aria-expanded][title="src/flux.ts"]')).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("code-composer-context")).toContainText("flux.ts");

    await rail.getByRole("switch", { name: "Mark src/flux.ts viewed" }).click();
    await expect(progress).toHaveText("1 of 2 viewed");
    await next.click();
    await expect(viewerName).toHaveText("retry.ts");
    await rail.getByRole("switch", { name: "Mark src/retry.ts viewed" }).click();
    await expect(progress).toHaveText("2 of 2 viewed");
    await expect(progress).toHaveAttribute("data-complete", "true");
    await expect(next).toBeDisabled();

    // The rail collapsed to its spine still leaves the answer in the header.
    await page.getByRole("button", { name: "Hide the review rail" }).click();
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);
    await expect(progress).toHaveText("2 of 2 viewed");

    // Unmarking reopens the walk.
    await page.getByRole("button", { name: "Show the review rail" }).click();
    await page.getByTestId("code-review-rail").getByRole("switch", { name: "Mark src/flux.ts unviewed" }).click();
    await expect(progress).toHaveText("1 of 2 viewed");
    await expect(page.getByTestId("code-review-rail").getByRole("button", { name: "Next unviewed" })).toBeEnabled();
  });

  // ── Pass 2 (#5718) ─────────────────────────────────────────────────────────

  test("7. a session round trip keeps the open tabs, the viewed ticks and the unsent draft", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    await tree.getByText("flux.ts", { exact: true }).click();
    await tree.getByText("README.md", { exact: true }).click();
    await page.getByTestId("code-review-rail").getByRole("switch", { name: "Mark src/flux.ts viewed" }).click();
    const prompt = () => page.getByTestId("code-composer").getByRole("textbox", { name: "Follow-up" });
    await prompt().fill("half-written draft");
    await expect(page.getByTestId("code-desk-progress")).toHaveText("1 of 2 viewed");

    // Away: the other session starts with nothing of this one's.
    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    await expect(page.getByTestId("code-open-file-tabs")).toHaveCount(0);
    await expect(prompt()).toHaveValue("");

    // And back: everything is where it was left.
    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/running/);
    const tabs = page.getByTestId("code-open-file-tabs");
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await expect(tabs.getByRole("tab", { name: /README\.md/ })).toHaveAttribute("aria-selected", "true");
    await expect(desk.locator(".workspace-rail__preview-name")).toHaveText("README.md");
    await expect(prompt()).toHaveValue("half-written draft");
    await expect(page.getByTestId("code-desk-progress")).toHaveText("1 of 2 viewed");

    // Sending clears the remembered draft too.
    await page.getByTestId("code-composer").getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("code-composer-reply")).toHaveAttribute("data-phase", "done");
    await page.locator("[data-code-session-id='s-old']").first().click();
    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/running/);
    await expect(prompt()).toHaveValue("");
  });

  test("8. the header and the rail print one diffstat, and the rail does not repeat the panel's figures", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await expect(page.getByTestId("code-desk-diffstat")).toContainText("+17");
    const rail = page.getByTestId("code-review-rail");
    await expect(rail).toContainText("+17");
    // Progress and the bar stay in the rail summary; the figures print once,
    // in the changes panel header below it.
    const summary = rail.locator(".code-rail__summary");
    await expect(summary).toContainText("0 of 2 viewed");
    await expect(summary).not.toContainText("+17");
    await expect(summary).not.toContainText(/worktree/i);
  });

  test("9. at a medium width the viewer header keeps the name and the actions, with a relative directory", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await base(page);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-code-session-id='s-new']").first()).toBeVisible({ timeout: 30_000 });
    if (!(await page.getByTestId("code-workbench").isVisible())) {
      await page.locator("[data-code-session-id='s-new']").first().click();
    }
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    const viewer = page.locator(".code-room__viewer");
    await expect(viewer.locator(".workspace-rail__preview-name")).toHaveText("flux.ts");
    await expect(viewer.locator(".workspace-rail__preview-dir")).toHaveText("src");
    const fits = await viewer.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const inside = (sel: string) => {
        const node = el.querySelector(sel);
        if (!node) return false;
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1;
      };
      return {
        name: inside(".workspace-rail__preview-name"),
        actions: inside(".workspace-rail__preview-actions"),
      };
    });
    expect(fits).toEqual({ name: true, actions: true });
    await expect(viewer.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Copy" })).toBeVisible();
  });

  test("10. the open drawer goes straight from the status strip to the pane bar", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.getByRole("separator", { name: "Resize the terminal drawer" })).toBeVisible();
    await expect(page.getByText("Terminal · this worktree")).toHaveCount(0);
    const paneBar = page.locator(".code-terminal-workspace__bar");
    await expect(paneBar.getByRole("button", { name: "Taller" })).toBeVisible();
    await paneBar.getByRole("button", { name: "Taller" }).click();
    await expect(paneBar.getByRole("button", { name: "Shorter" })).toHaveAttribute("aria-pressed", "true");

    // Even at its tallest, the drawer leaves the columns their share of the
    // space they split, and nothing in the columns paints over the pane bar —
    // the bar's own controls still take the click (the regression this caught).
    const split = await page.evaluate(() => ({
      body: document.querySelector(".code-room__body")?.getBoundingClientRect().height ?? 0,
      drawer: document.querySelector('[data-testid="code-terminal-drawer"]')?.getBoundingClientRect().height ?? 0,
    }));
    expect(split.body).toBeGreaterThanOrEqual(Math.floor((split.body + split.drawer) * 0.3) - 1);
    await paneBar.getByRole("button", { name: "Shorter" }).click();
    await expect(paneBar.getByRole("button", { name: "Taller" })).toHaveAttribute("aria-pressed", "false");
  });

  test("11. on a phone-width desk the dock keeps one row of suggestions and the source keeps its height", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await base(page);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await page.locator("[data-code-session-id='s-new']").first().click({ timeout: 30_000 });
    await expect(page.getByTestId("code-workbench")).toBeVisible({ timeout: 30_000 });
    const suggestions = page.getByTestId("code-composer-suggestions");
    await expect(suggestions).toBeVisible();
    const visible = suggestions.locator(".code-composer__suggestion:visible");
    await expect(visible).toHaveCount(2);
    const rows = await visible.evaluateAll((nodes) => new Set(nodes.map((n) => Math.round(n.getBoundingClientRect().top))).size);
    expect(rows).toBe(1);
    await expect(page.getByTestId("code-composer").locator(".code-composer__hint")).toBeHidden();
    // The source viewer is taller than the dock under it.
    const heights = await page.evaluate(() => ({
      viewer: document.querySelector(".code-room__viewer")?.getBoundingClientRect().height ?? 0,
      dock: document.querySelector('[data-testid="code-composer"]')?.getBoundingClientRect().height ?? 0,
    }));
    expect(heights.viewer).toBeGreaterThan(heights.dock);
  });

  test("12. the selected tree row keeps its fill, and a narrow viewer keeps the whole file name", async ({ page }) => {
    // 1280 wide with the session rail showing leaves the viewer narrow.
    await page.setViewportSize({ width: 1280, height: 720 });
    await base(page);
    const desk = await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await page.mouse.move(2, 2);

    // Button/ghost's transparent background used to beat the accent fill, so
    // the selected row showed dark text on nothing once the pointer left.
    const row = page.getByTestId("code-workbench-tree").locator('[data-tree-row][data-selected="true"]');
    await expect(row).toHaveCount(1);
    const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");

    const name = desk.locator(".code-room__viewer .workspace-rail__preview-name");
    await expect(name).toHaveText("flux.ts");
    const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);
    // The Outline action keeps its accessible name even with the word collapsed.
    await expect(desk.getByRole("button", { name: /^Outline, 1 symbol$/ })).toBeVisible();
  });

  // ── Review fixes (#5720) ───────────────────────────────────────────────────

  test("13. the header follows the panel's refresh at once, and the tooltip reads the same figure", async ({ page }) => {
    // An idle session's room subscription does not poll, so only the
    // reconciliation can move the header after the panel refreshes.
    const worktree: ChangesFixture = { current: CHANGED_FILES };
    await base(page, [{ ...NEWEST, status: "idle" }, OLDER], worktree);
    await openDesk(page);
    const diffstat = page.getByTestId("code-desk-diffstat");
    await expect(diffstat).toContainText("+17");
    await expect(diffstat).toHaveAttribute("title", "17 added, 3 removed");

    worktree.current = [
      ...CHANGED_FILES,
      { path: "src/new.ts", status: "untracked", insertions: 8, deletions: 0, changeVersion: "300:300:80" },
    ];
    await page.getByTestId("code-review-rail").getByRole("button", { name: "Refresh working tree changes" }).click();
    await expect(page.getByTestId("code-review-rail")).toContainText("new.ts");
    await expect(diffstat).toContainText("+25", { timeout: 3_000 });
    await expect(diffstat).toHaveAttribute("title", "25 added, 3 removed");
    await expect(page.getByTestId("code-desk-progress")).toHaveText("0 of 3 viewed");
  });

  test("14. a rewrite that keeps the line counts clears the file's viewed tick", async ({ page }) => {
    const worktree: ChangesFixture = { current: CHANGED_FILES };
    await base(page, [{ ...NEWEST, status: "idle" }, OLDER], worktree);
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("switch", { name: "Mark src/flux.ts viewed" }).click();
    await expect(page.getByTestId("code-desk-progress")).toHaveText("1 of 2 viewed");

    // Same status, same +12 −3, new bytes on disk.
    worktree.current = CHANGED_FILES.map((file) =>
      file.path === "src/flux.ts" ? { ...file, changeVersion: "200:200:401" } : file,
    );
    await rail.getByRole("button", { name: "Refresh working tree changes" }).click();
    await expect(page.getByTestId("code-desk-progress")).toHaveText("0 of 2 viewed");
    await expect(rail.getByRole("switch", { name: "Mark src/flux.ts viewed" })).toBeVisible();
  });

  test("15. a failed changes request keeps the listed diffstat instead of reading as clean", async ({ page }) => {
    await base(page, [NEWEST, OLDER], { current: "fail" });
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("code-workbench")).toBeVisible({ timeout: 30_000 });
    // The session list says +12 −3; with no snapshot to contradict it, that stands.
    const diffstat = page.getByTestId("code-desk-diffstat");
    await expect(diffstat).toContainText("+12");
    await expect(diffstat).toContainText("−3");
  });

  // ── Pass 3 fixes (#5729) ───────────────────────────────────────────────────

  test("16. a focused terminal hands back its toggle, and focus lands on the bar", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.getByRole("separator", { name: "Resize the terminal drawer" })).toBeVisible();
    // The harness runs no shell, so stand in for xterm's focused helper
    // textarea inside the drawer — the target every key in a live terminal has.
    await page.evaluate(() => {
      const host = document.querySelector(".code-term__drawer-body");
      const xterm = document.createElement("div");
      xterm.className = "xterm";
      const field = document.createElement("textarea");
      field.className = "xterm-helper-textarea";
      field.setAttribute("aria-label", "Terminal input");
      xterm.append(field);
      host?.append(xterm);
      field.focus();
    });
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".xterm")))).toBe(true);

    // Other desk shortcuts still belong to the shell...
    await page.keyboard.press("ControlOrMeta+p");
    await expect(page.locator("[data-code-picker-panel]")).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".xterm")))).toBe(true);

    // ...but the toggle leaves, and focus lands on the bar that reopens it.
    await page.keyboard.press("ControlOrMeta+Backquote");
    const bar = page.getByRole("button", { name: "Open the terminal drawer" });
    await expect(bar).toBeVisible();
    await expect(bar).toBeFocused();

    // The bar's hint is the bound combo, not a hard-coded ⌃`.
    const hint = await bar.locator(".code-term__kbd").innerText();
    expect(hint.endsWith("`")).toBe(true);
    expect(["⌘`", "Ctrl`"]).toContain(hint);
  });

  test("16b. the terminal toggle can be rebound but never left without a key", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog");
    const terminalRow = dialog.locator(".code-keys__row").filter({ hasText: "Terminal drawer" });
    // It is the way out of a focused terminal: no Unbind.
    await expect(terminalRow.getByRole("button", { name: "Unbind" })).toBeDisabled();
    const before = (await terminalRow.locator(".code-keys__combo").textContent()) ?? "";
    expect(before.length).toBeGreaterThan(0);

    // Another action cannot take its key either.
    const pickerRow = dialog.locator(".code-keys__row").filter({ hasText: "Switch session" });
    await pickerRow.getByRole("button", { name: "Rebind" }).click();
    await page.keyboard.press("ControlOrMeta+Backquote");
    await expect(page.getByText("which always keeps a key")).toBeAttached();
    await expect(terminalRow.locator(".code-keys__combo")).toHaveText(before);
    await expect(pickerRow.locator(".code-keys__combo")).not.toHaveText(before);
  });

  test("17. in light mode the viewer header and a rendered README are readable", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("README.md", { exact: true }).click();
    await expect(page.locator(".code-room__viewer .workspace-rail__preview-name")).toHaveText("README.md");
    await page.evaluate(() => document.documentElement.setAttribute("data-mode", "light"));
    await page.waitForTimeout(300);
    const ratios = await page.evaluate(() => {
      // Canvas round-trip: computed colors arrive as oklch / color-mix.
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      const rgba = (c: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const backdrop = (el: Element | null) => {
        for (; el; el = el.parentElement) {
          const c = rgba(getComputedStyle(el).backgroundColor);
          if (c[3] === 255) return c;
        }
        return [255, 255, 255, 255];
      };
      const ratio = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return 0;
        const a = lum(rgba(getComputedStyle(el).color));
        const b = lum(backdrop(el));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return {
        name: ratio(".code-room__viewer .workspace-rail__preview-name"),
        chip: ratio(".code-room__viewer .workspace-rail__preview-chip"),
        prose: ratio(".code-room__viewer .comux-md p, .code-room__viewer .comux-md h1"),
      };
    });
    // It measured 1.08:1 before the fix.
    expect(ratios.name).toBeGreaterThanOrEqual(4.5);
    expect(ratios.chip).toBeGreaterThanOrEqual(4.5);
    expect(ratios.prose).toBeGreaterThanOrEqual(4.5);
  });

  test("18. opening the Changes panel again costs one request, not a round of refetches", async ({ page }) => {
    // An idle session's room does not poll, so every status request below is
    // one the desk chose to make.
    await base(page, [{ ...NEWEST, status: "idle" }, OLDER]);
    let statusRequests = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/changes" || request.method() !== "GET") return;
      if (["branches", "path", "checkpoints"].some((key) => url.searchParams.has(key))) return;
      statusRequests += 1;
    });
    await openDesk(page);
    await expect(page.getByTestId("code-desk-progress")).toHaveText("0 of 2 viewed");
    await page.waitForTimeout(1_500);
    const settled = statusRequests;
    await page.waitForTimeout(1_500);
    expect(statusRequests).toBe(settled);

    // Away to Pull request and back: the panel remounts and loads once. Its
    // initial [] used to read as a disagreement and refetch both lists.
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await page.waitForTimeout(500);
    const beforeReturn = statusRequests;
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await expect(rail.getByRole("switch", { name: "Mark src/flux.ts viewed" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(statusRequests - beforeReturn).toBe(1);
  });

  // ── Pass 3 medium fixes (#5729) ────────────────────────────────────────────

  const slowSend = (page: Page, ms: number, frames: unknown[]) =>
    page.route("**/api/chat/send", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route
        .fulfill({ contentType: "text/event-stream", body: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") })
        .catch(() => {});
    });

  test("19. Stop before any text says Stopped and gives the ask back", async ({ page }) => {
    await base(page);
    await slowSend(page, 4_000, [{ kind: "assistant_chunk", text: "Late." }, { kind: "done", sessionId: "s-new" }]);
    await openDesk(page);
    const composer = page.getByTestId("code-composer");
    const prompt = composer.getByRole("textbox", { name: "Follow-up" });
    await prompt.fill("Rename the flux module");
    await composer.getByRole("button", { name: "Send" }).click();
    await expect(composer.getByRole("status")).toHaveText(/Replying…/);
    await composer.getByRole("button", { name: "Stop" }).click();
    // It used to vanish without a word and take the typed ask with it.
    await expect(composer.getByRole("status")).toHaveText(/Stopped/);
    await expect(prompt).toHaveValue("Rename the flux module");
    await expect(composer.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("20. a reply that fails partway says Couldn't reply and keeps what arrived", async ({ page }) => {
    await base(page);
    await page.route("**/api/chat/send", (route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Partial answer." })}`, "",
          `data: ${JSON.stringify({ kind: "error", message: "model overloaded" })}`, "", "",
        ].join("\n"),
      }),
    );
    await openDesk(page);
    const composer = page.getByTestId("code-composer");
    await composer.getByRole("textbox", { name: "Follow-up" }).fill("Summarize");
    await composer.getByRole("button", { name: "Send" }).click();
    const reply = page.getByTestId("code-composer-reply");
    // Text plus an error used to read "Replied".
    await expect(reply.getByRole("status")).toHaveText(/Couldn't reply/);
    await expect(reply.getByRole("alert")).toHaveText("model overloaded");
    await expect(reply).toContainText("Partial answer.");
    await expect(composer.getByRole("textbox", { name: "Follow-up" })).toHaveValue("", { timeout: 1_000 });
  });

  test("21. a follow-up in flight survives a session switch, and Stop still works on return", async ({ page }) => {
    await base(page);
    await slowSend(page, 6_000, [{ kind: "assistant_chunk", text: "Finished while you were away." }, { kind: "done", sessionId: "s-new" }]);
    await openDesk(page);
    const composer = () => page.getByTestId("code-composer");
    await composer().getByRole("textbox", { name: "Follow-up" }).fill("Long job");
    await composer().getByRole("button", { name: "Send" }).click();
    await expect(composer().getByRole("status")).toHaveText(/Replying…/);

    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    await expect(composer().getByRole("status")).toHaveCount(0, { timeout: 2_000 });

    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/running/);
    // The run used to be orphaned: idle, Send enabled, Stop unreachable.
    await expect(composer().getByRole("status")).toHaveText(/Replying…/);
    await expect(composer().getByRole("button", { name: "Send" })).toHaveCount(0);
    await composer().getByRole("button", { name: "Stop" }).click();
    await expect(composer().getByRole("status")).toHaveText(/Stopped/);
    await expect(composer().getByRole("textbox", { name: "Follow-up" })).toHaveValue("Long job");
  });

  test("21b. a reply that finishes while the session is off screen is there on return", async ({ page }) => {
    await base(page);
    await slowSend(page, 2_500, [{ kind: "assistant_chunk", text: "Finished while you were away." }, { kind: "done", sessionId: "s-new" }]);
    await openDesk(page);
    const composer = () => page.getByTestId("code-composer");
    await composer().getByRole("textbox", { name: "Follow-up" }).fill("Long job");
    await composer().getByRole("button", { name: "Send" }).click();
    await page.locator("[data-code-session-id='s-old']").first().click();
    await page.waitForTimeout(4_000);
    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(composer().getByRole("status")).toHaveText(/Replied/);
    await expect(page.getByTestId("code-composer-reply")).toContainText("Finished while you were away.");
  });

  test("22. a late response for the session's old root never lands on its new root", async ({ page }) => {
    // The first session list predates enrichment: no worktree root yet, so the
    // room starts on the shared checkout. Events, not timers, force the bug's
    // exact order: the enriched list is served only once the desk has asked
    // for the shared checkout, and that answer is held until the desk has
    // moved on and asked for the worktree.
    const MAIN_FILES = [{ path: "main-only.ts", status: "modified", insertions: 99, deletions: 9, changeVersion: "1:1:1" }];
    const newestGit = (NEWEST as unknown as { git: Record<string, unknown> }).git;
    const early = { ...NEWEST, status: "idle", diff: null, git: { ...newestGit, worktreeRoot: "/repo/alpha", isWorktree: false } };
    const late = { ...NEWEST, status: "idle", diff: null };
    await base(page, [late, OLDER]);
    let askedSharedCheckout = false;
    let oldAnswerReleased = false;
    let releaseOldAnswer: () => void = () => {};
    const worktreeAsked = new Promise<void>((resolve) => (releaseOldAnswer = resolve));
    await page.route("**/api/sessions/list**", (route) =>
      route.fulfill({ json: { ok: true, sessions: askedSharedCheckout ? [late, OLDER] : [early, OLDER] } }),
    );
    await page.route("**/api/changes**", async (route) => {
      const url = new URL(route.request().url());
      if (["branches", "path", "checkpoints"].some((key) => url.searchParams.has(key))) return route.fallback();
      const root = url.searchParams.get("projectRoot");
      if (root === "/repo/alpha") {
        askedSharedCheckout = true;
        await Promise.race([worktreeAsked, new Promise((resolve) => setTimeout(resolve, 30_000))]);
        await new Promise((resolve) => setTimeout(resolve, 500));
        oldAnswerReleased = true;
        return route.fulfill({ json: { ok: true, repo: true, repoRoot: "/repo/alpha", files: MAIN_FILES } }).catch(() => {});
      }
      if (root === WORK_ROOT) releaseOldAnswer();
      return route.fallback();
    });
    await openDesk(page);
    // The race really ran: the shared checkout's slow answer landed after the
    // desk had moved to the worktree.
    await expect.poll(() => oldAnswerReleased, { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("code-desk-diffstat")).toContainText("+17");
    await expect(page.getByTestId("code-desk-progress")).toHaveText("0 of 2 viewed");
    await expect(page.getByTestId("code-review-rail")).not.toContainText("main-only.ts");
  });

  test("23. long names stay distinguishable in tabs and rail rows, and the active tab stays in view", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    const many = Array.from({ length: 14 }, (_, i) => ({
      path: `src/features/really-long-directory-name/component-with-a-very-long-file-name-${i}.tsx`,
      status: "modified",
      insertions: i + 1,
      deletions: 0,
      changeVersion: `${i}:${i}:1`,
    }));
    await base(page, [NEWEST, OLDER], { current: many as typeof CHANGED_FILES });
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-code-session-id='s-new']").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    if (!(await page.getByTestId("code-workbench").isVisible())) await page.locator("[data-code-session-id='s-new']").first().click();
    const tree = page.getByTestId("code-workbench-tree");
    await tree.getByRole("button", { name: /changed/ }).click();
    const rows = tree.locator(".code-tree__changed-row");
    for (let i = 0; i < 14; i++) await rows.nth(i).click();

    // Which character sits at the right edge of each truncated label?
    const tailVisible = (selector: string) =>
      page.evaluate((sel) => {
        // Only labels actually on screen: the strip scrolls to its active tab.
        const onScreen = [...document.querySelectorAll(sel)].filter((label) => {
          const r = label.getBoundingClientRect();
          const scroller = label.closest(".code-tabs, .code-rail__body") ?? document.documentElement;
          const s = scroller.getBoundingClientRect();
          return r.width > 0 && r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom;
        });
        return onScreen.slice(0, 6).map((label) => {
          const text = label.textContent ?? "";
          const box = label.getBoundingClientRect();
          if (label.scrollWidth <= label.clientWidth) return { text, clipped: false, tail: true };
          const range = document.caretRangeFromPoint(box.right - 3, box.top + box.height / 2);
          const offset = range ? range.startOffset : -1;
          return { text, clipped: true, tail: offset >= text.length - 3 };
        });
      }, selector);
    const tabs = await tailVisible(".code-tabs__label");
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((t) => t.clipped)).toBe(true);
    expect(tabs.every((t) => t.tail)).toBe(true);
    const railNames = await tailVisible('[data-testid="code-review-rail"] .session-changes-table-row span:has(> bdi)');
    expect(railNames.length).toBeGreaterThan(0);
    expect(railNames.every((t) => t.tail)).toBe(true);

    const activeInView = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="code-open-file-tabs"]')!;
      const active = strip.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
      const box = strip.getBoundingClientRect();
      return { overflowing: strip.scrollWidth > strip.clientWidth, inView: active.left >= box.left - 1 && active.right <= box.right + 1 };
    });
    expect(activeInView).toEqual({ overflowing: true, inView: true });
  });

  test("24. every desk control is at least 24px, at desktop and phone widths", async ({ page }) => {
    const SELECTORS = [
      ".code-tabs__close",
      '[data-testid="code-review-rail"] .code-rail__action',
      ".session-changes__viewed",
      '.code-room__viewer .workspace-rail__preview-action',
      ".code-rail__next",
      ".code-tree__filter",
      ".code-room__chip--link",
      ".code-rail__tab",
      ".code-terminal-workspace__action",
    ];
    const measure = () =>
      page.evaluate((selectors) => {
        const small: string[] = [];
        let seen = 0;
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            seen += 1;
            if (r.width < 23.5 || r.height < 23.5) small.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return { seen, small };
      }, SELECTORS);

    await page.setViewportSize({ width: 1440, height: 900 });
    await base(page);
    await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    const desktop = await measure();
    expect(desktop.seen).toBeGreaterThan(10);
    expect(desktop.small).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const review = page.getByTestId("code-workbench").getByRole("tab", { name: "Review" });
    if (await review.isVisible()) await review.click();
    const phone = await measure();
    expect(phone.seen).toBeGreaterThan(4);
    expect(phone.small).toEqual([]);
  });
});

