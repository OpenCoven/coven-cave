import { expect, test, type Locator, type Page } from "@playwright/test";

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

/** A desk narrower than the three-column split, deep-linked past the session
 *  list so the step switcher is what shows. */
async function openNarrowDesk(page: Page) {
  await page.goto("/?mode=code&session=s-new", { waitUntil: "domcontentloaded" });
  const steps = page.getByRole("tablist", { name: "Workbench step" });
  await expect(steps).toBeVisible({ timeout: 30_000 });
  return steps;
}

/** The tab names a panel that exists, is a tabpanel, and is labelled by it. */
async function expectTabControlsPanel(page: Page, tab: Locator) {
  const panelId = await tab.getAttribute("aria-controls");
  const tabId = await tab.getAttribute("id");
  expect(panelId, "the selected tab names its panel").toBeTruthy();
  expect(tabId, "the tab has an id for its panel to point back at").toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", tabId!);
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

    await rail.getByRole("switch", { name: "Viewed: src/flux.ts" }).click();
    await expect(progress).toHaveText("1 of 2 viewed");
    await next.click();
    await expect(viewerName).toHaveText("retry.ts");
    await rail.getByRole("switch", { name: "Viewed: src/retry.ts" }).click();
    await expect(progress).toHaveText("2 of 2 viewed");
    await expect(progress).toHaveAttribute("data-complete", "true");
    await expect(next).toBeDisabled();

    // The rail collapsed to its spine still leaves the answer in the header.
    await page.getByRole("button", { name: "Hide the review rail" }).click();
    await expect(page.getByTestId("code-review-rail")).toHaveCount(0);
    await expect(progress).toHaveText("2 of 2 viewed");

    // Unmarking reopens the walk.
    await page.getByRole("button", { name: "Show the review rail" }).click();
    await page.getByTestId("code-review-rail").getByRole("switch", { name: "Viewed: src/flux.ts" }).click();
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
    await page.getByTestId("code-review-rail").getByRole("switch", { name: "Viewed: src/flux.ts" }).click();
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
    await rail.getByRole("switch", { name: "Viewed: src/flux.ts" }).click();
    await expect(page.getByTestId("code-desk-progress")).toHaveText("1 of 2 viewed");

    // Same status, same +12 −3, new bytes on disk.
    worktree.current = CHANGED_FILES.map((file) =>
      file.path === "src/flux.ts" ? { ...file, changeVersion: "200:200:401" } : file,
    );
    await rail.getByRole("button", { name: "Refresh working tree changes" }).click();
    await expect(page.getByTestId("code-desk-progress")).toHaveText("0 of 2 viewed");
    await expect(rail.getByRole("switch", { name: "Viewed: src/flux.ts" })).toBeVisible();
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
    // Measure the README once it has rendered; the header shows its name
    // before the body arrives.
    await expect(page.locator(".code-room__viewer .comux-md p, .code-room__viewer .comux-md h1").first()).toBeVisible();
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

    // Away to Pull request and back: the panel remounts and loads at most once.
    // Its initial [] used to read as a disagreement and refetch both lists.
    // Since #5745 a mount within the shared gate's 4s window reuses the read
    // the desk already made, so this can be zero.
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await page.waitForTimeout(500);
    const beforeReturn = statusRequests;
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await expect(rail.getByRole("switch", { name: "Viewed: src/flux.ts" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(statusRequests - beforeReturn).toBeLessThanOrEqual(1);
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

  // ── Pass 3 low fixes (#5729) ───────────────────────────────────────────────

  test("25. a failed changes request reads as unavailable in the tree, and a file that fails to open offers Retry", async ({ page }) => {
    await base(page, [NEWEST, OLDER], { current: "fail" });
    let failNext = true;
    await page.route("**/api/project-file**", (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (failNext) {
        failNext = false;
        return route.fulfill({ json: { ok: false, error: "EACCES: permission denied" } });
      }
      return route.fulfill({ json: { ok: true, kind: "text", content: `// ${name} loaded\n`, size: 20 } });
    });
    const desk = await openDesk(page);
    const filter = page.getByTestId("code-workbench-tree").locator(".code-tree__filter");
    await expect(filter).toHaveText("Changes unavailable");
    await expect(filter).toBeDisabled();
    await expect(filter).toHaveAttribute("title", "Couldn't load this worktree's changes");

    await page.getByTestId("code-workbench-tree").getByText("README.md", { exact: true }).click();
    const failure = desk.locator(".workspace-rail__preview-error");
    await expect(failure.locator(".workspace-rail__preview-error-title")).toHaveText(/^Couldn.t open README\.md$/);
    await expect(failure).toContainText("EACCES: permission denied");
    await failure.getByRole("button", { name: "Retry" }).click();
    await expect(failure).toHaveCount(0);
    await expect(desk.getByText("// README.md loaded")).toBeVisible();
  });

  test("26. a session with no familiar says why it can't send, and offers Chat", async ({ page }) => {
    await base(page, [{ ...NEWEST, familiarId: null }, OLDER]);
    await openDesk(page);
    const composer = page.getByTestId("code-composer");
    const note = composer.locator(".code-composer__note");
    await expect(note).toContainText("No familiar is attached to this session");
    await expect(note.getByRole("button", { name: "Continue in Chat" })).toBeVisible();
    const noteId = await note.getAttribute("id");
    const describedBy = (await composer.getByRole("textbox", { name: "Follow-up" }).getAttribute("aria-describedby")) ?? "";
    expect(describedBy.split(" ")).toContain(noteId);
    // Suggestions would only fill a field that cannot send.
    await expect(page.getByTestId("code-composer-suggestions")).toHaveCount(0);
  });

  test("27. desk shortcuts stay off the app's keys: the prompt is on Mod+I, help starts unbound, app keys are refused", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await page.keyboard.press("ControlOrMeta+i");
    await expect(page.getByTestId("code-composer").getByRole("textbox", { name: "Follow-up" })).toBeFocused();

    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog");
    const helpRow = dialog.locator(".code-keys__row").filter({ hasText: "This dialog" });
    await expect(helpRow.locator(".code-keys__combo")).toHaveText("unbound");
    // "?" belongs to the app's sheet, whose handler runs first: refused, with a reason.
    await helpRow.getByRole("button", { name: "Rebind" }).click();
    await page.keyboard.press("?");
    await expect(page.getByText("That shortcut is reserved for the app.")).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(helpRow.locator(".code-keys__combo")).toHaveText("unbound");
    // The app's keys are listed as taken.
    await expect(dialog.getByText("App-wide — fixed")).toBeVisible();
    await expect(dialog.locator(".code-keys__row").filter({ hasText: "Quick chat" })).toBeVisible();
    await expect(dialog.locator(".code-keys__row").filter({ hasText: "Command palette" })).toBeVisible();
  });

  test("28. on a narrow desk the Changes, PR and Files shortcuts bring their step forward", async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 900 });
    await base(page);
    const steps = await openNarrowDesk(page);
    // Start from Source, then leave focus on the page rather than a tab.
    await steps.getByRole("tab", { name: "Source pane" }).click();
    await expect(steps.getByRole("tab", { name: "Source pane" })).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press("ControlOrMeta+Shift+C");
    await expect(steps.getByRole("tab", { name: "Review pane" })).toHaveAttribute("aria-selected", "true");
    const rail = page.getByTestId("code-review-rail");
    await expect(rail.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ControlOrMeta+Shift+R");
    await expect(rail.getByRole("tab", { name: "Pull request" })).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(steps.getByRole("tab", { name: "Files pane" })).toHaveAttribute("aria-selected", "true");
    // The tree itself, not the filter button above it, even though the tree
    // mounts with this step and lists itself only after its first load. The
    // tree hands its focus to a row.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          return Boolean(active?.matches("[data-tree-row]") && active.closest('[data-testid="code-workbench-tree"] [role="tree"]'));
        }),
      )
      .toBe(true);
  });

  test("29. the file tree lets Alt+Up and Alt+Down through to the open-file shortcuts", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    const viewerName = desk.locator(".workspace-rail__preview-name");
    await tree.getByText("README.md", { exact: true }).click();
    await tree.getByText("flux.ts", { exact: true }).click();
    await expect(viewerName).toHaveText("flux.ts");
    // Focus is in the tree, where a bare arrow moves between rows.
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="code-workbench-tree"]')))).toBe(true);
    await page.keyboard.press("Alt+ArrowUp");
    await expect(viewerName).toHaveText("README.md");
    await page.keyboard.press("Alt+ArrowDown");
    await expect(viewerName).toHaveText("flux.ts");
  });

  test("30. focus stays put when a revert is cancelled, a tab is closed, or a follow-up is sent", async ({ page }) => {
    await base(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/chat/send", async (route) => {
      await held;
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Ready." })}`, "",
          `data: ${JSON.stringify({ kind: "done", sessionId: "s-new" })}`, "", "",
        ].join("\n"),
      });
    });
    await openDesk(page);

    // The confirm takes focus when it opens, and Cancel gives it back.
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("button", { name: "Revert src/flux.ts" }).click();
    const cancel = rail.getByRole("group", { name: "Confirm file revert" }).getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rail.getByRole("button", { name: "Revert src/flux.ts" })).toBeFocused();

    // Closing a tab with its button hands focus to the neighbouring tab.
    const tree = page.getByTestId("code-workbench-tree");
    await tree.getByText("README.md", { exact: true }).click();
    await tree.getByText("flux.ts", { exact: true }).click();
    const tabs = page.getByTestId("code-open-file-tabs");
    await tabs.getByRole("button", { name: "Close flux.ts" }).click();
    await expect(tabs.getByRole("tab", { name: /README\.md/ })).toBeFocused();

    // Sending keeps the field focused while the reply streams.
    const prompt = page.getByTestId("code-composer").getByRole("textbox", { name: "Follow-up" });
    await prompt.fill("Check the retry path.");
    await prompt.press("ControlOrMeta+Enter");
    await expect(prompt).toHaveAttribute("readonly", "");
    await expect(prompt).toBeFocused();
    release();
    await expect(page.getByTestId("code-composer-reply")).toHaveAttribute("data-phase", "done");
    await expect(prompt).not.toHaveAttribute("readonly", "");
    await expect(prompt).toBeFocused();
  });

  test("31. the rail can't starve the viewer, and the narrow Review step has no dead resize controls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await base(page);
    await openDesk(page);
    const grip = page.getByRole("separator", { name: "Resize the review rail" });
    await grip.focus();
    for (let i = 0; i < 24; i += 1) await page.keyboard.press("Shift+ArrowLeft");
    const viewer = await page.locator(".code-room__viewer").evaluate((el) => el.getBoundingClientRect().width);
    expect(viewer).toBeGreaterThanOrEqual(379);

    // The widen toggle keeps one name; its pressed state says which way it is.
    const widen = page.getByRole("button", { name: "Widen the rail" });
    await expect(widen).toHaveAttribute("aria-pressed", "true");
    await widen.click();
    await expect(page.getByRole("button", { name: "Widen the rail" })).toHaveAttribute("aria-pressed", "false");

    await page.setViewportSize({ width: 760, height: 900 });
    const steps = await openNarrowDesk(page);
    await steps.getByRole("tab", { name: "Review pane" }).click();
    await expect(page.getByTestId("code-review-rail")).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize the review rail" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Widen the rail" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hide the review rail" })).toBeVisible();
  });

  test("32. each desk tablist has one tab stop, arrows move it, and each tab names its panel", async ({ page }) => {
    await base(page);
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    const railTabs = rail.getByRole("tablist", { name: "Review surface" });
    await expect(railTabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    const changes = railTabs.getByRole("tab", { name: /Changes/ });
    await expectTabControlsPanel(page, changes);
    await changes.focus();
    await page.keyboard.press("ArrowRight");
    const pr = railTabs.getByRole("tab", { name: "Pull request" });
    await expect(pr).toBeFocused();
    await expect(pr).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(railTabs.getByRole("tab", { name: "Filesystem" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(changes).toBeFocused();
    await expect(changes).toHaveAttribute("aria-selected", "true");

    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    const fileTabs = page.getByTestId("code-open-file-tabs");
    await expectTabControlsPanel(page, fileTabs.getByRole("tab", { name: /flux\.ts/ }));
    // One tab stop for the strip: close buttons are clicked or reached by
    // Delete on the tab, which says so.
    await expect(fileTabs.getByRole("button", { name: "Close flux.ts" })).toHaveAttribute("tabindex", "-1");
    await expect(fileTabs.getByRole("tab", { name: /flux\.ts/ })).toHaveAttribute("aria-keyshortcuts", "Delete");

    // Toggles keep one name; the state is in aria-checked / aria-pressed.
    const viewed = rail.getByRole("switch", { name: "Viewed: src/flux.ts" });
    await expect(viewed).toHaveAttribute("aria-checked", "false");
    await viewed.click();
    await expect(rail.getByRole("switch", { name: "Viewed: src/flux.ts" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    const paneBar = page.locator(".code-terminal-workspace__bar");
    await paneBar.getByRole("button", { name: "Split terminal right" }).click();
    for (const name of ["Broadcast input", "Focus current terminal"]) {
      const toggle = paneBar.getByRole("button", { name, exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await toggle.click();
      await expect(paneBar.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    }

    // The narrow steps rove too, and only the shown step's panel is named.
    await page.setViewportSize({ width: 760, height: 900 });
    const steps = await openNarrowDesk(page);
    await expect(steps.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    const source = steps.getByRole("tab", { name: "Source pane" });
    await source.click();
    await expect(source).toHaveAttribute("tabindex", "0");
    await expectTabControlsPanel(page, source);
    await source.focus();
    await page.keyboard.press("ArrowRight");
    const review = steps.getByRole("tab", { name: "Review pane" });
    await expect(review).toBeFocused();
    await expect(review).toHaveAttribute("aria-selected", "true");
    await expectTabControlsPanel(page, review);
    await expect(steps.getByRole("tab", { name: "Files pane" })).not.toHaveAttribute("aria-controls", /.+/);
  });

  test("33. in a project inside a larger repo, the empty viewer opens changed files at their real path", async ({ page }) => {
    const sub = mkSession({
      id: "s-sub",
      title: "Tune the app package",
      project_root: "/repo/mono/packages/app",
      updated_at: NEW_ISO,
      familiarWorkspace: false,
      git: { branch: "main", repositoryUrl: "https://github.com/acme/mono", isWorktree: false },
    });
    await base(page, [sub]);
    // Change paths are relative to the git toplevel, two levels above the project.
    await page.route("**/api/changes**", (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || [...url.searchParams.keys()].some((key) => key !== "projectRoot")) {
        return route.fallback();
      }
      return route.fulfill({
        json: {
          ok: true,
          repo: true,
          repoRoot: "/repo/mono",
          files: [{ path: "packages/app/src/flux.ts", status: "modified", insertions: 2, deletions: 1 }],
        },
      });
    });
    const requested: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/project-file")) requested.push(new URL(request.url()).searchParams.get("path") ?? "");
    });
    // A plain checkout is not "Reviewable", so pick it from All local.
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await page.getByRole("group", { name: "Session scope" }).getByRole("button", { name: /All local/ }).click({ timeout: 30_000 });
    await page.locator("[data-code-session-id='s-sub']").first().click();
    const desk = page.getByTestId("code-workbench");
    await expect(desk).toBeVisible({ timeout: 30_000 });
    await desk.locator(".workspace-rail__empty-change").filter({ hasText: "flux.ts" }).click();
    await expect.poll(() => requested).toContain("/repo/mono/packages/app/src/flux.ts");
    expect(requested).not.toContain("/repo/mono/packages/app/packages/app/src/flux.ts");
    // The tab is the changed file, so it carries the tree's letter.
    await expect(page.getByTestId("code-open-file-tabs").getByRole("tab", { name: /flux\.ts/ }).locator(".code-tabs__status")).toHaveText("M");
  });

  test("34. a failed checkpoint names the action that failed, not revert", async ({ page }) => {
    await base(page);
    await page.route("**/api/changes**", (route) => {
      const request = route.request();
      if (request.method() === "POST" && (request.postDataJSON() as { action?: string })?.action === "checkpoint") {
        return route.fulfill({ status: 500, json: { ok: false, error: "disk full" } });
      }
      return route.fallback();
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("button", { name: "Save patch checkpoint" }).click();
    await expect(rail.getByText("Couldn't save a checkpoint: disk full")).toBeVisible();
    await expect(rail.getByText(/revert:/)).toHaveCount(0);
    await rail.getByRole("button", { name: "Dismiss error" }).click();
    await expect(rail.getByText(/Couldn't save a checkpoint/)).toHaveCount(0);
  });

  // ── Pass 4 high fixes (#5745) ──────────────────────────────────────────────

  test("35. an unsaved edit survives a tab switch, Escape and a session round trip, and its tab says so", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    const tabs = page.getByTestId("code-open-file-tabs");
    const editor = desk.locator(".cm-content");
    await tree.getByText("README.md", { exact: true }).click();
    await tree.getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n// KEEP-ME");
    const fluxTab = tabs.getByRole("tab", { name: /flux\.ts/ });
    await expect(fluxTab.getByTestId("code-tab-unsaved")).toBeVisible();
    await expect(fluxTab).toHaveAccessibleName(/unsaved changes/);

    // Another tab and back: the edit is where it was left.
    await tabs.getByRole("tab", { name: /README\.md/ }).click();
    await expect(desk.locator(".workspace-rail__preview-name")).toHaveText("README.md");
    await expect(editor).toHaveCount(0);
    await fluxTab.click();
    await expect(editor).toContainText("KEEP-ME");

    // Escape leaves the editor for Save; it does not discard.
    await editor.click();
    await page.keyboard.press("Escape");
    await expect(desk.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await expect(editor).toContainText("KEEP-ME");

    // A session round trip remounts the desk; the edit comes back with it.
    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/running/);
    await expect(page.getByTestId("code-workbench").locator(".cm-content")).toContainText("KEEP-ME");

    // Cancel is the one way to throw it away.
    await page.getByTestId("code-workbench").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByTestId("code-workbench").locator(".cm-content")).toHaveCount(0);
    await expect(page.getByTestId("code-workbench").locator(".workspace-rail__preview-body")).not.toContainText("KEEP-ME");
    await expect(page.getByTestId("code-tab-unsaved")).toHaveCount(0);
  });

  test("36. a save in flight settles the file it was sent for, and keeps what was typed meanwhile", async ({ page }) => {
    await base(page);
    const posts: { path?: string; content?: string }[] = [];
    let release: () => void = () => {};
    await page.route("**/api/project-file", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().postDataJSON());
      await new Promise<void>((resolve) => (release = resolve));
      await route.fulfill({ json: { ok: true, size: 80, version: `saved-${posts.length}` } });
    });
    const desk = await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    const tabs = page.getByTestId("code-open-file-tabs");
    const editor = desk.locator(".cm-content");
    const body = desk.locator(".workspace-rail__preview-body");
    await tree.getByText("README.md", { exact: true }).click();
    await tree.getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n// SAVED-INTO-FLUX");
    await desk.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    // The request cannot be called back, so the edit cannot be discarded under it.
    await expect(desk.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();

    // Move to README.md while the save is held, then let it land.
    await tabs.getByRole("tab", { name: /README\.md/ }).click();
    await expect(desk.locator(".workspace-rail__preview-name")).toHaveText("README.md");
    await expect(body).toContainText("README.md");
    release();
    await page.waitForTimeout(400);
    expect(posts[0].path).toMatch(/\/src\/flux\.ts$/);
    await expect(body).not.toContainText("SAVED-INTO-FLUX");
    await expect(desk.getByText("Saved", { exact: true })).toHaveCount(0);

    // Keys typed while a save is in flight stay in the edit.
    await tabs.getByRole("tab", { name: /flux\.ts/ }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n// FIRST");
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => posts.length).toBe(2);
    await page.keyboard.type("\n// TYPED-WHILE-SAVING");
    release();
    await page.waitForTimeout(400);
    expect(posts[1].content).toContain("FIRST");
    expect(posts[1].content).not.toContain("TYPED-WHILE-SAVING");
    await expect(editor).toContainText("TYPED-WHILE-SAVING");
    await expect(tabs.getByRole("tab", { name: /flux\.ts/ }).getByTestId("code-tab-unsaved")).toBeVisible();
  });

  test("37. a save names its starting version, and a file changed on disk is a conflict, not an overwrite", async ({ page }) => {
    await base(page);
    // A server double with the real version contract: reads return a version,
    // a save naming an older version is refused with 409.
    const disk = { text: "// flux.ts\nexport const v = 1;\n", version: 1 };
    const posts: { content?: string; expectedVersion?: string }[] = [];
    await page.route("**/api/project-file**", async (route) => {
      const request = route.request();
      if (!new URL(request.url()).searchParams.get("path")?.endsWith("flux.ts") && request.method() === "GET") return route.fallback();
      if (request.method() === "GET") {
        return route.fulfill({ json: { ok: true, kind: "text", content: disk.text, size: disk.text.length, version: `v${disk.version}` } });
      }
      const body = request.postDataJSON() as { content: string; expectedVersion?: string };
      posts.push(body);
      if (body.expectedVersion && body.expectedVersion !== `v${disk.version}`) {
        return route.fulfill({ status: 409, json: { ok: false, error: "file changed on disk", conflict: true, version: `v${disk.version}` } });
      }
      disk.text = body.content;
      disk.version += 1;
      return route.fulfill({ json: { ok: true, size: disk.text.length, version: `v${disk.version}` } });
    });
    const desk = await openDesk(page);
    const editor = desk.locator(".cm-content");
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// mine");

    // The agent rewrites the file meanwhile.
    disk.text = "// flux.ts\nexport const v = 2; // the agent's change\n";
    disk.version += 1;
    await page.keyboard.press("ControlOrMeta+s");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].expectedVersion).toBe("v1");
    await expect(desk.getByText("This file changed on disk since you started editing.")).toBeVisible();
    expect(disk.text).toContain("the agent's change");
    await expect(editor).toContainText("// mine");
    await expect(desk.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    // Overwrite is a deliberate choice: it writes my edit over the newer file.
    await desk.getByRole("button", { name: "Overwrite" }).click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].expectedVersion).toBeUndefined();
    await expect(editor).toHaveCount(0);
    expect(disk.text).toContain("// mine");

    // Reload is the other: drop my edit and read the file as it is now.
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// mine again");
    disk.text = "// flux.ts\nexport const v = 3; // the agent again\n";
    disk.version += 1;
    await page.keyboard.press("ControlOrMeta+s");
    await expect(desk.getByText("This file changed on disk since you started editing.")).toBeVisible();
    await desk.getByRole("button", { name: "Reload" }).click();
    await expect(editor).toHaveCount(0);
    await expect(desk.locator(".workspace-rail__preview-body")).toContainText("the agent again");
  });

  test("38. the open file is read again when the agent changes it", async ({ page }) => {
    const fixture = { current: CHANGED_FILES as typeof CHANGED_FILES | "fail" };
    await base(page, [NEWEST, OLDER], fixture);
    let fluxText = "// flux.ts version one\n";
    await page.route("**/api/project-file**", (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      if (route.request().method() !== "GET" || !path.endsWith("flux.ts")) return route.fallback();
      return route.fulfill({ json: { ok: true, kind: "text", content: fluxText, size: fluxText.length } });
    });
    const desk = await openDesk(page);
    const body = desk.locator(".workspace-rail__preview-body");
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await expect(body).toContainText("version one");

    fluxText = "// flux.ts version two\n";
    fixture.current = [{ ...CHANGED_FILES[0], insertions: 14, changeVersion: "300:300:700" }, CHANGED_FILES[1]];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(body).toContainText("version two", { timeout: 20_000 });
    await expect(desk.locator(".workspace-rail__preview-name")).toHaveText("flux.ts");
  });

  test("39. leaving the desk for another tab still warns before a reload drops an unsaved edit", async ({ page }) => {
    await base(page);
    const desk = await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await desk.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\n// DO-NOT-LOSE");
    // The Work tab unmounts the desk, and the viewer with it.
    await page.getByRole("tablist", { name: "Code surface" }).getByRole("tab", { name: "Work" }).click();
    await expect(page.getByTestId("code-workbench")).toHaveCount(0);
    const dialog = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    const prompt = await dialog;
    expect(prompt.type()).toBe("beforeunload");
    await prompt.dismiss();
  });

  // ── Pass 4 medium fixes (#5745) ────────────────────────────────────────────

  test("40. a diff re-expanded after its file changed is read again, never shown stale", async ({ page }) => {
    const fixture = { current: CHANGED_FILES as typeof CHANGED_FILES | "fail" };
    await base(page, [NEWEST, OLDER], fixture);
    let diffVersion = 1;
    const diffGets: string[] = [];
    await page.route("**/api/changes**", (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" || !url.searchParams.has("path")) return route.fallback();
      diffGets.push(url.searchParams.get("path") ?? "");
      return route.fulfill({ json: { ok: true, diff: `--- a/src/flux.ts\n+++ b/src/flux.ts\n@@ -1 +1 @@\n-old\n+DIFF-V${diffVersion}\n` } });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    const row = rail.locator('button[aria-expanded][title="src/flux.ts"]');
    await row.click();
    await expect(rail).toContainText("DIFF-V1");
    await row.click();
    // The agent edits flux.ts while it is collapsed.
    diffVersion = 2;
    fixture.current = [{ ...CHANGED_FILES[0], insertions: 20, changeVersion: "200:200:500" }, CHANGED_FILES[1]];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(rail).toContainText("+20", { timeout: 15_000 });
    const before = diffGets.length;
    await row.click();
    await expect(rail).toContainText("DIFF-V2");
    await expect(rail).not.toContainText("DIFF-V1");
    expect(diffGets.length).toBeGreaterThan(before);

    // A rewrite that keeps the line counts still refreshes the open diff:
    // only the change stamp moves (#5751 review).
    diffVersion = 3;
    fixture.current = [{ ...CHANGED_FILES[0], insertions: 20, changeVersion: "300:300:500" }, CHANGED_FILES[1]];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(rail).toContainText("DIFF-V3", { timeout: 15_000 });
  });

  test("41. a half-typed commit message and Create PR survive the rail switching tabs", async ({ page }) => {
    await base(page);
    await page.route("**/api/changes", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "commit") return route.fulfill({ json: { ok: true, sha: "abc1234", headOid: "a".repeat(40), branch: "feat/flux", onDefaultBranch: false } });
      return route.fulfill({ status: 409, json: { ok: false, error: "blocked" } });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    const message = rail.getByRole("textbox", { name: "Commit message" });
    await message.fill("Half a thought");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await expect(rail.getByRole("textbox", { name: "Commit message" })).toHaveValue("Half a thought");

    await rail.getByRole("textbox", { name: "Commit message" }).fill("Wire the flux capacitor");
    await rail.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Create PR" })).toBeVisible();
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await expect(rail.getByRole("button", { name: "Create PR" })).toBeVisible();
  });

  test("42. a commit names the list it reviewed, and Create PR names the commit", async ({ page }) => {
    await base(page);
    const posts: Record<string, unknown>[] = [];
    let refuseFirst = true;
    await page.route("**/api/changes", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posts.push(body);
      if (body.action === "commit" && refuseFirst) {
        refuseFirst = false;
        return route.fulfill({ status: 409, json: { ok: false, stale: true, error: "the working tree changed since you reviewed it; review the new changes, then commit" } });
      }
      if (body.action === "commit") return route.fulfill({ json: { ok: true, sha: "abc1234", headOid: "a".repeat(40), branch: "feat/flux", onDefaultBranch: false } });
      if (body.action === "create-pr") return route.fulfill({ json: { ok: true, url: "https://github.com/acme/alpha/pull/8" } });
      return route.fulfill({ status: 409, json: { ok: false, error: "blocked" } });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("textbox", { name: "Commit message" }).fill("Wire the flux capacitor");
    await rail.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(rail.getByText(/Couldn't commit: the working tree changed since you reviewed it/)).toBeVisible();
    expect(posts[0].expectedChanges).toEqual([
      { path: "src/flux.ts", changeVersion: "100:100:400" },
      { path: "src/retry.ts", changeVersion: "100:100:90" },
    ]);
    // The message survives the refusal; commit again.
    await rail.getByRole("button", { name: "Commit", exact: true }).click();
    await rail.getByRole("button", { name: "Create PR" }).click();
    await rail.getByRole("button", { name: "Create pull request" }).click();
    await expect.poll(() => posts.find((post) => post.action === "create-pr")).toBeTruthy();
    const createPr = posts.find((post) => post.action === "create-pr")!;
    expect(createPr.expectedHead).toBe("a".repeat(40));
    expect(createPr.expectedBranch).toBe("feat/flux");
  });

  test("43. the rail merges only on passing checks, pinned to the head they ran on", async ({ page }) => {
    const live = { ...NEWEST, pullRequest: { ...(NEWEST as unknown as { pullRequest: Record<string, unknown> }).pullRequest, attribution: "branch" } };
    await base(page, [live, OLDER]);
    const head = "b".repeat(40);
    let rollup: "failing" | "passing" = "failing";
    let checksDown = true;
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    await page.route("**/api/queue/**", (route) => route.fulfill({ json: { ok: true, items: [], prs: [], issues: [] } }));
    await page.route("**/api/github/**", (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        posts.push({ path: url.pathname, body: route.request().postDataJSON() });
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.endsWith("/checks")) {
        if (checksDown) return route.fulfill({ status: 502, json: { ok: false, error: "GitHub is unavailable" } });
        return route.fulfill({ json: { ok: true, authed: true, sha: head, rollup, runs: [{ name: "ci", status: "completed", conclusion: rollup === "failing" ? "failure" : "success" }], statuses: [] } });
      }
      return route.fulfill({ json: { ok: true, authed: true, canResolve: true, issueComments: [], reviewThreads: [], reviews: [] } });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    // No checks, no head: a review would land on whatever commit is current.
    await expect(rail.getByText("Review and merge are off: the checks couldn't be loaded.")).toBeVisible();
    await expect(rail.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(rail.getByRole("button", { name: "Squash merge" })).toBeDisabled();

    checksDown = false;
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await expect(rail.getByRole("button", { name: "Squash merge" })).toBeDisabled();
    await expect(rail.getByText("Merge is off: checks are failing.")).toBeVisible();
    // Failing checks don't stop a review of the head they ran on.
    await expect(rail.getByRole("button", { name: "Approve" })).toBeEnabled();

    // The checks pass; the panel reads them again when it mounts.
    rollup = "passing";
    await rail.getByRole("tab", { name: /Changes/ }).click();
    await rail.getByRole("tab", { name: "Pull request" }).click();
    const merge = rail.getByRole("button", { name: "Squash merge" });
    await expect(merge).toBeEnabled();
    await rail.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => posts.find((post) => post.path.endsWith("/review"))).toBeTruthy();
    expect(posts.find((post) => post.path.endsWith("/review"))!.body.headSha).toBe(head);
    await merge.click();
    await rail.getByRole("button", { name: "Confirm squash merge" }).click();
    await expect.poll(() => posts.find((post) => post.path.endsWith("/merge"))).toBeTruthy();
    expect(posts.find((post) => post.path.endsWith("/merge"))!.body.headSha).toBe(head);
  });

  test("44. split terminals come back after a session round trip", async ({ page }) => {
    await base(page);
    await openDesk(page);
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await page.locator(".code-terminal-workspace__bar").getByRole("button", { name: "Split terminal right" }).click();
    const panes = page.locator('[data-testid="code-terminal-workspace"] section[aria-label^="Terminal "]');
    await expect(panes).toHaveCount(2);
    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    await expect(panes).toHaveCount(1);
    await page.locator("[data-code-session-id='s-new']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/running/);
    await expect(panes).toHaveCount(2);
  });

  test("45. saving on an idle session refreshes its changes at once", async ({ page }) => {
    await base(page);
    await page.route("**/api/project-file", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({ json: { ok: true, size: 60, version: "v2" } });
    });
    await openDesk(page);
    await page.locator("[data-code-session-id='s-old']").first().click();
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    const desk = page.getByTestId("code-workbench");
    await page.getByTestId("code-workbench-tree").getByText("README.md", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await desk.locator(".cm-content").click();
    await page.keyboard.type("// probe ");
    const gets: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/changes" && request.method() === "GET" && !url.searchParams.has("path")) gets.push(url.search);
    });
    await desk.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => gets.length, { timeout: 3000 }).toBeGreaterThan(0);
  });

  test("46. opening the session inspector moves focus into it", async ({ page }) => {
    await base(page);
    await openDesk(page);
    const trigger = page.getByRole("button", { name: /Session inspector/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest(".code-room__inspector"))))
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("47. the session picker is a combobox, and focus survives picking and the full PR view", async ({ page }) => {
    await base(page);
    await page.route("**/api/queue/**", (route) => route.fulfill({ json: { ok: true, items: [], prs: [], issues: [] } }));
    await page.route("**/api/github/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/checks")) return route.fulfill({ json: { ok: true, authed: true, sha: "c".repeat(40), rollup: "passing", runs: [], statuses: [] } });
      return route.fulfill({ json: { ok: true, authed: true, canResolve: true, issueComments: [], reviewThreads: [], reviews: [], commits: [] } });
    });
    await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();

    // Full PR view: in on Back, out to the control that opened it.
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await rail.getByRole("button", { name: "Full PR view" }).click();
    const back = page.getByRole("button", { name: "Back to files" });
    await expect(back).toBeFocused({ timeout: 15_000 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-review-rail").getByRole("button", { name: "Full PR view" })).toBeFocused();

    // The picker: arrows move the active option the field points at.
    await page.keyboard.press("ControlOrMeta+p");
    const search = page.getByRole("combobox", { name: /Search sessions/ });
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute("aria-expanded", "true");
    const listboxId = await search.getAttribute("aria-controls");
    await expect(page.locator(`[id="${listboxId}"]`)).toHaveAttribute("role", "listbox");
    const first = await search.getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    const second = await search.getAttribute("aria-activedescendant");
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    const activeOption = page.locator(`[id="${second}"]`);
    await expect(activeOption).toHaveAttribute("aria-selected", "true");
    await expect(activeOption).toHaveAttribute("data-code-session-id", "s-old");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-desk-activity")).toHaveText(/idle/);
    // The desk remounted for the new session; focus lands on its picker.
    await expect(page.getByTestId("code-workbench").locator(".code-picker__trigger")).toBeFocused();
  });

  test("48. the full PR view stays put when a poll briefly loses the pull request", async ({ page }) => {
    const live = JSON.parse(JSON.stringify(NEWEST)) as Record<string, unknown>;
    await base(page, [live, OLDER]);
    await page.route("**/api/queue/**", (route) => route.fulfill({ json: { ok: true, items: [], prs: [], issues: [] } }));
    await page.route("**/api/github/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/checks")) return route.fulfill({ json: { ok: true, authed: true, sha: "c".repeat(40), rollup: "passing", runs: [], statuses: [] } });
      return route.fulfill({ json: { ok: true, authed: true, canResolve: true, issueComments: [], reviewThreads: [], reviews: [], commits: [] } });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await rail.getByRole("button", { name: "Full PR view" }).click();
    await expect(page.getByRole("button", { name: "Back to files" })).toBeVisible({ timeout: 15_000 });
    // A failed revalidation: the next sessions poll has no pullRequest.
    delete live.pullRequest;
    await expect(page.getByTestId("code-desk-pr")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Back to files" })).toBeVisible();
    await page.getByRole("button", { name: "Back to files" }).click();
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible();
  });

  test("49. a deep file is revealed in the tree, with no folder left spinning", async ({ page }) => {
    const deep = [{ path: "src/deep/x.ts", status: "modified", insertions: 1, deletions: 0, changeVersion: "1:1:1" }];
    await base(page, [NEWEST, OLDER], { current: deep });
    await page.route("**/api/project-tree**", (route) => {
      const root = new URL(route.request().url()).searchParams.get("root") ?? "";
      const entries =
        root === `${WORK_ROOT}/src/deep`
          ? [{ name: "x.ts", path: `${WORK_ROOT}/src/deep/x.ts`, isDir: false }]
          : root === `${WORK_ROOT}/src`
            ? [{ name: "deep", path: `${WORK_ROOT}/src/deep`, isDir: true }]
            : [{ name: "src", path: `${WORK_ROOT}/src`, isDir: true }];
      return route.fulfill({ json: { ok: true, entries } });
    });
    await openDesk(page);
    await page.getByTestId("code-review-rail").getByRole("button", { name: "Next unviewed" }).click();
    const tree = page.getByTestId("code-workbench-tree");
    await expect(tree.getByText("x.ts", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tree.locator(".animate-spin")).toHaveCount(0);
  });

  // ── Pass 4 low fixes (#5745) ───────────────────────────────────────────────

  test("50. the tree shows files the agent creates and drops ones it deletes", async ({ page }) => {
    const fixture = { current: CHANGED_FILES as typeof CHANGED_FILES | "fail" };
    await base(page, [NEWEST, OLDER], fixture);
    let srcChildren = [{ name: "flux.ts", path: `${WORK_ROOT}/src/flux.ts`, isDir: false }];
    let readme = true;
    // As the real route answers at depth 1: a top-level folder carries its
    // children, and starts open.
    await page.route("**/api/project-tree**", (route) => {
      const root = new URL(route.request().url()).searchParams.get("root") ?? "";
      if (root === `${WORK_ROOT}/src`) return route.fulfill({ json: { ok: true, entries: srcChildren } });
      return route.fulfill({
        json: {
          ok: true,
          entries: [
            { name: "src", path: `${WORK_ROOT}/src`, isDir: true, children: srcChildren },
            ...(readme ? [{ name: "README.md", path: `${WORK_ROOT}/README.md`, isDir: false }] : []),
          ],
        },
      });
    });
    await openDesk(page);
    const tree = page.getByTestId("code-workbench-tree");
    await expect(tree.getByText("flux.ts", { exact: true })).toBeVisible();

    // The agent creates src/new.ts and deletes README.md.
    srcChildren = [...srcChildren, { name: "new.ts", path: `${WORK_ROOT}/src/new.ts`, isDir: false }];
    readme = false;
    fixture.current = [
      ...CHANGED_FILES,
      { path: "src/new.ts", status: "untracked", insertions: 3, deletions: 0, changeVersion: "5:5:5" },
      { path: "README.md", status: "deleted", insertions: 0, deletions: 4, changeVersion: "missing" },
    ];
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(tree.getByText("new.ts", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tree.locator("[data-tree-row]").filter({ hasText: /^README\.md/ })).toHaveCount(0);
  });

  test("51. the changes table is one tab stop, and arrow keys move through it", async ({ page }) => {
    await base(page);
    await openDesk(page);
    const grid = page.getByTestId("code-review-rail").getByRole("grid", { name: "Changed files" });
    // Every control Tab can reach, buttons without a tabindex included.
    const TABBABLE = 'button:not([tabindex="-1"]):not([disabled]), [tabindex]:not([tabindex="-1"]):not(button)';
    await expect(grid.locator(TABBABLE)).toHaveCount(1);
    const firstRow = grid.locator('tr[data-grid-row="src/flux.ts"]');
    const secondRow = grid.locator('tr[data-grid-row="src/retry.ts"]');
    await firstRow.locator('[data-grid-col="0"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(secondRow.locator('[data-grid-col="0"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(secondRow.getByRole("switch", { name: "Viewed: src/retry.ts" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(firstRow.getByRole("switch", { name: "Viewed: src/flux.ts" })).toBeFocused();
    // The cell last used keeps the table's only tab stop; Tab leaves the table.
    await expect(grid.locator(TABBABLE)).toHaveCount(1);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="grid"]')))).toBe(false);

    // A revert confirmation joins the grid (#5753 review): still one stop, and
    // arrows reach Confirm from Cancel.
    await firstRow.getByRole("button", { name: "Revert src/flux.ts" }).click();
    const confirm = grid.getByRole("group", { name: "Confirm file revert" });
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(grid.locator(TABBABLE)).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(confirm.getByRole("button", { name: "Confirm revert src/flux.ts" })).toBeFocused();
    await expect(grid.locator(TABBABLE)).toHaveCount(1);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(firstRow.getByRole("button", { name: "Revert src/flux.ts" })).toBeFocused();
    await expect(grid.locator(TABBABLE)).toHaveCount(1);
  });

  test("52. the picker points to matches in other groups instead of offering a duplicate", async ({ page }) => {
    const beta = mkSession({
      id: "s-beta",
      title: "Beta login retry",
      status: "idle",
      project_root: "/repo/beta",
      familiarWorkspace: false,
      git: { branch: "main", repositoryUrl: "https://github.com/acme/beta", worktreeRoot: "/repo/beta/.worktrees/x", isWorktree: true },
    });
    await base(page, [NEWEST, OLDER, beta]);
    await openDesk(page);
    await page.keyboard.press("ControlOrMeta+p");
    const panel = page.locator("[data-code-picker-panel]");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /acme\/alpha/ }).click();
    await panel.getByRole("combobox").fill("Beta login");
    await expect(panel.getByText(/1 match is in other groups/)).toBeVisible();
    await expect(panel.getByRole("button", { name: /Start a new session/ })).toHaveCount(0);
    await panel.getByRole("button", { name: "Show all groups" }).click();
    await expect(panel.getByRole("option", { name: /Beta login retry/ })).toBeVisible();
  });

  test("53. in forced colors the selected session and tree row keep an outline", async ({ page }) => {
    await base(page);
    await page.emulateMedia({ forcedColors: "active" });
    await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    const styles = await page.evaluate(() => {
      const outline = (el: Element | null) => (el ? getComputedStyle(el).outlineStyle : "missing");
      return {
        session: outline(document.querySelector('[data-code-session-id][aria-current="true"]')),
        tree: outline(document.querySelector('[data-tree-row][data-selected="true"]')),
      };
    });
    expect(styles.session).toBe("solid");
    expect(styles.tree).toBe("solid");
  });

  test("54. at 320px every terminal control stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await base(page);
    await page.goto("/?mode=code&session=s-new", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("code-workbench")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Open the terminal drawer" }).click();
    await expect(page.locator(".code-terminal-workspace__bar")).toBeVisible();
    const offscreen = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".code-terminal-workspace__bar button"))
        .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent ?? "", rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1))
        .map(({ name }) => name.trim()),
    );
    expect(offscreen).toEqual([]);
  });

  test("55. editing a CRLF file saves CRLF, not a whole-file rewrite", async ({ page }) => {
    await base(page);
    const posts: { content?: string }[] = [];
    await page.route("**/api/project-file**", (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        posts.push(request.postDataJSON());
        return route.fulfill({ json: { ok: true, size: 20, version: "v2" } });
      }
      if (!(new URL(request.url()).searchParams.get("path") ?? "").endsWith("flux.ts")) return route.fallback();
      return route.fulfill({ json: { ok: true, kind: "text", content: "one\r\ntwo\r\n", size: 10, version: "v1" } });
    });
    const desk = await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await desk.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("three");
    await desk.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].content).toBe("one\r\ntwo\r\nthree");
  });

  test("56. a review thread that fails to resolve says so", async ({ page }) => {
    const live = { ...NEWEST, pullRequest: { ...(NEWEST as unknown as { pullRequest: Record<string, unknown> }).pullRequest, attribution: "branch" } };
    await base(page, [live, OLDER]);
    await page.route("**/api/queue/**", (route) => route.fulfill({ json: { ok: true, items: [], prs: [], issues: [] } }));
    await page.route("**/api/github/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/resolve-thread")) return route.abort("failed");
      if (url.pathname.endsWith("/checks")) return route.fulfill({ json: { ok: true, authed: true, sha: "d".repeat(40), rollup: "passing", runs: [], statuses: [] } });
      return route.fulfill({
        json: {
          ok: true, authed: true, canResolve: true, issueComments: [], reviews: [],
          reviewThreads: [{ id: "T1", isResolved: false, isOutdated: false, path: "src/flux.ts", comments: [{ id: "c1", author: { login: "val" }, body: "Rename this", createdAt: null }] }],
        },
      });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("tab", { name: "Pull request" }).click();
    await rail.getByRole("button", { name: "Resolve" }).click();
    await expect(rail.getByRole("alert").filter({ hasText: /Couldn.t update the thread/ })).toBeVisible();
  });

  test("57. a session switch reads the change list once, not once per view", async ({ page }) => {
    await base(page);
    await openDesk(page);
    let reads = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/changes" && request.method() === "GET" && [...url.searchParams.keys()].join() === "projectRoot") reads += 1;
    });
    // At most one read per switch (#5753 review); zero when the shared 4s
    // window already holds the list. The desk, its panel and the launchpad
    // used to read it once each.
    for (const id of ["s-old", "s-new", "s-old", "s-new"]) {
      const before = reads;
      await page.locator(`[data-code-session-id='${id}']`).first().click();
      await expect(page.getByTestId("code-desk-activity")).toHaveText(id === "s-new" ? /running/ : /idle/);
      await page.waitForTimeout(600);
      expect(reads - before, `reads for the switch to ${id}`).toBeLessThanOrEqual(1);
    }
  });

  test("58. a file the tree's first answer missed still appears on the first change list", async ({ page }) => {
    // The agent created src/new.ts between the tree's load and the first
    // change list (#5753 review). That first list must refresh the folder.
    const fixture = {
      current: [...CHANGED_FILES, { path: "src/new.ts", status: "untracked", insertions: 2, deletions: 0, changeVersion: "6:6:6" }] as typeof CHANGED_FILES | "fail",
    };
    await base(page, [NEWEST, OLDER], fixture);
    const stale = [{ name: "flux.ts", path: `${WORK_ROOT}/src/flux.ts`, isDir: false }];
    const fresh = [...stale, { name: "new.ts", path: `${WORK_ROOT}/src/new.ts`, isDir: false }];
    await page.route("**/api/project-tree**", (route) => {
      const root = new URL(route.request().url()).searchParams.get("root") ?? "";
      // The folder's own read is current; the root's nested copy is not.
      if (root === `${WORK_ROOT}/src`) return route.fulfill({ json: { ok: true, entries: fresh } });
      return route.fulfill({ json: { ok: true, entries: [{ name: "src", path: `${WORK_ROOT}/src`, isDir: true, children: stale }] } });
    });
    await openDesk(page);
    await expect(page.getByTestId("code-workbench-tree").getByText("new.ts", { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  // ── Pass 5 high fixes (#5756) ──────────────────────────────────────────────

  test("59. restoring a checkpoint says what came back and names what it kept", async ({ page }) => {
    await base(page);
    const name = "2026-10-03T01-02-03-000Z.patch";
    let listReads = 0;
    const posts: Record<string, unknown>[] = [];
    await page.route("**/api/changes**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.searchParams.get("checkpoints") === "1") {
        listReads += 1;
        return route.fulfill({ json: { ok: true, checkpoints: [{ name, savedAt: "2026-10-03T01:02:03.000Z", bytes: 1200 }] } });
      }
      if (request.method() !== "POST") return route.fallback();
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      return route.fulfill({
        json: { ok: true, checkpoint: name, restored: ["src/flux.ts"], unchanged: [], kept: ["src/retry.ts"], checkpointPath: "/x/.git/coven-cave/checkpoints/after.patch" },
      });
    });
    await openDesk(page);
    const rail = page.getByTestId("code-review-rail");
    await rail.getByRole("button", { name: /Checkpoints/ }).click();
    await rail.getByRole("button", { name: /^Restore checkpoint / }).click();
    const before = listReads;
    await rail.getByRole("group", { name: "Confirm checkpoint restore" }).getByRole("button", { name: /^Confirm restore checkpoint / }).click();
    await expect(rail.getByText(/Restored 1 file from checkpoint .+\. Kept src\/retry\.ts as it is: changed after the checkpoint\. The state before restoring is saved as a new checkpoint\./)).toBeVisible();
    expect(posts).toEqual([expect.objectContaining({ action: "restore-checkpoint", checkpoint: name })]);
    // The restore saved the state before it as a new checkpoint: the list is read again.
    await expect.poll(() => listReads).toBeGreaterThan(before);
  });

  test("60. Escape always leaves the editor: to the viewer while saving, to Reload in a conflict", async ({ page }) => {
    await base(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/project-file**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      await held;
      return route.fulfill({ status: 409, json: { ok: false, error: "file changed on disk", conflict: true, version: "v9" } });
    });
    const desk = await openDesk(page);
    const editor = desk.locator(".cm-content");
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// mine");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(desk.getByRole("button", { name: "Saving…" })).toBeDisabled();
    // Save and Cancel are both off while the save is in flight: the viewer
    // itself takes focus, and Tab moves on from there.
    await editor.click();
    await page.keyboard.press("Escape");
    await expect(desk.locator(".workspace-rail__preview-head")).toBeFocused();

    release();
    const reload = desk.getByRole("button", { name: "Reload" });
    await expect(reload).toBeVisible();
    await editor.click();
    await page.keyboard.press("Escape");
    await expect(reload).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(desk.getByRole("button", { name: "Overwrite" })).toBeFocused();
    await expect(editor).toContainText("// mine");
  });

  test("61. an unsaved edit survives a reload, and its tab says so", async ({ page }) => {
    await base(page);
    page.on("dialog", (dialog) => void dialog.accept());
    const desk = await openDesk(page);
    await page.getByTestId("code-workbench-tree").getByText("flux.ts", { exact: true }).click();
    await desk.getByRole("button", { name: "Edit" }).click();
    await desk.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("// survives");
    // A fresh page load. The desk drops `mode` from the URL once it opens, so
    // go back to it by address rather than page.reload().
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    const again = page.getByTestId("code-workbench");
    await expect(again).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("code-tab-unsaved")).toHaveCount(1);
    await expect(again.locator(".cm-content")).toContainText("// survives");
    // Saving clears the kept copy: the next load has nothing to bring back.
    await again.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("code-tab-unsaved")).toHaveCount(0);
    await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("code-workbench")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("code-workbench-tree")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("code-tab-unsaved")).toHaveCount(0);
  });
});
