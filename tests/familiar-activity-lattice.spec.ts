import { expect, test, type Page } from "@playwright/test";

const NOW = Date.now();
const DAY_MS = 86_400_000;
const NO_ATTENTION = { state: "none", since: null, reason: null } as const;

const NOVA = {
  id: "nova",
  display_name: "Nova",
  role: "Orchestrator",
  status: "active",
  icon: "ph:sparkle-fill",
  autoSelfReport: true,
};

const CONTRACT_REPORT = {
  specVersion: "0.1.0",
  pass: true,
  properties: [
    { property: "Named Identity", pass: true },
    { property: "Defined Purpose", pass: true },
    { property: "Bounded Authority", pass: true },
    { property: "Persistent Memory", pass: true },
    { property: "Human Belonging", pass: true },
  ],
  violations: [],
  warnings: [],
};

const RETRO_SNAPSHOT = {
  generatedAt: new Date(NOW).toISOString(),
  summary: {
    totalRuns: 0,
    accepted: 0,
    reverted: 0,
    runningFamiliars: 0,
    familiarsWithData: 0,
    trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
    lastRun: null,
  },
  familiars: [],
  runs: [],
};

let sequence = 0;

function isoDaysAgo(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString();
}

function sessionCountForDay(daysAgo: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const iso = isoDaysAgo(daysAgo);
    const id = `nova-session-${++sequence}`;
    return {
      id,
      project_root: "/repo/nova",
      harness: "claude",
      model: "claude-sonnet-4.6",
      runtime: "local",
      title: `Nova session ${id}`,
      status: index % 5 === 0 ? "completed" : "running",
      exit_code: 0,
      archived_at: null,
      created_at: iso,
      updated_at: iso,
      attention: NO_ATTENTION,
      familiarId: "nova",
      origin: "chat",
    };
  });
}

const SESSIONS = [
  ...sessionCountForDay(11, 1),
  ...sessionCountForDay(8, 4),
  ...sessionCountForDay(5, 12),
  ...sessionCountForDay(2, 24),
  ...sessionCountForDay(0, 100),
];

async function installAnalyticsRoutes(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname, searchParams } = url;

    if (pathname === "/api/familiars") {
      await route.fulfill({ json: { ok: true, familiars: [NOVA] } });
      return;
    }
    if (pathname === "/api/familiars/nova/contract") {
      await route.fulfill({ json: { ok: true, report: CONTRACT_REPORT } });
      return;
    }
    if (pathname === "/api/familiars/nova/self-reports/snapshots") {
      await route.fulfill({ json: { ok: true, snapshots: [], total: 0 } });
      return;
    }
    if (pathname === "/api/familiars/nova/self-reports") {
      await route.fulfill({ json: { ok: true, reports: [], total: 0 } });
      return;
    }
    if (pathname === "/api/sessions/list") {
      if (searchParams.get("familiarId") !== "nova" || searchParams.get("includeArchived") !== "1") {
        await route.fulfill({ status: 503, json: { ok: false, error: `unexpected sessions query: ${url.search}` } });
        return;
      }
      await route.fulfill({ json: { ok: true, sessions: SESSIONS } });
      return;
    }
    if (pathname === "/api/coven-memory") {
      await route.fulfill({ json: { ok: true, entries: [] } });
      return;
    }
    if (pathname === "/api/retro-runs") {
      await route.fulfill({ json: { ok: true, snapshot: RETRO_SNAPSHOT } });
      return;
    }
    if (pathname === "/api/feedback/message") {
      if (searchParams.get("familiarId") !== "nova") {
        await route.fulfill({ status: 503, json: { ok: false, error: `unexpected feedback query: ${url.search}` } });
        return;
      }
      await route.fulfill({ json: { ok: true, rollup: { up: 0, down: 0, total: 0, models: [], runtimes: [] } } });
      return;
    }

    await route.fulfill({
      status: 503,
      json: { ok: false, error: `unmocked api request: ${pathname}${url.search}` },
    });
  });
}

async function uniqueNonZeroSteps(page: Page): Promise<string[]> {
  return page.locator('[data-testid="familiar-activity-lattice"]').evaluate((host) => {
    const steps = [...host.querySelectorAll<HTMLElement>(".fa-lattice__day")]
      .map((cell) => cell.dataset.step ?? "")
      .filter((step) => step !== "0" && step !== "");
    return [...new Set(steps)].sort((left, right) => Number(left) - Number(right));
  });
}

async function latticeMetrics(page: Page) {
  return page.locator('[data-testid="familiar-activity-lattice"]').evaluate((host) => {
    const views = host.querySelector<HTMLElement>(".fa-lattice__views");
    const year = host.querySelector<HTMLElement>(".fa-lattice__cell--year");
    const quarter = host.querySelector<HTMLElement>(".fa-lattice__cell--quarter");
    const trend = host.querySelector<HTMLElement>(".fa-lattice__trend");
    const spark = trend?.querySelector<HTMLElement>(".spark");
    const caption = trend?.querySelector<HTMLElement>("figcaption");
    const fortnight = host.querySelector<HTMLElement>(".fa-lattice__cell--fortnight");
    const grid = year?.querySelector<HTMLElement>(".fa-lattice__grid");
    const cell = grid?.querySelector<HTMLElement>(".fa-lattice__day[data-step='4'], .fa-lattice__day");

    if (!views) throw new Error("Missing .fa-lattice__views");
    if (!year) throw new Error("Missing .fa-lattice__cell--year");
    if (!quarter) throw new Error("Missing .fa-lattice__cell--quarter");
    if (!trend) throw new Error("Missing .fa-lattice__trend");
    if (!spark) throw new Error("Missing .spark");
    if (!caption) throw new Error("Missing quarter figcaption");
    if (!fortnight) throw new Error("Missing .fa-lattice__cell--fortnight");
    if (!grid) throw new Error("Missing .fa-lattice__grid");
    if (!cell) throw new Error("Missing .fa-lattice__day cell");

    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };

    return {
      quarter: rect(quarter),
      spark: rect(spark),
      caption: rect(caption),
      fortnight: rect(fortnight),
      viewsFits: views.scrollWidth <= views.clientWidth,
      gridColumnCount: getComputedStyle(views).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
      yearCellRadius: getComputedStyle(cell).borderTopLeftRadius,
      yearCellWidth: cell.getBoundingClientRect().width,
      yearGridScrollWidth: grid.scrollWidth,
      yearGridClientWidth: grid.clientWidth,
    };
  });
}

test("activity lattice keeps its browser geometry in wide and narrow layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installAnalyticsRoutes(page);

  await page.goto("/dashboard/familiars/nova/analytics");
  await page.getByRole("button", { name: "Expand the activity detail" }).click();

  const lattice = page.getByTestId("familiar-activity-lattice");
  await expect(lattice).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => uniqueNonZeroSteps(page)).toEqual(["1", "2", "3", "4"]);

  const wide = await latticeMetrics(page);
  expect(wide.yearCellRadius).toBe("2px");
  expect(wide.caption.top, "quarter figcaption should start at or below the Sparkline").toBeGreaterThanOrEqual(wide.spark.bottom - 1);
  expect(Math.abs(wide.quarter.top - wide.fortnight.top), "quarter and fortnight should align on the same row in wide layout").toBeLessThanOrEqual(2);
  expect(wide.fortnight.left, "fortnight should sit to the right of the quarter in wide layout").toBeGreaterThanOrEqual(wide.quarter.right - 2);

  await lattice.evaluate((element) => {
    const host = element as HTMLElement;
    host.style.inlineSize = "320px";
    host.style.maxInlineSize = "320px";
  });

  await expect.poll(async () => (await latticeMetrics(page)).gridColumnCount).toBe(1);
  await expect.poll(async () => (await latticeMetrics(page)).viewsFits).toBe(true);

  const narrow = await latticeMetrics(page);
  expect(Math.abs(narrow.quarter.left - narrow.fortnight.left), "quarter and fortnight should share the same left edge in narrow layout").toBeLessThanOrEqual(2);
  expect(narrow.fortnight.top, "fortnight should stack below the quarter in narrow layout").toBeGreaterThanOrEqual(narrow.quarter.bottom - 2);
  expect(narrow.viewsFits, "the lattice views container should not overflow when stacked").toBe(true);
  expect(narrow.yearGridScrollWidth, "the year grid should scroll horizontally instead of collapsing cells").toBeGreaterThan(narrow.yearGridClientWidth);
  expect(narrow.yearCellWidth, "year cells should keep the reviewed minimum width").toBeGreaterThanOrEqual(6);
});
