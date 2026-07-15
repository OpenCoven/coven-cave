import { expect, test, type Page } from "@playwright/test";

// GitHub chat cards end-to-end (cave-fpqx.9, design
// docs/chat-github-integration.md §8): a conversation turn carrying a
// bare-line PR URL renders a hydrated PRCard; the tier-2 Merge action opens
// an inline confirm strip stating exactly what will fire; Confirm posts to
// /api/github/merge (mocked) and the card re-hydrates into the merged state.
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
  await page.route("**/api/github/merge", async (route) => {
    opts.mergeCalls.push(route.request().postDataJSON());
    opts.mergedRef.merged = true;
    await route.fulfill({ json: { ok: true, merged: true, sha: "deadbee" } });
  });

  await page.goto("/");
  await page.waitForTimeout(400);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
}

test.describe("github chat cards", () => {
  test.skip(({ isMobile }) => isMobile, "desktop transcript flow");

  test("PR URL → hydrated card → tier-2 merge confirm → merged morph; proposals never auto-fire", async ({ page }) => {
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

    // Tier-2 on the PR card: Merge opens the confirm strip; nothing fires yet.
    await prCard.getByRole("button", { name: "Merge" }).click();
    await expect(prCard).toContainText("Merge acme/rocket#7 via squash?");
    expect(mergeCalls.length).toBe(0);

    // Confirm fires the mocked route with the exact payload and the card
    // re-hydrates into the merged state.
    await prCard.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => mergeCalls.length).toBe(1);
    expect(mergeCalls[0]).toEqual({ repo: "acme/rocket", number: 7, method: "squash" });
    await expect(prCard.getByLabel(/Merged:/)).toBeVisible({ timeout: 10_000 });
  });
});
