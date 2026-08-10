import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-10T12:00:00.000Z";

const SESSIONS = [
  {
    id: "s-response-complete",
    title: "Response output",
    status: "idle",
    project_root: "/tmp/coven-cave",
    harness: "claude",
    familiarId: "nova",
    model: "test",
    runtime: "local:/tmp/coven-cave",
    exit_code: null,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
  },
  {
    id: "s-response-error",
    title: "Interrupted output",
    status: "idle",
    project_root: "/tmp/coven-cave",
    harness: "claude",
    familiarId: "nova",
    model: "test",
    runtime: "local:/tmp/coven-cave",
    exit_code: null,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
  },
];

const COMPLETE_MARKDOWN = `[READY]

The response stays readable and stable while preserving the familiar's authored content.

## Recommendation

- Render **bold**, _italics_, [links](https://example.com), and \`threads-dgg\`.
- Keep supporting details beneath the primary conclusion.

Use \`[READY]\` literally in code, while standalone [REVIEW] and [BLOCKED] tokens become badges.
`;

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          {
            id: "nova",
            display_name: "Nova",
            role: "Orchestrator",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.route("**/api/chat/conversation/**", (route) => {
    const error = route.request().url().includes("s-response-error");
    const userId = error ? "u-error" : "u-complete";
    const assistantId = error ? "a-error" : "a-complete";
    return route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: assistantId,
          turns: [
            {
              id: userId,
              parentId: null,
              role: "user",
              text: error ? "Show interrupted output" : "Show response output",
              createdAt: ISO,
            },
            {
              id: assistantId,
              parentId: userId,
              role: "assistant",
              text: error
                ? "The provider returned a useful partial answer before the connection ended."
                : COMPLETE_MARKDOWN,
              isError: error,
              createdAt: ISO,
            },
          ],
        },
      },
    });
  });
}

test("completed assistant responses render editorial Markdown and accessible controls", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-response-complete", { waitUntil: "domcontentloaded" });

  const bubble = page.locator('.cave-bubble-assistant[data-state="complete"]').last();
  await expect(bubble.getByText("The response stays readable and stable")).toBeVisible({
    timeout: 30_000,
  });
  await expect(bubble.locator(".cave-response-status")).toHaveCount(3);
  await expect(bubble.getByText("threads-dgg")).toBeVisible();
  await expect(bubble.locator("strong")).toContainText("bold");
  await expect(bubble.locator("em")).toContainText("italics");

  const width = await bubble.locator(".cave-response-frame").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(width).toBeLessThanOrEqual(768);

  await bubble.hover();
  await expect(bubble.getByRole("button", { name: "Copy message" })).toBeVisible();
  await expect(bubble.getByRole("button", { name: "Retry response" })).toBeVisible();
  await bubble.getByRole("button", { name: "Collapse", exact: true }).click();
  await expect(bubble.getByText("Response collapsed")).toBeVisible();
  await bubble.getByRole("button", { name: "Expand", exact: true }).click();

  await bubble.getByRole("button", { name: "More response actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Open reader" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Read aloud" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Good response" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("interrupted responses preserve partial text and keep Retry visible", async ({ page }) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-response-error", { waitUntil: "domcontentloaded" });

  const bubble = page.locator('.cave-bubble-assistant[data-state="error"]').last();
  await expect(bubble.getByText("The provider returned a useful partial answer")).toBeVisible({
    timeout: 30_000,
  });
  await expect(bubble.getByText("Response interrupted")).toBeVisible();
  await expect(bubble.getByRole("button", { name: "Retry response" })).toBeVisible();
});
