import { expect, test, type Locator, type Page } from "@playwright/test";

const NOW = new Date().toISOString();

const PROJECTS = Array.from({ length: 12 }, (_, index) => ({
  id: `project-${index + 1}`,
  name: `Project ${index + 1}`,
  root: `/workspace/project-${index + 1}`,
  createdAt: NOW,
  updatedAt: NOW,
}));

const SESSIONS = PROJECTS.slice(0, 5).map((project, index) => ({
  id: `session-${index + 1}`,
  project_root: project.root,
  harness: "codex",
  title: `Active session ${index + 1}`,
  status: "idle",
  exit_code: null,
  archived_at: null,
  created_at: NOW,
  updated_at: NOW,
  familiarId: "nova",
}));

type Rect = { left: number; top: number; right: number; bottom: number; width: number };

async function rect(locator: Locator): Promise<Rect> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width };
  });
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
}

async function openPopulatedProjects(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) => route.fulfill({
    json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" }] },
  }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: PROJECTS } }));
  await page.goto("/?mode=chat");
  await page.getByRole("tab", { name: "Projects" }).click();
  await expect(page.locator(".projects-view")).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter by activity" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sort projects" })).toBeVisible();
}

test("populated Projects toolbar fits continuously through narrow split-pane widths", async ({ page }) => {
  await openPopulatedProjects(page);

  const surface = page.locator(".projects-view");
  const toolbar = page.locator(".projects-toolbar");
  const controls = page.locator(".projects-toolbar__controls");
  const actions = page.locator(".projects-toolbar__actions");

  for (const width of [521, 540, 560, 640, 641]) {
    await surface.evaluate((element, nextWidth) => {
      const html = element as HTMLElement;
      html.style.width = `${nextWidth}px`;
      html.style.flex = `0 0 ${nextWidth}px`;
    }, width);

    await expect.poll(async () => Math.round((await rect(surface)).width)).toBe(width);

    const [toolbarRect, controlsRect, actionsRect] = await Promise.all([
      rect(toolbar),
      rect(controls),
      rect(actions),
    ]);

    expect(overlaps(controlsRect, actionsRect), `${width}px controls and actions must not overlap`).toBe(false);
    expect(controlsRect.left, `${width}px controls stay inside toolbar`).toBeGreaterThanOrEqual(toolbarRect.left - 1);
    expect(actionsRect.right, `${width}px actions stay inside toolbar`).toBeLessThanOrEqual(toolbarRect.right + 1);

    const stacked = Math.abs(controlsRect.top - actionsRect.top) > 1;
    expect(stacked, `${width}px toolbar row placement`).toBe(width <= 640);
  }
});
