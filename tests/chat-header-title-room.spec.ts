import { expect, test, type Page } from "@playwright/test";

// #6201: title and metadata occupy two rows beside the familiar, with at
// most one additional activity row. Keep the title room protected by #6008.

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
      statusBelowIdentity: Boolean(meta && status && status.top >= meta.bottom),
      height: rowBox.height,
      avatarHeight: row.querySelector(".cave-chat-header-avatar")?.getBoundingClientRect().height,
      avatarRadius: getComputedStyle(row.querySelector(".cave-chat-header-avatar")!).borderRadius,
      actionsShareRow: Boolean(meta && status && [meta.top, status.top].includes(row.querySelector(":scope > .cave-chat-session-actions")?.getBoundingClientRect().top ?? -1)),
    };
  });
}

test.describe("Chat header title room", () => {
  test.skip(({ isMobile }) => isMobile, "desktop header geometry");

  for (const width of [1024, 1440, 1920]) {
    test.describe(`${width}px window`, () => {
      test.use({ viewport: { width, height: 900 } });

      test("keeps title, metadata and activity within three rows", async ({ page }) => {
        await openChatWithLongStatus(page);
        const geometry = await headerGeometry(page);
        expect(geometry.text).toContain(TITLE);
        if (width >= 1440) expect(geometry.truncated).toBe(false);
        expect(geometry.actionsVisible).toBe(true);
        expect(geometry.actionsShareRow).toBe(true);
        expect(geometry.statusBelowIdentity).toBe(true);
        expect(geometry.height).toBeLessThanOrEqual(72);
        expect(geometry.avatarHeight).toBe(44);
        expect(geometry.avatarRadius).toBe("8px");
        await page.locator(".cave-chat-linear-header").screenshot({ path: test.info().outputPath("header.png") });
        if (width === 1440) {
          for (const [theme, mode] of [["coven", "light"], ["tide", "dark"]]) {
            await page.evaluate(([theme, mode]) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.dataset.mode = mode;
            }, [theme, mode]);
            expect((await headerGeometry(page)).height).toBeLessThanOrEqual(72);
            await page.locator(".cave-chat-linear-header").screenshot({ path: test.info().outputPath(`header-${theme}-${mode}.png`) });
          }
        }
      });
    });
  }
});
