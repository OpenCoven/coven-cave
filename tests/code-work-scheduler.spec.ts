import { expect, test, type Page, type Request } from "@playwright/test";

// The Work scheduler (cave-7c329) — the isWork half of Cody Code Reading v2,
// mounted as the Coding Room's Work tab.
//
// This spec exists for ONE reason: the pure model in src/lib/work-scheduler.ts
// can prove a figure is derived, but only the rendered surface can prove the
// derived figure is the one on screen. Every assertion below is a rendered
// honesty property, not a spelling:
//
//   - the lane figure equals a value computed from the mocked queue, and two
//     lanes with different shares print different numbers (a placeholder would
//     print the same one twice);
//   - a lane whose familiar is not running does not read as running;
//   - no reorder control exists anywhere in the table;
//   - a gate card names its blocker by TITLE, states why one is primary, and
//     offers no Approve;
//   - the undo that IS offered fires the exact inverse request;
//   - the action that is NOT reversible offers no undo and prints the reason.
//
// Daemon-less — onboarding dismissed, every endpoint mocked via page.route.

const ISO = "2026-06-12T10:00:00.000Z";

const READY = [
  // Nova owns two, Orion one — deliberately unequal so a constant share fails.
  { id: "cave-aaa", title: "Wire the flux capacitor", priority: 1, status: "open", assignee: "nova", updated_at: ISO },
  { id: "cave-bbb", title: "Fix login retry", priority: 3, status: "open", assignee: "nova", updated_at: ISO },
  { id: "cave-ccc", title: "Rotate the signing key", priority: 2, status: "open", assignee: "orion", updated_at: ISO },
];

const BLOCKED = [
  { id: "cave-gate", title: "Ship the audit broker", priority: 1, status: "blocked", blocked_by: ["cave-blk", "cave-deep"], blocked_by_count: 2 },
  { id: "cave-deep", title: "Land the capability layer", priority: 0, status: "blocked", blocked_by: ["cave-root"], blocked_by_count: 1 },
];

const BLOCKERS = [
  { id: "cave-blk", title: "Provision the signing key", status: "open", priority: 2 },
  { id: "cave-deep", title: "Land the capability layer", status: "blocked", priority: 0 },
];

const FAMILIARS = [
  { id: "nova", display_name: "Nova", role: "Coding", familiarType: "coding", status: "online", icon: "ph:sparkle-fill" },
  { id: "orion", display_name: "Orion", role: "Coding", familiarType: "coding", status: "online", icon: "ph:sparkle-fill" },
];

const SESSIONS = [
  {
    id: "s-nova",
    project_root: "/repo/alpha",
    harness: "claude",
    title: "Wire the flux capacitor",
    status: "running",
    familiarId: "nova",
    exit_code: null,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
    attention: { state: "none", since: null, reason: null },
  },
  {
    id: "s-orion",
    project_root: "/repo/alpha",
    harness: "claude",
    title: "Old work",
    status: "completed",
    familiarId: "orion",
    exit_code: 0,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
    attention: { state: "none", since: null, reason: null },
  },
];

type Posted = { action?: string; id?: string; priority?: number; assignee?: string };

async function mount(page: Page): Promise<Posted[]> {
  const posted: Posted[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });

  await page.route("**/api/familiars**", (route) => route.fulfill({ json: { ok: true, familiars: FAMILIARS } }));
  await page.route("**/api/daemon/status**", (route) =>
    route.fulfill({ json: { running: true, availability: "online", target: { mode: "local" } } }),
  );
  await page.route("**/api/daemon/connection**", (route) =>
    route.fulfill({
      json: {
        running: true,
        availability: "online",
        checkedAt: ISO,
        target: { mode: "local", label: "Local daemon", socket: "/tmp/coven.sock" },
      },
    }),
  );
  await page.route("**/api/onboarding/status**", (route) =>
    route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } }),
  );
  await page.route("**/api/onboarding/update**", (route) =>
    route.fulfill({ json: { ok: true, tools: [], checkedAt: ISO, stale: false } }),
  );
  await page.route("**/api/onboarding/install**", (route) => route.fulfill({ json: { npmBusy: false } }));
  await page.route("**/api/cave-home-migration**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: { pending: [], conflicts: [], migrated: true, details: [], backupRoot: "", journalPath: "" },
      },
    }),
  );
  await page.route("**/api/roles**", (route) => route.fulfill({ json: { ok: true, roles: [] } }));
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: SESSIONS } }));
  await page.route("**/api/queue/readiness**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        readiness: {
          ok: true,
          code: "ready",
          message: "",
          canGenerate: false,
          project: { id: "alpha", name: "Alpha", root: "/repo/alpha" },
        },
      },
    }),
  );

  await page.route("**/api/beads?**", (route) => {
    const request: Request = route.request();
    if (request.method() === "POST") {
      posted.push(JSON.parse(request.postData() ?? "{}") as Posted);
      route.fulfill({ json: { ok: true, action: "ok", data: {} } });
      return;
    }
    const url = request.url();
    if (url.includes("mode=blocked")) {
      route.fulfill({ json: { ok: true, mode: "blocked", data: BLOCKED, blockers: BLOCKERS } });
      return;
    }
    if (url.includes("mode=show")) {
      route.fulfill({ json: { ok: true, mode: "show", data: [READY[0]] } });
      return;
    }
    route.fulfill({ json: { ok: true, mode: "ready", data: READY } });
  });
  // POST /api/beads carries no query string, so it needs its own pattern.
  await page.route("**/api/beads", (route) => {
    const request: Request = route.request();
    if (request.method() === "POST") {
      posted.push(JSON.parse(request.postData() ?? "{}") as Posted);
      route.fulfill({ json: { ok: true, action: "ok", data: {} } });
      return;
    }
    route.fulfill({ json: { ok: true, mode: "ready", data: READY } });
  });

  await page.goto("/?mode=code", { waitUntil: "domcontentloaded" });
  const tabs = page.getByRole("tablist", { name: "Code surface" });
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  await tabs.getByRole("tab", { name: "Work" }).click();
  await expect(page.getByRole("list", { name: "Familiar lanes" })).toBeVisible({ timeout: 30_000 });
  return posted;
}

test.describe.configure({ mode: "serial" });

test.describe("work scheduler", () => {
  test("lane figures are derived from the queue, and an unread state is never guessed", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only; the rail stacks under the queue on a phone");
    await mount(page);

    const lanes = page.getByRole("list", { name: "Familiar lanes" });
    const nova = lanes.getByRole("listitem").filter({ hasText: "Nova" });
    const orion = lanes.getByRole("listitem").filter({ hasText: "Orion" });

    // 2 of 3 and 1 of 3. Two DIFFERENT figures from one render: a placeholder
    // — or a share computed against anything but the rendered rows — cannot
    // produce both.
    await expect(nova).toContainText("2 queued · 67% of queue");
    await expect(orion).toContainText("1 queued · 33% of queue");

    // The dot's word comes from the familiar's own live session.
    await expect(nova).toContainText("focused");
    await expect(orion).not.toContainText("focused");
  });

  test("the queue has no reorder control, and its order is the tracker's", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only");
    await mount(page);

    const table = page.getByRole("table");
    // Priority band first, then the tie-break — cave-aaa (P1), cave-ccc (P2),
    // cave-bbb (P3) — regardless of the order the API returned them in.
    const ids = await table.getByRole("row").locator("td:nth-child(2)").allInnerTexts();
    expect(ids.map((text) => text.trim())).toEqual(["cave-aaa", "cave-ccc", "cave-bbb"]);

    // Nothing in the table can be dragged: the frame's drag would have written
    // a rank bd does not store, so it is not offered at all.
    await expect(table.locator("[draggable]")).toHaveCount(0);
    // Scoped to the table: the app shell has its own drag handles, and this is
    // an assertion about the QUEUE, not about the window chrome around it.
    await expect(table.getByRole("button", { name: /reorder|move up|move down|drag/i })).toHaveCount(0);
    await expect(page.getByText("There is no hand-rank")).toBeVisible();
  });

  test("a gate card names its blocker, states why one is primary, and offers no approval", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only");
    await mount(page);

    const gate = page.getByRole("listitem").filter({ hasText: "Ship the audit broker" });
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Blocked by 2");

    // Named, not a bare id — the joined title is what proves the route's join
    // reached the render.
    await expect(gate).toContainText("Provision the signing key");
    await expect(gate).toContainText("Land the capability layer");
    // cave-deep is itself blocked, so it is marked and cannot be the primary.
    await expect(gate).toContainText("also blocked");
    await expect(gate).toContainText("the only blocker not itself blocked");
    await expect(gate).toContainText("Beads record blockers, not a primary");

    // The one action is to go to the blocker.
    await expect(gate.getByRole("button", { name: "Open cave-blk" })).toBeVisible();
    await expect(gate.getByRole("button", { name: /approve/i })).toHaveCount(0);
  });

  test("the undo that is offered fires the exact inverse; the one that is not says why", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "desktop-only");
    const posted = await mount(page);

    // cave-bbb sits at P3 (Low). Promote it to Critical.
    await page.getByRole("button", { name: "Actions for cave-bbb" }).click();
    await page.getByRole("menuitemradio", { name: "Critical" }).click();
    await expect
      .poll(() => posted.filter((body) => body.action === "priority"))
      .toEqual([{ action: "priority", id: "cave-bbb", priority: 0, projectRoot: "/repo/alpha" }]);

    // History offers the undo, and firing it replays the PREVIOUS band.
    await page.getByRole("tab", { name: "History" }).click();
    const entry = page.getByRole("listitem").filter({ hasText: "Priority Low → Critical" });
    await expect(entry).toBeVisible();
    await entry.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => posted.filter((body) => body.action === "priority").at(-1))
      .toEqual({ action: "priority", id: "cave-bbb", priority: 3, projectRoot: "/repo/alpha" });
    // Already fired: it must not be offered a second time.
    await expect(entry.getByRole("button", { name: "Undo" })).toHaveCount(0);

    // Reassign is recorded but is NOT reversible here, and says so instead of
    // showing a control that could not fire.
    await page.getByRole("tab", { name: "Gates" }).click();
    await page.getByRole("button", { name: "Actions for cave-ccc" }).click();
    await page.getByRole("menuitemradio", { name: "Nova" }).click();
    await expect
      .poll(() => posted.filter((body) => body.action === "claim"))
      .toEqual([{ action: "claim", id: "cave-ccc", assignee: "nova", projectRoot: "/repo/alpha" }]);

    await page.getByRole("tab", { name: "History" }).click();
    const reassigned = page.getByRole("listitem").filter({ hasText: "Reassigned to Nova" });
    await expect(reassigned).toBeVisible();
    await expect(reassigned.getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(reassigned).toContainText("cannot be undone here");
  });
});
