import { expect, test, type Locator, type Page } from "@playwright/test";

// The Projects list pane is the shared SurfaceRail now (filter / All-Active /
// sort / Refresh / New project all live inside it). This spec keeps the old
// toolbar-responsiveness guarantee in its new shape: the rail chrome must fit
// its pane continuously through narrow split-pane widths, and below the 640px
// container collapse the hub pages rail ↔ detail instead of cramming both.
// Runs daemonless: all data arrives via page.route mocks.

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
  // The Projects surface is a lazy chunk; its FIRST dev compile can run well
  // past the 5s default on a loaded machine.
  await expect(page.locator(".projects-view")).toBeVisible({ timeout: 120_000 });
  // The rail chrome carries the controls now.
  await expect(page.getByRole("group", { name: "Filter by activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort projects" })).toBeVisible();
  await expect(page.getByLabel("Filter projects")).toBeVisible();
}

async function setSurfaceWidth(page: Page, width: number) {
  const surface = page.locator(".projects-view");
  await surface.evaluate((element, nextWidth) => {
    const html = element as HTMLElement;
    html.style.width = `${nextWidth}px`;
    html.style.flex = `0 0 ${nextWidth}px`;
  }, width);
  await expect.poll(async () => Math.round((await rect(surface)).width)).toBe(width);
}

test("populated Projects rail fits continuously through narrow split-pane widths", async ({ page }) => {
  await openPopulatedProjects(page);

  const rail = page.locator(".projects-hub .surface-rail");
  const detail = page.locator(".projects-hub__detail");
  const filter = page.getByLabel("Filter projects");
  const refresh = page.getByRole("button", { name: "Refresh projects" });
  const newProject = page.locator(".projects-hub").getByRole("button", { name: "New project" });

  // Wide band: rail and detail sit side by side without overlapping.
  for (const width of [900, 641]) {
    await setSurfaceWidth(page, width);
    await expect(rail).toBeVisible();
    await expect(detail).toBeVisible();
    const [railRect, detailRect] = await Promise.all([rect(rail), rect(detail)]);
    expect(railRect.right, `${width}px rail sits left of the detail pane`).toBeLessThanOrEqual(detailRect.left + 1);
    for (const [name, control] of [["filter", filter], ["refresh", refresh], ["new project", newProject]] as const) {
      const controlRect = await rect(control);
      expect(controlRect.left, `${width}px ${name} stays inside the rail`).toBeGreaterThanOrEqual(railRect.left - 1);
      expect(controlRect.right, `${width}px ${name} stays inside the rail`).toBeLessThanOrEqual(railRect.right + 1);
    }
  }

  // Narrow band: single pane — the rail becomes the whole list page (never a
  // 56px collapsed strip) and the detail hides until a project is opened.
  for (const width of [640, 560, 521]) {
    await setSurfaceWidth(page, width);
    await expect(rail).toBeVisible();
    await expect(detail).toBeHidden();
    const railRect = await rect(rail);
    expect(railRect.width, `${width}px rail spans the single pane`).toBeGreaterThanOrEqual(width - 2);
    for (const [name, control] of [["filter", filter], ["refresh", refresh], ["new project", newProject]] as const) {
      const controlRect = await rect(control);
      expect(controlRect.left, `${width}px ${name} stays inside the pane`).toBeGreaterThanOrEqual(railRect.left - 1);
      expect(controlRect.right, `${width}px ${name} stays inside the pane`).toBeLessThanOrEqual(railRect.right + 1);
    }
  }

  // Paging: opening a project swaps to the detail page; Back returns.
  await page.locator(".projects-list-row").first().click();
  await expect(detail).toBeVisible();
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: "Back to project list" }).click();
  await expect(rail).toBeVisible();
  await expect(detail).toBeHidden();
});
