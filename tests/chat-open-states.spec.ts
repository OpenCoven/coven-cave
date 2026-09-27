import { expect, test } from "@playwright/test";

// #5583: how a chat's history states read when it opens.

const ISO = new Date().toISOString();

test("a chat deleted elsewhere while open says so and offers no Retry (#5583)", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: [{ id: "project-repo", name: "repo", root: "/repo", createdAt: ISO, updatedAt: ISO }] } }),
  );
  // The chat is listed when the link opens, then deleted elsewhere: later
  // list refreshes no longer carry it.
  let listed = true;
  await page.route("**/api/sessions/list**", (route) => {
    const sessions = listed
      ? [{
        id: "gone-5583", title: "Soon deleted", status: "completed", origin: "chat", project_root: "/repo",
        harness: "claude", familiarId: "nova", exit_code: 0, archived_at: null,
        created_at: ISO, updated_at: ISO, attention: { state: "none", since: null, reason: null },
      }]
      : [];
    return route.fulfill({ json: { ok: true, sessions } });
  });
  // The chat's transcript is gone: the conversation endpoint answers 404.
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({ status: 404, json: { ok: false, error: "not found" } }),
  );

  await page.goto("/#chat-gone-5583", { waitUntil: "domcontentloaded" });
  const main = page.getByTestId("chat-main");
  // Still listed: a 404 means no transcript has been saved yet.
  await expect(main.getByText("This chat exists, but Coven Cave couldn't find a saved transcript yet.")).toBeVisible({ timeout: 45_000 });
  listed = false;
  // Once the list no longer carries it, the chat reads as deleted.
  await expect(main.getByText("This chat was deleted or moved")).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("This chat exists, but Coven Cave couldn't find a saved transcript yet.")).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Back to chats" })).toBeVisible();
});
