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

const CHANGED_FILES = [
  { path: "src/flux.ts", status: "modified", insertions: 12, deletions: 3 },
  { path: "src/retry.ts", status: "added", insertions: 5, deletions: 0 },
];

type Sent = { prompt?: string; sessionId?: string };

async function base(page: Page, sessions: unknown[] = [NEWEST, OLDER]) {
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
    route.fulfill({ json: { ok: true, repo: true, repoRoot: WORK_ROOT, files: CHANGED_FILES } });
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

    const diffstat = page.getByTestId("code-desk-diffstat");
    await expect(diffstat).toContainText("+12");
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
    await page.setViewportSize({ width: 1280, height: 1000 });
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
});
