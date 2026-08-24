import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-24T12:00:00.000Z";
const SESSION_ID = "composer-followup";
const RATIONALE = "Keeps the active implementation moving without another navigation step.";

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
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
    route.fulfill({
      json: {
        ok: true,
        sessions: [
          {
            id: SESSION_ID,
            title: "Composer follow-up",
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
        ],
      },
    }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: "assistant-1",
          turns: [
            {
              id: "user-1",
              parentId: null,
              role: "user",
              text: "Polish the composer.",
              createdAt: ISO,
            },
            {
              id: "assistant-1",
              parentId: "user-1",
              role: "assistant",
              text: `The composer is ready.

<coven:next-paths>
- [reply:recommended rationale="${RATIONALE}" evidence="message:assistant-1"] Draft the concise follow-up
- [task rationale="Captures the remaining verification as durable work." evidence="message:assistant-1"] Review the validation task
- [action:open-tasks rationale="Shows the project queue without changing this conversation." evidence="message:assistant-1"] Open project tasks
</coven:next-paths>`,
              createdAt: ISO,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        projects: [
          { id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" },
        ],
      },
    }),
  );
}

test("chat composer is full-width and follow-up rationale does not reflow it", async ({
  page,
}) => {
  await setup(page);
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });

  const main = page.getByTestId("chat-main");
  const shell = main.locator(".cave-chat-linear .cave-composer-shell");
  const dock = main.locator(".cave-chat-linear .cave-composer-dock");
  const input = main.locator(".cave-chat-linear .cave-composer-input");
  const why = main.getByRole("button", {
    name: "Why this suggestion: Draft the concise follow-up",
  });
  await expect(why).toBeVisible({ timeout: 45_000 });

  const before = {
    shellHeight: (await shell.boundingBox())?.height,
    documentHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  };
  const [shellBox, dockBox, inputBox] = await Promise.all([
    shell.boundingBox(),
    dock.boundingBox(),
    input.boundingBox(),
  ]);
  expect(shellBox?.width ?? 0).toBeGreaterThan((dockBox?.width ?? 0) * 0.9);
  expect(inputBox?.height).toBeLessThanOrEqual(44);

  await why.click();
  const dialog = page.getByRole("dialog", {
    name: "Why this suggestion: Draft the concise follow-up",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(RATIONALE);
  await expect(page.getByRole("button", { name: "Close explanation" })).toBeFocused();

  const after = {
    shellHeight: (await shell.boundingBox())?.height,
    documentHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  };
  expect(after).toEqual(before);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(why).toBeFocused();
});
