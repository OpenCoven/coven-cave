import { expect, test, type Page } from "@playwright/test";

// #6008: the Chat header's title row holds identity · run status · actions.
// Between the 52rem wrap query and a wide pane, a long "Last run needs
// attention" status used to keep its full width while the title fell to
// "Capabil…". Space is now given up in order: a long title truncates to a
// protected floor, then the status stacks inside its own box.

const SESSION_ID = "header-title-room";
const TITLE = "Capability gap · 1 signal";
const ISO = "2026-10-15T10:00:00.000Z";
const PROJECT_ROOT = "/repo";

async function openChatWithLongStatus(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:shell:nav-open", "1");
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
      id: SESSION_ID, title: TITLE, familiarId: "nova", status: "idle",
      project_root: PROJECT_ROOT, harness: "codex", model: "test",
      runtime: `local:${PROJECT_ROOT}`, exit_code: null, archived_at: null,
      created_at: ISO, updated_at: ISO,
    }] },
  }));
  // Two errors and two notices: "Last run needs attention · 2 notices · 2 issues".
  const progress = [
    { id: "queued", label: "Queued request", status: "done" },
    { id: "grants", label: "Unavailable project grants skipped", status: "notice" },
    { id: "compat", label: "Runtime compatibility notice", status: "notice" },
    { id: "tool", label: "Tool call failed", status: "error" },
    { id: "result", label: "Request failed", status: "error", durationMs: 0 },
  ].map((event) => ({ ...event, createdAt: ISO }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task: null, tasks: [], github: [] },
      conversation: {
        familiarId: "nova",
        activeLeafId: "answer",
        turns: [
          { id: "request", parentId: null, role: "user", text: "Compare the hosted recipe", createdAt: ISO },
          { id: "answer", parentId: "request", role: "assistant", text: "The comparison needs the hosted recipe.", lifecycle: "failed", createdAt: ISO, progress },
        ],
      },
    },
  }));
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cave-chat-header-row")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".cave-run-activity")).toContainText("Last run needs attention");
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
}

function headerGeometry(page: Page) {
  return page.locator(".cave-chat-header-row").evaluate((row) => {
    const title = row.querySelector(".cave-chat-title");
    const truncated = title
      ? [title, ...title.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth + 1)
      : true;
    const rowBox = row.getBoundingClientRect();
    const actions = [...row.querySelectorAll(":scope > .cave-chat-session-actions > *")].map((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1;
    });
    const meta = row.querySelector(":scope > .cave-chat-meta-line")?.getBoundingClientRect();
    const status = row.querySelector(":scope > .cave-chat-header-status")?.getBoundingClientRect();
    return {
      pane: Math.round(rowBox.width),
      truncated,
      text: title?.textContent?.trim() ?? "",
      actionsVisible: actions.length > 0 && actions.every(Boolean),
      // Status beside the identity, not wrapped under it.
      statusOnTitleLine: Boolean(meta && status && status.top < meta.bottom - 4),
    };
  });
}

test.describe("Chat header title room", () => {
  test.skip(({ isMobile }) => isMobile, "desktop header geometry");

  test.describe("a 1440px window with the nav and Chat list open", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("keeps the whole title beside a long run status and every action", async ({ page }) => {
      await openChatWithLongStatus(page);
      await expect.poll(async () => (await headerGeometry(page)).truncated).toBe(false);
      const geometry = await headerGeometry(page);
      expect(geometry.text).toContain(TITLE);
      expect(geometry.actionsVisible).toBe(true);
      // Above the 52rem query the status stays on the title row, stacked inside its own box.
      expect(geometry.pane).toBeGreaterThan(52 * 16);
      expect(geometry.statusOnTitleLine).toBe(true);
    });
  });

  test.describe("a 1920px window", () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test("keeps the title, status and actions on one line", async ({ page }) => {
      await openChatWithLongStatus(page);
      const geometry = await headerGeometry(page);
      expect(geometry.truncated).toBe(false);
      expect(geometry.actionsVisible).toBe(true);
      expect(geometry.statusOnTitleLine).toBe(true);
      const statusLines = await page.locator(".cave-chat-header-status").evaluate((status) =>
        new Set([...status.children].map((child) => Math.round(child.getBoundingClientRect().top / 8))).size,
      );
      expect(statusLines).toBe(1);
    });
  });
});
