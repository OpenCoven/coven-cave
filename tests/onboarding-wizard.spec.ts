import { expect, test, type Page, type Route } from "@playwright/test";

const BOUNDARIES = {
  credentials:
    "Provider sign-in is deferred until you first use a familiar that needs it.",
  elevation:
    "Setup writes only to your user account and never asks for an administrator password.",
  git: "Git is optional. Install it later only when you want project and Queue features.",
};

type StageStatus = "pending" | "running" | "complete" | "skipped" | "failed";

type SetupDiagnostics = {
  version: 1;
  capturedAt: string;
  stage: "core-tools" | "workspace" | "daemon";
  code: string;
  summary: string;
  nextStep: string;
  environment: {
    appVersion: string;
    platform: "win32" | "darwin" | "linux" | "unsupported";
    architecture: "x64" | "arm64" | "other";
  };
  applicationData: {
    displayLocation: "Cave application data";
    exists: boolean | null;
    writeProbe: "passed" | "failed" | "not_run";
  };
  components: {
    managedNode: string;
    covenCli: string;
    localService: string;
  };
  installer?: {
    target: "managed-node" | "coven-cli";
    status: "idle" | "running" | "done" | "busy" | "unavailable";
    elapsedMs: number | null;
    exitCode: number | null;
    outputTail: string[];
  };
};

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
    code?: string;
    diagnostics?: SetupDiagnostics;
  };
};

const DIAGNOSTICS: SetupDiagnostics = {
  version: 1,
  capturedAt: "2026-08-10T12:34:56.000Z",
  stage: "core-tools",
  code: "download_failed",
  summary: "Cave couldn’t download its local components.",
  nextStep: "Check your connection, then retry setup.",
  environment: {
    appVersion: "1.4.2",
    platform: "linux",
    architecture: "x64",
  },
  applicationData: {
    displayLocation: "Cave application data",
    exists: true,
    writeProbe: "passed",
  },
  components: {
    managedNode: "missing",
    covenCli: "missing",
    localService: "not_checked",
  },
  installer: {
    target: "managed-node",
    status: "done",
    elapsedMs: 431,
    exitCode: 1,
    outputTail: [
      "Managed Node installer: starting verified setup.",
      "Download failed with EAI_AGAIN at [local path omitted]",
    ],
  },
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
        detail:
          "Cave will check its private Node.js and npm runtime, then verify the Coven CLI.",
      },
      {
        id: "workspace",
        label: "Create Cave defaults",
        status: "pending",
        detail:
          "Waiting for local components. Cave will then create user-scoped folders and defaults.",
      },
      {
        id: "daemon",
        label: "Start local services",
        status: "pending",
        detail:
          "Waiting for setup. Cave will check the local service and start it only when needed.",
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
  options?: { dismissed?: boolean; openOnboarding?: boolean },
) {
  await baseRoutes(page);
  await page.route("**/api/onboarding/bootstrap**", handler);
  if (options?.dismissed) {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
  }
  // The root route resolves bootstrap state on the server, before Playwright
  // can intercept its client API route. Seed the server-readable dismissal for
  // these shared-overlay interaction tests, then use the supported manual-open
  // bridge below. The startup gate itself is covered by the focused app test.
  await page.goto("/");
  await page.context().addCookies([
    {
      name: "cave_onboarding_dismissed",
      value: "1",
      url: page.url(),
    },
  ]);
  await page.goto("/");
  // Startup state is now resolved by the server before this browser can
  // intercept API requests. These interaction tests exercise the shared
  // overlay through the Workspace's supported manual-open bridge; the server
  // startup/hydration contract is covered by the focused app test.
  if (options?.openOnboarding !== false) {
    await page.getByRole("searchbox").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("cave:onboarding-open"));
    });
  }
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

  test("keeps setup diagnostics focus contained in WebKit", async ({ page }) => {
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "core-tools",
      failure: {
        stage: "core-tools",
        stageLabel: "Prepare local components",
        message: DIAGNOSTICS.summary,
        recoveryLabel: "Retry setup",
        code: DIAGNOSTICS.code,
        diagnostics: DIAGNOSTICS,
      },
    });
    await gotoApp(page, (route) => route.fulfill({ json: payload(failed) }), {
      dismissed: true,
    });

    const trigger = setup(page).getByRole("button", { name: "View diagnostics" });
    await trigger.click();
    const modal = page.getByRole("dialog", { name: /Setup diagnostics/ });
    await expect(modal.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(modal.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
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
              detail: "Setting up Cave’s private Node.js and npm runtime…",
            },
            ...state().stages.slice(1),
          ],
        });
      }
      await route.fulfill({ json: payload(current) });
    });

    const dialog = setup(page);
    await dialog.getByRole("button", { name: "Set up Cave", exact: true }).click();
    await expect(dialog.getByText("Setting up Cave’s private Node.js and npm runtime…")).toBeVisible();
    await expect(dialog.locator('[aria-current="step"]')).toContainText(
      "Prepare local components",
    );
    await expect.poll(() => confirmations).toBe(1);

    await expect(dialog.getByText(/private Node\.js and npm runtime/)).toBeVisible();
    await expect(dialog.getByText(/Waiting for local components/)).toBeVisible();
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
    await expect(alert.getByRole("button", { name: "View diagnostics" })).toHaveCount(0);
    await alert.getByRole("button", { name: "Retry setup" }).click();
    await expect.poll(() => retries).toBe(1);
  });

  test("opens selectable setup diagnostics without resuming installation and returns focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            window.sessionStorage.setItem("copied-setup-diagnostics", text);
          },
        },
      });
    });
    let posts = 0;
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "core-tools",
      stages: state().stages.map((stage) =>
        stage.id === "core-tools"
          ? {
              ...stage,
              status: "failed",
              detail: `Setup stopped at Prepare local components. ${DIAGNOSTICS.summary} ${DIAGNOSTICS.nextStep}`,
            }
          : stage,
      ),
      failure: {
        stage: "core-tools",
        stageLabel: "Prepare local components",
        message: `Setup stopped at Prepare local components. ${DIAGNOSTICS.summary} ${DIAGNOSTICS.nextStep}`,
        recoveryLabel: "Retry setup",
        code: DIAGNOSTICS.code,
        diagnostics: DIAGNOSTICS,
      },
    });
    await gotoApp(
      page,
      async (route) => {
        if (route.request().method() === "POST") posts += 1;
        await route.fulfill({ json: payload(failed) });
      },
      { dismissed: true },
    );

    const outer = setup(page);
    const trigger = outer.getByRole("button", { name: "View diagnostics" });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    expect(posts).toBe(0);

    const modal = page.getByRole("dialog", { name: /Setup diagnostics/ });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(DIAGNOSTICS.summary);
    await expect(modal).toContainText(DIAGNOSTICS.nextStep);
    await expect(modal.getByText("Missing", { exact: true })).toHaveCount(2);
    await expect(modal).toHaveCSS("animation-name", "none");
    await modal.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(modal).toBeVisible();
    expect(posts).toBe(0);
    const bounds = await modal.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
    await expect(modal.getByText("download_failed", { exact: true })).toBeVisible();
    await expect(modal.getByText("Passed at capture time", { exact: true })).toBeVisible();
    await expect(modal.getByText("Managed Node.js", { exact: true })).toBeVisible();
    await expect(modal.getByText("Coven CLI", { exact: true })).toBeVisible();
    await expect(modal.getByText("Not checked", { exact: true })).toBeVisible();

    const focusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"][aria-describedby]')),
    );
    expect(focusedInside).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[role="dialog"][aria-describedby]')),
        ),
      ).toBe(true);
    }

    await modal.getByText("Sanitized installer output").click();
    const output = modal.getByText(/Download failed with EAI_AGAIN/);
    await expect(output).toBeVisible();
    expect(
      await output.evaluate((element) => getComputedStyle(element).userSelect),
    ).not.toBe("none");

    await modal.getByRole("button", { name: "Copy diagnostics" }).click();
    await expect(modal.getByText("Diagnostics copied.")).toBeVisible();
    const copied = await page.evaluate(() =>
      window.sessionStorage.getItem("copied-setup-diagnostics"),
    );
    expect(copied).toContain("Failure code: download_failed");
    expect(copied).toContain("EAI_AGAIN");
    expect(copied).not.toContain("/home/");

    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(outer).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(posts).toBe(0);

    await outer.getByRole("button", { name: "Retry setup" }).click();
    await expect.poll(() => posts).toBe(1);
  });

  test("reports clipboard failure without hiding Retry", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => Promise.reject(new Error("denied")) },
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => false,
      });
    });
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "core-tools",
      failure: {
        stage: "core-tools",
        stageLabel: "Prepare local components",
        message: DIAGNOSTICS.summary,
        recoveryLabel: "Retry setup",
        code: DIAGNOSTICS.code,
        diagnostics: DIAGNOSTICS,
      },
    });
    await gotoApp(page, (route) => route.fulfill({ json: payload(failed) }), {
      dismissed: true,
    });

    const outer = setup(page);
    await outer.getByRole("button", { name: "View diagnostics" }).click();
    const modal = page.getByRole("dialog", { name: /Setup diagnostics/ });
    await modal.getByRole("button", { name: "Copy diagnostics" }).click();
    await expect(modal.getByText(/Couldn’t copy diagnostics/)).toBeVisible();
    await expect(
      page.locator('[aria-label="Set up Cave"] button', { hasText: "Retry setup" }),
    ).toHaveCount(1);
  });

  test("keeps the legacy copy fallback inside setup diagnostics", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => true,
      });
    });
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "core-tools",
      failure: {
        stage: "core-tools",
        stageLabel: "Prepare local components",
        message: DIAGNOSTICS.summary,
        recoveryLabel: "Retry setup",
        code: DIAGNOSTICS.code,
        diagnostics: DIAGNOSTICS,
      },
    });
    await gotoApp(page, (route) => route.fulfill({ json: payload(failed) }), {
      dismissed: true,
    });

    await setup(page).getByRole("button", { name: "View diagnostics" }).click();
    const modal = page.getByRole("dialog", { name: /Setup diagnostics/ });
    const copy = modal.getByRole("button", { name: "Copy diagnostics" });
    await copy.click();

    await expect(modal.getByText("Diagnostics copied.")).toBeVisible();
    await expect(modal.getByRole("button", { name: "Copied" })).toBeFocused();
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"][aria-describedby]')),
      ),
    ).toBe(true);
  });

  test("explains what a local-components failure did and did not do", async ({
    page,
  }) => {
    const failed = state({
      confirmed: true,
      status: "failed",
      activeStage: "core-tools",
      stages: state().stages.map((stage) =>
        stage.id === "core-tools"
          ? {
              ...stage,
              status: "failed",
              detail: "Setup stopped at Prepare local components. Cave couldn’t prepare its private Node.js and npm runtime.",
            }
          : stage,
      ),
      failure: {
        stage: "core-tools",
        stageLabel: "Prepare local components",
        message: "Setup stopped at Prepare local components. Cave couldn’t prepare its private Node.js and npm runtime. No Cave defaults were created. Retry setup; if it happens again, restart Cave and try once more.",
        recoveryLabel: "Retry setup",
      },
    });
    await gotoApp(page, (route) => route.fulfill({ json: payload(failed) }), {
      dismissed: true,
    });

    const alert = setup(page).getByRole("alert");
    await expect(alert).toContainText("No Cave defaults were created.");
    await expect(alert).toContainText(
      "It does not create Cave defaults or start a familiar runtime.",
    );
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
      { openOnboarding: false },
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
