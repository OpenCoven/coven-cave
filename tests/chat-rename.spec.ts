import { expect, test, type Page } from "@playwright/test";

// The chat header carries an explicit, labeled rename button beside the title
// (aria-label "Rename chat"). Clicking it opens the inline title editor;
// Enter persists via PATCH /api/sessions/:id and the header reflects the new
// name. Self-contained per the daemon-less E2E constraint: sessions and the
// conversation come from route mocks, and the PATCH is intercepted so the
// mock session list can echo the rename back like the daemon would.

const ISO = "2026-06-12T10:00:00.000Z";

const SESSION = {
  id: "s-rename",
  title: "Quarterly plan",
  status: "complete",
  origin: "chat",
  project_root: "/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: "local:/Users/dev/Documents/GitHub/OpenCoven/coven-cave",
  exit_code: 0,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

async function setup(page: Page): Promise<{ patched: () => unknown }> {
  // The PATCH body lands here; the sessions/list mock serves the patched
  // title afterwards so the UI round-trip mirrors the real daemon.
  let currentTitle = SESSION.title;
  let patchedBody: unknown;

  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [{ ...SESSION, title: currentTitle }] } }),
  );
  await page.route("**/api/sessions/s-rename", (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patchedBody = route.request().postDataJSON();
    currentTitle = (patchedBody as { title: string }).title;
    return route.fulfill({ json: { ok: true, title: currentTitle } });
  });
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: { turns: [{ id: "t1", role: "assistant", text: "Plan drafted.", createdAt: ISO }] },
        context: { task: null, github: [] },
      },
    }),
  );
  await page.goto("/");
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });

  return { patched: () => patchedBody };
}

test("header rename button opens the title editor and persists the new name", async ({ page }) => {
  const { patched } = await setup(page);

  // Open the mocked chat from the chat-mode sidebar.
  await page.locator(".chat-sidebar").getByText("Quarterly plan", { exact: false }).first().click();

  // The explicit affordance: a labeled button next to the title — not just
  // click-to-rename on the text or the overflow-menu item.
  const renameBtn = page.getByRole("button", { name: "Rename chat", exact: true });
  await expect(renameBtn).toBeVisible({ timeout: 30_000 });

  await renameBtn.click();
  const input = page.getByRole("textbox", { name: "Chat title" });
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Quarterly plan");

  const patchDone = page.waitForResponse(
    (r) => r.url().includes("/api/sessions/s-rename") && r.request().method() === "PATCH",
  );
  await input.fill("Roadmap review");
  await input.press("Enter");
  await patchDone;

  expect(patched()).toEqual({ title: "Roadmap review" });

  // The editor closes and the header shows the persisted name.
  await expect(input).toHaveCount(0);
  await expect(
    page.locator(".cave-chat-meta-line").getByRole("button", { name: /Roadmap review/ }),
  ).toBeVisible({ timeout: 15_000 });
});
