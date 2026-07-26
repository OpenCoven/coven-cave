import { expect, test, type Page } from "@playwright/test";

// The Chat → Projects surface is the "Project access" page: one familiar's
// access map over every registered project, split into WORKSPACES (familiar
// workspace roots) and REPOSITORIES, where clicking a row cycles its direct
// grant none → read → full → none against /api/project-grants. Runs
// daemonless: all data arrives via page.route mocks, and the grants store is
// simulated statefully so the page's post-mutation refetch sees its writes.

const NOW = new Date().toISOString();

const PROJECTS = [
  {
    id: "ws-nova",
    name: "nova",
    root: "/home/cave/.coven/workspaces/familiars/nova",
    createdAt: NOW,
    updatedAt: NOW,
  },
  { id: "repo-cave", name: "Coven Cave", root: "/workspace/coven-cave", createdAt: NOW, updatedAt: NOW },
  { id: "repo-docs", name: "Coven Docs", root: "/workspace/coven-docs", createdAt: NOW, updatedAt: NOW },
];

type GrantRow = { familiarId: string; projectId: string; access: "read" | "write" };

async function openProjectAccess(page: Page, seed: GrantRow[]): Promise<GrantRow[]> {
  const grants: GrantRow[] = [...seed];
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
          { id: "echo", display_name: "Echo", role: "Researcher", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: PROJECTS } }));
  await page.route("**/api/project-grants**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { targetFamiliarId: string; projectId: string; access: "read" | "write" };
      const existing = grants.find((g) => g.familiarId === body.targetFamiliarId && g.projectId === body.projectId);
      if (existing) existing.access = body.access;
      else grants.push({ familiarId: body.targetFamiliarId, projectId: body.projectId, access: body.access });
      return route.fulfill({ json: { ok: true } });
    }
    if (request.method() === "DELETE") {
      const body = request.postDataJSON() as { targetFamiliarId: string; projectId: string };
      const index = grants.findIndex((g) => g.familiarId === body.targetFamiliarId && g.projectId === body.projectId);
      if (index >= 0) grants.splice(index, 1);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: { ok: true, grants, accessGroups: [], supremeFamiliarId: null, audit: [] },
    });
  });

  await page.goto("/?mode=chat");
  await page.getByRole("tab", { name: "Projects" }).click();
  // The Projects surface is a lazy chunk; its FIRST dev compile can run well
  // past the 5s default on a loaded machine.
  await expect(page.locator(".projects-access")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Project access" })).toBeVisible();
  return grants;
}

test("rows are sectioned and cycle no access → read → full → none per click", async ({ page }) => {
  const grants = await openProjectAccess(page, [
    { familiarId: "nova", projectId: "repo-docs", access: "read" },
  ]);

  // Sections split by root: familiar workspaces vs everything else.
  const workspaces = page.locator(".projects-access-section", { hasText: "Workspaces" });
  const repositories = page.locator(".projects-access-section", { hasText: "Repositories" });
  await expect(workspaces.locator(".projects-access-row")).toHaveCount(1);
  await expect(repositories.locator(".projects-access-row")).toHaveCount(2);

  // Seeded grant renders as a Read pill.
  const docsRow = page.locator(".projects-access-row", { hasText: "Coven Docs" });
  await expect(docsRow.locator(".projects-access-pill")).toHaveText(/Read/);

  // Cycle an ungranted row: none → read → full → none, verifying both the
  // pill AND the simulated grants store after each click's refetch settles.
  const caveRow = page.locator(".projects-access-row", { hasText: "Coven Cave" });
  await expect(caveRow.locator(".projects-access-pill")).toHaveText(/No access/);

  await caveRow.click();
  await expect(caveRow.locator(".projects-access-pill")).toHaveText(/^Read$/);
  await expect.poll(() => grants.find((g) => g.projectId === "repo-cave")?.access).toBe("read");

  await caveRow.click();
  await expect(caveRow.locator(".projects-access-pill")).toHaveText(/Full/);
  await expect.poll(() => grants.find((g) => g.projectId === "repo-cave")?.access).toBe("write");

  await caveRow.click();
  await expect(caveRow.locator(".projects-access-pill")).toHaveText(/No access/);
  await expect.poll(() => grants.some((g) => g.projectId === "repo-cave")).toBe(false);
});

test("search filters rows and the tally spans the whole map", async ({ page }) => {
  await openProjectAccess(page, [
    { familiarId: "nova", projectId: "repo-docs", access: "read" },
    { familiarId: "nova", projectId: "ws-nova", access: "write" },
  ]);

  // Tally: 1 without access, 1 read, 1 full.
  const counts = page.locator(".projects-access-count");
  await expect(counts.nth(0)).toHaveText(/1/);
  await expect(counts.nth(1)).toHaveText(/1/);
  await expect(counts.nth(2)).toHaveText(/1/);

  // Filtering hides non-matching rows and empty sections entirely.
  await page.getByLabel("Find a project").fill("docs");
  await expect(page.locator(".projects-access-row")).toHaveCount(1);
  await expect(page.locator(".projects-access-section", { hasText: "Workspaces" })).toHaveCount(0);

  // The tally still describes the whole map, not the filtered subset.
  await expect(counts.nth(1)).toHaveText(/1/);

  await page.getByLabel("Find a project").fill("zzz");
  await expect(page.getByText(/No projects match/)).toBeVisible();
});
