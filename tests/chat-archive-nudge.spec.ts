import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "archive-guidance";
const ISO = "2026-09-09T10:00:00.000Z";
const PROJECT_ROOT = "/repo";

async function openChat(
  page: Page,
  options: { lifecycle?: string | null; running?: boolean; failArchive?: boolean } = {},
) {
  const mutations: unknown[] = [];
  let failArchive = options.failArchive ?? false;
  let archived = false;
  const task = options.lifecycle === null ? null : {
    id: "archive-task",
    title: "Polish archive guidance",
    status: "done",
    lifecycle: options.lifecycle ?? "completed",
    priority: "medium",
    labels: [],
    cwd: PROJECT_ROOT,
    projectId: "p1",
    notes: null,
  };
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{
      id: "nova", display_name: "Nova", role: "Orchestrator",
      status: "active", icon: "ph:sparkle-fill",
    }] },
  }));
  await page.route("**/api/projects**", (route) => route.fulfill({
    json: { ok: true, projects: [{ id: "p1", name: "Cave", root: PROJECT_ROOT, access: "write" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({
    json: { ok: true, sessions: archived ? [] : [{
      id: SESSION_ID, title: "Archive guidance", familiarId: "nova",
      status: options.running ? "running" : "idle",
      project_root: PROJECT_ROOT, harness: "claude", model: "test",
      runtime: `local:${PROJECT_ROOT}`, exit_code: null, archived_at: null,
      created_at: ISO, updated_at: ISO,
    }] },
  }));
  await page.route("**/api/chat/conversation/**", (route) => route.fulfill({
    json: {
      ok: true,
      context: { task, tasks: task ? [task] : [], github: [] },
      conversation: {
        activeLeafId: "turn-39",
        turns: Array.from({ length: 40 }, (_, index) => ({
          id: `turn-${index}`,
          parentId: index === 0 ? null : `turn-${index - 1}`,
          role: index % 2 === 0 ? "user" : "assistant",
          text: `Message ${index + 1}. ${"Review the completed work and keep its history. ".repeat(12)}`,
          createdAt: ISO,
        })),
      },
    },
  }));
  await page.route(`**/api/sessions/${SESSION_ID}`, (route) => {
    mutations.push(route.request().postDataJSON());
    if (failArchive) {
      failArchive = false;
      return route.fulfill({ status: 500, json: { ok: false, error: "Archive unavailable. Try again." } });
    }
    archived = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cave-chat-transcript").first()).toBeVisible({ timeout: 45_000 });
  return mutations;
}

test("archive guidance stays visible above the composer, including while reading older messages", async ({ page }) => {
  await openChat(page);
  const nudge = page.getByTestId("chat-archive-nudge");
  await expect(nudge.getByRole("heading", { name: "Task complete. Ready to archive?" })).toBeVisible();
  await expect(nudge).toContainText("finished with this topic");
  await expect(nudge).toContainText("not its history");
  await expect(nudge).toContainText("Show archived");
  await expect(nudge.getByRole("button", { name: "Archive chat" })).toHaveClass(/ui-btn--primary/);
  expect(await nudge.evaluate((element) => element.closest(".cave-chat-transcript") === null)).toBe(true);

  const composer = page.locator(".cave-composer-dock").first();
  const nudgeBox = await nudge.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(nudgeBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(nudgeBox!.y + nudgeBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);

  await page.locator(".cave-chat-transcript").first().evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(nudge).toBeInViewport({ ratio: 1 });
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme, mode });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(nudge).toBeInViewport({ ratio: 1 });
    expect(await nudge.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(nudge.getByRole("button", { name: "Keep chat open" })).toBeVisible();
  }
});

test("keeping a chat open dismisses only the prompt and survives reload", async ({ page }) => {
  const mutations = await openChat(page);
  const nudge = page.getByTestId("chat-archive-nudge");
  const keepOpen = nudge.getByRole("button", { name: "Keep chat open" });
  await keepOpen.focus();
  await page.keyboard.press("Enter");
  await expect(nudge).toHaveCount(0);
  expect(mutations).toEqual([]);
  expect(await page.evaluate((id) => localStorage.getItem(`cave:chat-archive-nudge-dismissed:${id}`), SESSION_ID))
    .toBe("1");
  await page.reload();
  await expect(page.locator(".cave-composer-input").first()).toBeVisible();
  await expect(nudge).toHaveCount(0);
});

test("failed archive stays actionable and a retry uses the existing archive endpoint", async ({ page }) => {
  const mutations = await openChat(page, { failArchive: true });
  const nudge = page.getByTestId("chat-archive-nudge");
  await nudge.getByRole("button", { name: "Archive chat" }).click();
  await expect(page.getByText("Archive unavailable. Try again.", { exact: true })).toBeVisible();
  await expect(nudge.getByRole("button", { name: "Archive chat" })).toBeEnabled();
  await nudge.getByRole("button", { name: "Archive chat" }).click();
  await expect(nudge).toHaveCount(0);
  expect(mutations).toEqual([{ archived: true }, { archived: true }]);
});

for (const [label, options] of [
  ["active work", { running: true }],
  ["unfinished task", { lifecycle: "running" }],
  ["unlinked chat", { lifecycle: null }],
] as const) {
  test(`does not imply ${label} is ready to archive`, async ({ page }) => {
    await openChat(page, options);
    await expect(page.locator(".cave-composer-input").first()).toBeVisible();
    await expect(page.getByTestId("chat-archive-nudge")).toHaveCount(0);
  });
}
