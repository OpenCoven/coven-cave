import { expect, test, type Page } from "@playwright/test";

// Behavioral coverage for the first-run onboarding wizard — previously the
// only e2e mentions of onboarding were specs BYPASSING it. All daemon-shaped
// endpoints are stubbed (CI runs daemon-less), and /api/onboarding/status is
// stubbed to a fresh-machine shape so the wizard auto-opens.
//
// The focus assertions exist because of a live-reproduced bug: the home
// composer's mount autofocus stole focus out of the wizard, and the focus
// trap never recaptured it, so Tab silently walked the workspace BEHIND the
// full-screen modal.

const FRESH_STATUS = {
  ok: true,
  complete: false,
  steps: {
    covenCli: { ok: false, detail: "coven not found on PATH" },
    covenHome: { ok: false, detail: "~/.coven missing" },
    git: { ok: true, optional: true, detail: "/usr/bin/git" },
    adapters: { ok: false, detail: "no adapters detected" },
    daemon: { ok: false, detail: "daemon socket not reachable" },
    // Advisory since familiar creation moved to the in-app summoning circle.
    familiars: { ok: false, optional: true, detail: "no familiars" },
    binding: { ok: false, optional: true, detail: "no binding configured" },
  },
  tools: [],
};

// A machine that finished setup once but whose daemon is currently stopped:
// structural steps are healthy, daemon-dependent ones are not.
const DAEMON_DOWN_VETERAN_STATUS = {
  ok: true,
  complete: false,
  steps: {
    covenCli: { ok: true, detail: "0.0.53" },
    covenHome: { ok: true, detail: "~/.coven" },
    git: { ok: true, optional: true, detail: "/usr/bin/git" },
    adapters: { ok: true, detail: "Codex" },
    daemon: { ok: false, detail: "daemon socket not reachable" },
    familiars: { ok: false, optional: true, detail: "daemon offline" },
    binding: { ok: false, optional: true, detail: "Waiting for the daemon" },
  },
  tools: [],
};

// Every step healthy but the roster empty — the state the finish CTA's
// "summon your familiar" promise is about. Server `complete` alone drives the
// wizard's finish state: Coven Code is an optional runtime adapter, so it is
// deliberately ABSENT from tools[] here — the banner must still appear.
const COMPLETE_NO_FAMILIARS_STATUS = {
  ok: true,
  complete: true,
  steps: {
    covenCli: { ok: true, detail: "0.0.60" },
    covenHome: { ok: true, detail: "~/.coven" },
    git: { ok: true, optional: true, detail: "/usr/bin/git" },
    adapters: { ok: true, detail: "Codex" },
    daemon: { ok: true, detail: "running" },
    familiars: { ok: false, optional: true, detail: "no familiars" },
    binding: { ok: false, optional: true, detail: "no binding configured" },
  },
  tools: [
    {
      id: "coven-cli",
      label: "Coven CLI",
      packageName: "@opencoven/cli",
      binary: "coven",
      installed: true,
      path: "/usr/local/bin/coven",
      current: "0.0.60",
      latest: "0.0.60",
      outdated: false,
      compatible: true,
      minimumVersion: "0.0.50",
      // Display-only now: the tools card shows verified freshness, but
      // completion is the server's `complete` — no client-side tool AND.
      latestCheck: { status: "verified", checkedAt: "2026-07-12T00:00:00.000Z", latest: "0.0.60" },
    },
  ],
};

async function gotoApp(page: Page, status: unknown, opts?: { dismissed?: boolean }) {
  await page.route("**/api/onboarding/status**", (r) => r.fulfill({ json: status }));
  await page.route("**/api/familiars**", (r) => r.fulfill({ json: { ok: true, familiars: [] } }));
  await page.route("**/api/sessions/list**", (r) => r.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/harnesses**", (r) => r.fulfill({ json: { ok: true, harnesses: [] } }));
  await page.route("**/api/openclaw-agents**", (r) => r.fulfill({ json: { ok: true, agents: [] } }));
  if (opts?.dismissed) {
    await page.addInitScript(() => {
      window.localStorage.setItem("cave:onboarding:dismissed", "1");
    });
  }
  await page.goto("/");
}

const wizard = (page: Page) => page.getByRole("dialog", { name: "Onboarding" });

// cave-m3a8: the workspace registers its cave:onboarding-open listener in a
// mount effect that can land AFTER the searchbox paints — on a cold CI
// machine a single dispatch fires into the void and the dialog never opens.
// Re-dispatch until the dialog exists; each attempt is cheap and idempotent.
async function openWizardManually(page: Page) {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:onboarding-open")));
    await expect(wizard(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("onboarding wizard", () => {
  test("auto-opens on a fresh machine and keeps keyboard focus trapped inside", async ({ page }) => {
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });
    await expect(wizard(page).getByText("Set up CovenCave, step by step.")).toBeVisible();

    // Give the home composer's 80ms mount-autofocus a chance to (wrongly)
    // steal focus, then require that keyboard interaction stays in the modal.
    await page.waitForTimeout(1_000);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inDialog = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Onboarding"]')),
      );
      expect(inDialog, `Tab press ${i + 1} must stay inside the wizard`).toBe(true);
    }
  });

  test("marks the first incomplete step as the current step", async ({ page }) => {
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });
    const current = wizard(page).locator('li[aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current.first()).toContainText("Install the Coven CLI");
  });

  test("Escape closes for the session without permanently skipping", async ({ page }) => {
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(wizard(page)).toHaveCount(0);
    // Escape must NOT write the permanent opt-out — a fresh visit still guides.
    const dismissed = await page.evaluate(() => window.localStorage.getItem("cave:onboarding:dismissed"));
    expect(dismissed).toBeNull();
  });

  test("stays hidden once dismissed", async ({ page }) => {
    await gotoApp(page, FRESH_STATUS, { dismissed: true });
    await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await expect(wizard(page)).toHaveCount(0);
  });

  test("does not relaunch for a set-up machine whose daemon is merely stopped", async ({ page }) => {
    await gotoApp(page, DAEMON_DOWN_VETERAN_STATUS);
    await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await expect(wizard(page)).toHaveCount(0);
  });

  test("shows the first-run journey strip with setup as the current beat", async ({ page }) => {
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });
    const strip = wizard(page).getByLabel("First-run journey");
    await expect(strip).toBeVisible();
    await expect(strip.getByText("Set up Cave")).toBeVisible();
    await expect(strip.getByText("Summon a familiar")).toBeVisible();
    await expect(strip.getByText("First chat")).toBeVisible();
    await expect(strip.locator('[aria-current="step"]')).toHaveText(/Set up Cave/);
  });

  test("completed setup surfaces an above-the-fold banner whose CTA opens the Summoning Circle", async ({ page }) => {
    // Complete machines never auto-open; drive the wizard via the manual-open
    // event every setup entry point dispatches.
    await gotoApp(page, COMPLETE_NO_FAMILIARS_STATUS);
    await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
    await openWizardManually(page);

    // The banner renders at the top — reachable without scrolling a long page.
    await expect(wizard(page).getByText("Setup complete — Cave is ready.")).toBeVisible();

    // Its CTA keeps the promise: the Summoning Circle itself opens (not just
    // the Familiars roster with a second button to find).
    await wizard(page).getByRole("button", { name: "Summon your familiar", exact: true }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Summoning circle" })).toBeVisible({ timeout: 15_000 });
  });

  test("a failed CLI install (npm missing) shows the hint and stays retryable", async ({ page }) => {
    // The install route's npm-missing shape: the wizard must surface the hint
    // (NodeSetupNotice + per-tool failure note) and keep the install button
    // enabled — a machine without Node can never be a dead end.
    let installCalls = 0;
    await page.route("**/api/onboarding/install", (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      installCalls += 1;
      return r.fulfill({
        status: 422,
        json: {
          ok: false,
          npmMissing: true,
          error: "npm is not available on PATH",
          hint: "Install Node.js LTS from https://nodejs.org, then try again.",
        },
      });
    });
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });

    const install = wizard(page).getByRole("button", { name: "Install the Coven CLI", exact: true });
    await install.click();
    await expect(
      wizard(page).getByText("Install Node.js LTS from https://nodejs.org, then try again."),
    ).toBeVisible({ timeout: 10_000 });
    expect(installCalls).toBeGreaterThanOrEqual(1);

    // Retryable: the primary action is enabled again, and clicking it hits
    // the route a second time.
    await expect(install).toBeEnabled();
    await install.click();
    await expect.poll(() => installCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test("a completed failed CLI install keeps its redacted tail visible and copyable", async ({ page }) => {
    const terminalTail =
      "node: error while loading shared libraries: libatomic.so.1: cannot open shared object file";
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as Window & { __copiedDiagnostics?: string }).__copiedDiagnostics = text;
          },
        },
      });
    });
    await page.route("**/api/onboarding/install**", (r) => {
      const request = r.request();
      if (request.method() === "POST") {
        return r.fulfill({
          status: 202,
          json: { started: true, target: "coven-cli", npmBusy: true },
        });
      }
      const target = new URL(request.url()).searchParams.get("target");
      if (target === "coven-cli") {
        return r.fulfill({
          json: {
            status: "done",
            elapsedMs: 671,
            tail: terminalTail,
            ok: false,
            code: 127,
            binaryPath: "/redacted/coven",
            error: "installer exited with code 127",
            npmBusy: false,
            npmBusyTarget: null,
          },
        });
      }
      return r.fulfill({
        json: { status: "idle", npmBusy: false, npmBusyTarget: null },
      });
    });
    await gotoApp(page, FRESH_STATUS);
    await expect(wizard(page)).toBeVisible({ timeout: 30_000 });

    await wizard(page)
      .getByRole("button", { name: "Install the Coven CLI", exact: true })
      .click();
    await expect(wizard(page).getByText("installer exited with code 127")).toBeVisible({
      timeout: 10_000,
    });
    await expect(wizard(page).getByText(terminalTail)).toBeVisible();

    await wizard(page).getByRole("button", { name: /Copy diagnostics/ }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __copiedDiagnostics?: string }).__copiedDiagnostics ?? "",
        ),
      )
      .toContain(terminalTail);
  });

  test("a failed daemon start shows message + hint and recovers through the banner's retry", async ({ page }) => {
    // Structural steps healthy + daemon down: opening the wizard fires its
    // one automatic daemon start. Fail every start until the flag flips —
    // deterministic no matter which surface (wizard or workspace) calls
    // first — then prove the banner's retry clears it on success.
    let daemonStartShouldFail = true;
    let startCalls = 0;
    await page.route("**/api/daemon/start", (r) => {
      startCalls += 1;
      return daemonStartShouldFail
        ? r.fulfill({
            status: 504,
            json: { ok: false, error: "timeout", stderr: "daemon did not answer health checks" },
          })
        : r.fulfill({ json: { ok: true, exitCode: 0, restart: false, stdout: "", stderr: "" } });
    });
    await gotoApp(page, DAEMON_DOWN_VETERAN_STATUS);
    await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 30_000 });
    await openWizardManually(page);

    // The failure banner carries the verbatim error, the derived hint, and a
    // retry naming the failed action.
    const banner = wizard(page).getByRole("alert").filter({ hasText: "timeout" });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByText(/didn't come up within its start window/)).toBeVisible();
    const retry = banner.getByRole("button", { name: "Retry daemon start" });
    await expect(retry).toBeVisible();
    expect(startCalls).toBeGreaterThanOrEqual(1);

    // Recovery: flip the route to success, retry from the banner, banner
    // clears — the user never has to hunt for the original button.
    daemonStartShouldFail = false;
    await retry.click();
    await expect(banner).toHaveCount(0, { timeout: 10_000 });
  });
});
