import { expect, test, type Page } from "@playwright/test";

const NOTICE = "A Claude Code tool frame is not supported by the selected compatibility profile; stream-json tool bubbles are disabled, but local hook evidence will still be shown when available.";
const PATH = `/repo/${"a-very-long-directory/".repeat(30)}evidence.json`;

async function openActivity(page: Page, failed = false) {
  const now = new Date().toISOString();
  await page.route("**/api/inbox**", (route) => route.fulfill({ json: { ok: true, items: [] } }));
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [{ id: "repo", name: "repo", root: "/repo", createdAt: now, updatedAt: now }] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [{ id: "activity-5934", title: "Activity updates", status: "completed", origin: "chat", project_root: "/repo", harness: "claude", familiarId: "nova", exit_code: failed ? 1 : 0, archived_at: null, created_at: now, updated_at: now }] } }));
  const progress = [
    { id: "queued", label: "Queued request", status: "done" },
    { id: "bridge", label: "Connected to chat bridge", status: "done" },
    { id: "grants", label: "Unavailable project grants skipped", status: "notice", detail: "One registered project directory was unavailable on this host." },
    { id: "access", label: "Filesystem access refreshed", status: "done", detail: PATH },
    { id: "harness", label: "Starting runtime", status: "done" },
    { id: "stream", label: "Receiving response", status: failed ? "running" : "done" },
    { id: "result", label: failed ? "Request failed" : "Succeeded", status: failed ? "error" : "done", durationMs: 0 },
    { id: "claude-runtime-compatibility", label: NOTICE, status: "notice" },
  ].map((event) => ({ ...event, createdAt: now }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({ json: {
    ok: true, context: { task: null, github: [] }, conversation: { familiarId: "nova", activeLeafId: "answer", turns: [
      { id: "request", parentId: null, role: "user", text: "Review the activity", createdAt: now },
      { id: "answer", parentId: "request", role: "assistant", text: "The activity is ready to inspect.", lifecycle: failed ? "failed" : "complete", createdAt: now, progress },
    ] },
  } }));
  await page.goto("/#chat-activity-5934", { waitUntil: "domcontentloaded" });
  const main = page.getByTestId("chat-main");
  await expect(main.getByText("The activity is ready to inspect.")).toBeVisible({ timeout: 45_000 });
  const activity = main.locator("details.streaming-turn-activity").first();
  await activity.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  const group = activity.locator(".cave-progress-group");
  await expect(group).toBeVisible();
  return { activity, group };
}

test("activity diagnostics fit narrow panes and retain keyboard disclosure across themes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  const { activity, group } = await openActivity(page);
  await expect(group.locator(".cave-progress-heading")).toHaveText("Run activity");
  await expect(group.locator(".cave-progress-count")).toHaveText("8 of 8 settled");
  await expect(group.locator(".cave-progress-notices")).toHaveText("2 notices recorded");
  await expect(group.locator(".cave-progress-bar")).toHaveCount(0);
  await group.evaluate((el) => { el.style.width = "640px"; });
  await group.screenshot({ path: info.outputPath("activity-overview.png") });
  const notice = group.locator("summary").filter({ hasText: "Runtime compatibility notice" });
  await expect(notice).toBeVisible();
  await expect(group.locator(".cave-progress-detail").filter({ hasText: NOTICE })).not.toBeVisible();
  await notice.focus();
  await page.keyboard.press("Enter");
  await expect(group.locator(".cave-progress-detail").filter({ hasText: NOTICE })).toBeVisible();
  const path = group.locator("summary").filter({ hasText: "Filesystem access refreshed" });
  await path.focus();
  await page.keyboard.press("Space");
  await expect(group.getByText(PATH, { exact: true })).toBeVisible();
  for (const [theme, mode, width] of [["coven", "dark", 640], ["coven", "light", 320], ["tide", "dark", 280]] as const) {
    await page.evaluate(({ theme, mode }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, { theme, mode });
    await group.evaluate((el, width) => { el.style.width = `${width}px`; }, width);
    const overflow = await group.evaluate((el) => [...el.querySelectorAll<HTMLElement>(".cave-progress-row, .cave-progress-detail")].filter((row) => row.scrollWidth > row.clientWidth + 1).map((row) => ({ text: row.textContent, scroll: row.scrollWidth, client: row.clientWidth })));
    expect(overflow).toEqual([]);
    await group.screenshot({ path: info.outputPath(`activity-${theme}-${mode}-${width}.png`) });
  }
  await notice.focus();
  await expect(notice).toBeFocused();
  expect(await notice.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Escape");
  await expect(notice).toBeFocused();
  await expect(group.locator(".cave-progress-detail").filter({ hasText: NOTICE })).not.toBeVisible();
  // Reopening the outer disclosure retains user-opened rows and keyboard focus.
  await activity.locator(":scope > summary").click();
  await activity.locator(":scope > summary").click();
  await expect(group.getByText(PATH, { exact: true })).toBeVisible();
});

test("failed activity keeps errors and unfinished steps explicit without idle animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { group } = await openActivity(page, true);
  await expect(group.locator(".cave-progress-heading")).toHaveText("Activity needs attention");
  await expect(group.locator(".cave-progress-count")).toHaveText("7 of 8 settled");
  await expect(group.locator(".cave-progress-row--error")).toContainText("Error: Request failed");
  await expect(group.locator(".cave-progress-row--running")).toContainText("Unfinished: Receiving response");
  await expect(group.locator(".cave-progress-meta").filter({ hasText: "0s" })).toBeVisible();
  const animations = await group.locator("svg").evaluateAll((nodes) => nodes.map((el) => getComputedStyle(el).animationName));
  expect(animations.every((name) => name === "none")).toBe(true);
});

test.describe("touch activity", () => {
  test.use({ hasTouch: true });

  test("touch disclosures keep generous targets and readable diagnostics", async ({ page }, info) => {
    const { group } = await openActivity(page);
    const notice = group.locator("summary").filter({ hasText: "Runtime compatibility notice" });
    const bounds = await notice.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await notice.tap();
    await expect(group.locator(".cave-progress-detail").filter({ hasText: NOTICE })).toBeVisible();
    expect(await group.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await notice.tap();
    await expect(group.locator(".cave-progress-detail").filter({ hasText: NOTICE })).not.toBeVisible();
    await group.screenshot({ path: info.outputPath("activity-touch.png") });
  });
});
