import { expect, test, type Page } from "@playwright/test";

// The composer's Environment popover (#5958): the branch chip opens the chat's
// environment card — Changes `+N −N`, Local/ssh + worktree, Branch ▸, Commit
// or push, and the branch's pull request — at EVERY width. It replaced the
// floating HUD that sat at the transcript's top-right on panes ≥1536px.
//
// Lives at the root (not tests/mobile/) and is listed in the config's
// MOBILE_SURFACE_SPECS so the same journeys run on desktop, pixel-5 and
// iphone-13: the phone cases (rest-state chips, viewport containment, 44px
// rows) only exist there. Daemon-less: onboarding dismissed, APIs mocked.

test.use({ serviceWorkers: "block" });

const FAMILIARS = [
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", harness: "codex", icon: "ph:sparkle-fill" },
];
const PROJECT = { id: "p1", name: "Cave", root: "/repo/cave", access: "write" };
const SESSION = {
  id: "env-recent",
  title: "Open the environment from the chip",
  familiarId: "nova",
  project_root: PROJECT.root,
  runtime: `local:${PROJECT.root}`,
  harness: "codex",
  status: "idle",
  hasLocalConversation: true,
  archived_at: null,
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
};
// Not a github.com URL on purpose: the shell routes GitHub items into the
// Code desk; anything else opens in the in-app browser pane, which is the
// observable effect this spec asserts.
const PR_URL = "https://forge.example.test/cave/cave/pull/42";
const CHANGED_FILES = [
  { path: "src/a.ts", status: "modified", insertions: 12, deletions: 3 },
  { path: "src/b.ts", status: "modified", insertions: 5, deletions: 1 },
];

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify("p1"));
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:code-rail:pinned:v1", "false");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [PROJECT] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [SESSION] } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [], unreadCount: 0 } }));
  await page.route("**/api/github/review-requests**", (route) => route.fulfill({ json: { ok: true, rows: [] } }));
  await page.route("**/api/onboarding/status**", (route) => route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } }));
  await page.route("**/api/daemon/connection**", (route) => route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }));
  await page.route("**/api/daemon/status**", (route) => route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      conversation: { turns: [{ id: "t1", role: "assistant", text: "On it.", createdAt: SESSION.created_at }] },
      context: { task: null, github: [] },
    },
  }));
  await page.route("**/api/chat/model-state**", (route) => route.fulfill({
    json: { ok: true, state: {
      familiarId: "nova", runtime: null, harness: "codex", effectiveModel: "unknown",
      source: "runtime-default", applicationState: "saved", reason: "e2e",
    } },
  }));
  // One handler for the whole /api/changes family: the 5s summary poll, the
  // branch PR probe (?pr=1) and the branch list (?branches=1).
  await page.route("**/api/changes**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("pr")) {
      return route.fulfill({ json: { ok: true, pr: { number: 42, url: PR_URL, html_url: PR_URL, state: "OPEN", isDraft: false } } });
    }
    if (url.searchParams.has("branches")) {
      return route.fulfill({ json: { ok: true, branches: [
        { name: "main", current: true, worktree: null },
        { name: "feat/env-popover", current: false, worktree: null },
      ] } });
    }
    return route.fulfill({ json: {
      ok: true, repo: true, repoRoot: PROJECT.root, branch: "main", worktree: "wt-cave", files: CHANGED_FILES,
    } });
  });
}

async function openThread(page: Page) {
  // `#chat-<sessionId>` is the chat deep link (CHAT-D9-01): the thread opens
  // with its docked composer, where the branch chip carries session context.
  await page.goto(`/?mode=chat#chat-${SESSION.id}`);
  const main = page.getByTestId("chat-main");
  await expect(main.getByRole("textbox", { name: "Message", exact: true })).toBeVisible({ timeout: 30_000 });
  // Attached, not visible: on a phone the chips rest hidden until the
  // composer is engaged (#5546), which the phone journey below exercises.
  await expect(main.getByRole("group", { name: "Session context", exact: true, includeHidden: true })).toBeAttached({ timeout: 30_000 });
  return main;
}

/** Unfolds "More composer options" and returns the branch chip. */
async function revealBranchChip(main: ReturnType<Page["getByTestId"]>) {
  const context = main.locator(".cave-context-controls");
  const more = context.getByRole("button", { name: "More composer options", exact: true });
  await expect(more).toBeVisible({ timeout: 20_000 });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  const chip = context.getByRole("button", { name: /^Branch: main — open environment$/ });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-haspopup", "dialog");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  return { context, more, chip };
}

test("pointer opening keeps focus on the chip; keyboard opening lands on the first row and arrows rove", async ({ page, isMobile }) => {
  test.skip(isMobile, "phone journeys are below");
  await seed(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const main = await openThread(page);
  // The HUD is gone at the width that used to show it.
  await expect(page.locator("[data-chat-env-panel]")).toHaveCount(0);

  const { chip } = await revealBranchChip(main);
  await chip.click();
  const environment = page.getByRole("dialog", { name: "Environment", exact: true });
  await expect(environment).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(chip).toBeFocused();

  const changes = environment.getByRole("button", { name: /^Changes/ });
  await expect(changes).toHaveText(/\+17\s*−4/);
  await expect(environment.getByText("Local", { exact: true })).toBeVisible();
  await expect(environment.getByText("wt-cave", { exact: true })).toBeVisible();
  await expect(environment.getByRole("button", { name: "Commit or push", exact: true })).toBeVisible();
  await expect(environment.getByRole("button", { name: "Pull request #42", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(environment).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAttribute("aria-expanded", "false");

  // Keyboard: Enter on the focused chip opens with focus on the first row.
  await page.keyboard.press("Enter");
  await expect(environment).toBeVisible();
  await expect(changes).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(environment.getByRole("button", { name: "main", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(environment.getByRole("button", { name: "Pull request #42", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(changes).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(environment.getByRole("button", { name: "Pull request #42", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(environment).toBeHidden();
  await expect(chip).toBeFocused();
});

test("rows launch the Changes rail, the pull request and the branch list; Escape returns to the chip", async ({ page, isMobile }) => {
  test.skip(isMobile, "phone journeys are below");
  await seed(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const main = await openThread(page);
  const { chip, more } = await revealBranchChip(main);
  const environment = page.getByRole("dialog", { name: "Environment", exact: true });

  // Commit or push → cave:changes-open → the code rail opens on its Changes tab.
  await chip.click();
  await environment.getByRole("button", { name: "Commit or push", exact: true }).click();
  await expect(environment).toBeHidden();
  const rail = page.locator(".workspace-rail");
  await expect(rail).toBeVisible({ timeout: 60_000 });
  await expect(rail.getByRole("button", { name: "Changes", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Branch row → Branches menu on the same anchor → Escape returns to the chip.
  await chip.click();
  await expect(environment).toBeVisible();
  await environment.getByRole("button", { name: "main", exact: true }).click();
  await expect(environment).toBeHidden();
  const branches = page.getByRole("menu", { name: "Branches", exact: true });
  await expect(branches).toBeVisible();
  await expect(branches.getByRole("menuitemradio", { name: "feat/env-popover" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(branches).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "true");

  // PR row → the open pull request, in the app's browser pane.
  await chip.click();
  await expect(environment).toBeVisible();
  await environment.getByRole("button", { name: "Pull request #42", exact: true }).click();
  await expect(environment).toBeHidden();
  await expect(page.locator(".browser-pane")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".browser-address-input")).toHaveValue(PR_URL, { timeout: 30_000 });
});

test("on a phone the popover opens from the engaged composer, stays in the viewport, and its rows are touch targets", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone-only");
  await seed(page);
  const main = await openThread(page);
  const chat = page.locator(".cave-chat-linear");
  const input = main.getByRole("textbox", { name: "Message", exact: true });
  const context = main.locator(".cave-context-controls");

  // #5546: at rest the chips are hidden; focusing the input brings them back.
  await expect(chat).toHaveAttribute("data-composer-rest", "true");
  await expect(context).toBeHidden();
  await input.focus();
  await expect(chat).not.toHaveAttribute("data-composer-rest", "true");
  await expect(context).toBeVisible();

  // Driven by focus + Enter rather than taps: WebKit does not focus a button
  // on click, so a tap blurs the textarea with no relatedTarget and the
  // composer rests before the chip can be reached (the existing phone specs
  // stage a draft or move focus directly for the same reason). Enter is also
  // the keyboard-open path, which puts the first row in the body portal —
  // the focus move the composer must NOT read as leaving it.
  const more = context.getByRole("button", { name: "More composer options", exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const chip = context.getByRole("button", { name: /^Branch: main — open environment$/ });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-haspopup", "dialog");
  await chip.focus();
  await page.keyboard.press("Enter");
  const environment = page.getByRole("dialog", { name: "Environment", exact: true });
  await expect(environment).toBeVisible();
  const changes = environment.getByRole("button", { name: /^Changes/ });
  await expect(changes).toBeFocused();
  await expect(changes).toHaveText(/\+17\s*−4/);
  // Focus is in the portal with an empty draft: still engaged, chip still there.
  await expect(chat).not.toHaveAttribute("data-composer-rest", "true");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "true");

  const viewport = page.viewportSize()!;
  const box = (await environment.boundingBox())!;
  expect(box.x, "left edge inside the viewport").toBeGreaterThanOrEqual(0);
  expect(box.y, "top edge inside the viewport").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right edge inside the viewport").toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height, "bottom edge inside the viewport").toBeLessThanOrEqual(viewport.height + 0.5);

  const rows = environment.locator(".ui-popover-item");
  expect(await rows.count()).toBeGreaterThanOrEqual(4);
  for (const row of await rows.all()) {
    const rowBox = (await row.boundingBox())!;
    // Rounded: Pixel 5 (DPR 2.75) reports a 44px min-height as 43.99997.
    expect(Math.round(rowBox.height), `row "${await row.innerText()}" is a touch target`).toBeGreaterThanOrEqual(44);
  }

  // Escape closes and hands focus back to the chip, composer still engaged.
  await page.keyboard.press("Escape");
  await expect(environment).toBeHidden();
  await expect(chip).toBeFocused();
  await expect(chat).not.toHaveAttribute("data-composer-rest", "true");

  // Commit or push opens the code rail as the phone's slide-over sheet.
  await page.keyboard.press("Enter");
  await expect(environment).toBeVisible();
  await environment.getByRole("button", { name: "Commit or push", exact: true }).click();
  await expect(environment).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Code rail" })).toBeVisible({ timeout: 60_000 });
});
