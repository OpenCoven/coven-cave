import { expect, test, type Page } from "@playwright/test";

// The Chat → Projects surface is the "Project access" page: one familiar's
// access map over every registered project, grouped by derived organization,
// where clicking a row cycles its direct grant none → read → full → none
// against /api/project-grants. Runs daemonless: all data arrives via page.route
// mocks, and the grants store is simulated statefully so the page's
// post-mutation refetch sees its writes.

const NOW = new Date().toISOString();

const PROJECTS = [
  {
    id: "ws-nova",
    name: "nova",
    root: "/home/cave/.coven/workspaces/familiars/nova",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "repo-cave",
    name: "Coven Cave",
    root: "/workspace/coven-cave",
    repoUrl: "https://github.com/OpenCoven/coven-cave",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "repo-docs",
    name: "Coven Docs",
    root: "/workspace/coven-docs",
    repoUrl: "https://github.com/OpenCoven/coven-docs",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

type GrantRow = { familiarId: string; projectId: string; access: "read" | "write" };

const organizationSection = (page: Page, name: string) =>
  page.locator(`.projects-access-section[aria-label="${name}"]`);

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
  await page.getByTestId("detail").getByRole("tab", { name: "Projects" }).click();
  // The Projects surface is a lazy chunk; its FIRST dev compile can run well
  // past the 5s default on a loaded machine.
  await expect(page.locator(".projects-access")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "Project access" })).toBeVisible();
  await expect(page.locator(".projects-access-card")).toHaveCount(PROJECTS.length);
  return grants;
}

test("cards are sectioned and their pill cycles no access → read → full → none", async ({ page }) => {
  const grants = await openProjectAccess(page, [
    { familiarId: "nova", projectId: "repo-docs", access: "read" },
  ]);

  // Sections split by derived organization: OpenCoven repositories and the
  // familiars workspace leaf.
  const opencoven = organizationSection(page, "OpenCoven");
  const familiars = organizationSection(page, "familiars");
  await expect(opencoven.locator(".projects-access-card")).toHaveCount(2);
  await expect(familiars.locator(".projects-access-card")).toHaveCount(1);

  // Seeded grant renders as a Read pill.
  const docsCard = page.locator(".projects-access-card", { hasText: "Coven Docs" });
  await expect(docsCard.locator(".projects-access-pill")).toHaveText(/Read/);

  // Cycle an ungranted card: none → read → full → none, verifying both the
  // pill AND the simulated grants store after each click's refetch settles.
  const caveCard = page.locator(".projects-access-card", { hasText: "Coven Cave" });
  const cavePill = caveCard.locator(".projects-access-pill");
  await expect(cavePill).toHaveText(/No access/);

  await cavePill.click();
  await expect(cavePill).toHaveText(/^Read$/);
  await expect.poll(() => grants.find((g) => g.projectId === "repo-cave")?.access).toBe("read");

  await cavePill.click();
  await expect(cavePill).toHaveText(/Full/);
  await expect.poll(() => grants.find((g) => g.projectId === "repo-cave")?.access).toBe("write");

  await cavePill.click();
  await expect(cavePill).toHaveText(/No access/);
  await expect.poll(() => grants.some((g) => g.projectId === "repo-cave")).toBe(false);
});

test("the ledger, the views, and the bulk band all drive the same map", async ({ page }) => {
  const grants = await openProjectAccess(page, [
    { familiarId: "nova", projectId: "repo-docs", access: "read" },
    { familiarId: "nova", projectId: "ws-nova", access: "write" },
  ]);

  // Ledger: 1 full · 1 read · 1 no-access, proportional over the whole map.
  const key = page.locator(".projects-access-ledger-key > span");
  await expect(key.nth(0)).toHaveText(/1 Full/);
  await expect(key.nth(1)).toHaveText(/1 Read/);
  await expect(key.nth(2)).toHaveText(/1 No access/);

  // Rows view floats granted projects to the top of one dense list.
  await page.getByRole("button", { name: "Rows" }).click();
  await expect(page.locator(".projects-access-tr").first()).toContainText("nova");
  await expect(page.locator(".projects-access-card")).toHaveCount(0);

  // Tree view groups by level and says so when a level is empty.
  await page.getByRole("button", { name: "Tree" }).click();
  const full = page.locator(".projects-access-level", { hasText: "Full" });
  await expect(full.locator(".projects-access-chip")).toHaveCount(1);

  // Back to cards, then bulk-set both repositories to Full in one action.
  await page.getByRole("button", { name: "Grid" }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByLabel("Select Coven Cave").check();
  await page.getByLabel("Select Coven Docs").check();
  await expect(page.locator(".projects-access-bulk-count")).toHaveText("2 selected");
  await page.getByRole("button", { name: "Set full" }).click();
  await expect
    .poll(() => grants.filter((g) => g.access === "write").length)
    .toBe(3);
});

test("search filters cards and the ledger still spans the whole map", async ({ page }) => {
  await openProjectAccess(page, [
    { familiarId: "nova", projectId: "repo-docs", access: "read" },
    { familiarId: "nova", projectId: "ws-nova", access: "write" },
  ]);

  await page.getByLabel("Find a project").fill("docs");
  await expect(page.locator(".projects-access-card")).toHaveCount(1);
  await expect(organizationSection(page, "familiars")).toHaveCount(0);

  // The ledger still describes the whole map, not the filtered subset.
  await expect(page.locator(".projects-access-ledger-key > span").nth(1)).toHaveText(/1 Read/);

  await page.getByLabel("Find a project").fill("zzz");
  await expect(page.getByText(/No projects match/)).toBeVisible();
});

test("a collapsed section keeps reporting what is granted inside it", async ({ page }) => {
  await openProjectAccess(page, [{ familiarId: "nova", projectId: "repo-cave", access: "write" }]);

  const opencoven = organizationSection(page, "OpenCoven");
  // Address the section toggle by name — `{ expanded: true }` also matches any
  // open card disclosure inside the section.
  await opencoven.getByRole("button", { name: "OpenCoven" }).click();
  await expect(opencoven.locator(".projects-access-card")).toHaveCount(0);
  // Folding must not hide that something in there is granted.
  await expect(opencoven.locator(".projects-access-mix-chip.is-write")).toHaveText("1");
  await expect(opencoven.locator(".projects-access-peek")).toContainText("Coven Cave");
});
