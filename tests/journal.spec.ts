import { expect, test, type Page, type Route } from "@playwright/test";

const today = (() => {
  const value = new Date();
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
})();

const longReflection = Array.from(
  { length: 45 },
  (_, index) => `Paragraph ${index + 1}: Sage kept the coven's memory coherent and reviewable.`,
).join("\n\n");

type JournalScenario = {
  reflection?: string;
  reflectedBy?: string;
  dayStatus?: number;
  saveStatus?: number;
  saveError?: string;
  listResponses?: Array<{ status: number; delayMs?: number; error?: string }>;
};

type JournalState = JournalScenario & {
  listRequestCount: number;
  modified: string | null;
};

async function fulfillJournal(route: Route, scenario: JournalState) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === "POST") {
    const status = scenario.saveStatus ?? 200;
    if (status < 400) {
      const body = request.postDataJSON() as { reflection?: string; reflectedBy?: string };
      scenario.reflection = body.reflection ?? "";
      scenario.reflectedBy = body.reflectedBy ?? scenario.reflectedBy;
      scenario.modified = "2026-07-26T09:00:00.000Z";
    }
    return route.fulfill({
      status,
      json: status >= 400
        ? { ok: false, error: scenario.saveError ?? "Journal store unavailable." }
        : { ok: true, date: today, modified: scenario.modified },
    });
  }
  const date = url.searchParams.get("date");
  if (!date) {
    const response = scenario.listResponses?.[scenario.listRequestCount];
    scenario.listRequestCount += 1;
    if (response?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, response.delayMs));
    }
    if (response && response.status >= 400) {
      return route.fulfill({
        status: response.status,
        json: { ok: false, error: response.error ?? "Journal list unavailable." },
      });
    }
    return route.fulfill({
      json: {
        ok: true,
        days: scenario.reflection
          ? [{
              date: today,
              preview: scenario.reflection.slice(0, 80),
              reflectedBy: scenario.reflectedBy ?? "sage",
              modified: scenario.modified,
            }]
          : [],
      },
    });
  }
  if (url.searchParams.has("stats")) {
    return route.fulfill({
      json: {
        ok: true,
        date,
        stats: { covenOrigin: 3, externalRuntimes: 1, runtimeMemory: 2 },
        context: `${date}: Sage reviewed the day's memory.`,
        sources: [],
      },
    });
  }
  if ((scenario.dayStatus ?? 200) >= 400) {
    return route.fulfill({
      status: scenario.dayStatus,
      json: { ok: false, error: "Journal entry unavailable." },
    });
  }

  // Mirror the real route's familiar filter. The Journal tab is coven-wide, so
  // a detail request that incorrectly carries active familiar "nova" hides
  // Sage's entry and reproduces the list/detail mismatch.
  const requestedFamiliar = url.searchParams.get("familiar");
  const reflectedBy = scenario.reflectedBy ?? "sage";
  const hiddenByScope = Boolean(requestedFamiliar && requestedFamiliar !== reflectedBy);
  return route.fulfill({
    json: {
      ok: true,
      date,
      exists: Boolean(scenario.reflection) && !hiddenByScope,
      entry: hiddenByScope
        ? { reflectedBy: null, generatedAt: null, reflection: "" }
        : {
            reflectedBy,
            generatedAt: "2026-07-26T08:00:00.000Z",
            reflection: scenario.reflection ?? "",
          },
      modified: scenario.reflection && !hiddenByScope ? scenario.modified : null,
    },
  });
}

async function gotoJournal(page: Page, scenario: JournalScenario = {}) {
  const state: JournalState = {
    ...scenario,
    listRequestCount: 0,
    modified: scenario.reflection ? "2026-07-26T08:00:00.000Z" : null,
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active" },
          { id: "sage", display_name: "Sage", role: "Archivist", status: "active" },
        ],
      },
    }),
  );
  await page.route("**/api/daemon/status**", (route) =>
    route.fulfill({
      json: {
        running: false,
        availability: "offline",
        reason: "daemon offline",
        target: { mode: "local" },
      },
    }),
  );
  await page.route("**/api/onboarding/status**", (route) =>
    route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/knowledge/collections**", (route) =>
    route.fulfill({ json: { ok: true, collections: [] } }),
  );
  await page.route("**/api/knowledge**", (route) => route.fulfill({ json: { ok: true, entries: [] } }));
  await page.route("**/api/memory", (route) => route.fulfill({ json: { ok: true, entries: [] } }));
  await page.route("**/api/grimoire/graph**", (route) =>
    route.fulfill({ json: { ok: true, graph: { nodes: [], edges: [] } } }),
  );
  await page.route("**/api/journal**", (route) => fulfillJournal(route, state));
  await page.route("**/api/chat/send", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'id: 1\ndata: {"kind":"assistant_chunk","text":"Generated reflection from Sage."}\n\n',
        'id: 2\ndata: {"kind":"done","sessionId":"journal-e2e","isError":false}\n\n',
      ].join(""),
    }),
  );

  await page.goto("/?mode=journal", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".journal-list")).toBeVisible({ timeout: 45_000 });
  return state;
}

test.describe("Journal tab", () => {
  test("opens coven-wide entries and scrolls the full review surface", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoJournal(page, { reflection: longReflection, reflectedBy: "sage" });

    await expect(page.locator(".journal-entry__reflection")).toContainText("Paragraph 45");
    const detail = page.locator(".journal-detail");
    const metrics = await detail.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      };
    });
    expect(metrics.overflowY).toBe("auto");
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  });

  test("collapses and restores the journal day rail", async ({ page }) => {
    await gotoJournal(page, { reflection: "Sage reviewed the day's work.", reflectedBy: "sage" });

    const rail = page.locator(".journal-list__rail");
    await page.getByRole("button", { name: "Collapse journal entries" }).click();
    await expect(rail).toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => (await rail.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(80);

    await page.goto("/?mode=journal", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Expand journal entries" })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Expand journal entries" }).click();
    await expect(rail).not.toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => (await rail.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  });

  test("shows a retryable error instead of stale or endless loading content", async ({ page }) => {
    await gotoJournal(page, { dayStatus: 503 });

    await expect(page.locator(".journal-detail .ui-error-state")).toContainText("Couldn't load this journal entry");
    await expect(
      page
        .getByRole("region", { name: "Journal entry" })
        .getByRole("button", { name: "Retry" }),
    ).toBeVisible();
  });

  test("does not announce generation success when the journal save fails", async ({ page }) => {
    await gotoJournal(page, {
      saveStatus: 503,
      saveError: "Journal store unavailable.",
    });

    await page.getByRole("button", { name: "Collapse journal entries" }).click();
    await page.locator(".journal-detail").getByRole("button", { name: "Generate today's entry" }).click();
    await expect(page.locator(".journal-detail .journal-list__error")).toContainText("Journal store unavailable.");
    await expect(page.getByText("Reflection generated.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand journal entries" })).toBeVisible();
  });

  test("persists a generated reflection and reloads it from the journal API", async ({ page }) => {
    await gotoJournal(page);

    await page.locator(".journal-entry-gen").click();

    await expect(page.locator(".journal-entry__reflection")).toContainText("Generated reflection from Sage.");
    await expect(page.locator(".journal-day")).toContainText("Generated reflection from Sage.");
  });

  test("retries a failed day request", async ({ page }) => {
    const state = await gotoJournal(page, { dayStatus: 503 });
    await expect(page.locator(".journal-detail .ui-error-state")).toContainText("Couldn't load this journal entry");

    state.dayStatus = 200;
    await page.locator(".journal-detail").getByRole("button", { name: "Retry" }).click();

    await expect(page.locator(".journal-detail .ui-empty-state")).toContainText("No reflection yet for this day");
  });

  test("drops a stale list failure after a newer post-generation refresh", async ({ page }) => {
    await gotoJournal(page, {
      listResponses: [{ status: 503, delayMs: 1_500, error: "Obsolete list failure." }],
    });

    await page.locator(".journal-entry-gen").click();
    await expect(page.locator(".journal-day")).toContainText("Generated reflection from Sage.");

    await page.waitForTimeout(1_700);
    await expect(page.getByText("Obsolete list failure.")).toHaveCount(0);
    await expect(page.locator(".journal-entry__reflection")).toContainText("Generated reflection from Sage.");
  });
});
