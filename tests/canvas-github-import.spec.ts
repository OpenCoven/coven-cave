import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-24T00:00:00.000Z";
const FILE_URL =
  "https://github.com/OpenCoven/coven-cave/blob/main/src/App.tsx";
const SOURCE = {
  kind: "github",
  url: FILE_URL,
  repoUrl: "https://github.com/OpenCoven/coven-cave",
  filePath: "src/App.tsx",
  ref: "main",
  projectFileHash: "fixture-hash",
};

async function openGitHubImport(
  page: Page,
  projects: Array<{
    id: string;
    name: string;
    root: string;
    repoUrl?: string;
    createdAt: string;
    updatedAt: string;
  }>,
) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem(
      "cave:familiar:nova:last-surface",
      "chat",
    );
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/projects**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { ok: true, projects } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/canvas", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { ok: true, positions: {}, artifacts: [] },
      });
      return;
    }
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ok: true,
        artifacts: [body.artifact],
        savedId: body.artifact.id,
      },
    });
  });
  await page.route("**/api/canvas/github-source", (route) =>
    route.fulfill({
      json: {
        ok: true,
        code: "export default function App() { return <main>Ready</main>; }",
        title: "App",
        source: SOURCE,
      },
    }),
  );

  await page.goto("/?mode=chat");
  await page.waitForSelector(".chat-surface", { timeout: 30_000 });
  const canvasTab = page.getByRole("tab", { name: "Canvas" });
  await canvasTab.click();
  // The Canvas scope mounts asynchronously (surface history navigation), and
  // the add tile is its empty state. Wait for the surface itself before
  // looking for the composer controls. A click can land before hydration
  // completes on a cold server, so retry the tab once.
  const canvasView = page.locator(".chat-canvas-view");
  try {
    await canvasView.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    await canvasTab.click();
    await canvasView.waitFor({ state: "visible", timeout: 15_000 });
  }

  const startFromCode = page.getByRole("button", {
    name: "Start from code",
  });
  if (!(await startFromCode.isVisible())) {
    await page.getByRole("button", { name: "New sketch" }).first().click();
  }
  await startFromCode.click();
  await page.getByRole("menuitem", { name: /GitHub file/ }).click();
  await expect(
    page.getByRole("dialog", { name: /Canvas›?Import GitHub file/ }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Canvas GitHub file import", () => {
  test("reveals details after a valid URL and prefers the linked project", async ({
    page,
  }) => {
    const linkedProject = {
      id: "project-linked",
      name: "Coven Cave",
      root: "/work/coven-cave",
      repoUrl: "https://github.com/OpenCoven/coven-cave",
      createdAt: ISO,
      updatedAt: ISO,
    };
    await openGitHubImport(page, [linkedProject]);

    const dialog = page.getByRole("dialog", {
      name: /Canvas›?Import GitHub file/,
    });
    await expect(
      dialog.getByRole("heading", { name: "Connect a Cave project" }),
    ).toHaveCount(0);

    const url = dialog.getByLabel("GitHub file URL");
    await url.fill("not-a-github-url");
    await url.blur();
    await expect(
      dialog.getByText(/Paste a GitHub blob URL/),
    ).toBeVisible();

    await url.fill(FILE_URL);
    await expect(dialog.getByLabel("GitHub file ready")).toContainText(
      "OpenCoven/coven-cave",
    );
    await expect(
      dialog.getByRole("heading", { name: "Connect a Cave project" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cave project" }))
      .toContainText("Coven Cave");

    await dialog.getByRole("button", { name: "Load App.tsx" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Paste sketch code")).toContainText(
      "return <main>Ready</main>",
    );
    await expect(
      page.getByLabel("Connected sketch source"),
    ).toContainText("src/App.tsx");
  });

  test("registers a local checkout without asking for a project name", async ({
    page,
  }) => {
    let createdProjectBody: Record<string, unknown> | null = null;
    // Chat requires at least one project before its scope tabs render, so the
    // "no projects" scenario starts from one UNLINKED project instead of an
    // empty list. With no repository-linked project the modal still defaults
    // to "Register local checkout", which is what this test exercises.
    await openGitHubImport(page, [{
      id: "project-local",
      name: "Local checkout",
      root: "/work/local",
      createdAt: ISO,
      updatedAt: ISO,
    }]);
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      createdProjectBody = route.request().postDataJSON();
      await route.fulfill({
        json: {
          ok: true,
          project: {
            id: "project-created",
            name: "coven-cave",
            root: "/work/coven-cave",
            repoUrl: "https://github.com/OpenCoven/coven-cave",
            createdAt: ISO,
            updatedAt: ISO,
          },
        },
      });
    });

    const dialog = page.getByRole("dialog", {
      name: /Canvas›?Import GitHub file/,
    });
    await dialog.getByLabel("GitHub file URL").fill(FILE_URL);
    await expect(dialog.getByText("Register local checkout")).toBeVisible();
    await expect(dialog.getByLabel("Project name")).toHaveCount(0);
    await dialog.getByLabel("Local checkout").fill("/work/coven-cave");
    await dialog.getByRole("button", { name: "Load App.tsx" }).click();

    await expect.poll(() => createdProjectBody).toEqual({
      name: "coven-cave",
      root: "/work/coven-cave",
      repoUrl: "https://github.com/OpenCoven/coven-cave",
    });
    await expect(page.getByLabel("Paste sketch code")).toBeVisible();
  });
});
