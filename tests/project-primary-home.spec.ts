import { expect, test, type Page, type Route } from "@playwright/test";
import { installCompletedFirstUse } from "./fixtures/first-use";

test.use({ serviceWorkers: "block" });

const CODY = {
  id: "cody",
  display_name: "Cody",
  role: "Coding",
  status: "active",
  icon: "ph:code",
};
const NOVA = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
};
const PROJECTS = [
  { id: "project-a", name: "Project A", root: "/repo/a", access: "write" },
  { id: "project-b", name: "Project B", root: "/repo/b", access: "write" },
];

function fulfillSse(route: Route) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: [
      `data: ${JSON.stringify({ kind: "assistant_chunk", text: "Ready." })}`,
      "",
      `data: ${JSON.stringify({ kind: "done", sessionId: "session-project-b" })}`,
      "",
      "",
    ].join("\n"),
  });
}

async function seed(page: Page) {
  const familiarProjectRequests: Array<string | null> = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:workspace:project-scope:v1", "null");
    window.localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ "__all-projects__": [], "project-a": [], "project-b": [] }));
  });
  await page.route("**/api/familiars**", (route) => {
    const projectIds = new URL(route.request().url()).searchParams.getAll("projectId");
    familiarProjectRequests.push(...(projectIds.length ? projectIds : [null]));
    const crewFor = (projectId: string) => (projectId === "project-a"
        ? [CODY]
        : projectId === "project-b"
          ? [CODY, NOVA]
          : []).map((familiar) => ({ ...familiar, projectAccess: "write" }));
    return route.fulfill({ json: projectIds.length > 1
      ? { ok: true, familiarsByProject: Object.fromEntries(projectIds.map((id) => [id, crewFor(id)])) }
      : { ok: true, familiars: projectIds.length ? crewFor(projectIds[0]) : [CODY, NOVA] } });
  });
  await page.route("**/api/projects**", (route) =>
    route.fulfill({ json: { ok: true, projects: PROJECTS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/board**", (route) =>
    route.fulfill({ json: { ok: true, cards: [] } }),
  );
  await page.route("**/api/chat/model-state**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        state: {
          familiarId: "nova",
          runtime: null,
          harness: "claude",
          effectiveModel: "unknown",
          source: "runtime-default",
          applicationState: "saved",
          reason: "e2e",
        },
      },
    }),
  );
  await installCompletedFirstUse(page, { project: PROJECTS[0], familiarIds: ["cody"], actingFamiliarId: "cody", permissionMode: "full" });
  return familiarProjectRequests;
}

test("opening navigation during startup keeps New chat reachable after layout restoration", async ({ page }) => {
  await seed(page);
  // Widen the startup window so this exercises a real early user action even
  // on a slow runner. Assertions cover both sides of the delayed restoration.
  await page.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      original(handler, delay === 250 ? 2_000 : delay, ...args)) as typeof window.setTimeout;
  });
  await page.goto("/?mode=home");
  await expect(page.locator(".shell-frame")).not.toHaveAttribute("data-settled", "");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  const newChat = page.getByRole("button", { name: "New chat" }).first();
  await expect(newChat).toBeVisible();
  await expect(page.locator(".shell-frame")).toHaveAttribute("data-settled", "");
  await expect(newChat).toBeVisible();
});

test("project scope, aggregate crew, and explicit actor reach one launch", async ({ page }) => {
  const familiarProjectRequests = await seed(page);
  const launchBodies: Record<string, unknown>[] = [];
  await page.route("**/api/chat/send", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.prompt === "Ship the project-primary launch.") launchBodies.push(body);
    return fulfillSse(route);
  });

  await page.goto("/?mode=home");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  const projectTrigger = page.getByRole("button", { name: /Switch project/ }).first();
  await expect(projectTrigger).toBeVisible({ timeout: 45_000 });
  await projectTrigger.click();
  await page.getByText("Project B", { exact: true }).last().click();
  await expect(
    page.getByRole("button", { name: /Switch project.*Project B/ }).first(),
  ).toBeVisible();
  await expect.poll(() => familiarProjectRequests).toContain("project-b");

  const crewTrigger = page.getByRole("button", { name: /scope: project crew/i }).first();
  await crewTrigger.click();
  const codyOption = page.getByRole("option", { name: /Cody/ });
  const novaOption = page.getByRole("option", { name: /Nova/ });
  await codyOption.click({ modifiers: ["Meta"] });
  await expect(codyOption).toHaveAttribute("aria-selected", "true");
  await novaOption.click({ modifiers: ["Meta"] });
  await expect(novaOption).toHaveAttribute("aria-selected", "true");
  const selectedCrewTrigger = page.getByRole("button", { name: /scope: 2 familiars/i }).first();
  await expect(selectedCrewTrigger).toBeVisible();
  await selectedCrewTrigger.click();

  await page.getByRole("button", { name: "New chat" }).first().click();
  const gate = page.getByRole("dialog", { name: /New chat.*Choose familiar/ });
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: /Nova/ }).click();

  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible({ timeout: 45_000 });
  await composer.fill("Ship the project-primary launch.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => launchBodies.length).toBe(1);
  await page.waitForTimeout(250);
  expect(launchBodies).toHaveLength(1);
  expect(launchBodies[0]?.familiarId).toBe("nova");
  expect(launchBodies[0]?.projectRoot).toBe("/repo/b");
});
