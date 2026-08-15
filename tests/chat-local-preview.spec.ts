import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-15T12:00:00.000Z";
const PREVIEW_URL = "http://127.0.0.1:3000/demo";
const SESSION = {
  id: "s-local-preview",
  title: "Local preview delivery",
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
};

async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
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
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: "a-preview",
          turns: [
            {
              id: "u-preview",
              parentId: null,
              role: "user",
              text: "Show the local demo beside our conversation.",
              createdAt: ISO,
            },
            {
              id: "a-preview",
              parentId: "u-preview",
              role: "assistant",
              text: `The demo is ready.\n\n<coven:preview url="${PREVIEW_URL}" title="Routing demo" />`,
              createdAt: ISO,
            },
          ],
        },
      },
    }),
  );
}

test("local preview card opens Browser beside Chat without replacing the transcript", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-local-preview", { waitUntil: "domcontentloaded" });

  const card = page
    .locator('.cave-bubble-assistant section')
    .filter({ hasText: "Routing demo" });
  await expect(card).toContainText("127.0.0.1:3000/demo", { timeout: 30_000 });
  await expect(page.getByText("<coven:preview")).toHaveCount(0);

  await card.getByRole("button", { name: "Open beside chat" }).click();

  const split = page.locator(".split-host__group");
  const chatPane = page.locator('[data-pane-instance="workspace-primary"]');
  const browserPane = page.locator('[data-pane-instance="chat-preview-browser"]');
  await expect(split).toBeVisible({ timeout: 30_000 });
  await expect(chatPane.getByText("Show the local demo beside our conversation.")).toBeVisible();
  await expect(browserPane.locator(".browser-pane")).toBeVisible({ timeout: 30_000 });
  await expect(browserPane.locator(".browser-address-input")).toHaveValue(PREVIEW_URL, {
    timeout: 30_000,
  });

  const [chatBox, browserBox] = await Promise.all([
    chatPane.boundingBox(),
    browserPane.boundingBox(),
  ]);
  expect(chatBox).not.toBeNull();
  expect(browserBox).not.toBeNull();
  expect(browserBox!.x).toBeGreaterThan(chatBox!.x);
});
