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
  {
    id: "s-response-wide",
    title: "Wide output",
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

const WIDE_MARKDOWN = `Here is the plan.

\`\`\`ts
const reallyLongIdentifierThatShouldScrollHorizontallyInsideTheCodeBlockAndNotBreakThePageLayoutEvenOnADesktopWideColumn = await reconcileServeRoutes();
\`\`\`

| Column A | Column B | Column C | Column D | Column E | Column F | Column G |
| --- | --- | --- | --- | --- | --- | --- |
| a long cell value here | another long cell value | third long cell value | fourth value that is long | fifth long value | sixth long value | seventh long value |

See https://github.com/OpenCoven/coven-cave/pull/5465/files#diff-${"a".repeat(160)}`;

const COMPLETE_MARKDOWN = `[READY]

The response stays readable and stable while preserving the familiar's authored content.

## Recommendation

- Render **bold**, _italics_, [[READY]](https://example.com/status), and \`threads-dgg\`.
- Keep supporting details beneath the primary conclusion.

Use \`[READY]\` literally in code, while standalone [REVIEW] and [BLOCKED] tokens become badges.

${Array.from(
  { length: 32 },
  (_, index) => `Supporting detail ${index + 1} keeps the transcript scrollable.`,
).join("\n\n")}

<coven:skill name="brainstorming" stage="done" note="Mapped the response structure" />
<coven:skill name="verification-before-completion" stage="running" note="Checking the rendered result" />
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
    const url = route.request().url();
    if (url.includes("s-response-wide")) {
      return route.fulfill({
        json: {
          ok: true,
          conversation: {
            activeLeafId: "a-wide",
            turns: [
              { id: "u-wide", parentId: null, role: "user", text: "Show wide output", createdAt: ISO },
              { id: "a-wide", parentId: "u-wide", role: "assistant", text: WIDE_MARKDOWN, createdAt: ISO },
            ],
          },
        },
      });
    }
    const error = url.includes("s-response-error");
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
  await expect(bubble.locator(".cave-response-lead")).toContainText(
    "The response stays readable and stable",
  );
  await expect(bubble.locator("code").filter({ hasText: "[READY]" })).toHaveCount(1);
  await expect(bubble.locator("code .cave-response-status")).toHaveCount(0);
  await expect(bubble.locator('a[href="https://example.com/status"]')).toContainText("[READY]");
  await expect(
    bubble.locator('a[href="https://example.com/status"] .cave-response-status'),
  ).toHaveCount(0);
  await expect(bubble.locator(".cave-response-status").first()).not.toHaveAttribute(
    "role",
    "status",
  );
  await expect(bubble.getByText("threads-dgg")).toBeVisible();
  const prose = bubble.locator(".streaming-turn-prose");
  await expect(prose.locator("strong")).toContainText("bold");
  await expect(prose.locator("em")).toContainText("italics");

  const width = await bubble.locator(".cave-response-frame").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(width).toBeLessThanOrEqual(768);

  await bubble.hover();
  await expect(
    bubble.getByRole("button", { name: "Copy completed response" }),
  ).toBeVisible();
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

test("wide code, tables and URLs scroll inside the reply instead of widening it", async ({ page }) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-response-wide", { waitUntil: "domcontentloaded" });

  const bubble = page.locator('.cave-bubble-assistant[data-state="complete"]').last();
  await expect(bubble.getByText("Here is the plan.")).toBeVisible({ timeout: 30_000 });
  // An auto-sized grid track grew to the widest child, so the reply ran past
  // its column and the overflow was clipped instead of scrolling (#5527).
  const fits = await bubble.evaluate((element) => {
    const column = element.getBoundingClientRect();
    const md = element.querySelector(".streaming-turn-prose .cave-md")?.getBoundingClientRect();
    const pre = element.querySelector("pre");
    const scroller = element.querySelector(".cave-table-scroll") ?? element.querySelector("table");
    return {
      mdInside: Boolean(md) && md!.right <= column.right + 1,
      preScrolls: Boolean(pre) && pre!.scrollWidth > pre!.clientWidth,
      tableContained: Boolean(scroller) && scroller!.getBoundingClientRect().right <= column.right + 1,
    };
  });
  expect(fits).toEqual({ mdInside: true, preScrolls: true, tableContained: true });
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

test("run skills open one complete ledger and reading older output hides the composer", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-response-complete", { waitUntil: "domcontentloaded" });

  const verificationCard = page.getByRole("button", {
    name: /Open details for skill verification-before-completion/,
  });
  await expect(verificationCard).toBeVisible({ timeout: 30_000 });
  await verificationCard.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Skills used in this run" })).toBeVisible();
  await expect(dialog.getByText("brainstorming", { exact: true })).toBeVisible();
  await expect(dialog.getByText("verification-before-completion", { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-selected="true"]')).toContainText(
    "verification-before-completion",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(verificationCard).toBeFocused();

  const mainChat = page.getByTestId("chat-main");
  const transcript = mainChat.locator(".cave-chat-transcript");
  const composer = mainChat.locator(".cave-composer-dock");
  await expect(composer).toBeVisible();
  await transcript.hover();
  await page.mouse.wheel(0, -900);
  await expect(composer).toHaveCount(0);
  await mainChat.getByRole("button", { name: "Latest" }).click();
  await expect(composer).toBeVisible();
});

test("the header archive button sends one archive mutation and leaves the session", async ({
  page,
}) => {
  await setup(page);
  let archiveRequests = 0;
  await page.route("**/api/sessions/s-response-complete", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fallback();
      return;
    }
    archiveRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ archived: true });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/?mode=chat#chat-s-response-complete", { waitUntil: "domcontentloaded" });

  const archive = page.getByRole("button", { name: "Archive this chat" });
  await expect(archive).toBeVisible({ timeout: 30_000 });
  await archive.click();

  await expect.poll(() => archiveRequests).toBe(1);
  await expect(page).not.toHaveURL(/#chat-s-response-complete$/);
});
