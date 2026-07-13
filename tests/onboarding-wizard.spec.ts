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
// "summon your familiar" promise is about. Coven Code must be present and
// current in tools[]: the wizard ANDs it into effectiveComplete.
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
      // effectiveComplete requires hasVerifiedLatestVersion(tool): a verified
      // latestCheck, not just current === latest.
      latestCheck: { status: "verified", checkedAt: "2026-07-12T00:00:00.000Z", latest: "0.0.60" },
    },
    {
      id: "coven-code",
      label: "Coven Code",
      packageName: "@opencoven/coven-code",
      binary: "coven-code",
      installed: true,
      path: "/usr/local/bin/coven-code",
      current: "0.0.60",
      latest: "0.0.60",
      outdated: false,
      compatible: true,
      minimumVersion: "0.0.50",
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
    await expect(current.first()).toContainText("Install the OpenCoven tools");
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
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:onboarding-open")));
    await expect(wizard(page)).toBeVisible({ timeout: 15_000 });

    // The banner renders at the top — reachable without scrolling a long page.
    await expect(wizard(page).getByText("Setup complete — Cave is ready.")).toBeVisible();

    // Its CTA keeps the promise: the Summoning Circle itself opens (not just
    // the Familiars roster with a second button to find).
    await wizard(page).getByRole("button", { name: "Summon your familiar", exact: true }).click();
    await expect(wizard(page)).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Summoning circle" })).toBeVisible({ timeout: 15_000 });
  });
});
