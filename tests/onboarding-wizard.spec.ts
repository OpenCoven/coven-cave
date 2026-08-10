import { expect, test, type Page, type Route } from "@playwright/test";

const BOUNDARIES = {
  credentials:
    "Provider sign-in is deferred until you first use a familiar that needs it.",
  elevation:
    "Setup writes only to your user account and never asks for an administrator password.",
  git: "Git is optional. Install it later only when you want project and Queue features.",
};

type StageStatus = "pending" | "running" | "complete" | "skipped" | "failed";

type BootstrapState = {
  confirmed: boolean;
  complete: boolean;
  needsSetup: boolean;
  status: "idle" | "running" | "failed" | "complete";
  activeStage: "core-tools" | "workspace" | "daemon" | null;
  stages: Array<{
    id: "core-tools" | "workspace" | "daemon";
    label: string;
    status: StageStatus;
    detail: string;
  }>;
  failure: null | {
    stage: "core-tools" | "workspace" | "daemon";
    stageLabel: string;
    message: string;
    recoveryLabel: "Retry setup";
  };
};

function state(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    confirmed: false,
    complete: false,
    needsSetup: true,
    status: "idle",
    activeStage: null,
    stages: [
      {
        id: "core-tools",
        label: "Prepare local components",
        status: "pending",
        detail: "Cave will verify the local components it needs.",
      },
      {
        id: "workspace",
        label: "Create Cave defaults",
        status: "pending",
        detail: "Cave will create user-scoped folders and defaults.",
      },
      {
        id: "daemon",
        label: "Start local services",
        status: "pending",
        detail: "Cave will start its local background service.",
      },
    ],
    failure: null,
    ...overrides,
  };
}

function payload(value: BootstrapState) {
  return {
    ok: true,
    version: 1,
    updatedAt: "2026-08-09T00:00:00.000Z",
    boundaries: BOUNDARIES,
    ...value,
  };
}

async function baseRoutes(page: Page) {
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [] } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [] } }),
  );
}

async function gotoApp(
  page: Page,
  handler: (route: Route) => Promise<unknown> | unknown,
  options?: { dismissed?: boolean },
) {
  await baseRoutes(page);
  await page.route("**/api/onboarding/bootstrap**", handler);
  if (options?.dismissed) {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
  }
  await page.goto("/");
}

const setup = (page: Page) => page.getByRole("dialog", { name: "Set up Cave" });

test.describe("onboarding bootstrap", () => {
  test("auto-opens on first run and traps keyboard focus", async ({ page }) => {
    await gotoApp(page, (route) => route.fulfill({ json: payload(state()) }));
    await expect(setup(page)).toBeVisible({ timeout: 30_000 });
    await expect(
      setup(page).getByRole("button", { name: "Set up Cave", exact: true }),
    ).toBeVisible();

    await page.waitForTimeout(1_000);
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      const inDialog = await page.evaluate(() =>
        Boolean(
          document.activeElement?.closest(
            '[role="dialog"][aria-label="Set up Cave"]',
          ),
        ),
      );
      expect(inDialog).toBe(true);
    }
  });

  test("keeps setup controls focus-visible in WebKit", async ({
    page,
    browserName,
  }) => {
    await gotoApp(page, (route) => route.fulfill({ json: payload(state()) }));
    const dialog = setup(page);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.focus();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");

    const focused = dialog.locator(":focus");
    await expect(focused).toHaveCount(1);
    const focusStyle = await focused.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(focusStyle.visible).toBe(true);
    expect(focusStyle.outlineStyle).toBe("solid");
    expect(focusStyle.outlineWidth).toBeGreaterThan(0);
  });

  test("one confirmation starts a visible serialized stage flow", async ({
    page,
  }) => {
    let current = state();
    let confirmations = 0;
    await gotoApp(page, async (route) => {
      if (route.request().method() === "POST") {
        confirmations += 1;
        current = state({
          confirmed: true,
          status: "running",
          activeStage: "core-tools",
          stages: [
            {
              id: "core-tools",
              label: "Prepare local components",
              status: "running",
              detail: "Preparing Cave’s local runtime…",
            },
            ...state().stages.slice(1),
          ],
        });
      }
      await route.fulfill({ json: payload(current) });
    });

    const dialog = setup(page);
    await dialog.getByRole("button", { name: "Set up Cave", exact: true }).click();
    await expect(dialog.getByText("Preparing Cave’s local runtime…")).toBeVisible();
    await expect(dialog.locator('[aria-current="step"]')).toContainText(
      "Prepare local components",
    );
    expect(confirmations).toBe(1);

    const visibleText = await dialog.innerText();
    for (const hidden of [
      "Node.js",
      "npm",
      "Coven CLI",
      "Codex",
      "Claude",
      "Copilot",
      "OpenClaw",
    ]) {
      expect(visibleText).not.toContain(hidden);
    }
    await expect(dialog.getByText(/Provider sign-in is deferred/)).toBeVisible();
    await expect(dialog.getByText(/never asks for an administrator password/)).toBeVisible();
    await expect(dialog.getByText(/Git is optional/)).toBeVisible();
  });

  test("names the blocked stage and offers one recovery action", async ({
    page,
  }) => {
    let retries = 0;
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "workspace",
      stages: state().stages.map((stage) =>
        stage.id === "workspace"
          ? {
              ...stage,
              status: "failed",
              detail:
                "Setup stopped at Create Cave defaults. Check that ~/.coven is writable, then retry setup.",
            }
          : stage.id === "core-tools"
            ? { ...stage, status: "complete", detail: "Local components are ready." }
            : stage,
      ),
      failure: {
        stage: "workspace",
        stageLabel: "Create Cave defaults",
        message:
          "Setup stopped at Create Cave defaults. Check that ~/.coven is writable, then retry setup.",
        recoveryLabel: "Retry setup",
      },
    });
    await gotoApp(
      page,
      async (route) => {
        if (route.request().method() === "POST") retries += 1;
        await route.fulfill({ json: payload(failed) });
      },
      { dismissed: true },
    );

    const alert = setup(page).getByRole("alert");
    await expect(alert).toContainText("Create Cave defaults is blocked");
    await expect(alert.getByRole("button", { name: "Retry setup" })).toHaveCount(1);
    await alert.getByRole("button", { name: "Retry setup" }).click();
    expect(retries).toBe(1);
  });

  test("skips onboarding when an existing setup is already ready", async ({
    page,
  }) => {
    const complete = state({
      complete: true,
      needsSetup: false,
      status: "complete",
      stages: state().stages.map((stage) => ({
        ...stage,
        status: "skipped",
        detail: "Existing setup was kept.",
      })),
    });
    await gotoApp(page, (route) =>
      route.fulfill({ json: payload(complete) }),
    );
    await page.getByRole("searchbox").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await expect(setup(page)).toHaveCount(0);
  });

  test("confirmed interrupted setup resumes even after an earlier dismissal", async ({
    page,
  }) => {
    let resumes = 0;
    let current = state({
      confirmed: true,
      status: "idle",
      activeStage: null,
    });
    await gotoApp(
      page,
      async (route) => {
        if (route.request().method() === "POST") {
          resumes += 1;
          current = state({
            confirmed: true,
            status: "running",
            activeStage: "core-tools",
          });
        }
        await route.fulfill({ json: payload(current) });
      },
      { dismissed: true },
    );

    await expect(setup(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => resumes).toBe(1);
  });
});
