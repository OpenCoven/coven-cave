import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-06T12:00:00.000Z";
const SESSION = {
  id: "s-transcript-fold",
  title: "Long-running migration",
  status: "running",
  origin: "chat",
  project_root: "/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  harness: "claude",
  familiarId: "nova",
  model: "sonnet-4.6",
  runtime: "local:/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

const TURNS = Array.from({ length: 64 }, (_, index) => ({
  id: `turn-${index + 1}`,
  role: index % 2 === 0 ? "user" : "assistant",
  text: `Transcript turn ${index + 1}`,
  createdAt: new Date(Date.parse(ISO) + index * 60_000).toISOString(),
}));

async function setup(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({ json: { ok: true, conversation: { turns: TURNS }, context: {} }),
  );

  await page.goto("/?mode=chat");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.getByText(SESSION.title).first().click();
}

test("a live long transcript toggles its labeled earlier-turn fold", async ({ page }) => {
  await setup(page);

  const fold = page.getByTitle("Toggle earlier turns");
  await expect(fold).toBeVisible({ timeout: 30_000 });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(fold).toContainText("4 earlier turns");
  await expect(page.locator("[data-turn-id]")).toHaveCount(60);

  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(fold).toContainText("Hide earlier turns");
  await expect(page.locator("[data-turn-id]")).toHaveCount(64);

  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-turn-id]")).toHaveCount(60);
});
