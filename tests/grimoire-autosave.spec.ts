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
  body: [
    "Stamp the version everywhere.",
    "See [[Operations guide]] for the handoff.",
    ...Array.from({ length: 80 }, (_, index) => `Release note ${index + 1}: verify the packaged artifact.`),
  ].join("\n\n"),
};

const OPERATIONS_GUIDE = {
  id: "operations-guide",
  title: "Operations guide",
  tags: ["operations"],
  scope: "global",
  enabled: true,
  body: "Hand the release to the on-call operator.",
};

const INCIDENT_PLAYBOOK = {
  id: "incident-playbook",
  title: "Incident playbook",
  tags: ["operations"],
  scope: "global",
  enabled: true,
  body: "Stabilize the service before changing it.",
};

const MEMORY_ENTRY = {
  relPath: "memory/notes.md",
  fullPath: "/home/e2e/.coven/memory/notes.md",
  modified: new Date().toISOString(),
  sourceKindLabel: "Coven native memory",
  rootLabel: "Coven memory",
};

const JOURNAL_DAY = "2026-07-01";

const EMPTY_RUNNING_ACTIVITY = {
  ok: true,
  generatedAt: "2026-07-01T00:00:00.000Z",
  total: 0,
  items: [],
  sources: {
    sessions: { ok: true, count: 0 },
    board: { ok: true, count: 0 },
    automations: { ok: true, count: 0 },
    flows: { ok: true, count: 0 },
    workflows: { ok: true, count: 0 },
  },
  unavailable: [],
} as const;

async function gotoGrimoire(
  page: Page,
  readyTimeout = 60_000,
  knowledgeEntries: Array<typeof KNOWLEDGE_ENTRY & { collection?: string }> = [KNOWLEDGE_ENTRY, OPERATIONS_GUIDE, INCIDENT_PLAYBOOK],
) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    // Pin the shared MdEditor to MARKDOWN (CodeMirror) mode — typing goes
    // through the same updateRaw → debounce → save pipeline as VISUAL mode,
    // without Milkdown's cold-compile flake.
    window.localStorage.setItem("cave:md-editor:mode", "markdown");
  });
  await page.route(/\/api\/running-activity(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: EMPTY_RUNNING_ACTIVITY });
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: [{ id: "nova", display_name: "Nova", role: "Orchestrator", status: "active" }] } }),
  );
  await page.route("**/api/sessions/list**", (route) => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/knowledge**", (route) => {
    if (new URL(route.request().url()).pathname === "/api/knowledge/collections") {
      const ids = [...new Set(knowledgeEntries.flatMap((entry) => entry.collection ? [entry.collection] : []))];
      return route.fulfill({ json: { ok: true, collections: ids.map((id) => ({ id, meta: null, count: knowledgeEntries.filter((entry) => entry.collection === id).length })) } });
    }
    if (route.request().method() === "POST") {
      knowledgePosts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, entry: { ...KNOWLEDGE_ENTRY } } });
    }
    return route.fulfill({ json: { ok: true, entries: knowledgeEntries } });
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
  await page.waitForSelector(".grimoire-view", { timeout: readyTimeout });
}

/** The navigator rail. Row clicks scope here: with no open tabs the main pane
 *  shows the Knowledge launcher, whose recents duplicate the rail rows'
 *  accessible names (strict mode would reject the bare getByRole match). */
function rail(page: Page) {
  return page.locator(".grimoire-view aside");
}

// PUT bodies captured by the memory-file mock, reset per test (the negative
// case asserts none arrive while typing).
let memoryPuts: Array<Record<string, unknown>> = [];
let knowledgePosts: Array<Record<string, unknown>> = [];

test.beforeEach(() => {
  memoryPuts = [];
  knowledgePosts = [];
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
  test("Memories research groups preserve topic context, independent collapse, and search", async ({ page }, testInfo) => {
    test.slow(); // Two full shell loads plus the editor's cold compile.
    const researchEntries = [
      ["findings", "Findings"],
      ["primary", "Research and compare: # Reliable orchestration"],
      ["research-log", "Research log"],
      ["source-ledger", "Source ledger"],
    ].map(([id, title]) => ({
      ...KNOWLEDGE_ENTRY,
      id: `alpha-${id}`,
      title,
      tags: ["research", "mission:research-alpha", "autoresearch", id],
      body: `# ${title}\n\nAlpha evidence.`,
    }));
    await gotoGrimoire(page, 60_000, [
      KNOWLEDGE_ENTRY,
      ...researchEntries,
      { ...researchEntries[0], id: "beta-findings", tags: ["research", "mission:research-beta"], body: "# Model evaluation\n\nBeta evidence." },
    ]);
    const alpha = rail(page).getByRole("group", { name: "Reliable orchestration", exact: true });
    const beta = rail(page).getByRole("group", { name: "Model evaluation", exact: true });
    const toggle = alpha.locator(":scope > button");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(rail(page).getByRole("button", { name: /Release checklist/ })).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(alpha.getByRole("button", { name: /^Findings/ })).toBeVisible();
    await expect(alpha.getByRole("button")).toHaveCount(5);
    await expect(beta.getByRole("button")).toHaveCount(1);
    // The shell consumes the mode query, so explicitly re-enter on a fresh load.
    await page.goto("/?mode=grimoire");
    await page.waitForSelector(".grimoire-view", { timeout: 60_000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    const search = page.getByRole("searchbox", { name: "Search memories" });
    await search.fill("reliable orchestration");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(alpha.getByRole("button")).toHaveCount(5);
    await expect(beta).toHaveCount(0);
    await search.fill("source ledger");
    await expect(alpha).toBeVisible();
    await expect(alpha.getByRole("button")).toHaveCount(2);
    await search.fill("");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await alpha.getByRole("button", { name: /^Findings/ }).click();
    await expect(alpha.getByRole("button", { name: /^Findings/ })).toHaveAttribute("aria-current", "true");
    await expect(page).toHaveURL(/#grimoire:knowledge:alpha-findings$/);
    await expect(page.locator(".grimoire-view .cm-editor")).toContainText("Alpha evidence.");
    for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.setAttribute("data-theme", theme);
        document.documentElement.setAttribute("data-mode", mode);
        window.dispatchEvent(new CustomEvent("cave:theme-changed", { detail: { themeId: theme, mode } }));
      }, { theme, mode });
      await expect(toggle).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`research-topics-${theme}-${mode}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Back to document list" }).click();
    await expect(toggle).toBeVisible();
    expect(await rail(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("research-topics-narrow.png") });
  });

  test("Memories research groups retain collection-qualified document selection", async ({ page }) => {
    const root = {
      ...KNOWLEDGE_ENTRY, id: "shared-report", title: "Research and compare: Entrusted work",
      tags: ["research", "mission:research-shared"], body: "# Root evidence",
    };
    await gotoGrimoire(page, 60_000, [root, { ...root, collection: "archive", body: "# Archived evidence" }]);
    const groups = rail(page).getByRole("group", { name: "Entrusted work", exact: true });
    await expect(groups).toHaveCount(2);
    await groups.nth(1).getByRole("button").click();
    await groups.nth(1).getByRole("button", { name: /^Research and compare/ }).click();
    await expect(page).toHaveURL(/#grimoire:knowledge:archive(?:%2F|\/)shared-report$/);
    await expect(page.locator(".grimoire-view .cm-editor")).toContainText("Archived evidence");
    await expect(groups.nth(0).getByRole("button")).toHaveCount(1);
  });

  test("Memories home separates Continue, Recall, and Weave", async ({ page }) => {
    await gotoGrimoire(page);

    await expect(page.getByRole("heading", { name: "Continue", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recall", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weave", exact: true })).toBeVisible();
    await expect(page.locator(".gl-thread")).toHaveCount(1);
    await expect(page.locator(".gl-banner, .gl-bento")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Library" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("searchbox", { name: "Search memories" })).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "URL to capture" })).toBeVisible();
    await expect(rail(page).getByRole("region", { name: "Journal" })).toHaveCount(0);

    await page.getByRole("button", { name: "More Memories actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Weaves" })).toHaveAttribute("href", "/weaves");
    await expect(page.getByRole("menuitem", { name: "Blank entry" })).toBeVisible();
  });

  test("journal reflections autosave after the debounce — no Save click", async ({ page }) => {
    await gotoGrimoire(page);
    await page
      .getByLabel("Recall")
      .getByRole("button", { name: /Journal.*Shipped the grimoire\./ })
      .click();

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
    await rail(page).getByRole("button", { name: /Release checklist/ }).click();

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

  test("Reader mode gives the active document the full canvas and returns with Escape", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoGrimoire(page, 90_000);
    await rail(page).getByRole("button", { name: /Release checklist/ }).click();

    await expect(page.getByRole("button", { name: "Reader", exact: true })).toBeVisible();
    const titleLine = page.locator(".grimoire-view .cm-line").filter({ hasText: "title: Release checklist" });
    await titleLine.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.type("title: Release readiness");
    // This link exists only in the unsaved editor value. Reader's link chips
    // must follow that live draft while backlinks remain graph-backed.
    await typeInEditor(page, " See [[Incident playbook]].");
    const markdownViewport = page.locator(".grimoire-view .cm-scroller");
    await markdownViewport.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.6;
      element.dispatchEvent(new Event("scroll"));
    });
    await page.getByRole("button", { name: "Reader", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator(".grimoire-view")).toHaveClass(/grimoire-view--reader/);
    await expect(page.locator(".grimoire-view aside")).toBeHidden();
    await expect(page.locator(".md-editor__topbar")).toHaveCount(0);
    await expect(page.locator(".md-editor__footer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Release readiness", exact: true })).toBeVisible();
    await expect(page.locator(".grimoire-doc-links")).toContainText("Operations guide");
    await expect(page.locator(".grimoire-doc-links")).toContainText("Incident playbook");
    await expect(page.locator(".md-editor--reader .ProseMirror")).toHaveCount(1, { timeout: 30_000 });
    const readerDocument = page.locator(".md-editor--reader .ProseMirror");
    const readerViewport = page.getByLabel("Document reader");
    await expect(readerDocument.getByText("Stamp the version everywhere.")).toBeVisible();
    await expect(readerDocument).toHaveAttribute("contenteditable", "false");
    await readerViewport.focus();
    await page.keyboard.type(" Reader must not write this.");
    await expect(readerDocument).not.toContainText("Reader must not write this.");
    await page.locator(".md-editor-visual").dispatchEvent("keydown", { key: "s", metaKey: true });
    await page.waitForTimeout(1_500);
    expect(knowledgePosts).toHaveLength(0);
    await expect.poll(() => page.locator("[data-md-editor-scroll]").evaluate((element) => {
      const maxScroll = element.scrollHeight - element.clientHeight;
      return maxScroll > 0 ? element.scrollTop / maxScroll : 0;
    })).toBeGreaterThan(0.45);

    await page.keyboard.press("Escape");
    await expect(page.locator(".grimoire-view")).not.toHaveClass(/grimoire-view--reader/);
    await expect(page.getByRole("button", { name: "Reader", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reader", exact: true })).toBeFocused();
    await expect(page.locator(".grimoire-view .cm-editor")).toBeVisible();
    await expect.poll(() => markdownViewport.evaluate((element) => {
      const maxScroll = element.scrollHeight - element.clientHeight;
      return maxScroll > 0 ? element.scrollTop / maxScroll : 0;
    })).toBeGreaterThan(0.45);
    await typeInEditor(page, " Editable again.");
    await expect.poll(() => knowledgePosts.length, { timeout: 10_000 }).toBe(1);

    await page.getByRole("button", { name: "Reader", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".md-editor--reader .ProseMirror")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(".md-editor--reader .ProseMirror")).toContainText("Editable again.");
    await page.getByRole("button", { name: "Incident playbook", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Incident playbook", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Reader", exact: true })).toBeFocused();

    await page.setViewportSize({ width: 320, height: 720 });
    const compactHeader = page.locator(".grimoire-header");
    await expect(page.getByRole("button", { name: "Reader", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "More Memories actions" })).toBeVisible();
    expect(await compactHeader.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("closing an unsaved title draft restores the persisted Reader title on reopen", async ({ page }) => {
    await gotoGrimoire(page);
    await rail(page).getByRole("button", { name: /Release checklist/ }).click();

    const titleLine = page.locator(".grimoire-view .cm-line").filter({ hasText: "title: Release checklist" });
    await titleLine.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.type("title: Discard this title");
    await page.getByRole("button", { name: "Close Release checklist (unsaved changes)" }).click();
    await page.getByRole("button", { name: "Close tab", exact: true }).click();

    await rail(page).getByRole("button", { name: /Release checklist/ }).click();
    await page.getByRole("button", { name: "Reader", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Release checklist", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Discard this title", exact: true })).toHaveCount(0);
    expect(knowledgePosts).toHaveLength(0);
  });

  test("memory files never autosave — typing leaves the draft unsaved", async ({ page }) => {
    await gotoGrimoire(page);
    await rail(page).getByRole("button", { name: /notes\.md/ }).click();

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
