import { expect, test, type Locator, type Page } from "@playwright/test";

// #6018: a reply's author line (name · status · time, then the hover-revealed
// meta, badge and ⓘ peek) was a flex row that never wrapped, so on panes up to
// ~400px — a narrow split pane, the right Chat panel at its default 320px — it
// ran past the pane edge and clipped the peek control. It now wraps its meta
// onto a second line only when it doesn't fit.

test.use({ serviceWorkers: "block" });

const ISO = "2026-10-15T10:00:00.000Z";
const ROOT = "/Users/dev/Documents/GitHub/OpenCoven/coven-cave";
const session = (id: string, title: string) => ({
  id, title, status: "idle", project_root: ROOT, harness: "codex", familiarId: "nova", model: "openai/gpt-6-astra",
  runtime: `local:${ROOT}`, exit_code: null, archived_at: null, created_at: ISO, updated_at: ISO,
});
const SESSIONS = [session("s-alpha", "Alpha planning thread"), session("s-beta", "Beta review thread")];

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, tasks: [], github: [] },
      conversation: {
        familiarId: "nova",
        activeLeafId: "a",
        turns: [
          { id: "u", parentId: null, role: "user", text: "Compare the hosted recipe", createdAt: ISO },
          {
            id: "a", parentId: "u", role: "assistant", lifecycle: "complete", createdAt: ISO, durationMs: 181_000,
            text: "The comparison needs the hosted recipe.",
            responseMetadata: {
              familiarId: "nova", harness: "codex", model: "openai/gpt-6-astra", runtime: `local:${ROOT}`,
              runtimeIdentity: { schemaVersion: 1, harness: "codex", version: "1.2.3", model: "openai/gpt-6-astra" },
            },
          },
        ],
      },
    },
  }));
}

async function openSplit(page: Page) {
  await page.goto("/?mode=chat");
  await page.waitForTimeout(500);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  await page.getByRole("button", { name: /Alpha planning thread/ }).first().click();
  const beta = page.getByRole("button", { name: /Beta review thread/ }).first();
  await beta.focus();
  await page.keyboard.press("Alt+Enter");
  const pane = page.locator('[data-chat-split-pane="s-beta"] .cave-chat-linear');
  await expect(pane.locator(".streaming-turn-current__row--author").first()).toBeVisible({ timeout: 30_000 });
  return pane;
}

function authorLine(scope: Locator) {
  return scope.evaluate((root) => {
    const pane = root.getBoundingClientRect();
    const row = root.querySelector(".streaming-turn-current__row--author");
    if (!row) return null;
    const parts = [row, ...row.querySelectorAll("*")]
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    // Children are centred on the row, so compare vertical centres, not tops:
    // a 32px button and an 18px line of text share a row at different tops.
    const centers = [...row.children]
      .map((child) => child.getBoundingClientRect())
      .filter((box) => box.height > 0)
      .map((box) => box.top + box.height / 2);
    return {
      inside: parts.every((box) => box.right <= pane.right + 1),
      oneRow: Math.max(...centers) - Math.min(...centers) <= 8,
    };
  });
}

test.describe("a reply's author line in narrow panes", () => {
  test.skip(({ isMobile }) => isMobile, "desktop split panes");
  test.use({ viewport: { width: 1920, height: 1000 } });

  test("stays inside a 320px split pane and keeps one row at 760px", async ({ page }) => {
    await setup(page);
    const pane = await openSplit(page);
    await page.mouse.move(0, 0);
    for (const width of [320, 760]) {
      await pane.evaluate((node, w) => { (node as HTMLElement).style.width = `${w}px`; (node as HTMLElement).style.flex = "none"; }, width);
      await expect.poll(async () => (await authorLine(pane))?.inside).toBe(true);
      if (width === 760) expect((await authorLine(pane))?.oneRow).toBe(true);
    }
  });

  test("stays inside the right Chat panel at its default width", async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => localStorage.setItem("cave:shell:right-chat-width", "320"));
    await page.goto("/?mode=home");
    await page.getByRole("button", { name: "Open Chat panel" }).first().click();
    const panel = page.locator('[data-panel][id="right-chat"]');
    await expect(panel.locator(".streaming-turn-current__row--author").first()).toBeVisible({ timeout: 30_000 });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await authorLine(panel))?.inside).toBe(true);
  });
});
