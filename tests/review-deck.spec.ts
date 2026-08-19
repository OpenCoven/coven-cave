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
    route.fulfill({ json: { roles: [] } }),
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

async function enterReviewDeck(page: Page) {
  await page.getByRole("navigation").first().waitFor({ timeout: 60_000 });
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("cave:navigate-mode", {
          detail: { mode: "surface:reviewer-review-deck" },
        }),
      ),
    );
    await expect(page.locator(".rd-stage")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000 });
}

async function openReviewDeck(page: Page) {
  const handles = await mockReviewDeck(page);
  await page.goto("/");
  await enterReviewDeck(page);
  return handles;
}

test.describe("Review Deck focused review run", () => {
  test.describe.configure({ timeout: 180_000 });

  test("keeps the diff dominant, records head-scoped progress, and submits a verdict note", async ({
    page,
  }) => {
    const handles = await openReviewDeck(page);
    const deck = page.locator(".rd-stage");

    await deck
      .getByRole("button", { name: /Focus the Review Deck/ })
      .click();
    await expect(deck.getByText(`head ${HEAD_SHA.slice(0, 7)}`)).toBeVisible();
    await expect(
      deck.getByRole("region", { name: "Changed files and diff" }),
    ).toBeVisible();
    await expect(deck.getByText("export const title = 'Focused';")).toBeVisible();
    await expect(deck.getByText("0 of 2", { exact: true })).toBeVisible();
    await expect(deck.getByRole("textbox")).toHaveCount(0);

    await deck.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(deck.getByText("1 of 2", { exact: true })).toBeVisible();
    await expect(
      deck.getByRole("button", { name: "Reviewed", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await deck.getByRole("button", { name: "Request changes" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Evidence from GitHub")).toBeVisible();
    await dialog
      .getByLabel("Review note")
      .fill("Please keep the reviewed-file identity tied to this head.");
    await dialog.getByRole("button", { name: "Send request" }).click();

    await expect
      .poll(handles.review)
      .toMatchObject({
        repo: "OpenCoven/coven-cave",
        number: 4812,
        event: "REQUEST_CHANGES",
        body: "Please keep the reviewed-file identity tied to this head.",
      });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("reflows to Queue, Files, and Evidence tabs without hiding the code path", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await openReviewDeck(page);
    const deck = page.locator(".rd-stage");
    const tabs = deck.getByRole("tablist", { name: "Review Deck views" });

    await expect(tabs).toBeVisible();
    await tabs.getByRole("tab", { name: "Queue" }).click();
    await expect(deck.getByRole("navigation", { name: "Review queue" })).toBeVisible();
    await deck
      .getByRole("button", { name: /Focus the Review Deck/ })
      .click();
    await expect(
      deck.getByRole("region", { name: "Changed files and diff" }),
    ).toBeVisible();

    await tabs.getByRole("tab", { name: "Evidence" }).click();
    await expect(
      deck.getByRole("complementary", { name: "Review evidence" }),
    ).toBeVisible();
    await expect(deck.getByText("Waiting on GitHub")).toBeVisible();
  });
});
