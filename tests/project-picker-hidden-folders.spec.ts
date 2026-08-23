import { expect, test } from "@playwright/test";

const HOME = "/home/cave";

// Dot folders used to be listed unconditionally, which buried an ordinary
// project pick under .git / .cache / .local noise. They are hidden by default
// now, and the picker offers a session-scoped reveal. Two things are worth
// covering end to end rather than by source assertion: the toggle actually
// re-asks the server (hiding is a server decision, not a client filter), and
// the preference survives navigating away and back.

test("the project folder picker hides dot folders until the reveal toggle is pressed", async ({ page }) => {
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
  // One registered project, so the composer renders the project switcher this
  // test opens the picker from. With none, the chrome is the first-project
  // gate instead and the trigger below never appears.
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

  // Mirrors the real route: the server owns the hiding, `?hidden=1` opts out,
  // and `hiddenCount` is reported either way so the toggle can label itself.
  const revealRequests: boolean[] = [];
  await page.route("**/api/fs-browse**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("places") === "1") {
      await route.fulfill({ json: { ok: true, home: HOME, groups: [] } });
      return;
    }

    const includeHidden = url.searchParams.get("hidden") === "1";
    const dir = url.searchParams.get("dir") ?? HOME;
    revealRequests.push(includeHidden);

    const visible = [{ name: "starter", path: `${dir}/starter` }];
    const hidden = [{ name: ".config", path: `${dir}/.config`, hidden: true }];
    await route.fulfill({
      json: {
        ok: true,
        home: HOME,
        cwd: dir,
        parent: "/home",
        entries: includeHidden ? [...hidden, ...visible] : visible,
        hiddenCount: hidden.length,
        includeHidden,
      },
    });
  });

  await page.goto("/?mode=chat");
  await page.getByRole("button", { name: "Project: Choose project — change project" }).click();
  await page.getByText("Add project…", { exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Choose a project folder" });
  await expect(dialog).toBeVisible();

  // Default: the dot folder is absent, and the toggle names how many are.
  await expect(dialog.getByText("starter", { exact: true })).toBeVisible();
  await expect(dialog.getByText(".config", { exact: true })).toHaveCount(0);
  const toggle = dialog.getByRole("button", { name: "Show hidden folders (1)" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(revealRequests).not.toContain(true);

  // Pressing it re-asks the server rather than unfiltering client-side.
  await toggle.click();
  await expect(dialog.getByText(".config", { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => revealRequests).toContain(true);
  await expect(dialog.getByText("starter", { exact: true })).toBeVisible();

  // Navigating keeps the reveal on: the preference is session-scoped, not a
  // per-folder one-off the next click would silently discard.
  await dialog.getByText("starter", { exact: true }).dblclick();
  await expect(dialog.getByText(".config", { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Pressing again re-hides, and the highlight does not survive as a pending
  // selection of a row that is no longer on screen.
  await toggle.click();
  await expect(dialog.getByText(".config", { exact: true })).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
