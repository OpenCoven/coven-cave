import { expect, test, type Page } from "@playwright/test";

// #6009: narrowing the Chat pane while a chat is showing (opening the nav,
// dragging a separator) must narrow the transcript with it. Off-screen turns
// (content-visibility: auto) remember their last rendered width, which became
// the transcript's min-content; its flex host lacked min-width: 0, so the
// transcript kept its old width and prose, chips and code were clipped at the
// pane's right edge.

const SESSION_ID = "pane-narrow";
const ISO = "2026-10-15T10:00:00.000Z";
const PROJECT_ROOT = "/repo";

async function openLongChat(page: Page) {
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
    json: { ok: true, projects: [{ id: "p1", name: "Cave", root: PROJECT_ROOT, access: "write" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({
    json: { ok: true, sessions: [{
      id: SESSION_ID, title: "Pane narrowing", familiarId: "nova", status: "idle",
      project_root: PROJECT_ROOT, harness: "claude", model: "test",
      runtime: `local:${PROJECT_ROOT}`, exit_code: null, archived_at: null,
      created_at: ISO, updated_at: ISO,
    }] },
  }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, tasks: [], github: [] },
      conversation: {
        activeLeafId: "turn-39",
        turns: Array.from({ length: 40 }, (_, index) => ({
          id: `turn-${index}`,
          parentId: index === 0 ? null : `turn-${index - 1}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Message ${index + 1}. ${"Keep the conversation inside its pane at every width. ".repeat(10)}`,
          createdAt: ISO,
        })),
      },
    },
  }));
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cave-chat-transcript").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".cave-linear-turn")).not.toHaveCount(0);
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
}

async function readWholeThread(page: Page) {
  const transcript = page.locator(".cave-chat-transcript").first();
  const frames = () =>
    page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await transcript.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await frames();
  await transcript.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await frames();
}

function widths(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-panel][id="chat-main"]')?.getBoundingClientRect();
    const transcript = document.querySelector(".cave-chat-transcript")?.getBoundingClientRect();
    return { pane: pane?.width ?? 0, paneRight: pane?.right ?? 0, transcript: transcript?.width ?? 0, transcriptRight: transcript?.right ?? 0 };
  });
}

for (const viewport of [{ width: 1100, height: 800 }, { width: 1024, height: 768 }]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.skip(({ isMobile }) => isMobile, "desktop shell geometry");
    test.use({ viewport });

    test("opening the nav on a showing chat narrows the transcript with its pane", async ({ page }) => {
      await openLongChat(page);
      // Only a turn that has rendered and then scrolled out of view carries a
      // remembered size, so read the whole thread once, as a reader would.
      await readWholeThread(page);
      const before = await widths(page);
      expect(before.transcript).toBeLessThanOrEqual(before.pane + 1);

      const toggle = page.locator(".shell-top-toggle--nav");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      // The pane narrows by the nav's width; the transcript must follow it.
      await expect.poll(async () => (await widths(page)).pane).toBeLessThan(before.pane - 100);
      await expect
        .poll(async () => {
          const after = await widths(page);
          return after.transcriptRight - after.paneRight;
        })
        .toBeLessThanOrEqual(1);
    });
  });
}
