import { expect, test } from "@playwright/test";

const HOME = "/home/cave";
const PASTED_PATH = "/tmp/pasted-project";
const INVALID_PATH = "/tmp/missing-project";

test("the project folder picker accepts pasted paths and preserves invalid drafts", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });

  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          {
            id: "nova",
            display_name: "Nova",
            role: "Orchestrator",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        projects: [
          {
            id: "existing-project",
            name: "Existing project",
            root: "/workspace/existing-project",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/project-grants**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        grants: [
          {
            familiarId: "nova",
            projectId: "existing-project",
            access: "write",
            source: "human",
            grantedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        accessGroups: [],
        grantProposals: [],
        permissionAudit: [],
      },
    }),
  );

  const browsedPaths: string[] = [];
  await page.route("**/api/fs-browse**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("places") === "1") {
      await route.fulfill({
        json: {
          ok: true,
          home: HOME,
          groups: [],
        },
      });
      return;
    }

    const dir = url.searchParams.get("dir");
    if (!dir) {
      await route.fulfill({
        json: {
          ok: true,
          home: HOME,
          cwd: HOME,
          parent: "/home",
          entries: [{ name: "starter", path: `${HOME}/starter` }],
        },
      });
      return;
    }

    browsedPaths.push(dir);
    if (dir === INVALID_PATH) {
      await route.fulfill({
        status: 404,
        json: {
          ok: false,
          error: "Folder not found",
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        ok: true,
        home: HOME,
        cwd: dir,
        parent: "/tmp",
        entries: [{ name: "kept-folder", path: `${dir}/kept-folder` }],
      },
    });
  });

  await page.goto("/?mode=chat");
  await page
    .getByRole("button", { name: "Project: Choose project — change project" })
    .click();
  await page.getByText("Add project…", { exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Choose a project folder" });
  await expect(dialog).toBeVisible();

  const pathInput = dialog.getByLabel("Folder path");
  await expect(pathInput).toHaveValue(HOME);
  await pathInput.fill(PASTED_PATH);
  await pathInput.press("Enter");

  await expect.poll(() => browsedPaths).toContain(PASTED_PATH);
  await expect(pathInput).toHaveValue(PASTED_PATH);
  await expect(dialog.getByText("kept-folder", { exact: true })).toBeVisible();

  await pathInput.fill(INVALID_PATH);
  await pathInput.press("Enter");

  await expect.poll(() => browsedPaths).toContain(INVALID_PATH);
  await expect(pathInput).toHaveValue(INVALID_PATH);
  await expect(pathInput).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toHaveText("Folder not found");
  await expect(dialog.getByText("kept-folder", { exact: true })).toBeVisible();
});
