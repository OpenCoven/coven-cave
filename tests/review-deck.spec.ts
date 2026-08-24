import { expect, test, type Page } from "@playwright/test";

const FAMILIAR_ID = "vera";
const SESSION_ID = "review-session";
const HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";
const SESSION = {
  id: SESSION_ID,
  title: "Focus the Review Deck",
  status: "completed",
  origin: "chat",
  project_root: "/repo/review-deck",
  harness: "copilot",
  familiarId: FAMILIAR_ID,
  model: "github/gpt-5",
  runtime: "local:/repo/review-deck",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-08-19T10:00:00.000Z",
  updated_at: "2026-08-19T11:00:00.000Z",
  git: {
    branch: "feat/review-deck",
    worktreeRoot: "/repo/review-deck",
    isWorktree: true,
  },
  pullRequest: {
    repo: "OpenCoven/coven-cave",
    number: 4812,
    url: "https://github.com/OpenCoven/coven-cave/pull/4812",
    state: "open",
  },
  diff: { additions: 3, deletions: 1 },
};

const ITEM = {
  ok: true,
  isPull: true,
  state: "open",
  draft: false,
  merged: false,
  pull: {
    headRef: "feat/review-deck",
    baseRef: "main",
    headSha: HEAD_SHA,
    commits: 2,
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    mergeable: true,
    mergeableState: "clean",
    reviews: { approved: 0, changesRequested: 0, commented: 0 },
  },
};

const DIFF = {
  ok: true,
  truncated: false,
  total: 2,
  files: [
    {
      filename: "src/review.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: [
        "@@ -1,2 +1,3 @@",
        " export const ready = true;",
        "-export const title = 'Old';",
        "+export const title = 'Focused';",
        "+export const reviewed = false;",
      ].join("\n"),
      noPatchReason: null,
    },
    {
      filename: "src/review.test.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: ["@@ -0,0 +1 @@", "+test('reviewed', () => true);"].join(
        "\n",
      ),
      noPatchReason: null,
    },
  ],
};

async function mockReviewDeck(page: Page) {
  let submittedReview: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:active-familiar", "vera");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          {
            id: FAMILIAR_ID,
            display_name: "Vera",
            role: "Reviewer",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route(/\/api\/roles(\?|$)/, (route) =>
    route.fulfill({ json: { ok: true, roles: [] } }),
  );
  await page.route(/\/api\/github\/item\?/, (route) =>
    route.fulfill({ json: ITEM }),
  );
  await page.route(/\/api\/github\/diff\?/, (route) =>
    route.fulfill({ json: DIFF }),
  );
  await page.route(/\/api\/github\/checks\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        runs: [
          {
            name: "Frontend build",
            status: "completed",
            conclusion: "success",
            detailsUrl: null,
          },
        ],
        statuses: [],
      },
    }),
  );
  await page.route(/\/api\/github\/comments\?/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        canResolve: false,
        reviews: [],
        reviewThreads: [],
      },
    }),
  );
  await page.route("**/api/github/review", async (route) => {
    submittedReview = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  return {
    review: () => submittedReview,
  };
}

/** Deterministic entry: `?mode=` is applied once on mount, where a dispatched
 *  `cave:navigate-mode` races the shell's own mode restore. */
async function openReviewDeck(page: Page) {
  const handles = await mockReviewDeck(page);
  await page.goto("/?mode=surface:reviewer-review-deck");
  await expect(page.locator(".rd-stage")).toBeVisible({ timeout: 180_000 });
  return handles;
}

test.describe("Review Deck cockpit — the verdict actually posts", () => {
  test.describe.configure({ timeout: 180_000 });

  // This file predates the cockpit and pinned the surface it replaced. What is
  // worth keeping is the thing no other spec covers: that a verdict composed in
  // the UI arrives at /api/github/review with the exact body the reviewer typed.
  // The IA assertions it used to carry (an "Evidence" tab, an evidence dock, a
  // deck with no visible textbox) described the old three-tab layout and are now
  // wrong by design — the note is deliberately reachable without opening a
  // dialog, and the third pane is the Inspector.

  test("head-scoped progress, then a request-changes note reaches GitHub verbatim", async ({
    page,
  }) => {
    const handles = await openReviewDeck(page);
    const deck = page.locator(".rd-stage");

    await deck.locator(".rd-row", { hasText: "Focus the Review Deck" }).click();
    await expect(deck.getByText(`head ${HEAD_SHA.slice(0, 7)}`)).toBeVisible();
    await expect(deck.getByRole("region", { name: "Unified diff" })).toBeVisible();
    await expect(deck.getByText("export const title = 'Focused';")).toBeVisible();

    // Progress is scoped to the exact head, and marking a file moves it.
    await expect(deck.locator(".rd-file-progress-label")).toHaveText("0/2");
    await deck.getByRole("button", { name: /Mark reviewed/ }).click();
    await expect(deck.locator(".rd-file-progress-label")).toHaveText("1/2");
    await expect(deck.getByRole("button", { name: /Reviewed/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await deck.getByRole("button", { name: "Request changes" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Cited evidence")).toBeVisible();
    await dialog
      .locator("#rd-review-body")
      .fill("Please keep the reviewed-file identity tied to this head.");
    await dialog.getByRole("button", { name: "Send request" }).click();

    await expect.poll(handles.review).toMatchObject({
      repo: "OpenCoven/coven-cave",
      number: 4812,
      event: "REQUEST_CHANGES",
      body: "Please keep the reviewed-file identity tied to this head.",
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The verdict must confirm VISIBLY, not only into the sr-only live region.
    // Before cave-06qka a sighted reviewer got nothing here but a closed dialog.
    await expect(deck.locator(".rd-toast")).toContainText("Requested changes on", {
      timeout: 5_000,
    });
    // …and the toast is hidden from assistive tech, because the announcer
    // already speaks the same sentence.
    await expect(deck.locator(".rd-toast")).toHaveAttribute("aria-hidden", "true");
  });

  test("every narrow-width pane stays reachable, including the one you just left", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await openReviewDeck(page);
    const deck = page.locator(".rd-stage");
    const tabs = deck.getByRole("tablist", { name: "Review Deck views" });
    await expect(tabs).toBeVisible();

    // The switcher used to live inside the pane the diff view owns, so leaving
    // that view hid the control that switches back. Walk every tab and return.
    await tabs.getByRole("tab", { name: "Queue" }).click();
    await expect(deck.getByRole("navigation", { name: "Review queue" })).toBeVisible();
    await expect(tabs).toBeVisible();

    await tabs.getByRole("tab", { name: "Inspector" }).click();
    await expect(deck.getByRole("complementary", { name: "Review inspector" })).toBeVisible();
    await expect(tabs).toBeVisible();

    await tabs.getByRole("tab", { name: "Diff" }).click();
    await expect(deck.getByRole("region", { name: "Unified diff" })).toBeVisible();
    await expect(tabs).toBeVisible();
  });
});
