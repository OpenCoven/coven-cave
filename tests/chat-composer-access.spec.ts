import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-25T02:00:00.000Z";
const SESSION_ID = "composer-access";

async function setup(page: Page, sends: Array<Record<string, unknown>>) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }));
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessions: [{
          id: SESSION_ID,
          title: "Composer access",
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
        }],
      },
    }));
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" }],
      },
    }));
  await page.route("**/api/chat/conversation/**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            ok: true,
            conversation: {
              activeLeafId: "assistant-1",
              turns: [{
                id: "assistant-1",
                parentId: null,
                role: "assistant",
                text: "Choose the access level for the next request.",
                createdAt: ISO,
              }],
            },
          },
        })
      : route.fulfill({ json: { ok: true } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"done"}\n\n',
    });
  });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-main").locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
}

async function chooseAccess(page: Page, label: "Explore · read only" | "Build · full access") {
  await page.getByTestId("chat-main").getByRole("button", { name: "Tools" }).click();
  const responseTrigger = page.getByRole("menuitem", { name: /Response options/ });
  await responseTrigger.hover();
  const dialog = page.getByRole("dialog", { name: "Response options" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: label }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function send(page: Page, prompt: string) {
  const main = page.getByTestId("chat-main");
  await main.locator(".cave-composer-input").fill(prompt);
  await main.getByRole("button", { name: "Send message" }).click();
}

test("Response options preserves Explore and Build permission payloads", async ({ page }) => {
  const sends: Array<Record<string, unknown>> = [];
  await setup(page, sends);

  await chooseAccess(page, "Explore · read only");
  await send(page, "Inspect the repository.");
  await expect.poll(() => sends.find((entry) => entry.prompt === "Inspect the repository.")?.permissionMode)
    .toBe("read");

  await chooseAccess(page, "Build · full access");
  await send(page, "Apply the focused patch.");
  await expect.poll(() => sends.find((entry) => entry.prompt === "Apply the focused patch.")?.permissionMode)
    .toBe("full");
});
