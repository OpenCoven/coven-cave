import { expect, test, type Page } from "@playwright/test";

// #6014: the composer footer band (project · runtime · model chips, then the
// linked-work actions) wraps, and the chip cluster used to claim its chips'
// full width. On a narrow pane that pushed "Create task" onto its own line;
// the chips now scroll inside their cluster and the band stays one row.

const SESSION_ID = "composer-footer-row";
const ISO = "2026-10-15T10:00:00.000Z";
const PROJECT_ROOT = "/repo";

async function openChat(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:shell:nav-open", "0");
    localStorage.setItem("cave:shell:nav-open:source", "user");
    localStorage.setItem("cave:chat-rail:open", "true");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] },
  }));
  await page.route("**/api/projects**", (route) => route.fulfill({
    json: { ok: true, projects: [{ id: "p1", name: "River Oaks", root: PROJECT_ROOT, access: "write" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({
    json: { ok: true, sessions: [{
      id: SESSION_ID, title: "Footer row", familiarId: "nova", status: "idle",
      project_root: PROJECT_ROOT, harness: "codex", model: "openai/gpt-6-astra",
      runtime: `local:${PROJECT_ROOT}`, exit_code: null, archived_at: null,
      created_at: ISO, updated_at: ISO,
    }] },
  }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, tasks: [], github: [] },
      conversation: {
        familiarId: "nova",
        activeLeafId: "answer",
        turns: [
          { id: "request", parentId: null, role: "user", text: "Plan the next step", createdAt: ISO },
          { id: "answer", parentId: "request", role: "assistant", text: "Here is the plan.", createdAt: ISO },
        ],
      },
    },
  }));
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cave-composer-footer-band").first()).toBeVisible({ timeout: 45_000 });
  // The footer button's accessible name is its aria-label; its visible text is "Create task".
  await expect(page.getByRole("button", { name: "Create a task from this conversation" }).first()).toBeVisible();
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
}

function footerRows(page: Page) {
  return page.locator(".cave-composer-footer-band").first().evaluate((band) => {
    const cluster = band.querySelector(":scope > .cave-composer-footer-band__cluster")?.getBoundingClientRect();
    const linked = band.querySelector(":scope > .cave-chat-linked-context")?.getBoundingClientRect();
    const bandBox = band.getBoundingClientRect();
    return {
      sameRow: Boolean(cluster && linked && Math.abs(cluster.top + cluster.height / 2 - (linked.top + linked.height / 2)) <= 4),
      linkedInside: Boolean(linked && linked.right <= bandBox.right + 1),
      bandWidth: Math.round(bandBox.width),
    };
  });
}

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test.describe(`at ${viewport.width}px with the nav open`, () => {
    test.skip(({ isMobile }) => isMobile, "desktop composer geometry");
    test.use({ viewport });

    test("the chips and Create task share one footer row", async ({ page }) => {
      await openChat(page);
      const toggle = page.locator(".shell-top-toggle--nav");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect.poll(async () => (await footerRows(page)).sameRow).toBe(true);
      expect((await footerRows(page)).linkedInside).toBe(true);
    });
  });
}
