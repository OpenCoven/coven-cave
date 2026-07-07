import { expect, test, type Page } from "@playwright/test";

// Grimoire MdEditor autosave — behavioral e2e (cave-78l, follow-up to cave-b2v).
//
// cave-b2v shipped debounced autosave for the Grimoire's knowledge and journal
// editors with source-scan tests only. This spec proves the runtime behavior:
//
//   1. Typing in a journal reflection fires a debounced POST /api/journal with
//      NO explicit Save click.
//   2. Typing in a knowledge entry fires a debounced POST /api/knowledge the
//      same way.
//   3. The memory editor stays explicit-save: typing never auto-PUTs
//      /api/memory/file (agents write those roots concurrently; a silent
//      autosave would race the mtime conflict guard).
//
// Daemon-less (COVEN_CAVE_E2E=1): every Grimoire data source is mocked via
// page.route. The editor is pinned to MARKDOWN mode through its
// `cave:md-editor:mode` preference so the spec drives the CodeMirror editor
// and never mounts Milkdown Crepe — the heavy visual editor whose cold
// compile made the crash-sweep flaky (cave-ae7).

const KNOWLEDGE_ENTRY = {
  id: "release-checklist",
  title: "Release checklist",
  tags: ["release"],
  scope: "global",
  enabled: true,
  body: "Stamp the version everywhere.",
};

const MEMORY_ENTRY = {
  relPath: "memory/notes.md",
  fullPath: "/home/e2e/.coven/memory/notes.md",
  modified: new Date().toISOString(),
  sourceKindLabel: "Coven native memory",
  rootLabel: "Coven memory",
};

const JOURNAL_DAY = "2026-07-01";

async function gotoGrimoire(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Pin the shared MdEditor to MARKDOWN (CodeMirror) mode — typing goes
    // through the same updateRaw → debounce → save pipeline as VISUAL mode,
    // without Milkdown's cold-compile flake.
    window.localStorage.setItem("cave:md-editor:mode", "markdown");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/knowledge**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ json: { ok: true, entry: { ...KNOWLEDGE_ENTRY } } });
    }
    return route.fulfill({ json: { ok: true, entries: [KNOWLEDGE_ENTRY] } });
  });
  await page.route("**/api/memory", (route) => route.fulfill({ json: { ok: true, entries: [MEMORY_ENTRY] } }));
  await page.route("**/api/memory/file**", (route) => {
    if (route.request().method() === "PUT") {
      memoryPuts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, mtimeMs: 2000 } });
    }
    return route.fulfill({
      json: {
        ok: true,
        path: MEMORY_ENTRY.fullPath,
        revealed: true,
        text: "Remember the thing.",
        redactions: [],
        rawLength: 19,
        mtimeMs: 1000,
      },
    });
  });
  await page.route("**/api/journal**", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      return route.fulfill({ json: { ok: true, date: JOURNAL_DAY } });
    }
    if (new URL(req.url()).searchParams.get("date")) {
      return route.fulfill({
        json: {
          ok: true,
          date: JOURNAL_DAY,
          exists: true,
          entry: { reflectedBy: null, generatedAt: null, reflection: "Shipped the grimoire." },
          modified: null,
          stats: [],
          context: null,
        },
      });
    }
    return route.fulfill({
      json: { ok: true, days: [{ date: JOURNAL_DAY, preview: "Shipped the grimoire.", reflectedBy: null, modified: null }] },
    });
  });

  await page.goto("/?mode=grimoire");
  await page.waitForSelector(".grimoire-view", { timeout: 30_000 });
}

// PUT bodies captured by the memory-file mock, reset per test (the negative
// case asserts none arrive while typing).
let memoryPuts: Array<Record<string, unknown>> = [];

test.beforeEach(() => {
  memoryPuts = [];
});

/** Click into the last CodeMirror line (the document body — below any
 *  frontmatter) and type there. */
async function typeInEditor(page: Page, text: string) {
  const lastLine = page.locator(".grimoire-view .cm-line").last();
  await lastLine.waitFor({ timeout: 30_000 });
  await lastLine.click();
  await page.keyboard.type(text);
}

test.describe("grimoire autosave (desktop)", () => {
  test("journal reflections autosave after the debounce — no Save click", async ({ page }) => {
    await gotoGrimoire(page);
    await page.getByRole("button", { name: /2026-07-01/ }).click();

    const posted = page.waitForRequest(
      (req) => req.method() === "POST" && req.url().includes("/api/journal"),
      { timeout: 15_000 },
    );
    await typeInEditor(page, " More reflection.");
    const req = await posted;

    const body = req.postDataJSON() as { date?: string; reflection?: string };
    expect(body.date).toBe(JOURNAL_DAY);
    expect(body.reflection).toContain("More reflection.");
  });

  test("knowledge entries autosave after the debounce — no Save click", async ({ page }) => {
    await gotoGrimoire(page);
    await page.getByRole("button", { name: /Release checklist/ }).click();

    const posted = page.waitForRequest(
      (req) => req.method() === "POST" && req.url().includes("/api/knowledge"),
      { timeout: 15_000 },
    );
    await typeInEditor(page, " Tag the release.");
    const req = await posted;

    const body = req.postDataJSON() as { id?: string; body?: string };
    expect(body.id).toBe(KNOWLEDGE_ENTRY.id);
    expect(body.body).toContain("Tag the release.");
  });

  test("memory files never autosave — typing leaves the draft unsaved", async ({ page }) => {
    await gotoGrimoire(page);
    await page.getByRole("button", { name: /notes\.md/ }).click();

    await typeInEditor(page, " A new fact.");
    // The editor tracks the draft as dirty (manual-save surface)…
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    // …and well past the 1.2s autosave debounce, still nothing was written.
    await page.waitForTimeout(3_500);
    expect(memoryPuts).toHaveLength(0);
    await expect(page.getByText("Unsaved changes")).toBeVisible();

    // The explicit Save path still works and is the only write.
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect.poll(() => memoryPuts.length, { timeout: 10_000 }).toBe(1);
    const body = memoryPuts[0] as { path?: string; text?: string; expectedMtimeMs?: number };
    expect(body.path).toBe(MEMORY_ENTRY.fullPath);
    expect(body.text).toContain("A new fact.");
    expect(body.expectedMtimeMs).toBe(1000);
  });
});
