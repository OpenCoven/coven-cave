import { expect, test, type Page } from "@playwright/test";

// The Needs-you inbox in the desktop menu bar — design handoff
// `Coven Cave Prototype.dc.html` frame 2c, replacing the running-activity
// popover (cave-21rp).
//
// Covered: that the badge counts actionable work only and is absent at zero,
// the blocked → failed → awaiting order with oldest wait first inside a tier,
// that row tint is spent on awaiting/blocked while failed keeps only a badge,
// that the panel is genuinely opaque (the handoff's third P0 finding is
// transcript text reading THROUGH this popover), and that dismissing an ask
// removes it from the count.
//
// Daemon-less: /api/familiars, /api/sessions/list, /api/projects and
// /api/running-activity are all mocked.

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const NO_ATTENTION = { state: "none", since: null, reason: null } as const;

const SESSIONS = [
  // Two blocked, so the oldest-first rule inside a tier is observable.
  {
    id: "blocked-old",
    title: "Capability gap review",
    status: "completed",
    updated_at: iso(6),
    attention: { state: "awaiting-human", since: iso(6), reason: "approval" },
  },
  {
    id: "blocked-new",
    title: "Grant repo access",
    status: "completed",
    updated_at: iso(1),
    attention: { state: "awaiting-human", since: iso(1), reason: "credentials" },
  },
  {
    id: "failed-one",
    title: "Discord poll announce",
    status: "failed",
    updated_at: iso(5),
    attention: NO_ATTENTION,
  },
  {
    id: "awaiting-one",
    title: "Windows ACL revert",
    status: "completed",
    updated_at: iso(4),
    attention: { state: "awaiting-human", since: iso(4), reason: "input" },
  },
  // Neither of these may reach the inbox: running work wants nothing from you,
  // and a settled session is settled.
  { id: "running-one", title: "Mamase model selection", status: "running", updated_at: iso(0), attention: NO_ATTENTION },
  { id: "done-one", title: "Nightly triage", status: "completed", updated_at: iso(3), attention: NO_ATTENTION },
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  project_root: "/repo/alpha",
  exit_code: s.status === "failed" ? 1 : 0,
  archived_at: null,
  created_at: s.updated_at,
}));

const TRIGGER = ".needs-you-trigger";
const PANEL = ".needs-you-panel";
const ROW = ".needs-you-row";

async function gotoCave(page: Page, { sessions = SESSIONS, running = 12 } = {}) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Start from a clean slate: a dismissal persisted by an earlier test would
    // silently shrink this one's list.
    window.localStorage.removeItem("cave:needs-you:seen");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions } }));
  await page.route("**/api/projects**", (route) => route.fulfill({ json: { ok: true, projects: [] } }));
  // `isRunningActivityPayload` enforces `total === items.length` — the total is
  // the post-dedup item count, not an independent number — so the mock has to
  // carry real items or the payload is rejected and the component (correctly)
  // falls back to its session-derived count.
  const runningItems = Array.from({ length: running }, (_, i) => ({
    id: `session:run-${i}`,
    kind: "session" as const,
    title: `Running session ${i}`,
    status: "running" as const,
    startedAt: iso(0),
    familiarId: "nova",
    targetId: `run-${i}`,
  }));
  await page.route(/\/api\/running-activity(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        generatedAt: new Date(NOW).toISOString(),
        total: runningItems.length,
        items: runningItems,
        sources: {
          sessions: { ok: true, count: runningItems.length },
          board: { ok: true, count: 0 },
          automations: { ok: true, count: 0 },
          flows: { ok: true, count: 0 },
          workflows: { ok: true, count: 0 },
        },
        unavailable: [],
      },
    }),
  );
  await page.goto("/?mode=home", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
  await page.waitForSelector(TRIGGER, { timeout: 30_000 });
}

test.describe("Needs-you inbox", () => {
  test("badges only actionable work, and orders blocked → failed → awaiting", async ({ page }) => {
    await gotoCave(page);

    // Four need you; the running and completed sessions must not be counted.
    const badge = page.locator(`${TRIGGER} .needs-you-trigger__badge`);
    await expect(badge).toHaveText("4");
    await expect(page.locator(TRIGGER)).toHaveAttribute("aria-label", "Needs you, 4 items");

    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible();

    // Blocked outranks failed, failed outranks awaiting, and the older of the
    // two blocked asks comes first.
    await expect(page.locator(`${PANEL} ${ROW} .needs-you-row__title`)).toHaveText([
      "Capability gap review",
      "Grant repo access",
      "Discord poll announce",
      "Windows ACL revert",
    ]);

    await expect(page.locator(`${PANEL} ${ROW}`).nth(0)).toHaveAttribute("data-lifecycle", "blocked");
    await expect(page.locator(`${PANEL} ${ROW}`).nth(2)).toHaveAttribute("data-lifecycle", "failed");
    await expect(page.locator(`${PANEL} ${ROW}`).nth(3)).toHaveAttribute("data-lifecycle", "awaiting");
  });

  test("row tint is spent on awaiting and blocked; failed carries a badge, not a field", async ({ page }) => {
    await gotoCave(page);
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible();

    const backgrounds = await page.locator(`${PANEL} ${ROW}`).evaluateAll((rows) =>
      rows.map((row) => ({
        lifecycle: row.getAttribute("data-lifecycle"),
        background: window.getComputedStyle(row).backgroundColor,
      })),
    );
    const plain = backgrounds.find((r) => r.lifecycle === "failed")?.background;
    const tinted = backgrounds.filter((r) => r.lifecycle !== "failed").map((r) => r.background);

    // The alarm wall this redesign retires was a row-wide red field on every
    // failure. Failed must render the untinted row background.
    for (const background of tinted) {
      expect(background, "awaiting/blocked rows carry a tint").not.toBe(plain);
    }
    // Every state still names itself in words — colour is never the only channel.
    await expect(page.locator(`${PANEL} .needs-you-row__badge`).nth(2)).toContainText("Failed");
  });

  test("the panel is opaque, so nothing reads through it", async ({ page }) => {
    await gotoCave(page);
    await page.locator(TRIGGER).click();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();

    const paint = await panel.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { background: style.backgroundColor, backdropFilter: style.backdropFilter };
    });
    // A fully opaque colour: rgb() with no alpha, or rgba(…, 1).
    expect(paint.background).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\s*\)/);
    expect(paint.backdropFilter === "none" || paint.backdropFilter === "").toBeTruthy();
  });

  test("running is footer context, never the badge", async ({ page }) => {
    await gotoCave(page, { running: 12 });
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible();

    // The cross-source total from /api/running-activity, not a count of the
    // running sessions in the mocked list (which is 1).
    await expect(page.locator(".needs-you-foot__stat[data-tone='running']")).toHaveText("12 running");
    await expect(page.locator(`${TRIGGER} .needs-you-trigger__badge`)).toHaveText("4");
  });

  test("marking all seen empties the inbox and clears the badge", async ({ page }) => {
    await gotoCave(page);
    await page.locator(TRIGGER).click();
    await expect(page.locator(`${PANEL} ${ROW}`)).toHaveCount(4);

    await page.locator(".needs-you-head__seen").click();

    await expect(page.locator(`${PANEL} ${ROW}`)).toHaveCount(0);
    await expect(page.locator(PANEL)).toContainText("Nothing needs you");
    // The bell stays — it is how the empty state is reachable — but the badge,
    // which only means something when it is rare, goes.
    await expect(page.locator(TRIGGER)).toBeVisible();
    await expect(page.locator(`${TRIGGER} .needs-you-trigger__badge`)).toHaveCount(0);
  });

  test("\u21e7\u2318A opens the inbox, because the tooltip says it does", async ({ page }) => {
    await gotoCave(page);
    await expect(page.locator(PANEL)).toHaveCount(0);

    // The trigger advertises this. A hint that performs no action is the
    // defect the review caught on the first pass.
    await page.keyboard.press("Meta+Shift+KeyA");

    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(`${PANEL} ${ROW}`)).toHaveCount(4);
  });

  test("a row announces its wait, not just its title", async ({ page }) => {
    await gotoCave(page);
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible();

    // No explicit aria-label: an aria-label REPLACES the descendant name, which
    // is how the wait — the thing this list is ordered by — went unannounced.
    const row = page.locator(`${PANEL} ${ROW}`).first();
    await expect(row).not.toHaveAttribute("aria-label", /./);
    await expect(row).toContainText("waiting");
    await expect(row).toContainText("Blocked");
  });

  test("nothing waiting renders a quiet bell with no badge", async ({ page }) => {
    await gotoCave(page, {
      sessions: SESSIONS.filter((s) => s.id === "running-one" || s.id === "done-one"),
    });
    await expect(page.locator(TRIGGER)).toBeVisible();
    await expect(page.locator(`${TRIGGER} .needs-you-trigger__badge`)).toHaveCount(0);
    await expect(page.locator(TRIGGER)).toHaveAttribute(
      "aria-label",
      /Needs you, nothing waiting\./,
    );
  });
});
