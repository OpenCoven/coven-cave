import { expect, test, type Page } from "@playwright/test";

// GitHub chat cards end-to-end (cave-fpqx.9 / cave-076kh, design
// docs/chat-github-integration.md §8 + "Final Card Components.dc.html" §01):
// a conversation turn carrying a bare-line PR URL renders a hydrated PRCard
// resting on its reply pill; opening the composer, switching to the Merge verb
// and ARMING the field is the only path to a merge, which posts to
// /api/github/merge (mocked) and re-hydrates the card into the merged state.
// An assistant-emitted <coven:github-action> marker renders a proposal card
// that never auto-fires. Daemon-less: every API surface is page.route-mocked.

const ISO = new Date().toISOString();

const FAMILIARS = {
  ok: true,
  familiars: [
    { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
  ],
};

const SESSION = {
  id: "s1",
  title: "Ship the thing",
  status: "completed",
  origin: "chat",
  harness: "codex",
  familiarId: "nova",
  project_root: null,
  exit_code: 0,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

function itemPayload(merged: boolean) {
  return {
    ok: true,
    title: "feat: ship the thing",
    number: 7,
    state: merged ? "closed" : "open",
    isPull: true,
    merged,
    draft: false,
    body: "body",
    author: { login: "buns", avatarUrl: null, url: null },
    assignees: [],
    labels: [{ name: "chat", color: "aa66ff" }],
    createdAt: ISO,
    updatedAt: ISO,
    htmlUrl: "https://github.com/acme/rocket/pull/7",
    comments: 2,
    // The `pull=1` block the composer's merge + gate sections read.
    pull: {
      headRef: "feat/thing",
      baseRef: "main",
      headSha: "abc1234",
      commits: 3,
      additions: 10,
      deletions: 2,
      changedFiles: 2,
      mergeable: true,
      mergeableState: "clean",
      reviews: { approved: 1, changesRequested: 0, commented: 0 },
    },
  };
}

async function boot(page: Page, opts: { mergedRef: { merged: boolean }; mergeCalls: unknown[] }) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Nav is minimized-by-default; keep it expanded so the sidebar thread
    // titles are clickable (code-rail.spec idiom).
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars", (route) => route.fulfill({ json: FAMILIARS }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [SESSION] } }));
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          turns: [
            { id: "t1", role: "user", text: "https://github.com/acme/rocket/pull/7", createdAt: ISO },
            {
              id: "t2",
              role: "assistant",
              text: 'Looking good.\n<coven:github-action kind="merge" repo="acme/rocket" number="7" note="checks are green" />',
              createdAt: ISO,
            },
          ],
        },
        context: {},
      },
    }),
  );
  await page.route("**/api/github/item**", (route) => route.fulfill({ json: itemPayload(opts.mergedRef.merged) }));
  await page.route("**/api/github/checks**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        authed: true,
        sha: "abc1234",
        rollup: "passing",
        runs: [
          { id: "1", name: "Frontend build", status: "completed", conclusion: "success", startedAt: ISO, completedAt: ISO, detailsUrl: null, appName: null, appAvatarUrl: null },
        ],
        statuses: [],
      },
    }),
  );
  // Open-PR cards also pull review threads (gate) and reactions (rest row).
  await page.route("**/api/github/comments**", (route) =>
    route.fulfill({ json: { ok: true, authed: true, canResolve: true, issueComments: [], reviewThreads: [] } }),
  );
  await page.route("**/api/github/reactions**", (route) => route.fulfill({ json: { ok: true, reactions: [] } }));
  await page.route("**/api/github/merge", async (route) => {
    opts.mergeCalls.push(route.request().postDataJSON());
    opts.mergedRef.merged = true;
    await route.fulfill({ json: { ok: true, merged: true, sha: "deadbee" } });
  });

  await page.goto("/?mode=chat");
  await page.waitForTimeout(400);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
}

test.describe("github chat cards", () => {
  test.skip(({ isMobile }) => isMobile, "desktop transcript flow");
  // The composer's chunk compiles on demand under `next dev`; the suite's 60s
  // default was set before the card had a lazy boundary in its critical path.
  test.setTimeout(150_000);

  test("PR URL → hydrated card → armed merge → merged morph; proposals never auto-fire", async ({ page }) => {
    const mergedRef = { merged: false };
    const mergeCalls: unknown[] = [];
    await boot(page, { mergedRef, mergeCalls });

    // Open the seeded conversation from the sidebar.
    await page.locator(".chat-sidebar").getByText("Ship the thing", { exact: false }).first().click();
    const prCard = page.locator('[data-gh-kind="pr"]').first();
    await expect(prCard).toBeVisible({ timeout: 15_000 });
    await expect(prCard).toContainText("feat: ship the thing");
    await expect(prCard).toContainText("acme/rocket #7");

    // The agent's merge proposal renders as a card and does NOT auto-fire.
    const proposal = page.locator('[data-gh-action-kind="merge"]');
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("Proposed: Merge acme/rocket#7 via squash");
    await expect(proposal).toContainText("checks are green");
    expect(mergeCalls.length).toBe(0);

    // At rest the card offers only a reply pill — no bare Merge button to mis-tap.
    // The composer is a lazy chunk (it owns gh-card-composer.css, which has to
    // stay out of the home first load). The webServer is `next dev`, so that
    // chunk compiles on demand the first time any test reaches it, and that
    // compile can outlast a default action timeout — hence an explicit wait on
    // the lazy boundary rather than letting .click() absorb it.
    const replyPill = prCard.getByRole("button", { name: "Reply to acme/rocket#7" });
    await expect(replyPill).toBeVisible({ timeout: 60_000 });

    const restHeight = (await prCard.boundingBox())?.height ?? 0;
    expect(restHeight).toBeGreaterThan(0);
    await replyPill.click();
    await expect(prCard.getByRole("tab", { name: "Preview" })).toBeVisible();
    // The sheet is out of flow, so opening it must not move the card at all.
    expect((await prCard.boundingBox())?.height ?? 0).toBeCloseTo(restHeight, 0);

    // Choosing the Merge verb opens the merge section but arms nothing.
    await prCard.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(prCard.getByLabel("Type merge to arm the merge button")).toBeVisible();
    await expect(prCard).toContainText("feat/thing");
    expect(mergeCalls.length).toBe(0);

    // The CTA is inert until the arm field literally reads "merge".
    const cta = prCard.getByRole("button", { name: /and merge on acme\/rocket#7/ });
    await cta.click();
    await expect(prCard).toContainText("type merge in the Merge section to arm this");
    expect(mergeCalls.length).toBe(0);

    // Arm it, then fire. The branch toggle defaults on, so the tidy is requested
    // — but the body carries NO branch name: the route reads that back from
    // GitHub instead of trusting the caller (CodeQL js/request-forgery).
    await prCard.getByLabel("Type merge to arm the merge button").fill("merge");
    await cta.click();
    await expect.poll(() => mergeCalls.length).toBe(1);
    expect(mergeCalls[0]).toEqual({
      repo: "acme/rocket",
      number: 7,
      method: "squash",
      deleteBranch: true,
    });
    await expect(prCard.getByLabel(/Merged:/)).toBeVisible({ timeout: 10_000 });
  });

  test("the command palette only offers what the card can fire", async ({ page }) => {
    const mergedRef = { merged: false };
    const mergeCalls: unknown[] = [];
    await boot(page, { mergedRef, mergeCalls });
    await page.locator(".chat-sidebar").getByText("Ship the thing", { exact: false }).first().click();
    const prCard = page.locator('[data-gh-kind="pr"]').first();
    await expect(prCard).toBeVisible({ timeout: 15_000 });

    const pill = prCard.getByRole("button", { name: "Reply to acme/rocket#7" });
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await pill.click();
    const input = prCard.getByLabel("Reply to acme/rocket#7");
    await input.fill("/");
    await expect(prCard).toContainText("COMMANDS");
    await expect(prCard).toContainText("/review");
    await expect(prCard).toContainText("/merge");
    // No unresolved threads were mocked, so /thread must be absent.
    await expect(prCard).not.toContainText("/thread");

    // Tab completes the highlighted row rather than firing it.
    await input.press("Tab");
    await expect(input).toHaveValue("/review ");
    await expect(prCard).toContainText("SUBCOMMAND");
    await expect(prCard).toContainText("request-changes");

    // Esc drops the slash and keeps the text as prose — never a stray command.
    await input.press("Escape");
    await expect(input).toHaveValue("review ");
    await expect(prCard).not.toContainText("SUBCOMMAND");
    expect(mergeCalls.length).toBe(0);
  });
});
